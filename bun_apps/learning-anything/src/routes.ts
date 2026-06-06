/**
 * Routes: API route handlers for the learning-anything server.
 *
 * Endpoints:
 *   GET  /health                    — Health check
 *   GET  /api/stats                 — Graph stats summary
 *   GET  /api/nodes?type=fn&limit=N — List nodes (optional type filter)
 *   GET  /api/nodes/:id             — Get node by ID
 *   GET  /api/nodes/:id/neighbors   — Get 1-hop neighborhood
 *   GET  /api/nodes/:id/deps        — Get dependency tree
 *   GET  /api/layers                — List layers
 *   GET  /api/layers/:id            — Get layer with nodes
 *   GET  /api/tour                  — Get guided tour
 *   GET  /api/search?q=query        — Text search
 *   POST /api/chat                  — LLM chat with graph context
 *   POST /api/chat/stream           — Streaming LLM chat
 *   POST /api/analyze/root-cause    — Root cause analysis
 *   POST /api/analyze/architecture  — Architecture analysis
 *   POST /api/workflow/design       — Workflow design assistance
 *   POST /api/graph/reload          — Force reload graph from disk
 *   POST /api/ignore/generate       — Generate starter .understandignore file
 *   POST /api/parse                  — Parse non-code files (YAML, JSON, Markdown)
 */

import type { GraphStore } from "./graph.js";
import { getEnv, LIMITS } from "./config.js";
import * as agent from "./agent.js";
import type { AgentMessage } from "./agent.js";
import { AgentError } from "./agent.js";
import { validateGraph } from "./validate.js";
import { requestLogger, logResponse, rateLimiter, classifyError, checkResponseCache, storeResponseCache, invalidateResponseCache, getMetrics, getCacheSize, MAX_CACHE_ENTRIES } from "./middleware.js";
import { createIgnoreFilter, generateStarterIgnoreFile } from "./ignore.js";
import { generateHeuristicTour, type TourGroupingMode } from "./tour.js";
import { cosineSimilarity } from "./semantic-search.js";
import { contentHash } from "./fingerprint.js";
import type { LLMLayerResponse } from "./layer-detector.js";
import { normalizeBatchOutput } from "./normalize.js";
import { autoParse, parseYamlConfig, parseJsonConfig, parseMarkdown } from "./parsers.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * Safely parse an integer query parameter with clamping.
 * Returns `defaults.default` for null/NaN, clamps to [min, max].
 */
function parseIntParam(
  value: string | null,
  defaults: { default: number; min: number; max: number },
): number {
  if (value === null) return defaults.default;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaults.default;
  return Math.max(defaults.min, Math.min(defaults.max, parsed));
}

/**
 * Extract pagination parameters (offset + limit) from query string.
 * Offset defaults to 0, limit defaults to 200 with a max cap.
 */
function parsePagination(query: URLSearchParams): { offset: number; limit: number } {
  return {
    offset: parseIntParam(query.get("offset"), { default: 0, min: 0, max: 100000 }),
    limit: parseIntParam(query.get("limit"), { default: 200, min: 1, max: LIMITS.maxQueryResults }),
  };
}

/**
 * Validate that a request body has all required fields.
 * Returns a 400 error Response if any field is missing, otherwise returns null.
 */
function validateBody(body: unknown, requiredFields: string[]): Response | null {
  if (!body || typeof body !== "object") {
    return error("Request body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
      return error(`Missing required field: ${field}`);
    }
  }
  return null;
}

/** Parse URL path segments after /api/ */
function parsePath(url: string): { segments: string[]; query: URLSearchParams } {
  const u = new URL(url);
  const segments = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  return { segments, query: u.searchParams };
}

/**
 * Validate and decode a dynamic path parameter (node ID, layer ID).
 * Rejects IDs that are too long, contain path traversal patterns, null bytes,
 * or have malformed percent encoding.
 */
function validateAndDecodeId(raw: string): { ok: true; id: string } | { ok: false; response: Response } {
  if (raw.length > 512) {
    return { ok: false, response: error("ID parameter exceeds maximum length of 512 characters", 400) };
  }
  if (raw.includes("..") || raw.includes("\0")) {
    return { ok: false, response: error("ID parameter contains invalid characters", 400) };
  }
  try {
    return { ok: true, id: decodeURIComponent(raw) };
  } catch {
    return { ok: false, response: error("ID parameter contains malformed percent encoding", 400) };
  }
}

