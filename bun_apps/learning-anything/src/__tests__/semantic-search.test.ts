/**
 * semantic-search.test.ts — Tests for cosine similarity and SemanticSearchEngine.
 *
 * Covers: cosineSimilarity (identical/orthogonal/opposite vectors, zero vectors,
 * mismatched lengths), SemanticSearchEngine construction, search with threshold/
 * type filter, addEmbedding, updateNodes, hasEmbeddings, embeddingCount.
 */

import { describe, test, expect } from "bun:test";
import { cosineSimilarity, SemanticSearchEngine } from "../semantic-search.js";
import type { GraphNode } from "../graph.js";

// ─── cosineSimilarity ──────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  test("returns 1.0 for identical vectors", () => {
    const sim = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    expect(Math.abs(sim - 1.0)).toBeLessThan(0.0001);
  });

  test("returns 0.0 for orthogonal vectors", () => {
    const sim = cosineSimilarity([1, 0, 0], [0, 1, 0]);
    expect(Math.abs(sim)).toBeLessThan(0.0001);
  });

  test("returns -1.0 for opposite vectors", () => {
    const sim = cosineSimilarity([1, 0, 0], [-1, 0, 0]);
    expect(Math.abs(sim - (-1.0))).toBeLessThan(0.0001);
  });

  test("returns 0.0 for zero vectors", () => {
    const sim = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    expect(sim).toBe(0);
  });

  test("returns 0.0 for both zero vectors", () => {
    const sim = cosineSimilarity([0, 0, 0], [0, 0, 0]);
    expect(sim).toBe(0);
  });

  test("returns 0.0 for mismatched lengths", () => {
    const sim = cosineSimilarity([1, 2], [1, 2, 3]);
    expect(sim).toBe(0);
  });

  test("returns 0.0 for empty vectors", () => {
    const sim = cosineSimilarity([], []);
    expect(sim).toBe(0);
  });

  test("computes correct value for arbitrary vectors", () => {
    // [1, 2, 3] dot [4, 5, 6] = 4+10+18 = 32
    // |a| = sqrt(1+4+9) = sqrt(14), |b| = sqrt(16+25+36) = sqrt(77)
    const sim = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    const expected = 32 / Math.sqrt(14 * 77);
    expect(Math.abs(sim - expected)).toBeLessThan(0.0001);
  });

  test("handles single-element vectors", () => {
    expect(cosineSimilarity([1], [1])).toBeCloseTo(1.0, 4);
    expect(cosineSimilarity([1], [-1])).toBeCloseTo(-1.0, 4);
  });

  test("handles negative values correctly", () => {
    // [1, -1] dot [-1, 1] = -1 + -1 = -2
    // |a| = sqrt(2), |b| = sqrt(2)
    // cos = -2 / 2 = -1
    const sim = cosineSimilarity([1, -1], [-1, 1]);
    expect(sim).toBeCloseTo(-1.0, 4);
  });
});

// ─── SemanticSearchEngine ──────────────────────────────────────────────────────

describe("SemanticSearchEngine", () => {
  const nodesWithEmbeddings: GraphNode[] = [
    { id: "n1", type: "function", name: "auth", summary: "Auth function", tags: [], embedding: [1, 0, 0] },
    { id: "n2", type: "function", name: "db", summary: "DB function", tags: [], embedding: [0, 1, 0] },
    { id: "n3", type: "class", name: "api", summary: "API class", tags: [], embedding: [0.8, 0.2, 0] },
    { id: "n4", type: "function", name: "no-emb", summary: "No embedding", tags: [] },
  ];

  test("construction from nodes with embedding field", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    expect(engine.hasEmbeddings()).toBe(true);
    expect(engine.embeddingCount).toBe(3); // n4 has no embedding
  });

  test("construction from explicit embeddings map", () => {
    const nodes: GraphNode[] = [
      { id: "n1", type: "function", name: "a", summary: "A", tags: [] },
    ];
    const engine = new SemanticSearchEngine(nodes, { n1: [1, 0, 0] });
    expect(engine.embeddingCount).toBe(1);
  });

  test("search returns results sorted by similarity (best first)", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { limit: 3 });
    // n1 has sim=1.0 (score=0.0) -> best match, should be first
    expect(results[0].nodeId).toBe("n1");
    expect(results[0].score).toBeCloseTo(0.0, 2);
  });

  test("search respects limit parameter", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { limit: 1 });
    expect(results.length).toBe(1);
  });

  test("search respects threshold parameter", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { threshold: 0.5 });
    // Only n1 (sim=1.0) and n3 (sim~0.96) should pass threshold
    expect(results.length).toBe(2);
  });

  test("search respects type filter", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { types: ["class"] });
    // Only n3 is a class
    expect(results.length).toBe(1);
    expect(results[0].nodeId).toBe("n3");
  });

  test("search returns empty for unmatched type filter", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { types: ["module"] });
    expect(results).toEqual([]);
  });

  test("search skips nodes without embeddings", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const results = engine.search([1, 0, 0], { limit: 10 });
    const ids = results.map(r => r.nodeId);
    expect(ids).not.toContain("n4"); // n4 has no embedding
  });

  test("addEmbedding adds new embedding", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    engine.addEmbedding("n4", [0.5, 0.5, 0]);
    expect(engine.embeddingCount).toBe(4);
    const results = engine.search([0.5, 0.5, 0], { limit: 10 });
    const ids = results.map(r => r.nodeId);
    expect(ids).toContain("n4");
  });

  test("getEmbedding returns embedding for known node", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    expect(engine.getEmbedding("n1")).toEqual([1, 0, 0]);
    expect(engine.getEmbedding("n4")).toBeUndefined();
  });

  test("updateNodes rebuilds node list and collects new embeddings", () => {
    const engine = new SemanticSearchEngine(nodesWithEmbeddings);
    const newNodes: GraphNode[] = [
      { id: "n5", type: "function", name: "new", summary: "New", tags: [], embedding: [1, 1, 1] },
    ];
    engine.updateNodes(newNodes);
    // n1, n2, n3 embeddings should still be in the engine (preserved)
    expect(engine.getEmbedding("n1")).toEqual([1, 0, 0]);
    // n5 should be collected from its embedding field
    expect(engine.getEmbedding("n5")).toEqual([1, 1, 1]);
  });

  test("hasEmbeddings returns false when no embeddings", () => {
    const nodes: GraphNode[] = [
      { id: "n1", type: "function", name: "a", summary: "A", tags: [] },
    ];
    const engine = new SemanticSearchEngine(nodes);
    expect(engine.hasEmbeddings()).toBe(false);
  });

  test("default limit is 10", () => {
    const manyNodes: GraphNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`, type: "function", name: `node${i}`, summary: `Node ${i}`, tags: [],
      embedding: [Math.random(), Math.random(), Math.random()],
    }));
    const engine = new SemanticSearchEngine(manyNodes);
    const results = engine.search([1, 0, 0]);
    expect(results.length).toBe(10);
  });
});
