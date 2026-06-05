/**
 * Unit tests for context builders: context.ts, explain.ts, diff.ts, onboard.ts.
 *
 * Uses a small synthetic knowledge graph fixture.
 * Tests each builder for correct output structure and content.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GraphStore } from "../graph.js";
import type { KnowledgeGraph } from "../graph.js";
import { buildChatContext, formatContextForPrompt } from "../context.js";
import { buildExplainContext, formatExplainPrompt } from "../explain.js";
import { buildDiffContext, formatDiffAnalysis } from "../diff.js";
import { buildOnboardingGuide } from "../onboard.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Synthetic Graph Fixture ────────────────────────────────────────────────

const TEST_GRAPH: KnowledgeGraph = {
  version: "2.0.0",
  kind: "codebase",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["bun"],
    description: "A test project for builder tests",
    analyzedAt: "2025-01-01T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Server entry point", tags: ["server", "entry"], complexity: "simple" },
    { id: "fn:src/index.ts:startServer", type: "function", name: "startServer", filePath: "src/index.ts", summary: "Starts the HTTP server", tags: ["server"], complexity: "simple" },
    { id: "file:src/graph.ts", type: "file", name: "graph.ts", filePath: "src/graph.ts", summary: "Knowledge graph store", tags: ["graph", "core"], complexity: "complex" },
    { id: "fn:src/graph.ts:load", type: "function", name: "load", filePath: "src/graph.ts", summary: "Load graph from disk", tags: ["io", "load"], complexity: "moderate" },
    { id: "file:src/agent.ts", type: "file", name: "agent.ts", filePath: "src/agent.ts", summary: "LLM agent module", tags: ["ai", "agent"], complexity: "complex" },
    { id: "fn:src/agent.ts:chat", type: "function", name: "chat", filePath: "src/agent.ts", summary: "Chat completion endpoint", tags: ["chat", "ai"], complexity: "moderate" },
    { id: "concept:architecture", type: "concept", name: "Architecture", summary: "Overall system architecture", tags: ["architecture", "design"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "fn:src/index.ts:startServer", type: "contains" },
    { source: "file:src/graph.ts", target: "fn:src/graph.ts:load", type: "contains" },
    { source: "fn:src/index.ts:startServer", target: "file:src/graph.ts", type: "imports" },
    { source: "fn:src/agent.ts:chat", target: "fn:src/graph.ts:load", type: "calls" },
    { source: "file:src/agent.ts", target: "fn:src/agent.ts:chat", type: "contains" },
    { source: "concept:architecture", target: "file:src/index.ts", type: "related" },
  ],
  layers: [
    { id: "core", name: "Core", description: "Core modules", nodeIds: ["file:src/graph.ts", "fn:src/graph.ts:load"] },
    { id: "api", name: "API", description: "API layer", nodeIds: ["file:src/agent.ts", "fn:src/agent.ts:chat"] },
  ],
  tour: [
    { order: 1, title: "Start Here", description: "Begin with the entry point", nodeIds: ["file:src/index.ts"] },
    { order: 2, title: "Core Graph", description: "Understand the graph store", nodeIds: ["file:src/graph.ts"], languageLesson: "Graphs are loaded synchronously" },
  ],
};

// ─── Test Setup ─────────────────────────────────────────────────────────────

const TMP_DIR = join(import.meta.dir, "__tmp_test_builders__");
const GRAPH_FILE = join(TMP_DIR, "test-graph.json");

let store: GraphStore;

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(GRAPH_FILE, JSON.stringify(TEST_GRAPH, null, 2));
  store = new GraphStore(GRAPH_FILE);
  store.load();
});

// ─── Context Builder Tests ──────────────────────────────────────────────────

describe("buildChatContext", () => {
  test("finds relevant nodes from query", () => {
    const ctx = buildChatContext(store, "graph", 15);
    expect(ctx.relevantNodes.length).toBeGreaterThan(0);
    expect(ctx.relevantNodes.some(n => n.name === "graph.ts")).toBe(true);
  });

  test("includes project metadata", () => {
    const ctx = buildChatContext(store, "server", 15);
    expect(ctx.projectName).toBe("test-project");
    expect(ctx.languages).toContain("typescript");
    expect(ctx.frameworks).toContain("bun");
  });

  test("expands to connected nodes via edges", () => {
    const ctx = buildChatContext(store, "graph", 15);
    // Searching for "graph" should find graph.ts, then expand to connected nodes
    expect(ctx.relevantEdges.length).toBeGreaterThan(0);
  });

  test("collects relevant layers", () => {
    const ctx = buildChatContext(store, "graph", 15);
    expect(ctx.relevantLayers.length).toBeGreaterThan(0);
  });

  test("stores the original query", () => {
    const ctx = buildChatContext(store, "test query", 15);
    expect(ctx.query).toBe("test query");
  });
});

describe("formatContextForPrompt", () => {
  test("produces non-empty markdown", () => {
    const ctx = buildChatContext(store, "graph", 15);
    const md = formatContextForPrompt(ctx);
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("# Project: test-project");
    expect(md).toContain("## Code Components");
  });

  test("includes relationship section", () => {
    const ctx = buildChatContext(store, "graph", 15);
    const md = formatContextForPrompt(ctx);
    if (ctx.relevantEdges.length > 0) {
      expect(md).toContain("## Relationships");
    }
  });
});

// ─── Explain Builder Tests ──────────────────────────────────────────────────

describe("buildExplainContext", () => {
  test("finds node by file path", () => {
    const ctx = buildExplainContext(store, "src/graph.ts");
    expect(ctx.targetNode).not.toBeNull();
    expect(ctx.targetNode!.name).toBe("graph.ts");
  });

  test("finds node by path:function format", () => {
    const ctx = buildExplainContext(store, "src/graph.ts:load");
    expect(ctx.targetNode).not.toBeNull();
    expect(ctx.targetNode!.name).toBe("load");
  });

  test("returns null targetNode for missing path", () => {
    const ctx = buildExplainContext(store, "nonexistent.ts");
    expect(ctx.targetNode).toBeNull();
    expect(ctx.childNodes).toHaveLength(0);
  });

  test("collects child nodes", () => {
    const ctx = buildExplainContext(store, "src/graph.ts");
    expect(ctx.childNodes.length).toBeGreaterThan(0);
    expect(ctx.childNodes.some(n => n.name === "load")).toBe(true);
  });

  test("collects connected nodes", () => {
    const ctx = buildExplainContext(store, "src/graph.ts");
    // graph.ts is imported by startServer
    expect(ctx.connectedNodes.length).toBeGreaterThan(0);
  });

  test("finds layer for node", () => {
    const ctx = buildExplainContext(store, "src/graph.ts");
    expect(ctx.layer).not.toBeNull();
    expect(ctx.layer!.name).toBe("Core");
  });
});

describe("formatExplainPrompt", () => {
  test("formats found node as markdown", () => {
    const ctx = buildExplainContext(store, "src/graph.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("# Deep Dive: graph.ts");
    expect(md).toContain("## Internal Components");
  });

  test("formats not-found case", () => {
    const ctx = buildExplainContext(store, "nonexistent.ts");
    const md = formatExplainPrompt(ctx);
    expect(md).toContain("Component Not Found");
  });
});

// ─── Diff Builder Tests ─────────────────────────────────────────────────────

describe("buildDiffContext", () => {
  test("maps changed files to nodes", () => {
    const ctx = buildDiffContext(store, ["src/graph.ts"]);
    expect(ctx.changedNodes.length).toBeGreaterThan(0);
    expect(ctx.changedNodes.some(n => n.name === "graph.ts")).toBe(true);
  });

  test("identifies affected downstream nodes", () => {
    // Changing graph.ts should affect index.ts (which imports it)
    const ctx = buildDiffContext(store, ["src/graph.ts"]);
    expect(ctx.affectedNodes.length).toBeGreaterThan(0);
  });

  test("tracks unmapped files", () => {
    const ctx = buildDiffContext(store, ["src/new-file.ts", "src/another-new.ts"]);
    expect(ctx.unmappedFiles.length).toBe(2);
  });

  test("includes affected layers", () => {
    const ctx = buildDiffContext(store, ["src/graph.ts"]);
    expect(ctx.affectedLayers.length).toBeGreaterThan(0);
  });

  test("includes impacted edges", () => {
    const ctx = buildDiffContext(store, ["src/graph.ts"]);
    expect(ctx.impactedEdges.length).toBeGreaterThan(0);
  });
});

describe("formatDiffAnalysis", () => {
  test("produces structured markdown", () => {
    const ctx = buildDiffContext(store, ["src/graph.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("# Diff Analysis: test-project");
    expect(md).toContain("## Changed Components");
    expect(md).toContain("## Risk Assessment");
  });

  test("includes unmapped files section when present", () => {
    const ctx = buildDiffContext(store, ["src/new-file.ts"]);
    const md = formatDiffAnalysis(ctx);
    expect(md).toContain("## Unmapped Files");
  });
});

// ─── Onboarding Builder Tests ───────────────────────────────────────────────

describe("buildOnboardingGuide", () => {
  test("produces complete markdown guide", () => {
    const guide = buildOnboardingGuide(store);
    expect(guide.length).toBeGreaterThan(100);
    expect(guide).toContain("# test-project");
    expect(guide).toContain("## Architecture");
    expect(guide).toContain("## Getting Started");
    expect(guide).toContain("## File Map");
  });

  test("includes layer descriptions", () => {
    const guide = buildOnboardingGuide(store);
    expect(guide).toContain("### Core");
    expect(guide).toContain("### API");
  });

  test("includes tour steps", () => {
    const guide = buildOnboardingGuide(store);
    expect(guide).toContain("1. Start Here");
    expect(guide).toContain("2. Core Graph");
  });

  test("includes complexity hotspots", () => {
    const guide = buildOnboardingGuide(store);
    expect(guide).toContain("## Complexity Hotspots");
    // graph.ts and agent.ts are both complex
    expect(guide).toContain("graph.ts");
  });

  test("includes footer with version", () => {
    const guide = buildOnboardingGuide(store);
    expect(guide).toContain("v2.0.0");
    expect(guide).toContain("learning-anything");
  });
});