// ─── Route Handler Type ──────────────────────────────────────────────────────

type Handler = (
  segments: string[],
  query: URLSearchParams,
  body: unknown,
  graphStore: GraphStore,
  signal?: AbortSignal,
  requestId?: string,
) => Promise<Response> | Response;

// ─── Routes ──────────────────────────────────────────────────────────────────

const GET_ROUTES: Record<string, Handler> = {
  health: async () => json({ status: "ok", uptime: process.uptime() }),

  "api/stats": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    return json(gs.getStats());
  },

  "api/nodes": async (_s, q, _b, gs) => {
    const type = q.get("type") ?? undefined;
    const { offset, limit } = parsePagination(q);
    const allNodes = gs.getNodes(type);
    const nodes = allNodes.slice(offset, offset + limit);
    return json({ nodes, total: allNodes.length, offset, limit });
  },

  "api/layers": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    return json(gs.data.layers);
  },

  "api/tour": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    return json(gs.data.tour);
  },

  "api/search": async (_s, q, _b, gs) => {
    const query = q.get("q");
    if (!query) return error("Missing query parameter: q");
    const limit = parseIntParam(q.get("limit"), { default: 50, min: 1, max: 100 });
    const useIgnoreFilter = q.get("ignored") !== "false";
    let nodes = gs.search(query, limit);
    if (useIgnoreFilter) {
      const filter = createIgnoreFilter();
      nodes = nodes.filter(n => !n.filePath || !filter.isIgnored(n.filePath));
    }
    return json({ query, nodes, count: nodes.length });
  },

  "api/onboard": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const guide = agent.generateOnboardingGuide(gs);
    return json({ guide });
  },

  "api/staleness": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const result = gs.checkStaleness();
    return json(result);
  },

  "api/hotspots": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const hotspots = gs.getHotspots();
    return json({ hotspots, count: hotspots.length });
  },

  "api/health/detailed": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const stats = gs.getStats();
    const layerHealth = gs.getLayerHealth();
    return json({ stats, layerHealth });
  },

  "api/explain": async (_s, q, _b, gs, signal) => {
    const path = q.get("path");
    if (!path) return error("Missing query parameter: path");
    const result = await agent.explainNode(path, gs, "pro", signal);
    return json(result);
  },

  "api/validate": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const issues = gs.validationIssues;
    const isValid = issues.filter(i => i.level === "dropped" || i.level === "fatal").length === 0;
    return json({
      valid: isValid,
      totalIssues: issues.length,
      autoCorrected: issues.filter(i => i.level === "auto-corrected").length,
      dropped: issues.filter(i => i.level === "dropped").length,
      issues: issues.map(i => ({
        level: i.level,
        category: i.category,
        message: i.message,
        path: i.path,
      })),
    });
  },

  "api/search/semantic": async (_s, q, _b, gs) => {
    gs.ensureLoaded();
    const engine = gs.getSemanticSearchEngine();
    if (!engine || !engine.hasEmbeddings()) {
      return json({ nodes: [], count: 0, message: "No embeddings available. Pre-compute embeddings and add them to nodes." });
    }
    // For GET, accept comma-separated embedding values via ?e= query param
    const embeddingStr = q.get("e");
    if (!embeddingStr) return error("Missing query parameter: e (comma-separated embedding values)");
    const embedding = embeddingStr.split(",").map(Number).filter(n => !isNaN(n));
    if (embedding.length === 0) return error("Invalid embedding values");
    const threshold = q.get("threshold") ? parseFloat(q.get("threshold")!) : undefined;
    const limit = parseIntParam(q.get("limit"), { default: 10, min: 1, max: 100 });
    const typesStr = q.get("types");
    const types = typesStr ? typesStr.split(",") : undefined;
    const nodes = gs.semanticSearch(embedding, { threshold, limit, types });
    return json({ nodes, count: nodes.length });
  },

  "api/graph/fingerprints": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const store = gs.loadFingerprints();
    if (!store) {
      return json({ message: "No fingerprint store found. Compute fingerprints first via POST /api/graph/fingerprints/compute." });
    }
    return json({
      version: store.version,
      gitCommitHash: store.gitCommitHash,
      generatedAt: store.generatedAt,
      fileCount: Object.keys(store.files).length,
      files: store.files,
    });
  },

  "api/layers/detect": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const layers = gs.detectLayersHeuristic();
    return json({ layers, count: layers.length, mode: "heuristic" });
  },

  "api/language/concepts": async (_s, _q, _b, gs) => {
    gs.ensureLoaded();
    const conceptMap = gs.detectAllConcepts();
    const summary = Object.entries(conceptMap).map(([concept, nodeIds]) => ({
      concept,
      nodeCount: nodeIds.length,
      nodeIds: nodeIds.slice(0, 20),
    }));
    return json({ concepts: summary, totalConcepts: summary.length });
  },

  "api/metrics": async () => {
    const snapshot = getMetrics(getCacheSize(), MAX_CACHE_ENTRIES);
    return json(snapshot);
  },
};

