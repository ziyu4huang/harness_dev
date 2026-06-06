/**
 * Tests for the normalize module — node ID normalization, complexity mapping,
 * and batch normalization pipeline.
 */
import { describe, test, expect } from "bun:test";
import {
  normalizeNodeId,
  normalizeComplexity,
  normalizeBatchOutput,
} from "../normalize.js";
import type { GraphNode, GraphEdge } from "../graph.js";

describe("normalizeNodeId", () => {
  test("passes through already-correct IDs", () => {
    const result = normalizeNodeId("file:src/index.ts", {
      type: "file",
      filePath: "src/index.ts",
    });
    expect(result).toBe("file:src/index.ts");
  });

  test("normalizes bare path for file type", () => {
    const result = normalizeNodeId("src/index.ts", {
      type: "file",
      filePath: "src/index.ts",
    });
    expect(result).toBe("file:src/index.ts");
  });

  test("normalizes function type with filePath and name", () => {
    const result = normalizeNodeId("raw-id", {
      type: "function",
      filePath: "src/utils.ts",
      name: "helper",
    });
    expect(result).toBe("func:src/utils.ts:helper");
  });

  test("strips double-prefixed IDs", () => {
    const result = normalizeNodeId("file:file:src/foo.ts", {
      type: "file",
      filePath: "src/foo.ts",
    });
    expect(result).toBe("file:src/foo.ts");
  });

  test("handles step nodes with filePath", () => {
    const result = normalizeNodeId("step:some-slug", {
      type: "step",
      filePath: "flows/auth.ts",
      parentFlowSlug: "login-flow",
    });
    expect(result).toContain("step:");
    expect(result).toContain("flows/auth.ts");
  });

  test("handles empty string", () => {
    expect(normalizeNodeId("", { type: "file" })).toBe("");
  });
});

describe("normalizeComplexity", () => {
  test("passes through canonical values", () => {
    expect(normalizeComplexity("simple")).toBe("simple");
    expect(normalizeComplexity("moderate")).toBe("moderate");
    expect(normalizeComplexity("complex")).toBe("complex");
  });

  test("maps string aliases", () => {
    expect(normalizeComplexity("low")).toBe("simple");
    expect(normalizeComplexity("easy")).toBe("simple");
    expect(normalizeComplexity("medium")).toBe("moderate");
    expect(normalizeComplexity("high")).toBe("complex");
    expect(normalizeComplexity("hard")).toBe("complex");
  });

  test("maps numeric scales", () => {
    expect(normalizeComplexity(1)).toBe("simple");
    expect(normalizeComplexity(3)).toBe("simple");
    expect(normalizeComplexity(4)).toBe("moderate");
    expect(normalizeComplexity(6)).toBe("moderate");
    expect(normalizeComplexity(7)).toBe("complex");
    expect(normalizeComplexity(10)).toBe("complex");
  });

  test("defaults to moderate for unknown values", () => {
    expect(normalizeComplexity("unknown")).toBe("moderate");
    expect(normalizeComplexity(0)).toBe("moderate");
    expect(normalizeComplexity(-1)).toBe("moderate");
    expect(normalizeComplexity(NaN)).toBe("moderate");
    expect(normalizeComplexity(Infinity)).toBe("moderate");
  });

  test("handles case-insensitive aliases", () => {
    expect(normalizeComplexity("Low")).toBe("simple");
    expect(normalizeComplexity("HIGH")).toBe("complex");
    expect(normalizeComplexity("Medium")).toBe("moderate");
  });
});

describe("normalizeBatchOutput", () => {
  const makeNodes = (ids: string[], type = "file"): GraphNode[] =>
    ids.map(id => ({
      id,
      type,
      name: id.split(":").pop() ?? id,
      summary: `Node ${id}`,
      tags: [],
      complexity: "simple" as const,
    }));

  const makeEdge = (source: string, target: string, type = "calls"): GraphEdge => ({
    source,
    target,
    type,
  });

  test("normalizes node IDs in a batch", () => {
    const nodes = [
      { id: "src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "A", tags: [], complexity: "simple" as const },
    ];
    const result = normalizeBatchOutput({ nodes, edges: [] });
    expect(result.nodes[0].id).toBe("file:src/a.ts");
    expect(result.stats.idsFixed).toBe(1);
  });

  test("normalizes numeric complexity", () => {
    const nodes = makeNodes(["file:a.ts"]);
    (nodes[0] as any).complexity = 8;
    const result = normalizeBatchOutput({ nodes, edges: [] });
    expect(result.nodes[0].complexity).toBe("complex");
    expect(result.stats.complexityFixed).toBe(1);
  });

  test("deduplicates nodes by ID", () => {
    const nodes = makeNodes(["file:a.ts", "file:a.ts"]);
    const result = normalizeBatchOutput({ nodes, edges: [] });
    expect(result.nodes.length).toBe(1);
  });

  test("rewrites edge references after ID normalization", () => {
    const nodes = [
      { id: "src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "A", tags: [], complexity: "simple" as const },
      { id: "src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts", summary: "B", tags: [], complexity: "simple" as const },
    ];
    const edges = [makeEdge("src/a.ts", "src/b.ts", "depends_on")];
    const result = normalizeBatchOutput({ nodes, edges });
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].source).toBe("file:src/a.ts");
    expect(result.edges[0].target).toBe("file:src/b.ts");
    expect(result.stats.edgesRewritten).toBeGreaterThanOrEqual(1);
  });

  test("drops dangling edges referencing non-existent nodes", () => {
    const nodes = makeNodes(["file:a.ts"]);
    const edges = [makeEdge("file:a.ts", "file:nonexistent.ts")];
    const result = normalizeBatchOutput({ nodes, edges });
    expect(result.edges.length).toBe(0);
    expect(result.stats.danglingEdgesDropped).toBe(1);
    expect(result.stats.droppedEdges[0].reason).toBe("missing-target");
  });

  test("deduplicates edges by source+target+type", () => {
    const nodes = makeNodes(["file:a.ts", "file:b.ts"]);
    const edges = [makeEdge("file:a.ts", "file:b.ts"), makeEdge("file:a.ts", "file:b.ts")];
    const result = normalizeBatchOutput({ nodes, edges });
    expect(result.edges.length).toBe(1);
  });

  test("handles empty input", () => {
    const result = normalizeBatchOutput({ nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.stats.idsFixed).toBe(0);
  });

  test("preserves already-normalized batch", () => {
    const nodes = makeNodes(["file:a.ts", "file:b.ts"]);
    const edges = [makeEdge("file:a.ts", "file:b.ts", "calls")];
    const result = normalizeBatchOutput({ nodes, edges });
    expect(result.nodes.length).toBe(2);
    expect(result.edges.length).toBe(1);
    expect(result.stats.idsFixed).toBe(0);
  });
});
