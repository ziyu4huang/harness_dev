/**
 * Tests for the search module — Fuse.js-based fuzzy search with type filtering.
 */
import { describe, test, expect } from "bun:test";
import { SearchEngine } from "../search.js";
import type { GraphNode } from "../graph.js";

const TEST_NODES: GraphNode[] = [
  { id: "file:auth.ts", type: "file", name: "auth.ts", summary: "Authentication module with login/logout", tags: ["auth", "security"], complexity: "moderate" },
  { id: "fn:auth.ts:login", type: "function", name: "login", summary: "User login handler", tags: ["auth"], complexity: "simple" },
  { id: "fn:auth.ts:hashPassword", type: "function", name: "hashPassword", summary: "Password hashing utility", tags: ["auth", "crypto"], complexity: "simple" },
  { id: "file:db.ts", type: "file", name: "db.ts", summary: "Database connection and query module", tags: ["database", "core"], complexity: "complex" },
  { id: "fn:db.ts:query", type: "function", name: "query", summary: "Execute SQL query", tags: ["database"], complexity: "moderate" },
  { id: "class:app.ts:App", type: "class", name: "App", summary: "Main application class", tags: ["app"], complexity: "complex" },
];

describe("SearchEngine", () => {
  const engine = new SearchEngine(TEST_NODES);

  test("returns results for matching query", () => {
    const results = engine.search("auth");
    expect(results.length).toBeGreaterThan(0);
    // auth.ts, login, hashPassword should all match
    expect(results.some(r => r.nodeId === "file:auth.ts")).toBe(true);
  });

  test("returns results for tag-based query", () => {
    const results = engine.search("database");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.nodeId === "file:db.ts")).toBe(true);
  });

  test("returns empty for empty query", () => {
    expect(engine.search("")).toEqual([]);
    expect(engine.search("   ")).toEqual([]);
  });

  test("respects limit option", () => {
    const results = engine.search("auth", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test("filters by single type", () => {
    const results = engine.search("auth", { types: ["function"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const node = TEST_NODES.find(n => n.id === r.nodeId);
      expect(node?.type).toBe("function");
    }
  });

  test("filters by multiple types", () => {
    const results = engine.search("auth", { types: ["function", "file"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const node = TEST_NODES.find(n => n.id === r.nodeId);
      expect(["function", "file"]).toContain(node?.type);
    }
  });

  test("returns empty when type filter excludes all matches", () => {
    const results = engine.search("auth", { types: ["table"] });
    expect(results.length).toBe(0);
  });

  test("fuzzy matching works for partial queries", () => {
    const results = engine.search("hash");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.nodeId === "fn:auth.ts:hashPassword")).toBe(true);
  });

  test("scores are between 0 and 1", () => {
    const results = engine.search("auth");
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test("handles empty node list", () => {
    const emptyEngine = new SearchEngine([]);
    expect(emptyEngine.search("anything")).toEqual([]);
  });
});