// Dynamic path routes (need special handling)
async function handleDynamicGet(
  segments: string[],
  query: URLSearchParams,
  graphStore: GraphStore,
): Promise<Response | null> {
  // /api/nodes/:id
  const nodeMatch = segments.join("/").match(/^api\/nodes\/([^/]+)$/);
  if (nodeMatch) {
    const decoded = validateAndDecodeId(nodeMatch[1]);
    if (!decoded.ok) return decoded.response;
    const id = decoded.id;
    const suffix = query.get("view");
    if (suffix === "neighbors" || id.includes("/neighbors")) {
      const nodeId = id.replace(/\/neighbors$/, "");
      const { nodes, edges } = graphStore.getNeighborhood(nodeId, LIMITS.maxContextNodes);
      return json({ center: nodeId, nodes, edges });
    }
    if (suffix === "deps" || id.includes("/deps")) {
      const nodeId = id.replace(/\/deps$/, "");
      const depth = parseIntParam(query.get("depth"), { default: 3, min: 1, max: 10 });
      const { nodes, edges } = graphStore.getDependencyTree(nodeId, depth);
      return json({ root: nodeId, nodes, edges });
    }
    const node = graphStore.getNode(id);
    if (!node) return error("Node not found", 404);
    const edges = graphStore.getEdgesForNode(id);
    return json({ node, edges });
  }

  // /api/layers/:id
  const layerMatch = segments.join("/").match(/^api\/layers\/([^/]+)$/);
  if (layerMatch) {
    const decoded = validateAndDecodeId(layerMatch[1]);
    if (!decoded.ok) return decoded.response;
    const id = decoded.id;
    const nodes = graphStore.getLayerNodes(id);
    if (nodes.length === 0) return error("Layer not found", 404);
    return json({ layerId: id, nodes, count: nodes.length });
  }

  // /api/path?from=id&to=id
  const pathMatch = segments.join("/").match(/^api\/path$/);
  if (pathMatch) {
    const from = query.get("from");
    const to = query.get("to");
    if (!from || !to) return error("Missing query parameters: from, to");
    const result = graphStore.getPathBetween(from, to);
    return json({ from, to, nodes: result.nodes, edges: result.edges, found: result.nodes.length > 0 });
  }

  return null;
}

