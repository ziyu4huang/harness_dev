/**
 * analyzer.test.ts — Tests for LLM-powered file analysis and project summarization.
 *
 * Covers: extractJson (fenced/raw/embedded JSON), parseFileAnalysisResponse
 * (valid/missing fields/invalid), parseProjectSummaryResponse (valid/empty arrays),
 * buildProjectContextFromGraph, buildFileAnalysisPrompt, buildProjectSummaryPrompt.
 */

import { describe, test, expect } from "bun:test";
import {
  extractJson,
  parseFileAnalysisResponse,
  parseProjectSummaryResponse,
  buildProjectContextFromGraph,
  buildFileAnalysisPrompt,
  buildProjectSummaryPrompt,
  VALID_COMPLEXITIES,
} from "../analyzer.js";
import type { GraphNode, GraphEdge } from "../graph.js";

// ─── extractJson ───────────────────────────────────────────────────────────────

describe("extractJson", () => {
  test("extracts JSON from markdown code fence with json label", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(extractJson(input)).toBe('{"key": "value"}');
  });

  test("extracts JSON from code fence without json label", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJson(input)).toBe('{"key": "value"}');
  });

  test("extracts raw JSON object without fences", () => {
    const input = 'Here is the result: {"key": "value"} done';
    expect(extractJson(input)).toBe('{"key": "value"}');
  });

  test("extracts JSON from text with no object when no fences", () => {
    const input = 'just some text';
    expect(extractJson(input)).toBe("just some text");
  });

  test("handles nested braces in JSON", () => {
    const input = '```json\n{"outer": {"inner": true}}\n```';
    expect(extractJson(input)).toBe('{"outer": {"inner": true}}');
  });

  test("handles whitespace around JSON in fences", () => {
    const input = '```json\n  \n{"key": "value"}\n  \n```';
    expect(extractJson(input).trim()).toBe('{"key": "value"}');
  });
});

// ─── parseFileAnalysisResponse ─────────────────────────────────────────────────

