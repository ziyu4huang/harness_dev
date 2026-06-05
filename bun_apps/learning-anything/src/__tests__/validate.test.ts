/**
 * Unit tests for the graph validation pipeline.
 *
 * Tests sanitize, normalize, autoFix, and validate functions
 * with various malformed graph inputs.
 */

import { describe, test, expect } from "bun:test";
import {
  sanitizeGraph,
  normalizeGraph,
  autoFixGraph,
  validateGraph,
  NODE_TYPE_ALIASES,
  EDGE_TYPE_ALIASES,
  COMPLEXITY_ALIASES,
} from "../validate.js";

// ─── Valid graph base ───────────────────────────────────────────────────────

function makeValidGraph() {
  return {
    version: "1.0.0",
    kind: "codebase",
    project: {
      name: "test",
      languages: ["typescript"],
      frameworks: ["bun"],
      description: "Test project",
      analyzedAt: "2025-01-01",
      gitCommitHash: "abc123",
    },
    nodes: [
      { id: "file:src/index.ts", type: "file", name: "index.ts", summary: "Entry point", tags: ["entry"], complexity: "simple" },
      { id: "fn:src/index.ts:main", type: "function", name: "main", filePath: "src/index.ts", summary: "Main function", tags: ["core"], complexity: "moderate" },
    ],
    edges: [
      { source: "file:src/index.ts", target: "fn:src/index.ts:main", type: "contains" },
    ],
    layers: [
      { id: "core", name: "Core", description: "Core layer", nodeIds: ["file:src/index.ts", "fn:src/index.ts:main"] },
    ],
    tour: [
      { order: 1, title: "Start", description: "Start here", nodeIds: ["file:src/index.ts"] },
    ],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("validateGraph - valid input", () => {
  test("passes for a valid graph", () => {
    const result = validateGraph(makeValidGraph());
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes.length).toBe(2);
    expect(result.data!.edges.length).toBe(1);
    expect(result.fatal).toBeUndefined();
  });
});

describe("validateGraph - fatal errors", () => {
  test("fails for non-object input", () => {
    const result = validateGraph("not an object");
    expect(result.success).toBe(false);
    expect(result.fatal).toBeDefined();
  });

  test("fails for null input", () => {
    const result = validateGraph(null);
    expect(result.success).toBe(false);
    expect(result.fatal).toBeDefined();
  });

  test("fails for missing project metadata", () => {
    const graph = makeValidGraph();
    delete (graph as Record<string, unknown>).project;
    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("project");
  });

  test("fails for no valid nodes", () => {
    const graph = makeValidGraph();
    graph.nodes = [];
    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("No valid nodes");
  });
});

describe("sanitizeGraph", () => {
  test("converts null tour to empty array", () => {
    const graph = makeValidGraph();
    (graph as Record<string, unknown>).tour = null;
    const result = sanitizeGraph(graph);
    expect(result.tour).toEqual([]);
  });

  test("converts null layers to empty array", () => {
    const graph = makeValidGraph();
    (graph as Record<string, unknown>).layers = null;
    const result = sanitizeGraph(graph);
    expect(result.layers).toEqual([]);
  });

  test("removes null optional fields from nodes", () => {
    const graph = makeValidGraph();
    graph.nodes[0].filePath = null as unknown as undefined;
    graph.nodes[0].languageNotes = null as unknown as string;
    const result = sanitizeGraph(graph);
    const sanitizedNode = (result.nodes as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(sanitizedNode.filePath).toBeUndefined();
    expect(sanitizedNode.languageNotes).toBeUndefined();
  });

  test("lowercases node type and complexity", () => {
    const graph = makeValidGraph();
    graph.nodes[0].type = "FILE" as "file";
    graph.nodes[0].complexity = "COMPLEX" as "simple";
    const result = sanitizeGraph(graph);
    const sanitizedNode = (result.nodes as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(sanitizedNode.type).toBe("file");
    expect(sanitizedNode.complexity).toBe("complex");
  });
});

describe("normalizeGraph", () => {
  test("resolves node type aliases", () => {
    const graph = makeValidGraph();
    graph.nodes[0].type = "fn" as "file";
    const result = normalizeGraph(graph) as Record<string, unknown>;
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].type).toBe("function");
  });

  test("resolves edge type aliases", () => {
    const graph = makeValidGraph();
    graph.edges[0].type = "invokes" as "contains";
    const result = normalizeGraph(graph) as Record<string, unknown>;
    const edges = result.edges as Array<Record<string, unknown>>;
    expect(edges[0].type).toBe("calls");
  });

  test("does not change canonical types", () => {
    const graph = makeValidGraph();
    const result = normalizeGraph(graph) as Record<string, unknown>;
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].type).toBe("file");
  });
});