const POST_ROUTES: Record<string, Handler> = {
  "api/chat": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["messages"]);
    if (validationErr) return validationErr;
    const { messages, model } = body as { messages: AgentMessage[]; model?: string };
    if (!Array.isArray(messages) || messages.length === 0) return error("messages must be a non-empty array");
    const result = await agent.chat(messages, model ?? "flash", gs, signal, requestId);
    return json(result);
  },

  "api/chat/stream": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["messages"]);
    if (validationErr) return validationErr;
    const { messages, model } = body as { messages: AgentMessage[]; model?: string };
    if (!Array.isArray(messages) || messages.length === 0) return error("messages must be a non-empty array");
    const stream = await agent.chatStream(messages, model ?? "flash", gs, signal, requestId);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },

  "api/analyze/root-cause": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["problem"]);
    if (validationErr) return validationErr;
    const { problem, model } = body as { problem: string; model?: string };
    const result = await agent.rootCauseAnalysis(problem, gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/analyze/architecture": async (_s, _q, body, gs, signal, requestId) => {
    const { model } = (body as { model?: string }) ?? {};
    const result = await agent.analyzeArchitecture(gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/workflow/design": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["goal"]);
    if (validationErr) return validationErr;
    const { goal, model } = body as { goal: string; model?: string };
    const result = await agent.designWorkflow(goal, gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/explain": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["path"]);
    if (validationErr) return validationErr;
    const { path, model } = body as { path: string; model?: string };
    const result = await agent.explainNode(path, gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/diff/analyze": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["changedFiles"]);
    if (validationErr) return validationErr;
    const { changedFiles, model } = body as { changedFiles: string[]; model?: string };
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) return error("changedFiles must be a non-empty array");
    const result = await agent.analyzeDiff(changedFiles, gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/analyze/file": async (_s, _q, body, gs, signal, requestId) => {
    const validationErr = validateBody(body, ["filePath", "content"]);
    if (validationErr) return validationErr;
    const { filePath, content, model } = body as { filePath: string; content: string; model?: string };
    const result = await agent.analyzeFile(filePath, content, gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/analyze/project-summary": async (_s, _q, body, gs, signal, requestId) => {
    gs.ensureLoaded();
    const { model } = (body as { model?: string }) ?? {};
    const result = await agent.summarizeProject(gs, model ?? "pro", signal, requestId);
    return json(result);
  },

  "api/graph/reload": async (_s, _q, _b, gs) => {
    try {
      gs.load();
      invalidateResponseCache();
      return json({ status: "reloaded", stats: gs.getStats() });
    } catch (e) {
      return error(`Reload failed: ${(e as Error).message}`, 500);
    }
  },

  "api/graph/save": async (_s, _q, _b, gs) => {
    try {
      const bytesWritten = gs.save();
      invalidateResponseCache();
      return json({ status: "saved", bytesWritten, stats: gs.getStats() });
    } catch (e) {
      return error(`Save failed: ${(e as Error).message}`, 500);
    }
  },

  "api/graph/merge": async (_s, _q, body, gs) => {
    const validationErr = validateBody(body, ["changedFiles"]);
    if (validationErr) return validationErr;
    const { changedFiles, newNodes, newEdges } = body as {
      changedFiles: string[];
      newNodes: import("./graph.js").GraphNode[];
      newEdges: import("./graph.js").GraphEdge[];
    };
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) return error("changedFiles must be a non-empty array");
    if (!Array.isArray(newNodes) && !Array.isArray(newEdges)) return error("Missing newNodes or newEdges");
    try {
      const result = gs.mergeGraphUpdate(changedFiles, newNodes ?? [], newEdges ?? []);
      invalidateResponseCache();
      return json({ status: "merged", ...result, stats: gs.getStats() });
    } catch (e) {
      return error(`Merge failed: ${(e as Error).message}`, 500);
    }
  },

  "api/graph/normalize": async (_s, _q, body) => {
    const validationErr = validateBody(body, []);
    if (validationErr) return validationErr;
    const { nodes, edges } = body as {
      nodes?: import("./graph.js").GraphNode[];
      edges?: import("./graph.js").GraphEdge[];
    };
    if (!Array.isArray(nodes) && !Array.isArray(edges)) return error("Missing nodes or edges");
    try {
      const result = normalizeBatchOutput({
        nodes: Array.isArray(nodes) ? nodes : [],
        edges: Array.isArray(edges) ? edges : [],
      });
      return json({
        nodes: result.nodes,
        edges: result.edges,
        stats: result.stats,
      });
    } catch (e) {
      return error(`Normalization failed: ${(e as Error).message}`, 500);
    }
  },

  "api/tour/generate": async (_s, _q, body, gs) => {
    gs.ensureLoaded();
    const { mode, batchSize } = body as { mode?: TourGroupingMode; batchSize?: number };
    const graph = gs.data;
    const tour = generateHeuristicTour(
      graph.nodes,
      graph.edges,
      graph.layers,
      { mode: mode ?? "batch", batchSize },
    );
    return json({ tour, stepCount: tour.length, mode: mode ?? "batch" });
  },

  "api/search/semantic": async (_s, _q, body, gs) => {
    gs.ensureLoaded();
    const validationErr = validateBody(body, ["embedding"]);
    if (validationErr) return validationErr;
    const { embedding, types, threshold, limit } = body as {
      embedding: number[];
      types?: string[];
      threshold?: number;
      limit?: number;
    };
    if (!Array.isArray(embedding) || embedding.length === 0 || typeof embedding[0] !== "number") {
      return error("'embedding' must be a non-empty array of numbers");
    }
    const engine = gs.getSemanticSearchEngine();
    if (!engine || !engine.hasEmbeddings()) {
      return json({ nodes: [], count: 0, message: "No embeddings available. Pre-compute embeddings and add them to nodes." });
    }
    const nodes = gs.semanticSearch(embedding, { types, threshold, limit: limit ?? 10 });
    return json({ nodes, count: nodes.length });
  },

  "api/graph/fingerprints/compute": async (_s, _q, body, gs) => {
    gs.ensureLoaded();
    const validationErr = validateBody(body, []);
    if (validationErr) return validationErr;
    const { projectDir } = body as { projectDir?: string };
    try {
      const store = gs.computeFingerprints(projectDir);
      gs.saveFingerprints(store);
      return json({
        status: "computed",
        fileCount: Object.keys(store.files).length,
        gitCommitHash: store.gitCommitHash,
        generatedAt: store.generatedAt,
      });
    } catch (e) {
      return error(`Fingerprint computation failed: ${(e as Error).message}`, 500);
    }
  },

  "api/graph/analyze-changes": async (_s, _q, body, gs) => {
    const validationErr = validateBody(body, ["changedFiles"]);
    if (validationErr) return validationErr;
    const { changedFiles, projectDir } = body as { changedFiles: string[]; projectDir?: string };
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) return error("changedFiles must be a non-empty array");
    try {
      const result = gs.analyzeChangesWithFingerprints(changedFiles, projectDir);
      return json({
        analysis: result.analysis,
        decision: result.decision,
      });
    } catch (e) {
      return error(`Change analysis failed: ${(e as Error).message}`, 500);
    }
  },

  "api/layers/detect/llm": async (_s, _q, body, gs, signal, requestId) => {
    gs.ensureLoaded();
    const { model } = body as { model?: string };
    try {
      const layers = await agent.detectLayersLLM(gs, model ?? "pro", signal);
      // Also apply the layers to get node assignments
      const appliedLayers = gs.applyDetectedLLMLayers(layers);
      return json({
        layers: appliedLayers,
        count: appliedLayers.length,
        mode: "llm",
      });
    } catch (e) {
      return error(`LLM layer detection failed: ${(e as Error).message}`, 500);
    }
  },

  "api/tour/language-lesson": async (_s, _q, body, gs, signal, requestId) => {
    gs.ensureLoaded();
    const validationErr = validateBody(body, ["nodeId"]);
    if (validationErr) return validationErr;
    const { nodeId, language, model } = body as { nodeId: string; language?: string; model?: string };
    try {
      const result = await agent.generateLanguageLesson(nodeId, gs, language ?? "TypeScript", model ?? "pro", signal, requestId);
      return json(result);
    } catch (e) {
      return error(`Language lesson generation failed: ${(e as Error).message}`, 500);
    }
  },

  "api/tour/generate/llm": async (_s, _q, body, gs, signal) => {
    gs.ensureLoaded();
    const { model } = body as { model?: string };
    try {
      const steps = await agent.detectTourLLM(gs, model ?? "pro", signal);
      return json({
        steps,
        stepCount: steps.length,
        mode: "llm",
      });
    } catch (e) {
      return error(`LLM tour generation failed: ${(e as Error).message}`, 500);
    }
  },

  "api/ignore/generate": async (_s, _q, body) => {
    const validationErr = validateBody(body, []);
    if (validationErr) return validationErr;
    const { projectDir } = body as { projectDir?: string };
    const dir = projectDir ?? process.cwd();
    try {
      const content = generateStarterIgnoreFile(dir);
      return json({
        content,
        length: content.length,
        projectDir: dir,
      });
    } catch (e) {
      return error(`Starter ignore file generation failed: ${(e as Error).message}`, 500);
    }
  },

  "api/parse": async (_s, _q, body) => {
    const validationErr = validateBody(body, ["filePath", "content"]);
    if (validationErr) return validationErr;
    const { filePath, content, parser } = body as { filePath: string; content: string; parser?: string };
    try {
      let result;
      if (parser === "yaml") {
        result = parseYamlConfig(filePath, content);
      } else if (parser === "json") {
        result = parseJsonConfig(filePath, content);
      } else if (parser === "markdown") {
        result = parseMarkdown(filePath, content);
      } else {
        result = autoParse(filePath, content);
      }
      return json({
        nodes: result.nodes,
        edges: result.edges,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
      });
    } catch (e) {
      return error(`Parse failed: ${(e as Error).message}`, 500);
    }
  },
};

// ─── Rate Limiter Instance ───────────────────────────────────────────────────

const env = getEnv();
const limiter = rateLimiter({
  maxRequests: env.rateLimitMax,
  windowMs: env.rateLimitWindowMs,
});

// ─── Router ──────────────────────────────────────────────────────────────────

/** Dispatch to the correct route handler based on method + path. */
async function dispatchRoute(
  method: string, segments: string[], query: URLSearchParams,
  request: Request, graphStore: GraphStore, signal: AbortSignal, requestId: string,
): Promise<Response> {
  if (method === "GET") {
    const pathKey = segments.join("/");
    const handler = GET_ROUTES[pathKey];
    if (handler) {
      return await handler(segments, query, null, graphStore, signal, requestId);
    }
    const dynamicResp = await handleDynamicGet(segments, query, graphStore);
    return dynamicResp ?? error("Not found", 404);
  }

  if (method === "POST") {
    const pathKey = segments.join("/");
    const handler = POST_ROUTES[pathKey];
    if (!handler) return error("Not found", 404);

    // Reject oversized bodies before parsing
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > LIMITS.maxBodySizeBytes) {
      return error(`Request body exceeds maximum allowed size (${LIMITS.maxBodySizeBytes} bytes)`, 413);
    }

    let body: unknown = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await request.json();
      } catch {
        return error("Malformed JSON in request body", 400);
      }
    }
    return await handler(segments, query, body, graphStore, signal, requestId);
  }

  return error("Method not allowed", 405);
}

