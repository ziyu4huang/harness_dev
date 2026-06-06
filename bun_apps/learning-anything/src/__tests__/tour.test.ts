/**
 * tour.test.ts — Tests for heuristic tour generation using topological sort.
 *
 * Covers: generateHeuristicTour in batch mode (default batchSize=3),
 * layer mode, cycles, concept-only graphs, empty graphs, single node.
 */

import { describe, test, expect } from "bun:test";
import { generateHeuristicTour } from "../tour.js";
import type { GraphNode, GraphEdge, GraphLayer } from "../graph.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    type: "function",
    name: overrides.id,
    summary: "Test node",
    tags: [],
    ...overrides,
  };
}

const EMPTY_LAYERS: GraphLayer[] = [];

// ─── Batch Mode ────────────────────────────────────────────────────────────────

describe("generateHeuristicTour - batch mode", () => {
  const nodes: GraphNode[] = [
    makeNode({ id: "a", name: "moduleA" }),
    makeNode({ id: "b", name: "moduleB" }),
    makeNode({ id: "c", name: "moduleC" }),
    makeNode({ id: "d", name: "moduleD" }),
    makeNode({ id: "e", name: "moduleE" }),
  ];
  // a -> b -> c (linear chain), d and e are independent
  const edges: GraphEdge[] = [
    { source: "a", target: "b", type: "imports" },
    { source: "b", target: "c", type: "imports" },
  ];

  test("generates tour steps from linear chain with independent nodes", () => {
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 3 });
    expect(tour.length).toBeGreaterThan(0);
    // All nodes should be covered
    const allNodeIds = tour.flatMap(t => t.nodeIds);
    expect(allNodeIds).toHaveLength(5);
  });

  test("respects batchSize parameter", () => {
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 2 });
    // Each step should have at most 2 nodeIds
    for (const step of tour) {
      expect(step.nodeIds.length).toBeLessThanOrEqual(2);
    }
  });

  test("topological order: a comes before b, b comes before c", () => {
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 10 });
    const allNodeIds = tour.flatMap(t => t.nodeIds);
    const aIdx = allNodeIds.indexOf("a");
    const bIdx = allNodeIds.indexOf("b");
    const cIdx = allNodeIds.indexOf("c");
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  test("each tour step has order > 0", () => {
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 3 });
    for (const step of tour) {
      expect(step.order).toBeGreaterThan(0);
      expect(step.nodeIds.length).toBeGreaterThan(0);
    }
  });

  test("tour steps have incrementing order values", () => {
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 3 });
    for (let i = 1; i < tour.length; i++) {
      expect(tour[i].order).toBeGreaterThan(tour[i - 1].order);
    }
  });
});

// ─── Layer Mode ────────────────────────────────────────────────────────────────

describe("generateHeuristicTour - layer mode", () => {
  const nodes: GraphNode[] = [
    makeNode({ id: "a", name: "moduleA" }),
    makeNode({ id: "b", name: "moduleB" }),
  ];
  const edges: GraphEdge[] = [
    { source: "a", target: "b", type: "imports" },
  ];
  const layers: GraphLayer[] = [
    { id: "layer:core", name: "Core", description: "Core modules", nodeIds: ["a"] },
    { id: "layer:app", name: "App", description: "App modules", nodeIds: ["b"] },
  ];

  test("groups nodes by layer in layer mode", () => {
    const tour = generateHeuristicTour(nodes, edges, layers, { mode: "layer" });
    expect(tour.length).toBe(2);
    const layerNames = tour.map(t => t.title);
    expect(layerNames.some(n => n.includes("Core"))).toBe(true);
    expect(layerNames.some(n => n.includes("App"))).toBe(true);
  });

  test("preserves topological order across layers", () => {
    const tour = generateHeuristicTour(nodes, edges, layers, { mode: "layer" });
    const allNodeIds = tour.flatMap(t => t.nodeIds);
    expect(allNodeIds.indexOf("a")).toBeLessThan(allNodeIds.indexOf("b"));
  });

  test("nodes not in any layer go to unassigned group", () => {
    const nodesWithExtra = [
      ...nodes,
      makeNode({ id: "c", name: "moduleC" }),
    ];
    const edgesWithExtra = [...edges];
    const tour = generateHeuristicTour(nodesWithExtra, edgesWithExtra, layers, { mode: "layer" });
    const unassignedStep = tour.find(t => t.title.includes("Unassigned"));
    expect(unassignedStep).toBeDefined();
    expect(unassignedStep!.nodeIds).toContain("c");
  });
});

// ─── Cycles ────────────────────────────────────────────────────────────────────

describe("generateHeuristicTour - cycle handling", () => {
  test("handles cyclic dependencies gracefully", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
    ];
    const edges: GraphEdge[] = [
      { source: "a", target: "b", type: "imports" },
      { source: "b", target: "a", type: "imports" },
    ];
    // Should not hang or throw
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch" });
    expect(tour.length).toBeGreaterThan(0);
    const allNodeIds = tour.flatMap(t => t.nodeIds);
    expect(allNodeIds).toHaveLength(2);
  });
});

// ─── Concept Nodes ─────────────────────────────────────────────────────────────

describe("generateHeuristicTour - concept nodes", () => {
  test("concept nodes are appended as final step(s)", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "a", type: "function" }),
      makeNode({ id: "c1", type: "concept", name: "Auth Concept" }),
    ];
    const edges: GraphEdge[] = [];
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, { mode: "batch", batchSize: 3 });
    expect(tour.length).toBeGreaterThan(0);
    // Last step should contain the concept node
    const lastStep = tour[tour.length - 1];
    expect(lastStep.title).toContain("Key Concepts");
    expect(lastStep.nodeIds).toContain("c1");
  });

  test("concept-only graph returns single step", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "c1", type: "concept", name: "Concept A" }),
      makeNode({ id: "c2", type: "domain", name: "Domain B" }),
    ];
    const tour = generateHeuristicTour(nodes, [], EMPTY_LAYERS, { mode: "batch" });
    expect(tour).toHaveLength(1);
    expect(tour[0].title).toContain("Key Concepts");
    expect(tour[0].nodeIds).toHaveLength(2);
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────────────────

describe("generateHeuristicTour - edge cases", () => {
  test("empty graph returns empty tour", () => {
    const tour = generateHeuristicTour([], [], EMPTY_LAYERS);
    expect(tour).toEqual([]);
  });

  test("single node returns one step", () => {
    const nodes: GraphNode[] = [makeNode({ id: "a" })];
    const tour = generateHeuristicTour(nodes, [], EMPTY_LAYERS, { mode: "batch", batchSize: 3 });
    expect(tour).toHaveLength(1);
    expect(tour[0].nodeIds).toContain("a");
  });

  test("only uses specified dependency edge types", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
    ];
    // "calls" edge from b->a, but we only use "imports" as dependency type
    const edges: GraphEdge[] = [
      { source: "b", target: "a", type: "calls" },
    ];
    const tour = generateHeuristicTour(nodes, edges, EMPTY_LAYERS, {
      mode: "batch",
      batchSize: 10,
      dependencyEdgeTypes: ["imports"],
    });
    // Both should appear since there are no "imports" edges (both have 0 in-degree)
    const allNodeIds = tour.flatMap(t => t.nodeIds);
    expect(allNodeIds).toHaveLength(2);
  });

  test("default mode is batch", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
      makeNode({ id: "c" }),
    ];
    const tour = generateHeuristicTour(nodes, [], EMPTY_LAYERS);
    // Should have batch-style titles containing "Step"
    expect(tour[0].title).toContain("Step");
  });
});
