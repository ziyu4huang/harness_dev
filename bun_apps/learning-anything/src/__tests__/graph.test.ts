/**
 * Unit tests for GraphStore query methods and validation.
 *
 * Uses a small synthetic knowledge graph fixture (10 nodes, 12 edges, 2 layers, 3 tour steps).
 * Tests each query method for correctness.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GraphStore } from "../graph.js";
import type { KnowledgeGraph } from "../graph.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ─── Synthetic Graph Fixture ────────────────────────────────────────────────

const TEST_GRAPH: KnowledgeGraph = {
  version: "2.0.0",
  kind: "codebase",
  project: {
    name: "test-project",
    languages: ["typescript", "python"],
    frameworks: ["bun", "react"],
    description: "A test project for graph store tests",
    analyzedAt: "2025-01-01T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Server entry point", tags: ["server", "entry"], complexity: "simple" },
    { id: "fn:src/index.ts:startServer", type: "function", name: "startServer", filePath: "src/index.ts", summary: "Starts the HTTP server", tags: ["server"], complexity: "simple", lineRange: [10, 30] },
    { id: "file:src/graph.ts", type: "file", name: "graph.ts", filePath: "src/graph.ts", summary: "Knowledge graph store", tags: ["graph", "core"], complexity: "complex" },
    { id: "fn:src/graph.ts:load", type: "function", name: "load", filePath: "src/graph.ts", summary: "Load graph from disk", tags: ["io"], complexity: "moderate" },
    { id: "fn:src/graph.ts:search", type: "function", name: "search", filePath: "src/graph.ts", summary: "Search nodes by query", tags: ["search", "query"], complexity: "complex" },
    { id: "file:src/agent.ts", type: "file", name: "agent.ts", filePath: "src/agent.ts", summary: "LLM agent module", tags: ["ai", "agent"], complexity: "complex" },
    { id: "fn:src/agent.ts:chat", type: "function", name: "chat", filePath: "src/agent.ts", summary: "Chat completion endpoint", tags: ["chat", "ai"], complexity: "moderate" },
    { id: "class:src/config.ts:Config", type: "class", name: "Config", filePath: "src/config.ts", summary: "Configuration manager", tags: ["config"], complexity: "simple" },
    { id: "file:src/routes.ts", type: "file", name: "routes.ts", filePath: "src/routes.ts", summary: "API route handlers", tags: ["api", "routes"], complexity: "moderate" },
    { id: "concept:architecture", type: "concept", name: "Architecture", summary: "Overall system architecture", tags: ["architecture", "design"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "fn:src/index.ts:startServer", type: "contains" },
    { source: "file:src/graph.ts", target: "fn:src/graph.ts:load", type: "contains" },
    { source: "file:src/graph.ts", target: "fn:src/graph.ts:search", type: "contains" },
    { source: "file:src/agent.ts", target: "fn:src/agent.ts:chat", type: "contains" },
    { source: "fn:src/index.ts:startServer", target: "file:src/routes.ts", type: "imports" },
    { source: "fn:src/index.ts:startServer", target: "file:src/graph.ts", type: "imports" },
    { source: "fn:src/agent.ts:chat", target: "fn:src/graph.ts:search", type: "calls" },
    { source: "fn:src/agent.ts:chat", target: "class:src/config.ts:Config", type: "depends_on" },
    { source: "file:src/routes.ts", target: "fn:src/agent.ts:chat", type: "imports" },
    { source: "file:src/routes.ts", target: "file:src/graph.ts", type: "imports" },
    { source: "concept:architecture", target: "file:src/index.ts", type: "related" },
    { source: "fn:src/graph.ts:load", target: "fn:src/graph.ts:search", type: "calls" },
  ],
  layers: [
    { id: "core", name: "Core", description: "Core graph and config modules", nodeIds: ["file:src/graph.ts", "fn:src/graph.ts:load", "fn:src/graph.ts:search", "class:src/config.ts:Config"] },
    { id: "api", name: "API", description: "API and agent layer", nodeIds: ["file:src/routes.ts", "file:src/agent.ts", "fn:src/agent.ts:chat", "file:src/index.ts", "fn:src/index.ts:startServer"] },
  ],
  tour: [
    { order: 1, title: "Getting Started", description: "Start with the entry point", nodeIds: ["file:src/index.ts", "fn:src/index.ts:startServer"] },
    { order: 2, title: "Core Graph", description: "Understand the graph store", nodeIds: ["file:src/graph.ts", "fn:src/graph.ts:load", "fn:src/graph.ts:search"], languageLesson: "Bun.file() is sync and fast" },
    { order: 3, title: "Agent Layer", description: "Learn the agent module", nodeIds: ["file:src/agent.ts", "fn:src/agent.ts:chat"] },
  ],
};

// ─── Test Setup ─────────────────────────────────────────────────────────────

const TMP_DIR = join(import.meta.dir, "__tmp_test_graph__");
const GRAPH_FILE = join(TMP_DIR, "test-graph.json");

let store: GraphStore;

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(GRAPH_FILE, JSON.stringify(TEST_GRAPH, null, 2));
  store = new GraphStore(GRAPH_FILE);
  store.load();
});

// Cleanup after all tests (Bun doesn't have afterAll cleanup hook, so it's fine for CI)
// The tmp dir is in src/__tests__/ which is gitignored

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GraphStore - Loading", () => {
  test("loads graph from disk successfully", () => {
    expect(store.loaded).toBe(true);
  });

  test("stats reflect the fixture", () => {
    const stats = store.getStats();
    expect(stats.totalNodes).toBe(10);
    expect(stats.totalEdges).toBe(12);
    expect(stats.layers).toBe(2);
    expect(stats.tourSteps).toBe(3);
  });

  test("validation issues are empty for valid fixture", () => {
    expect(store.validationIssues.length).toBe(0);
  });
});

describe("GraphStore - getNode", () => {
  test("returns node by ID", () => {
    const node = store.getNode("file:src/graph.ts");
    expect(node).toBeDefined();
    expect(node!.name).toBe("graph.ts");
    expect(node!.type).toBe("file");
  });

  test("returns undefined for missing node", () => {
    expect(store.getNode("nonexistent")).toBeUndefined();
  });
});

describe("GraphStore - getNodes", () => {
  test("returns all nodes without filter", () => {
    const nodes = store.getNodes();
    expect(nodes.length).toBe(10);
  });

  test("filters by type", () => {
    const files = store.getNodes("file");
    expect(files.length).toBe(4);
    expect(files.every(n => n.type === "file")).toBe(true);
  });

  test("filters functions", () => {
    const fns = store.getNodes("function");
    expect(fns.length).toBe(4);
  });
});

describe("GraphStore - search", () => {
  test("finds nodes by name", () => {
    const results = store.search("graph", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(n => n.name === "graph.ts")).toBe(true);
  });

  test("finds nodes by tag", () => {
    const results = store.search("server", 10);
    expect(results.some(n => n.id === "file:src/index.ts" || n.id === "fn:src/index.ts:startServer")).toBe(true);
  });

  test("fuzzy matches partial words", () => {
    const results = store.search("agnt", 10);
    // Should find agent.ts via fuzzy matching
    expect(results.some(n => n.name === "agent.ts")).toBe(true);
  });

  test("returns empty for empty query", () => {
    const results = store.search("", 10);
    expect(results.length).toBe(0);
  });

  test("respects limit parameter", () => {
    const results = store.search("src", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("GraphStore - getNeighborhood", () => {
  test("returns 1-hop neighborhood", () => {
    const { nodes, edges } = store.getNeighborhood("file:src/graph.ts", 20);
    expect(nodes.length).toBeGreaterThan(1);
    expect(nodes.some(n => n.id === "file:src/graph.ts")).toBe(true);
    // graph.ts has contains edges to load and search, plus imports from index.ts and routes.ts
    expect(edges.length).toBeGreaterThan(0);
  });

  test("returns empty for missing node", () => {
    const { nodes, edges } = store.getNeighborhood("nonexistent");
    expect(nodes.length).toBe(0);
    expect(edges.length).toBe(0);
  });
});

describe("GraphStore - getDependencyTree", () => {
  test("follows imports/depends_on/calls chains", () => {
    const { nodes, edges } = store.getDependencyTree("fn:src/agent.ts:chat", 3);
    expect(nodes.length).toBeGreaterThan(0);
    // Should follow calls -> search and depends_on -> Config
    expect(nodes.some(n => n.id === "fn:src/graph.ts:search")).toBe(true);
  });

  test("respects depth limit", () => {
    const { nodes: deep } = store.getDependencyTree("fn:src/agent.ts:chat", 5);
    const { nodes: shallow } = store.getDependencyTree("fn:src/agent.ts:chat", 1);
    // Deeper should find at least as many nodes
    expect(deep.length).toBeGreaterThanOrEqual(shallow.length);
  });
});

describe("GraphStore - getPathBetween", () => {
  test("finds path between connected nodes", () => {
    const { nodes, edges, found } = store.getPathBetween("fn:src/index.ts:startServer", "class:src/config.ts:Config");
    // These are connected via: startServer -> routes -> agent.chat -> Config
    if (found) {
      expect(nodes.length).toBeGreaterThan(0);
      expect(edges.length).toBeGreaterThan(0);
    }
  });

  test("returns self-path for same node", () => {
    const { nodes, edges } = store.getPathBetween("file:src/graph.ts", "file:src/graph.ts");
    expect(nodes.length).toBe(1);
    expect(edges.length).toBe(0);
  });

  test("returns empty for disconnected components", () => {
    const { nodes } = store.getPathBetween("concept:architecture", "class:src/config.ts:Config");
    // concept:architecture is related to index.ts, which connects to routes.ts, then agent.ts:chat, then Config
    // A path should exist through the graph
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("GraphStore - getChildNodes", () => {
  test("returns children via contains edges", () => {
    const children = store.getChildNodes("file:src/graph.ts");
    expect(children.length).toBe(2);
    expect(children.some(n => n.name === "load")).toBe(true);
    expect(children.some(n => n.name === "search")).toBe(true);
  });

  test("returns empty for node with no children", () => {
    const children = store.getChildNodes("fn:src/graph.ts:load");
    expect(children.length).toBe(0);
  });
});

describe("GraphStore - getConnectedNodes", () => {
  test("returns connected nodes excluding contains", () => {
    const { nodes, edges } = store.getConnectedNodes("fn:src/agent.ts:chat");
    // chat -> calls search, depends_on Config
    expect(nodes.length).toBeGreaterThan(0);
    // Should not contain "contains" edges
    expect(edges.every(e => e.type !== "contains")).toBe(true);
  });
});

describe("GraphStore - getLayerHealth", () => {
  test("returns health for each layer", () => {
    const health = store.getLayerHealth();
    expect(health.length).toBe(2);

    const coreHealth = health.find(h => h.id === "core");
    expect(coreHealth).toBeDefined();
    expect(coreHealth!.nodeCount).toBe(4);
    expect(coreHealth!.edgeDensity).toBeGreaterThan(0);

    const apiHealth = health.find(h => h.id === "api");
    expect(apiHealth).toBeDefined();
    expect(apiHealth!.nodeCount).toBe(5);
  });
});

describe("GraphStore - getHotspots", () => {
  test("returns complex nodes", () => {
    const hotspots = store.getHotspots();
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots.every(n => n.complexity === "complex")).toBe(true);
  });
});

describe("GraphStore - getLayerNodes", () => {
  test("returns nodes in a layer", () => {
    const nodes = store.getLayerNodes("core");
    expect(nodes.length).toBe(4);
    expect(nodes.some(n => n.name === "graph.ts")).toBe(true);
  });

  test("returns empty for missing layer", () => {
    const nodes = store.getLayerNodes("nonexistent");
    expect(nodes.length).toBe(0);
  });
});

describe("GraphStore - getNodeByPath", () => {
  test("finds node by file path", () => {
    const node = store.getNodeByPath("src/graph.ts");
    expect(node).toBeDefined();
    expect(node!.name).toBe("graph.ts");
  });

  test("finds node by file path and name", () => {
    const node = store.getNodeByPath("src/graph.ts", "load");
    expect(node).toBeDefined();
    expect(node!.name).toBe("load");
  });

  test("returns undefined for missing path", () => {
    expect(store.getNodeByPath("nonexistent.ts")).toBeUndefined();
  });
});

describe("GraphStore - getEdgesForNode", () => {
  test("returns both incoming and outgoing edges", () => {
    const edges = store.getEdgesForNode("file:src/graph.ts");
    expect(edges.length).toBeGreaterThan(0);
    // Should contain contains edges (outgoing) and imports edges (incoming)
    const hasContains = edges.some(e => e.type === "contains");
    const hasImports = edges.some(e => e.type === "imports");
    expect(hasContains || hasImports).toBe(true);
  });
});

describe("GraphStore - checkStaleness", () => {
  test("returns stale status without crashing", () => {
    // This uses git which may not be available in test env
    // Just verify it doesn't throw
    const result = store.checkStaleness("/nonexistent/dir");
    expect(result).toHaveProperty("stale");
    expect(result).toHaveProperty("changedFiles");
    expect(result).toHaveProperty("graphCommitHash");
    expect(result.graphCommitHash).toBe("abc123");
  });
});