describe("parseFileAnalysisResponse", () => {
  test("parses valid response with all fields", () => {
    const json = JSON.stringify({
      fileSummary: "A utility module",
      tags: ["utility", "async"],
      complexity: "moderate",
      functionSummaries: { foo: "Does foo" },
      classSummaries: { Bar: "A bar class" },
      languageNotes: "Uses async/await",
    });
    const result = parseFileAnalysisResponse(json);
    expect(result).not.toBeNull();
    expect(result!.fileSummary).toBe("A utility module");
    expect(result!.tags).toEqual(["utility", "async"]);
    expect(result!.complexity).toBe("moderate");
    expect(result!.functionSummaries).toEqual({ foo: "Does foo" });
    expect(result!.classSummaries).toEqual({ Bar: "A bar class" });
    expect(result!.languageNotes).toBe("Uses async/await");
  });

  test("defaults missing fileSummary to empty string", () => {
    const json = JSON.stringify({ tags: [], complexity: "simple", functionSummaries: {}, classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.fileSummary).toBe("");
  });

  test("defaults missing tags to empty array", () => {
    const json = JSON.stringify({ fileSummary: "test", complexity: "simple", functionSummaries: {}, classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.tags).toEqual([]);
  });

  test("normalizes invalid complexity to moderate", () => {
    const json = JSON.stringify({ fileSummary: "test", tags: [], complexity: "unknown", functionSummaries: {}, classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.complexity).toBe("moderate");
  });

  test("accepts all valid complexity values", () => {
    for (const c of ["simple", "moderate", "complex"]) {
      const json = JSON.stringify({ fileSummary: "test", tags: [], complexity: c, functionSummaries: {}, classSummaries: {} });
      const result = parseFileAnalysisResponse(json);
      expect(result!.complexity).toBe(c);
    }
  });

  test("filters non-string tags", () => {
    const json = JSON.stringify({ fileSummary: "test", tags: ["valid", 123, true], complexity: "simple", functionSummaries: {}, classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.tags).toEqual(["valid"]);
  });

  test("defaults missing functionSummaries to empty object", () => {
    const json = JSON.stringify({ fileSummary: "test", tags: [], complexity: "simple", classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.functionSummaries).toEqual({});
  });

  test("defaults missing classSummaries to empty object", () => {
    const json = JSON.stringify({ fileSummary: "test", tags: [], complexity: "simple", functionSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.classSummaries).toEqual({});
  });

  test("returns null for unparseable JSON", () => {
    expect(parseFileAnalysisResponse("not json")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseFileAnalysisResponse("")).toBeNull();
  });

  test("languageNotes is undefined when not present", () => {
    const json = JSON.stringify({ fileSummary: "test", tags: [], complexity: "simple", functionSummaries: {}, classSummaries: {} });
    const result = parseFileAnalysisResponse(json);
    expect(result!.languageNotes).toBeUndefined();
  });

  test("handles response with markdown fences", () => {
    const response = '```json\n' + JSON.stringify({
      fileSummary: "test", tags: [], complexity: "simple", functionSummaries: {}, classSummaries: {},
    }) + '\n```';
    const result = parseFileAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.fileSummary).toBe("test");
  });
});

// ─── parseProjectSummaryResponse ───────────────────────────────────────────────

describe("parseProjectSummaryResponse", () => {
  test("parses valid response with all fields", () => {
    const json = JSON.stringify({
      description: "A web server",
      frameworks: ["Bun", "Vercel AI SDK"],
      layers: [
        { name: "API", description: "API routes", filePatterns: ["src/routes/"] },
        { name: "Core", description: "Core logic", filePatterns: ["src/core/"] },
      ],
    });
    const result = parseProjectSummaryResponse(json);
    expect(result).not.toBeNull();
    expect(result!.description).toBe("A web server");
    expect(result!.frameworks).toEqual(["Bun", "Vercel AI SDK"]);
    expect(result!.layers).toHaveLength(2);
    expect(result!.layers[0].name).toBe("API");
  });

  test("defaults missing description to empty string", () => {
    const json = JSON.stringify({ frameworks: [], layers: [] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.description).toBe("");
  });

  test("defaults missing frameworks to empty array", () => {
    const json = JSON.stringify({ description: "test", layers: [] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.frameworks).toEqual([]);
  });

  test("defaults missing layers to empty array", () => {
    const json = JSON.stringify({ description: "test", frameworks: [] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.layers).toEqual([]);
  });

  test("filters non-string frameworks", () => {
    const json = JSON.stringify({ description: "test", frameworks: ["valid", 123], layers: [] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.frameworks).toEqual(["valid"]);
  });

  test("filters layer items without name", () => {
    const json = JSON.stringify({
      description: "test",
      frameworks: [],
      layers: [
        { name: "Valid", description: "desc", filePatterns: [] },
        { description: "No name", filePatterns: [] },
      ],
    });
    const result = parseProjectSummaryResponse(json);
    expect(result!.layers).toHaveLength(1);
    expect(result!.layers[0].name).toBe("Valid");
  });

  test("defaults missing layer description to empty string", () => {
    const json = JSON.stringify({ description: "test", frameworks: [], layers: [{ name: "Layer1" }] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.layers[0].description).toBe("");
  });

  test("defaults missing filePatterns to empty array", () => {
    const json = JSON.stringify({ description: "test", frameworks: [], layers: [{ name: "Layer1", description: "desc" }] });
    const result = parseProjectSummaryResponse(json);
    expect(result!.layers[0].filePatterns).toEqual([]);
  });

  test("returns null for unparseable JSON", () => {
    expect(parseProjectSummaryResponse("not json")).toBeNull();
  });

  test("handles response with markdown fences", () => {
    const response = '```json\n' + JSON.stringify({
      description: "test", frameworks: [], layers: [],
    }) + '\n```';
    const result = parseProjectSummaryResponse(response);
    expect(result).not.toBeNull();
    expect(result!.description).toBe("test");
  });
});

// ─── buildFileAnalysisPrompt ───────────────────────────────────────────────────

describe("buildFileAnalysisPrompt", () => {
  test("includes file path in prompt", () => {
    const prompt = buildFileAnalysisPrompt("src/auth.ts", "code here", "Test project");
    expect(prompt).toContain("src/auth.ts");
  });

  test("includes file content in prompt", () => {
    const prompt = buildFileAnalysisPrompt("src/auth.ts", "function login() {}", "Test project");
    expect(prompt).toContain("function login() {}");
  });

  test("includes project context in prompt", () => {
    const prompt = buildFileAnalysisPrompt("src/auth.ts", "code", "My Project Context");
    expect(prompt).toContain("My Project Context");
  });
});

// ─── buildProjectSummaryPrompt ─────────────────────────────────────────────────

describe("buildProjectSummaryPrompt", () => {
  test("includes file list in prompt", () => {
    const prompt = buildProjectSummaryPrompt(["a.ts", "b.ts"], []);
    expect(prompt).toContain("a.ts");
    expect(prompt).toContain("b.ts");
  });

  test("includes sample files when provided", () => {
    const prompt = buildProjectSummaryPrompt(
      ["a.ts"],
      [{ path: "a.ts", content: "function hello() {}" }],
    );
    expect(prompt).toContain("function hello() {}");
    expect(prompt).toContain("Sample files");
  });

  test("excludes sample section when no samples", () => {
    const prompt = buildProjectSummaryPrompt(["a.ts"], []);
    expect(prompt).not.toContain("Sample files");
  });
});

// ─── buildProjectContextFromGraph ───────────────────────────────────────────────

describe("buildProjectContextFromGraph", () => {
  const nodes: GraphNode[] = [
    { id: "n1", type: "function", name: "login", summary: "Login handler", tags: [] },
    { id: "n2", type: "file", name: "auth.ts", summary: "Auth module", tags: [], filePath: "src/auth.ts" },
  ];
  const edges: GraphEdge[] = [
    { source: "n1", target: "n2", type: "contains" },
    { source: "n2", target: "n1", type: "imports" },
  ];

  test("includes project name", () => {
    const ctx = buildProjectContextFromGraph(nodes, edges, "MyProject");
    expect(ctx).toContain("MyProject");
  });

  test("includes node count", () => {
    const ctx = buildProjectContextFromGraph(nodes, edges, "Test");
    expect(ctx).toContain("Nodes: 2");
  });

  test("includes edge types summary", () => {
    const ctx = buildProjectContextFromGraph(nodes, edges, "Test");
    expect(ctx).toContain("contains");
    expect(ctx).toContain("imports");
  });

  test("limits to 30 nodes", () => {
    const manyNodes: GraphNode[] = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`, type: "function", name: `node${i}`, summary: `Node ${i}`, tags: [],
    }));
    const ctx = buildProjectContextFromGraph(manyNodes, [], "Test");
    // Count lines that start with "  [" — should be 30 (the sample node lines)
    const sampleLines = ctx.split("\n").filter(l => l.trim().startsWith("["));
    expect(sampleLines.length).toBeLessThanOrEqual(30);
  });
});

// ─── VALID_COMPLEXITIES ────────────────────────────────────────────────────────

describe("VALID_COMPLEXITIES", () => {
  test("contains the three expected values", () => {
    expect(VALID_COMPLEXITIES.has("simple")).toBe(true);
    expect(VALID_COMPLEXITIES.has("moderate")).toBe(true);
    expect(VALID_COMPLEXITIES.has("complex")).toBe(true);
  });

  test("rejects invalid values", () => {
    expect(VALID_COMPLEXITIES.has("unknown")).toBe(false);
    expect(VALID_COMPLEXITIES.has("")).toBe(false);
  });
});