describe("autoFixGraph", () => {
  test("adds missing type as file", () => {
    const graph = makeValidGraph();
    delete (graph.nodes[0] as Record<string, unknown>).type;
    const { data, issues } = autoFixGraph(graph);
    const nodes = data.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].type).toBe("file");
    expect(issues.some(i => i.category === "missing-field" && i.path?.includes("type"))).toBe(true);
  });

  test("adds missing complexity as moderate", () => {
    const graph = makeValidGraph();
    delete (graph.nodes[0] as Record<string, unknown>).complexity;
    const { data, issues } = autoFixGraph(graph);
    const nodes = data.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].complexity).toBe("moderate");
    expect(issues.some(i => i.category === "missing-field" && i.path?.includes("complexity"))).toBe(true);
  });

  test("resolves complexity aliases", () => {
    const graph = makeValidGraph();
    (graph.nodes[0] as Record<string, unknown>).complexity = "low";
    const { data, issues } = autoFixGraph(graph);
    const nodes = data.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].complexity).toBe("simple");
    expect(issues.some(i => i.category === "alias")).toBe(true);
  });

  test("adds missing tags as empty array", () => {
    const graph = makeValidGraph();
    delete (graph.nodes[0] as Record<string, unknown>).tags;
    const { data, issues } = autoFixGraph(graph);
    const nodes = data.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].tags).toEqual([]);
  });

  test("defaults missing summary to name", () => {
    const graph = makeValidGraph();
    delete (graph.nodes[0] as Record<string, unknown>).summary;
    const { data, issues } = autoFixGraph(graph);
    const nodes = data.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].summary).toBe("index.ts");
  });
});

describe("validateGraph - edge referential integrity", () => {
  test("drops edges with invalid source", () => {
    const graph = makeValidGraph();
    graph.edges[0].source = "nonexistent";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
    expect(result.issues.some(i => i.category === "invalid-reference")).toBe(true);
  });

  test("drops edges with invalid target", () => {
    const graph = makeValidGraph();
    graph.edges[0].target = "nonexistent";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
  });
});

describe("validateGraph - layer validation", () => {
  test("filters dangling nodeIds from layers", () => {
    const graph = makeValidGraph();
    graph.layers[0].nodeIds.push("nonexistent-node");
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.layers[0].nodeIds).not.toContain("nonexistent-node");
  });

  test("drops invalid layers", () => {
    const graph = makeValidGraph();
    graph.layers.push({} as typeof graph.layers[0]);
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    // Should still have the valid layer
    expect(result.data!.layers.length).toBe(1);
    expect(result.issues.some(i => i.category === "invalid-layer")).toBe(true);
  });
});

describe("validateGraph - tour validation", () => {
  test("filters dangling nodeIds from tour steps", () => {
    const graph = makeValidGraph();
    graph.tour[0].nodeIds.push("nonexistent-node");
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.tour[0].nodeIds).not.toContain("nonexistent-node");
  });

  test("drops invalid tour steps", () => {
    const graph = makeValidGraph();
    graph.tour.push({} as typeof graph.tour[0]);
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.tour.length).toBe(1);
    expect(result.issues.some(i => i.category === "invalid-tour-step")).toBe(true);
  });
});

describe("alias maps completeness", () => {
  test("NODE_TYPE_ALIASES has expected entries", () => {
    expect(NODE_TYPE_ALIASES["fn"]).toBe("function");
    expect(NODE_TYPE_ALIASES["mod"]).toBe("module");
    expect(NODE_TYPE_ALIASES["doc"]).toBe("document");
  });

  test("EDGE_TYPE_ALIASES has expected entries", () => {
    expect(EDGE_TYPE_ALIASES["extends"]).toBe("inherits");
    expect(EDGE_TYPE_ALIASES["invokes"]).toBe("calls");
    expect(EDGE_TYPE_ALIASES["uses"]).toBe("depends_on");
  });

  test("COMPLEXITY_ALIASES maps all variants", () => {
    expect(COMPLEXITY_ALIASES["low"]).toBe("simple");
    expect(COMPLEXITY_ALIASES["medium"]).toBe("moderate");
    expect(COMPLEXITY_ALIASES["high"]).toBe("complex");
  });
});
