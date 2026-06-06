/**
 * layer-detector.test.ts — Tests for heuristic and LLM-based architectural layer detection.
 *
 * Covers: matchFileToLayer (10 pattern groups), detectLayers (file/function/config nodes),
 * parseLayerDetectionResponse (valid/invalid JSON, code fences),
 * buildLayerDetectionPrompt (prompt structure), applyLLMLayers (pattern matching, Other fallback).
 */

import { describe, test, expect } from "bun:test";
import {
  matchFileToLayer,
  detectLayers,
  buildLayerDetectionPrompt,
  parseLayerDetectionResponse,
  applyLLMLayers,
} from "../layer-detector.js";
import type { GraphNode, GraphLayer } from "../graph.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    type: "file",
    name: overrides.id,
    summary: "Test node",
    tags: [],
    ...overrides,
  };
}

// ─── matchFileToLayer ──────────────────────────────────────────────────────────

describe("matchFileToLayer", () => {
  test("matches routes directory to API Layer", () => {
    expect(matchFileToLayer("src/routes/auth.ts")).toBe("API Layer");
  });

  test("matches controller directory to API Layer", () => {
    expect(matchFileToLayer("src/controller/user.ts")).toBe("API Layer");
  });

  test("matches service directory to Service Layer", () => {
    expect(matchFileToLayer("src/service/auth.ts")).toBe("Service Layer");
  });

  test("matches use-case directory to Service Layer", () => {
    expect(matchFileToLayer("src/use-case/createUser.ts")).toBe("Service Layer");
  });

  test("matches model directory to Data Layer", () => {
    expect(matchFileToLayer("src/model/user.ts")).toBe("Data Layer");
  });

  test("matches repository directory to Data Layer", () => {
    expect(matchFileToLayer("src/repository/userRepo.ts")).toBe("Data Layer");
  });

  test("matches component directory to UI Layer", () => {
    expect(matchFileToLayer("src/component/Header.tsx")).toBe("UI Layer");
  });

  test("matches view directory to UI Layer", () => {
    expect(matchFileToLayer("src/views/Home.tsx")).toBe("UI Layer");
  });

  test("matches middleware directory to Middleware Layer", () => {
    expect(matchFileToLayer("src/middleware/auth.ts")).toBe("Middleware Layer");
  });

  test("matches client directory to External Services", () => {
    expect(matchFileToLayer("src/client/stripe.ts")).toBe("External Services");
  });

  test("matches worker directory to Background Tasks", () => {
    expect(matchFileToLayer("src/worker/email.ts")).toBe("Background Tasks");
  });

  test("matches util directory to Utility Layer", () => {
    expect(matchFileToLayer("src/util/helpers.ts")).toBe("Utility Layer");
  });

  test("matches test directory to Test Layer", () => {
    expect(matchFileToLayer("src/test/auth.test.ts")).toBe("Test Layer");
  });

  test("matches __tests__ directory to Test Layer", () => {
    expect(matchFileToLayer("src/__tests__/auth.test.ts")).toBe("Test Layer");
  });

  test("matches config directory to Configuration Layer", () => {
    expect(matchFileToLayer("src/config/settings.ts")).toBe("Configuration Layer");
  });

  test("returns null for unrecognized directory", () => {
    expect(matchFileToLayer("src/my-custom-dir/thing.ts")).toBeNull();
  });

  test("handles backslash paths (Windows)", () => {
    expect(matchFileToLayer("src\\routes\\auth.ts")).toBe("API Layer");
  });

  test("first match wins when multiple patterns could match", () => {
    // "config" appears in Configuration Layer patterns, but also in other contexts
    // If a path has both "routes" and "config", "routes" should match first
    expect(matchFileToLayer("src/routes/config.ts")).toBe("API Layer");
  });

  test("matches singular form without trailing s", () => {
    expect(matchFileToLayer("src/handler/request.ts")).toBe("API Layer");
  });
});

// ─── detectLayers ──────────────────────────────────────────────────────────────

describe("detectLayers", () => {
  test("assigns file nodes to correct layers", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "src/routes/auth.ts" }),
      makeNode({ id: "f2", filePath: "src/service/user.ts" }),
    ];
    const layers = detectLayers(nodes);
    expect(layers.length).toBeGreaterThanOrEqual(2);
    const names = layers.map(l => l.name);
    expect(names).toContain("API Layer");
    expect(names).toContain("Service Layer");
  });

  test("assigns nodes without filePath to Core layer", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1" }), // no filePath
    ];
    const layers = detectLayers(nodes);
    const core = layers.find(l => l.name === "Core");
    expect(core).toBeDefined();
    expect(core!.nodeIds).toContain("f1");
  });

  test("only processes file-type nodes", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn1", type: "function", filePath: "src/routes/auth.ts" }),
      makeNode({ id: "f1", type: "file", filePath: "src/routes/auth.ts" }),
    ];
    const layers = detectLayers(nodes);
    // Only the file node should be in a layer
    const allNodeIds = layers.flatMap(l => l.nodeIds);
    expect(allNodeIds).toContain("f1");
    expect(allNodeIds).not.toContain("fn1");
  });

  test("returns empty array for empty nodes", () => {
    const layers = detectLayers([]);
    expect(layers).toEqual([]);
  });

  test("groups multiple files in same layer", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "src/routes/auth.ts" }),
      makeNode({ id: "f2", filePath: "src/routes/user.ts" }),
    ];
    const layers = detectLayers(nodes);
    const apiLayer = layers.find(l => l.name === "API Layer");
    expect(apiLayer).toBeDefined();
    expect(apiLayer!.nodeIds).toHaveLength(2);
  });
});

