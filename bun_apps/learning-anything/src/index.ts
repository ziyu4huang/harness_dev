#!/usr/bin/env bun
/**
 * learning-anything
 *
 * Bun web server that serves as a Claude Code dynamic workflow backend.
 * Uses Vercel AI SDK + DeepSeek models for LLM/agent capabilities.
 * Reads knowledge graphs produced by the Understand-Anything plugin.
 *
 * Usage:
 *   bun src/index.ts                          # start with defaults
 *   UA_GRAPH_PATH=../.understand-anything/knowledge-graph.json bun src/index.ts
 *   UA_PORT=4000 bun src/index.ts
 */

import { getEnv, LIMITS } from "./config.js";
import { GraphStore } from "./graph.js";
import { handleRequest } from "./routes.js";
import { cleanup } from "./middleware.js";

// ─── Main ────────────────────────────────────────────────────────────────────

const env = getEnv();

// Resolve graph path
let graphPath = env.graphPath;
if (!graphPath) {
  // Default: look for knowledge-graph.json in common locations relative to CWD
  const candidates = [
    ".understand-anything/knowledge-graph.json",
    "../Understand-Anything/.understand-anything/knowledge-graph.json",
    "../understand-anything/.understand-anything/knowledge-graph.json",
  ];
  for (const c of candidates) {
    try {
      const resolved = await import("path").then(p => p.resolve(c));
      const { existsSync } = await import("fs");
      if (existsSync(resolved)) {
        graphPath = resolved;
        break;
      }
    } catch {
      // skip
    }
  }
}

if (!graphPath) {
  console.error("ERROR: No knowledge-graph.json found. Set UA_GRAPH_PATH or run from a project with .understand-anything/");
  console.error("Usage: UA_GRAPH_PATH=/path/to/knowledge-graph.json bun src/index.ts");
  process.exit(1);
}

console.log(`Loading knowledge graph: ${graphPath}`);

const graphStore = new GraphStore(graphPath);
try {
  graphStore.load();
  const stats = graphStore.getStats();
  console.log(`Graph loaded: ${stats.totalNodes} nodes, ${stats.totalEdges} edges, ${stats.layers} layers`);
} catch (err) {
  console.error(`Failed to load graph: ${(err as Error).message}`);
  console.error("Server will start but graph endpoints will return errors until a valid graph is loaded.");
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: env.port,
  hostname: env.host,
  fetch(req: Request): Response | Promise<Response> {
    return handleRequest(req, graphStore);
  },
});

console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
console.log(`  ║  learning-anything                           ║`);
console.log(`  ║  http://${env.host}:${env.port}                        ║`);
console.log(`  ║  Graph: ${String(graphStore.loaded ? "loaded" : "not loaded").padEnd(43)}║`);
console.log(`  ║  Dashboard: ${env.dashboardUrl.padEnd(38)}║`);
console.log(`  ╚══════════════════════════════════════════════════════╝\n`);

console.log(`Endpoints:`);
console.log(`  GET  /health                 Health check`);
console.log(`  GET  /api/stats              Graph statistics`);
console.log(`  GET  /api/nodes?type=&limit= List nodes`);
console.log(`  GET  /api/nodes/:id          Get node + edges`);
console.log(`  GET  /api/nodes/:id/neighbors 1-hop neighborhood`);
console.log(`  GET  /api/nodes/:id/deps     Dependency tree`);
console.log(`  GET  /api/layers             List layers`);
console.log(`  GET  /api/search?q=&ignored= Text search (ignore filter)`);
console.log(`  POST /api/chat               LLM chat (body: {messages, model})`);
console.log(`  POST /api/chat/stream        Streaming LLM chat`);
console.log(`  POST /api/analyze/root-cause Root cause analysis`);
console.log(`  POST /api/analyze/architecture Architecture analysis`);
console.log(`  POST /api/analyze/file       LLM file analysis (body: {filePath, content})`);
console.log(`  POST /api/analyze/project-summary Project summary`);
console.log(`  POST /api/workflow/design    Workflow design`);
console.log(`  GET  /api/explain?path=      Explain node (UA port)`);
console.log(`  POST /api/explain            Explain node (body: {path})`);
console.log(`  POST /api/diff/analyze       Change impact analysis (UA port)`);
console.log(`  GET  /api/onboard            Onboarding guide (UA port)`);
console.log(`  GET  /api/staleness          Check graph freshness (UA port)`);
console.log(`  GET  /api/health/detailed    Detailed health + layer scores`);
console.log(`  GET  /api/hotspots           Complexity hotspots`);
console.log(`  GET  /api/path?from=&to=     Path between nodes`);
console.log(`  GET  /api/validate           Graph validation results`);
console.log(`  POST /api/graph/reload       Reload graph from disk`);
console.log(`  POST /api/graph/save         Save graph to disk`);
console.log(`  POST /api/graph/merge        Merge incremental updates
  POST /api/graph/normalize     Normalize graph nodes/edges`);
console.log(`  POST /api/tour/generate      Generate heuristic tour`);
console.log(`  POST /api/tour/generate/llm  LLM-based tour generation`);
console.log(`  GET  /api/search/semantic    Semantic search (embedding query)`);
console.log(`  POST /api/search/semantic    Semantic search (embedding body)`);
console.log(`  GET  /api/graph/fingerprints Inspect fingerprint store`);
console.log(`  POST /api/graph/fingerprints/compute  Compute fingerprints`);
console.log(`  POST /api/graph/analyze-changes      Analyze changes via fingerprints`);
console.log(`  GET  /api/layers/detect      Heuristic layer detection`);
console.log(`  POST /api/layers/detect/llm  LLM-based layer detection`);
console.log(`  POST /api/tour/language-lesson Generate language lesson for node`);
console.log(`  GET  /api/language/concepts  Detect language concepts across graph`);
console.log(`  GET  /api/metrics            Request/response metrics (latency, error rate, cache)`);

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.stop();
  console.log("  Server stopped accepting new connections.");

  // 2. Save graph state if dirty
  if (graphStore.dirty) {
    try {
      const bytesWritten = graphStore.save();
      console.log(`  Graph state saved (${bytesWritten} bytes).`);
    } catch (err) {
      console.error(`  Failed to save graph state: ${(err as Error).message}`);
    }
  }

  // 3. Clean up middleware resources (rate limiter interval, response cache)
  cleanup();
  console.log("  Middleware resources cleaned up.");

  console.log("  Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export { graphStore };
