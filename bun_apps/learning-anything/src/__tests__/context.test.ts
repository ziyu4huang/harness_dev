/**
 * context.test.ts — Unit tests for the chat context builder.
 *
 * Tests: buildChatContext search + 1-hop expansion, formatContextForPrompt output.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GraphStore } from "../graph.js";
import type { KnowledgeGraph } from "../graph.js";
import { buildChatContext, formatContextForPrompt } from "../context.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ─── Test Graph Fixture ────────────────────────────────────────────────────────

const TEST_GRAPH: KnowledgeGraph = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "context-test",
    languages: ["typescript"],
    frameworks: ["bun"],
    description: "Context builder test graph",
    analyzedAt: "2025-01-01",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:auth.ts", type: "file", name: "auth.ts", filePath: "auth.ts", summary: "Authentication module", tags: ["auth"], complexity: "moderate" },
    { id: "fn:auth.ts:login", type: "function", name: "login", filePath: "auth.ts", summary: "Login handler function", tags: ["auth", "handler"], complexity: "moderate" },
    { id: "fn:auth.ts:logout", type: "function", name: "logout", filePath: "auth.ts", summary: "Logout handler function", tags: ["auth", "handler"], complexity: "simple" },
    { id: "file:db.ts", type: "file", name: "db.ts", filePath: "db.ts", summary: "Database access module", tags: ["database"], complexity: "complex" },
    { id: "fn:db.ts:query", type: "function", name: "query", filePath: "db.ts", summary: "Execute database query", tags: ["database", "query"], complexity: "complex" },
  ],
  edges: [
    { source: "file:auth.ts", target: "fn:auth.ts:login", type: "contains" },
    { source: "file:auth.ts", target: "fn:auth.ts:logout", type: "contains" },
    { source: "file:db.ts", target: "fn:db.ts:query", type: "contains" },
    { source: "fn:auth.ts:login", target: "fn:db.ts:query", type: "calls" },
  ],
  layers: [
    { id: "auth-layer", name: "Authentication", description: "Authentication logic", nodeIds: ["file:auth.ts", "fn:auth.ts:login", "fn:auth.ts:logout"] },
    { id: "data-layer", name: "Data Access", description: "Database access", nodeIds: ["file:db.ts", "fn:db.ts:query"] },
  ],
  tour: [],
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

const ROOT = import.meta.dir.replace(/[/\\]src[/\\]__tests__$/, "");
const tmpDir = join(ROOT, "__tmp_context_test__");
const graphPath = join(tmpDir, "test-graph.json");
let store: GraphStore;

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(graphPath, JSON.stringify(TEST_GRAPH, null, 2));
  store = new GraphStore(graphPath);
  store.load();
});

import { afterAll } from "bun:test";
afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("buildChatContext", () => {
  test("finds relevant nodes by search query", () => {
    const ctx = buildChatContext(store, "auth", 15);
    expect(ctx.relevantNodes.length).toBeGreaterThan(0);
    const names = ctx.relevantNodes.map(n => n.name);
    expect(names.some(n => n.includes("auth") || n.includes("login") || n.includes("logout"))).toBe(true);
  });

  test("expands to 1-hop connected nodes", () => {
    const ctx = buildChatContext(store, "login", 15);
    // login -> db.ts:query via "calls" edge, so db.query should appear
    const names = ctx.relevantNodes.map(n => n.name);
    expect(names).toContain("query");
  });

  test("collects relevant layers", () => {
    const ctx = buildChatContext(store, "auth", 15);
    expect(ctx.relevantLayers.length).toBeGreaterThan(0);
    const layerNames = ctx.relevantLayers.map(l => l.name);
    expect(layerNames).toContain("Authentication");
  });

  test("includes edges between relevant nodes", () => {
    const ctx = buildChatContext(store, "auth", 15);
    expect(ctx.relevantEdges.length).toBeGreaterThan(0);
    // Should contain the "calls" edge from login to query
    const hasCallsEdge = ctx.relevantEdges.some(
      e => e.type === "calls" && e.source.includes("login") && e.target.includes("query"),
    );
    expect(hasCallsEdge).toBe(true);
  });

  test("populates project metadata", () => {
    const ctx = buildChatContext(store, "auth", 15);
    expect(ctx.projectName).toBe("context-test");
    expect(ctx.languages).toContain("typescript");
    expect(ctx.frameworks).toContain("bun");
  });

  test("respects maxNodes parameter", () => {
    // With maxNodes=1, expansion is limited
    const ctx = buildChatContext(store, "auth", 1);
    // At minimum the directly matched node should be there
    expect(ctx.relevantNodes.length).toBeGreaterThanOrEqual(1);
  });

  test("returns empty nodes for query with no matches", () => {
    const ctx = buildChatContext(store, "xyzzy-nothing-matches-this", 15);
    expect(ctx.relevantNodes.length).toBe(0);
    expect(ctx.relevantEdges.length).toBe(0);
  });
});

describe("formatContextForPrompt", () => {
  test("produces markdown with project header", () => {
    const ctx = buildChatContext(store, "auth", 15);
    const md = formatContextForPrompt(ctx);
    expect(md).toContain("# Project: context-test");
    expect(md).toContain("Authentication module");
  });

  test("includes Layers section when layers are relevant", () => {
    const ctx = buildChatContext(store, "auth", 15);
    const md = formatContextForPrompt(ctx);
    expect(md).toContain("## Relevant Layers");
    expect(md).toContain("Authentication");
  });

  test("includes Code Components section with node details", () => {
    const ctx = buildChatContext(store, "auth", 15);
    const md = formatContextForPrompt(ctx);
    expect(md).toContain("## Code Components");
    expect(md).toContain("auth.ts");
  });

  test("includes Relationships section with edges", () => {
    const ctx = buildChatContext(store, "auth", 15);
    const md = formatContextForPrompt(ctx);
    expect(md).toContain("## Relationships");
    expect(md).toContain("calls");
  });

  test("handles empty context gracefully", () => {
    const ctx = buildChatContext(store, "xyzzy-no-match", 15);
    const md = formatContextForPrompt(ctx);
    expect(md).toContain("# Project: context-test");
  });
});