// ─── parseLayerDetectionResponse ───────────────────────────────────────────────

describe("parseLayerDetectionResponse", () => {
  test("parses valid JSON array", () => {
    const response = JSON.stringify([
      { name: "API", description: "API endpoints", filePatterns: ["src/routes/"] },
    ]);
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].name).toBe("API");
  });

  test("parses JSON in markdown code fences", () => {
    const response = "```json\n" + JSON.stringify([
      { name: "UI", description: "Components", filePatterns: ["src/components/"] },
    ]) + "\n```";
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result![0].name).toBe("UI");
  });

  test("parses JSON in code fences without json label", () => {
    const response = "```\n" + JSON.stringify([
      { name: "Data", description: "Data layer", filePatterns: ["src/models/"] },
    ]) + "\n```";
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result![0].name).toBe("Data");
  });

  test("returns null for empty string", () => {
    expect(parseLayerDetectionResponse("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseLayerDetectionResponse("   ")).toBeNull();
  });

  test("returns null when no array is found", () => {
    expect(parseLayerDetectionResponse("not an array")).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(parseLayerDetectionResponse("[]")).toBeNull();
  });

  test("skips items without name field", () => {
    const response = JSON.stringify([
      { description: "No name", filePatterns: [] },
      { name: "Valid", description: "Valid layer", filePatterns: [] },
    ]);
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].name).toBe("Valid");
  });

  test("handles missing filePatterns gracefully", () => {
    const response = JSON.stringify([
      { name: "Layer1", description: "Desc" },
    ]);
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result![0].filePatterns).toEqual([]);
  });

  test("filters non-string filePatterns", () => {
    const response = JSON.stringify([
      { name: "Layer1", description: "Desc", filePatterns: ["valid", 123, null] },
    ]);
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result![0].filePatterns).toEqual(["valid"]);
  });
});

// ─── buildLayerDetectionPrompt ─────────────────────────────────────────────────

describe("buildLayerDetectionPrompt", () => {
  test("includes file paths from file nodes", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", type: "file", filePath: "src/routes/auth.ts" }),
      makeNode({ id: "fn1", type: "function", filePath: "src/routes/auth.ts" }),
    ];
    const prompt = buildLayerDetectionPrompt(nodes);
    expect(prompt).toContain("src/routes/auth.ts");
  });

  test("excludes non-file nodes from file list", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn1", type: "function", filePath: "src/routes/auth.ts" }),
    ];
    const prompt = buildLayerDetectionPrompt(nodes);
    expect(prompt).not.toContain("src/routes/auth.ts");
  });

  test("contains JSON array instructions", () => {
    const prompt = buildLayerDetectionPrompt([]);
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("name");
    expect(prompt).toContain("description");
    expect(prompt).toContain("filePatterns");
  });
});

// ─── applyLLMLayers ────────────────────────────────────────────────────────────

describe("applyLLMLayers", () => {
  const llmLayers = [
    { name: "API", description: "API endpoints", filePatterns: ["src/routes/"] },
    { name: "Service", description: "Business logic", filePatterns: ["src/services/"] },
  ];

  test("assigns file nodes matching patterns to correct layers", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "src/routes/auth.ts" }),
      makeNode({ id: "f2", filePath: "src/services/user.ts" }),
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const apiLayer = layers.find(l => l.name === "API");
    const svcLayer = layers.find(l => l.name === "Service");
    expect(apiLayer).toBeDefined();
    expect(apiLayer!.nodeIds).toContain("f1");
    expect(svcLayer).toBeDefined();
    expect(svcLayer!.nodeIds).toContain("f2");
  });

  test("assigns unmatched files to Other layer", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "src/unknown/thing.ts" }),
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const otherLayer = layers.find(l => l.name === "Other");
    expect(otherLayer).toBeDefined();
    expect(otherLayer!.nodeIds).toContain("f1");
  });

  test("assigns nodes without filePath to Other layer", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1" }), // no filePath
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const otherLayer = layers.find(l => l.name === "Other");
    expect(otherLayer).toBeDefined();
    expect(otherLayer!.nodeIds).toContain("f1");
  });

  test("skips non-file nodes", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn1", type: "function", filePath: "src/routes/auth.ts" }),
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const allNodeIds = layers.flatMap(l => l.nodeIds);
    expect(allNodeIds).not.toContain("fn1");
  });

  test("does not create empty layers", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "src/routes/auth.ts" }),
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const svcLayer = layers.find(l => l.name === "Service");
    expect(svcLayer).toBeUndefined();
  });

  test("handles pattern matching with includes", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "f1", filePath: "my-project/src/routes/auth.ts" }),
    ];
    const layers = applyLLMLayers(nodes, llmLayers);
    const apiLayer = layers.find(l => l.name === "API");
    expect(apiLayer).toBeDefined();
    expect(apiLayer!.nodeIds).toContain("f1");
  });
});
