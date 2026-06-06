/**
 * http.test.ts — HTTP integration tests using bun:test.
 *
 * Tests the full request/response cycle through handleRequest
 * for all key endpoints.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import type { GraphStore } from "../graph.js";

// ─── Test Graph Fixture ──────────────────────────────────────────────────────

const TEST_GRAPH = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "http-test",
    languages: ["typescript"],
    frameworks: ["bun"],
    description: "HTTP integration test graph",
    analyzedAt: "2025-01-01",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", summary: "Module A with authentication", tags: ["auth", "core"], complexity: "simple" },
    { id: "fn:a.ts:login", type: "function", name: "login", filePath: "a.ts", summary: "Login handler", tags: ["auth"], complexity: "moderate" },
    { id: "file:b.ts", type: "file", name: "b.ts", filePath: "b.ts", summary: "Module B with database", tags: ["database", "core"], complexity: "complex" },
    { id: "fn:b.ts:query", type: "function", name: "query", filePath: "b.ts", summary: "DB query", tags: ["database"], complexity: "complex" },
    { id: "class:c.ts:App", type: "class", name: "App", filePath: "c.ts", summary: "Main app", tags: ["app"], complexity: "moderate" },
  ],
  edges: [
    { source: "file:a.ts", target: "fn:a.ts:login", type: "contains" },
    { source: "file:b.ts", target: "fn:b.ts:query", type: "contains" },
    { source: "fn:a.ts:login", target: "fn:b.ts:query", type: "calls" },
    { source: "class:c.ts:App", target: "file:a.ts", type: "depends_on" },
    { source: "class:c.ts:App", target: "file:b.ts", type: "depends_on" },
  ],
  layers: [
    { id: "core", name: "Core", description: "Core modules", nodeIds: ["file:a.ts", "fn:a.ts:login", "file:b.ts", "fn:b.ts:query"] },
    { id: "app", name: "Application", description: "Application layer", nodeIds: ["class:c.ts:App"] },
  ],
  tour: [
    { order: 1, title: "Start", description: "Start here", nodeIds: ["file:a.ts"] },
  ],
};

// ─── Setup ────────────────────────────────────────────────────────────────────

const ROOT = import.meta.dir.replace(/[/\\]src[/\\]__tests__$/, "");
const tmpDir = join(ROOT, "__tmp_http_test__");
const graphPath = join(tmpDir, "test-graph.json");

let handleRequest: (req: Request, gs: GraphStore) => Promise<Response>;
let store: GraphStore;

beforeAll(async () => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(graphPath, JSON.stringify(TEST_GRAPH, null, 2));

  const routes = await import(join(ROOT, "src", "routes.ts"));
  const graph = await import(join(ROOT, "src", "graph.ts"));
  handleRequest = routes.handleRequest;
  const GS = graph.GraphStore;
  store = new GS(graphPath);
  store.load();
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchEndpoint(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const url = `http://127.0.0.1:3100${path}`;
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "127.0.0.1" },
  };
  if (body) init.body = JSON.stringify(body);
  const req = new Request(url, init);
  const resp = await handleRequest(req, store);
  const headers: Record<string, string> = {};
  resp.headers.forEach((v: string, k: string) => { headers[k] = v; });
  let respBody: any = null;
  try { respBody = await resp.json(); } catch {}
  return { status: resp.status, headers, body: respBody };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HTTP Integration Tests", () => {
  test("GET /health returns ok with uptime", async () => {
    const { status, body } = await fetchEndpoint("GET", "/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  test("GET /api/stats returns correct counts", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/stats");
    expect(status).toBe(200);
    expect(body.totalNodes).toBe(5);
    expect(body.totalEdges).toBe(5);
    // Schema check: verify required fields exist
    // project is the project name string, not an object
    expect(typeof body.project).toBe("string");
    expect(typeof body.layers).toBe("number");
    expect(typeof body.nodeTypes).toBe("object");
    expect(typeof body.edgeTypes).toBe("object");
  });

  test("GET /api/nodes returns all nodes", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes");
    expect(status).toBe(200);
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.length).toBe(5);
    expect(typeof body.total).toBe("number");
    // Schema: each node has required fields
    for (const node of body.nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.name).toBe("string");
      expect(typeof node.type).toBe("string");
      expect(typeof node.summary).toBe("string");
      expect(Array.isArray(node.tags)).toBe(true);
    }
  });

  test("GET /api/nodes?type=function filters by type", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?type=function");
    expect(status).toBe(200);
    expect(body.nodes.length).toBeGreaterThan(0);
    for (const node of body.nodes) {
      expect(node.type).toBe("function");
    }
  });

  test("GET /api/nodes/:id returns node and edges", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes/file:a.ts");
    expect(status).toBe(200);
    expect(body.node.id).toBe("file:a.ts");
    expect(Array.isArray(body.edges)).toBe(true);
  });

  test("GET /api/nodes/:id/neighbors returns neighborhood", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes/file:a.ts?view=neighbors");
    expect(status).toBe(200);
    expect(body.center).toBe("file:a.ts");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  test("GET /api/nodes/nonexistent returns 404", async () => {
    const { status } = await fetchEndpoint("GET", "/api/nodes/nonexistent-node-id");
    expect(status).toBe(404);
  });

  test("GET /api/layers returns layer list", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/layers");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    // Schema: each layer has required fields
    for (const layer of body) {
      expect(typeof layer.id).toBe("string");
      expect(typeof layer.name).toBe("string");
      expect(typeof layer.description).toBe("string");
      expect(Array.isArray(layer.nodeIds)).toBe(true);
    }
  });

  test("GET /api/search?q=auth returns results", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/search?q=auth");
    expect(status).toBe(200);
    expect(typeof body.query).toBe("string");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  test("GET /api/search without q returns 400", async () => {
    const { status } = await fetchEndpoint("GET", "/api/search");
    expect(status).toBe(400);
  });

  test("POST /api/chat with missing body returns 400", async () => {
    const { status } = await fetchEndpoint("POST", "/api/chat", {});
    expect(status).toBe(400);
  });

  test("GET /api/validate returns validation results", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/validate");
    expect(status).toBe(200);
    expect(typeof body.valid).toBe("boolean");
    expect(typeof body.totalIssues).toBe("number");
  });

  test("GET /api/metrics returns metrics snapshot", async () => {
    // Make a few requests first to populate metrics
    await fetchEndpoint("GET", "/health");
    await fetchEndpoint("GET", "/api/stats");

    const { status, body } = await fetchEndpoint("GET", "/api/metrics");
    expect(status).toBe(200);
    expect(typeof body.totalRequests).toBe("number");
    expect(typeof body.totalErrors).toBe("number");
    expect(typeof body.avgResponseMs).toBe("number");
    expect(typeof body.cacheSize).toBe("number");
    expect(typeof body.cacheMaxSize).toBe("number");
    expect(typeof body.uptimeMs).toBe("number");
    expect(typeof body.endpoints).toBe("object");
    expect(body.totalRequests).toBeGreaterThan(0);
  });

  test("OPTIONS returns CORS headers", async () => {
    const { status, headers } = await fetchEndpoint("OPTIONS", "/api/stats");
    expect(status).toBe(200);
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["access-control-allow-methods"]).toContain("GET");
  });

  test("GET /api/nonexistent returns 404", async () => {
    const { status } = await fetchEndpoint("GET", "/api/nonexistent/endpoint");
    expect(status).toBe(404);
  });

  test("X-Request-Id and X-Response-Time headers are present", async () => {
    const { headers } = await fetchEndpoint("GET", "/api/stats");
    expect(typeof headers["x-request-id"]).toBe("string");
    expect(headers["x-request-id"].length).toBeGreaterThan(0);
    expect(typeof headers["x-response-time"]).toBe("string");
  });

  test("malformed percent-encoded node ID returns 400", async () => {
    // %E0%A4%A is an incomplete UTF-8 sequence
    const { status } = await fetchEndpoint("GET", "/api/nodes/%E0%A4%A");
    expect(status).toBe(400);
  });

  test("path traversal in node ID returns 400", async () => {
    const { status } = await fetchEndpoint("GET", "/api/nodes/..%2F..%2Fetc%2Fpasswd");
    expect(status).toBe(400);
  });

  test("extremely long node ID returns 400", async () => {
    const longId = "a".repeat(600);
    const { status } = await fetchEndpoint("GET", `/api/nodes/${longId}`);
    expect(status).toBe(400);
  });

  test("null byte in node ID is handled safely", async () => {
    // URL-encoded null byte -- the URL parser may strip it, so we test that
    // it doesn't cause a 500. It will either be 400 (caught by validation)
    // or 404 (null byte stripped, node not found).
    const { status } = await fetchEndpoint("GET", "/api/nodes/test%00node");
    expect(status === 400 || status === 404).toBe(true);
  });

  test("malformed percent-encoded layer ID returns 400", async () => {
    const { status } = await fetchEndpoint("GET", "/api/layers/%E0%A4%A");
    expect(status).toBe(400);
  });
});

// ─── Query Parameter Validation Tests ──────────────────────────────────────────

describe("Query Parameter Validation", () => {
  test("negative limit is clamped to 1", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?limit=-5");
    expect(status).toBe(200);
    expect(body.limit).toBe(1);
    expect(body.nodes.length).toBeLessThanOrEqual(1);
  });

  test("non-numeric limit returns default (200)", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?limit=abc");
    expect(status).toBe(200);
    expect(body.limit).toBe(200);
    expect(body.nodes.length).toBe(5); // all nodes
  });

  test("limit exceeding max is clamped to maxQueryResults", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?limit=99999");
    expect(status).toBe(200);
    // maxQueryResults is 200 from config
    expect(body.limit).toBe(200);
  });

  test("offset parameter works for pagination", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?offset=3");
    expect(status).toBe(200);
    expect(body.offset).toBe(3);
    expect(body.nodes.length).toBe(2); // 5 total - 3 offset = 2 remaining
  });

  test("offset + limit combination works", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes?offset=1&limit=2");
    expect(status).toBe(200);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(2);
    expect(body.nodes.length).toBe(2);
  });

  test("depth > 10 is clamped to 10", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes/file:a.ts?view=deps&depth=50");
    expect(status).toBe(200);
    // Should not error; depth was clamped internally
    expect(body.root).toBe("file:a.ts");
  });

  test("negative depth is clamped to 1", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/nodes/file:a.ts?view=deps&depth=-1");
    expect(status).toBe(200);
    expect(body.root).toBe("file:a.ts");
  });

  test("search limit is clamped to max 100", async () => {
    const { status, body } = await fetchEndpoint("GET", "/api/search?q=auth&limit=500");
    expect(status).toBe(200);
    expect(body.nodes.length).toBeLessThanOrEqual(100);
  });
});