/** Build an error response from a caught exception. */
function buildErrorResponse(err: unknown, corsHeaders: Record<string, string>, elapsed: number, requestId: string): Response {
  const errInfo = classifyError(err);
  const agentMeta = err instanceof AgentError ? {
    functionName: err.functionName,
    model: err.model,
    retryable: err.retryable,
    category: err.category,
  } : undefined;

  return new Response(
    JSON.stringify({
      error: errInfo.message,
      code: errInfo.code,
      requestId,
      ...(agentMeta ? { agent: agentMeta } : {}),
    }),
    {
      status: errInfo.status,
      headers: { "Content-Type": "application/json", ...corsHeaders, "X-Response-Time": `${elapsed}ms` },
    },
  );
}

export async function handleRequest(
  request: Request,
  graphStore: GraphStore,
): Promise<Response> {
  const { segments, query } = parsePath(request.url);
  const method = request.method;
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip") ?? "unknown";

  const ctx = requestLogger(method, segments.join("/"), clientIp);

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "X-Request-Id": ctx.requestId,
  };

  // Rate limiting
  const rateResult = limiter.check(clientIp);
  corsHeaders["X-RateLimit-Remaining"] = String(rateResult.remaining);
  corsHeaders["X-RateLimit-Reset"] = String(rateResult.resetAt);
  if (!rateResult.allowed) {
    logResponse(ctx, 429);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Please retry later.", code: "RATE_LIMITED" }),
      { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  // Response cache check for GET
  if (method === "GET") {
    const cached = checkResponseCache(method, ctx.path, query.toString(), request.headers.get("if-none-match"));
    if (cached) {
      const elapsed = Date.now() - ctx.startTime;
      logResponse(ctx, cached.status);
      return new Response(cached.body, {
        status: cached.status,
        headers: { ...Object.fromEntries(cached.headers), ...corsHeaders, "X-Response-Time": `${elapsed}ms`, "X-Cache": "HIT" },
      });
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
    request.signal?.addEventListener?.("abort", () => controller.abort());

    const resp = await dispatchRoute(method, segments, query, request, graphStore, controller.signal, ctx.requestId);
    clearTimeout(timeoutId);

    const elapsed = Date.now() - ctx.startTime;
    const mergedHeaders: Record<string, string> = {
      ...Object.fromEntries(resp.headers), ...corsHeaders,
      "X-Response-Time": `${elapsed}ms`, "X-Cache": "MISS",
    };
    logResponse(ctx, resp.status);

    // Cache successful GET responses
    if (method === "GET" && resp.status >= 200 && resp.status < 300) {
      try { storeResponseCache(method, ctx.path, query.toString(), await resp.clone().text(), mergedHeaders); } catch { /* skip */ }
    }
    return new Response(resp.body, { status: resp.status, headers: mergedHeaders });
  } catch (err) {
    const elapsed = Date.now() - ctx.startTime;
    logResponse(ctx, classifyError(err).status);
    return buildErrorResponse(err, corsHeaders, elapsed, ctx.requestId);
  }
}
