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
 */

import type { GraphStore } from "./graph.js";
import { getEnv, LIMITS } from "./config.js";
import * as agent from "./agent.js";
import type { AgentMessage } from "./agent.js";
import { validateGraph } from "./validate.js";
import { requestLogger, logResponse, rateLimiter, classifyError } from "./middleware.js";
import { createIgnoreFilter } from "./ignore.js";

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

/** Parse URL path segments after /api/ */
function parsePath(url: string): { segments: string[]; query: URLSearchParams } {
  const u = new URL(url);
  const segments = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  return { segments, query: u.searchParams };
}

// ─── Route Handler Type ──────────────────────────────────────────────────────

type Handler = (
  segments: string[],
  query: URLSearchParams,
  body: unknown,
  graphStore: GraphStore,
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
    const limit = parseInt(q.get("limit") ?? "200", 10);
    const nodes = gs.getNodes(type).slice(0, Math.min(limit, LIMITS.maxQueryResults));
    return json({ nodes, total: gs.getNodes(type).length });
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
    const limit = parseInt(q.get("limit") ?? "50", 10);
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

  "api/explain": async (_s, q, _b, gs) => {
    const path = q.get("path");
    if (!path) return error("Missing query parameter: path");
    const result = await agent.explainNode(path, gs);
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
    const id = decodeURIComponent(nodeMatch[1]);
    const suffix = query.get("view");
    if (suffix === "neighbors" || id.includes("/neighbors")) {
      const nodeId = id.replace(/\/neighbors$/, "");
      const { nodes, edges } = graphStore.getNeighborhood(nodeId, LIMITS.maxContextNodes);
      return json({ center: nodeId, nodes, edges });
    }
    if (suffix === "deps" || id.includes("/deps")) {
      const nodeId = id.replace(/\/deps$/, "");
      const depth = parseInt(query.get("depth") ?? "3", 10);
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
    const id = decodeURIComponent(layerMatch[1]);
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
  "api/chat": async (_s, _q, body, gs) => {
    const { messages, model } = body as { messages: AgentMessage[]; model?: string };
    if (!messages?.length) return error("Missing messages array");
    const result = await agent.chat(messages, model ?? "flash", gs);
    return json(result);
  },

  "api/chat/stream": async (_s, _q, body, gs) => {
    const { messages, model } = body as { messages: AgentMessage[]; model?: string };
    if (!messages?.length) return error("Missing messages array");
    const stream = await agent.chatStream(messages, model ?? "flash", gs);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },

  "api/analyze/root-cause": async (_s, _q, body, gs) => {
    const { problem, model } = body as { problem: string; model?: string };
    if (!problem) return error("Missing problem description");
    const result = await agent.rootCauseAnalysis(problem, gs, model ?? "pro");
    return json(result);
  },

  "api/analyze/architecture": async (_s, _q, body, gs) => {
    const { model } = body as { model?: string };
    const result = await agent.analyzeArchitecture(gs, model ?? "pro");
    return json(result);
  },

  "api/workflow/design": async (_s, _q, body, gs) => {
    const { goal, model } = body as { goal: string; model?: string };
    if (!goal) return error("Missing goal description");
    const result = await agent.designWorkflow(goal, gs, model ?? "pro");
    return json(result);
  },

  "api/explain": async (_s, _q, body, gs) => {
    const { path, model } = body as { path: string; model?: string };
    if (!path) return error("Missing path parameter");
    const result = await agent.explainNode(path, gs, model ?? "pro");
    return json(result);
  },

  "api/diff/analyze": async (_s, _q, body, gs) => {
    const { changedFiles, model } = body as { changedFiles: string[]; model?: string };
    if (!changedFiles?.length) return error("Missing changedFiles array");
    const result = await agent.analyzeDiff(changedFiles, gs, model ?? "pro");
    return json(result);
  },

  "api/analyze/file": async (_s, _q, body, gs) => {
    const { filePath, content, model } = body as { filePath: string; content: string; model?: string };
    if (!filePath) return error("Missing filePath parameter");
    if (!content) return error("Missing content parameter");
    const result = await agent.analyzeFile(filePath, content, gs, model ?? "pro");
    return json(result);
  },

  "api/analyze/project-summary": async (_s, _q, body, gs) => {
    gs.ensureLoaded();
    const { model } = body as { model?: string };
    const result = await agent.summarizeProject(gs, model ?? "pro");
    return json(result);
  },

  "api/graph/reload": async (_s, _q, _b, gs) => {
    try {
      gs.load();
      return json({ status: "reloaded", stats: gs.getStats() });
    } catch (e) {
      return error(`Reload failed: ${(e as Error).message}`, 500);
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

export async function handleRequest(
  request: Request,
  graphStore: GraphStore,
): Promise<Response> {
  const { segments, query } = parsePath(request.url);
  const method = request.method;
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  // Middleware: request logging
  const ctx = requestLogger(method, segments.join("/"), clientIp);

  // CORS
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

  // Middleware: rate limiting
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

  try {
    let resp: Response;

    if (method === "GET") {
      const pathKey = segments.join("/");

      // Try static routes first
      const handler = GET_ROUTES[pathKey];
      if (handler) {
        resp = await handler(segments, query, null, graphStore);
      } else {
        // Try dynamic routes
        const dynamicResp = await handleDynamicGet(segments, query, graphStore);
        if (dynamicResp) {
          resp = dynamicResp;
        } else {
          resp = error("Not found", 404);
        }
      }
    } else if (method === "POST") {
      const pathKey = segments.join("/");
      const handler = POST_ROUTES[pathKey];
      if (!handler) {
        resp = error("Not found", 404);
      } else {
        let body: unknown = null;
        const contentType = request.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          body = await request.json();
        }
        resp = await handler(segments, query, body, graphStore);
      }
    } else {
      resp = error("Method not allowed", 405);
    }

    // Add middleware headers to response
    const elapsed = Date.now() - ctx.startTime;
    const mergedHeaders: Record<string, string> = {
      ...Object.fromEntries(resp.headers),
      ...corsHeaders,
      "X-Response-Time": `${elapsed}ms`,
    };

    logResponse(ctx, resp.status);

    return new Response(resp.body, {
      status: resp.status,
      headers: mergedHeaders,
    });
  } catch (err) {
    const errInfo = classifyError(err);
    const elapsed = Date.now() - ctx.startTime;
    logResponse(ctx, errInfo.status);

    return new Response(
      JSON.stringify({
        error: errInfo.message,
        code: errInfo.code,
        requestId: ctx.requestId,
      }),
      {
        status: errInfo.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
          "X-Response-Time": `${elapsed}ms`,
        },
      },
    );
  }
}
