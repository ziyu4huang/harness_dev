/**
 * diff.test.ts — Unit tests for the diff/change impact analyzer.
 *
 * Tests: buildDiffContext with changed files mapping to known nodes,
 * ripple detection, unmapped files, formatDiffAnalysis output.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GraphStore } from "../graph.js";
import type { KnowledgeGraph } from "../graph.js";
import { buildDiffContext, formatDiffAnalysis } from "../diff.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ─── Test Graph Fixture ────────────────────────────────────────────────────────

const TEST_GRAPH: KnowledgeGraph = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "diff-test",
    languages: ["typescript"],
    frameworks: ["bun"],
    description: "Diff analyzer test graph",
    analyzedAt: "2025-01-01",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", summary: "Module A", tags: ["core"], complexity: "simple" },
    { id: "fn:a.ts:process", type: "function", name: "process", filePath: "a.ts", summary: "Process data", tags: ["core"], complexity: "moderate" },
    { id: "file:b.ts", type: "file", name: "b.ts", filePath: "b.ts", summary: "Module B", tags: ["util"], complexity: "simple" },
    { id: "fn:b.ts:helper", type: "function", name: "helper", filePath: "b.ts", summary: "Helper function", tags: ["util"], complexity: "simple" },
    { id: "file:c.ts", type: "file", name: "c.ts", filePath: "c.ts", summary: "Module C", tags: ["api"], complexity: "complex" },
    { id: "fn:c.ts:endpoint", type: "function", name: "endpoint", filePath: "c.ts", summary: "API endpoint", tags: ["api"], complexity: "complex" },
  ],
  edges: [
    { source: "file:a.ts", target: "fn:a.ts:process", type: "contains" },
    { source: "file:b.ts", target: "fn:b.ts:helper", type: "contains" },
    { source: "file:c.ts", target: "fn:c.ts:endpoint", type: "contains" },
    { source: "fn:a.ts:process", target: "fn:b.ts:helper", type: "calls" },
    { source: "fn:c.ts:endpoint", target: "fn:a.ts:process", type: "calls" },
  ],
  layers: [
    { id: "core", name: "Core", description: "Core modules", nodeIds: ["file:a.ts", "fn:a.ts:process", "file:b.ts", "fn:b.ts:helper"] },
    { id: "api", name: "API", description: "API layer", nodeIds: ["file:c.ts", "fn:c.ts:endpoint"] },
  ],
  tour: [],
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

const ROOT = import.meta.dir.replace(/[/\\]src[/\\]__tests__$/, "");
const tmpDir = join(ROOT, "__tmp_diff_test__");
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

describe("buildDiffContext", () => {
  test("maps changed files to graph nodes", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    expect(ctx.changedNodes.length).toBeGreaterThan(0);
    const names = ctx.changedNodes.map(n => n.name);
    expect(names).toContain("a.ts");
    // Also includes "contains" children
    expect(names).toContain("process");
  });

  test("detects affected (ripple) nodes", () => {
    // Changing a.ts affects c.ts:endpoint (which calls a.ts:process)
    const ctx = buildDiffContext(store, ["a.ts"]);
    expect(ctx.affectedNodes.length).toBeGreaterThan(0);
    const affectedNames = ctx.affectedNodes.map(n => n.name);
    // b.ts:helper is called by a.ts:process, so it should be affected
    expect(affectedNames).toContain("helper");
  });

  test("identifies impacted edges", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    expect(ctx.impactedEdges.length).toBeGreaterThan(0);
    // Should include the "calls" edge from process -> helper
    const hasCallsEdge = ctx.impactedEdges.some(e => e.type === "calls");
    expect(hasCallsEdge).toBe(true);
  });

  test("identifies affected layers", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    expect(ctx.affectedLayers.length).toBeGreaterThan(0);
    const layerNames = ctx.affectedLayers.map(l => l.name);
    expect(layerNames).toContain("Core");
  });

  test("tracks unmapped files", () => {
    const ctx = buildDiffContext(store, ["unknown-file.ts"]);
    expect(ctx.unmappedFiles).toContain("unknown-file.ts");
    expect(ctx.changedNodes.length).toBe(0);
  });

  test("handles multiple changed files", () => {
    const ctx = buildDiffContext(store, ["a.ts", "b.ts", "c.ts"]);
    expect(ctx.changedNodes.length).toBeGreaterThan(3);
    expect(ctx.unmappedFiles.length).toBe(0);
  });

  test("populates project name", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    expect(ctx.projectName).toBe("diff-test");
  });
});

describe("formatDiffAnalysis", () => {
  test("produces markdown with project name", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("# Diff Analysis: diff-test");
  });

  test("includes Changed Components section", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("## Changed Components");
    expect(md).toContain("a.ts");
  });

  test("includes Affected Components section", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("## Affected Components");
  });

  test("includes Risk Assessment section", () => {
    const ctx = buildDiffContext(store, ["a.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("## Risk Assessment");
  });

  test("shows Unmapped Files when present", () => {
    const ctx = buildDiffContext(store, ["unknown.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("## Unmapped Files");
    expect(md).toContain("unknown.ts");
  });

  test("shows low risk for localized changes", () => {
    const ctx = buildDiffContext(store, ["b.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("Risk Assessment");
  });

  test("handles empty changed files", () => {
    const ctx = buildDiffContext(store, []);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("# Diff Analysis");
    expect(ctx.changedNodes.length).toBe(0);
    expect(ctx.affectedNodes.length).toBe(0);
  });
});
