/**
 * explain.test.ts — Unit tests for the node explanation builder.
 *
 * Tests: buildExplainContext with path:function format, child node collection,
 * connected nodes, formatExplainPrompt output.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GraphStore } from "../graph.js";
import type { KnowledgeGraph } from "../graph.js";
import { buildExplainContext, formatExplainPrompt } from "../explain.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ─── Test Graph Fixture ────────────────────────────────────────────────────────

const TEST_GRAPH: KnowledgeGraph = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "explain-test",
    languages: ["typescript"],
    frameworks: ["bun"],
    description: "Explain builder test graph",
    analyzedAt: "2025-01-01",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:server.ts", type: "file", name: "server.ts", filePath: "server.ts", summary: "Main server module", tags: ["server"], complexity: "moderate" },
    { id: "fn:server.ts:handleRequest", type: "function", name: "handleRequest", filePath: "server.ts", summary: "Handle incoming request", tags: ["server", "http"], complexity: "complex" },
    { id: "fn:server.ts:startServer", type: "function", name: "startServer", filePath: "server.ts", summary: "Start HTTP server", tags: ["server"], complexity: "simple" },
    { id: "file:utils.ts", type: "file", name: "utils.ts", filePath: "utils.ts", summary: "Utility functions", tags: ["util"], complexity: "simple" },
    { id: "fn:utils.ts:parseJSON", type: "function", name: "parseJSON", filePath: "utils.ts", summary: "Parse JSON safely", tags: ["util", "json"], complexity: "simple" },
    { id: "concept:microservice", type: "concept", name: "Microservice", summary: "Microservice architecture pattern", tags: ["architecture"], complexity: "simple" },
  ],
  edges: [
    { source: "file:server.ts", target: "fn:server.ts:handleRequest", type: "contains" },
    { source: "file:server.ts", target: "fn:server.ts:startServer", type: "contains" },
    { source: "file:utils.ts", target: "fn:utils.ts:parseJSON", type: "contains" },
    { source: "fn:server.ts:handleRequest", target: "fn:utils.ts:parseJSON", type: "calls" },
    { source: "concept:microservice", target: "file:server.ts", type: "related" },
  ],
  layers: [
    { id: "server", name: "Server", description: "HTTP server layer", nodeIds: ["file:server.ts", "fn:server.ts:handleRequest", "fn:server.ts:startServer"] },
  ],
  tour: [],
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

const ROOT = import.meta.dir.replace(/[/\\]src[/\\]__tests__$/, "");
const tmpDir = join(ROOT, "__tmp_explain_test__");
const graphPath = join(tmpDir, "test-graph.json");
let store: GraphStore;

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(graphPath, JSON.stringify(TEST_GRAPH, null, 2));
  store = new GraphStore(graphPath);
  store.load();
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("buildExplainContext", () => {
  test("finds node by file path", () => {
    const ctx = buildExplainContext(store, "server.ts");
    expect(ctx.targetNode).not.toBeNull();
    expect(ctx.targetNode!.name).toBe("server.ts");
    expect(ctx.targetNode!.type).toBe("file");
  });

  test("finds node by path:function format", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    expect(ctx.targetNode).not.toBeNull();
    expect(ctx.targetNode!.name).toBe("handleRequest");
  });

  test("finds node by exact ID", () => {
    const ctx = buildExplainContext(store, "concept:microservice");
    expect(ctx.targetNode).not.toBeNull();
    expect(ctx.targetNode!.name).toBe("Microservice");
  });

  test("collects child nodes via contains edges", () => {
    const ctx = buildExplainContext(store, "server.ts");
    expect(ctx.childNodes.length).toBe(2);
    const childNames = ctx.childNodes.map(n => n.name);
    expect(childNames).toContain("handleRequest");
    expect(childNames).toContain("startServer");
  });

  test("finds connected nodes (1-hop neighbors)", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    expect(ctx.connectedNodes.length).toBeGreaterThan(0);
    const connNames = ctx.connectedNodes.map(n => n.name);
    // handleRequest calls parseJSON, so parseJSON should be connected
    expect(connNames).toContain("parseJSON");
  });

  test("finds relevant edges", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    expect(ctx.relevantEdges.length).toBeGreaterThan(0);
    const hasCallsEdge = ctx.relevantEdges.some(e => e.type === "calls");
    expect(hasCallsEdge).toBe(true);
  });

  test("finds layer for node", () => {
    const ctx = buildExplainContext(store, "server.ts");
    expect(ctx.layer).not.toBeNull();
    expect(ctx.layer!.name).toBe("Server");
  });

  test("returns null targetNode for nonexistent path", () => {
    const ctx = buildExplainContext(store, "nonexistent.ts");
    expect(ctx.targetNode).toBeNull();
    expect(ctx.childNodes).toEqual([]);
    expect(ctx.connectedNodes).toEqual([]);
    expect(ctx.relevantEdges).toEqual([]);
    expect(ctx.layer).toBeNull();
  });

  test("populates project name", () => {
    const ctx = buildExplainContext(store, "server.ts");
    expect(ctx.projectName).toBe("explain-test");
  });

  test("preserves the original path in context", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    expect(ctx.path).toBe("server.ts:handleRequest");
  });
});

describe("formatExplainPrompt", () => {
  test("produces Deep Dive markdown for found node", () => {
    const ctx = buildExplainContext(store, "server.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("# Deep Dive: server.ts");
    expect(md).toContain("file");
  });

  test("includes Internal Components section for nodes with children", () => {
    const ctx = buildExplainContext(store, "server.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("## Internal Components");
    expect(md).toContain("handleRequest");
  });

  test("includes Architectural Layer when layer found", () => {
    const ctx = buildExplainContext(store, "server.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("## Architectural Layer: Server");
  });

  test("includes Instructions section", () => {
    const ctx = buildExplainContext(store, "server.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("## Instructions");
    expect(md).toContain("thorough explanation");
  });

  test("produces not-found message for nonexistent path", () => {
    const ctx = buildExplainContext(store, "nonexistent.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("Component Not Found");
    expect(md).toContain("nonexistent.ts");
  });

  test("includes Connected Components when present", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("## Connected Components");
  });

  test("includes Relationships section with non-contains edges", () => {
    const ctx = buildExplainContext(store, "server.ts:handleRequest");
    const md = formatExplainPrompt(ctx);
    if (ctx.relevantEdges.some(e => e.type !== "contains")) {
      expect(md).toContain("## Relationships");
    }
  });
});
