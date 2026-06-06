/**
 * Tests for the language-lesson module — concept detection, prompt building,
 * and response parsing.
 */
import { describe, test, expect } from "bun:test";
import {
  detectLanguageConcepts,
  detectAllConcepts,
  buildLanguageLessonPrompt,
  parseLanguageLessonResponse,
  type LanguageLessonResult,
} from "../language-lesson.js";
import type { GraphNode, GraphEdge } from "../graph.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "fn:test.ts:myFunc",
    type: "function",
    name: "myFunc",
    filePath: "test.ts",
    summary: "A test function",
    tags: [],
    ...overrides,
  };
}

// ─── detectLanguageConcepts ─────────────────────────────────────────────────────

describe("detectLanguageConcepts", () => {
  test("detects async/await from tags", () => {
    const node = makeNode({ tags: ["async", "promise"] });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("async/await");
  });

  test("detects middleware pattern from summary", () => {
    const node = makeNode({ summary: "Express middleware for authentication" });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("middleware pattern");
  });

  test("detects generics from tags", () => {
    const node = makeNode({ tags: ["generic", "type parameter"] });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("generics");
  });

  test("detects observer pattern from languageNotes", () => {
    const node = makeNode({ languageNotes: "Uses event subscribe/publish pattern" });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("observer pattern");
  });

  test("detects error handling from tags", () => {
    const node = makeNode({ tags: ["try/catch", "error boundary"] });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("error handling");
  });

  test("detects higher-order functions from summary", () => {
    const node = makeNode({ summary: "A factory that returns a callback closure" });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("higher-order functions");
  });

  test("returns empty array for node with no matching concepts", () => {
    const node = makeNode({ tags: ["simple"], summary: "Just a basic function" });
    const concepts = detectLanguageConcepts(node);
    expect(concepts.length).toBe(0);
  });

  test("detects multiple concepts simultaneously", () => {
    const node = makeNode({
      tags: ["async", "middleware"],
      summary: "Async middleware with try/catch error handling",
    });
    const concepts = detectLanguageConcepts(node);
    expect(concepts).toContain("async/await");
    expect(concepts).toContain("middleware pattern");
    expect(concepts).toContain("error handling");
  });
});

// ─── detectAllConcepts ──────────────────────────────────────────────────────────

describe("detectAllConcepts", () => {
  test("aggregates concepts across multiple nodes", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn:a.ts:fn1", tags: ["async"] }),
      makeNode({ id: "fn:b.ts:fn2", tags: ["middleware"] }),
      makeNode({ id: "fn:c.ts:fn3", tags: ["generic"] }),
    ];
    const conceptMap = detectAllConcepts(nodes);
    expect(conceptMap["async/await"]).toBeDefined();
    expect(conceptMap["async/await"].length).toBe(1);
    expect(conceptMap["middleware pattern"]).toBeDefined();
    expect(conceptMap["generics"]).toBeDefined();
  });

  test("maps multiple nodes to the same concept", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn:a.ts:fn1", tags: ["async"] }),
      makeNode({ id: "fn:b.ts:fn2", tags: ["async", "promise"] }),
    ];
    const conceptMap = detectAllConcepts(nodes);
    expect(conceptMap["async/await"].length).toBe(2);
  });

  test("returns empty object for nodes with no concepts", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "fn:a.ts:fn1", tags: ["simple"] }),
    ];
    const conceptMap = detectAllConcepts(nodes);
    expect(Object.keys(conceptMap).length).toBe(0);
  });
});

// ─── buildLanguageLessonPrompt ──────────────────────────────────────────────────

describe("buildLanguageLessonPrompt", () => {
  test("includes node name and type in prompt", () => {
    const node = makeNode({ name: "handleRequest", type: "function" });
    const edges: GraphEdge[] = [];
    const prompt = buildLanguageLessonPrompt(node, edges);
    expect(prompt).toContain("handleRequest");
    expect(prompt).toContain("function");
  });

  test("includes detected concepts section", () => {
    const node = makeNode({ tags: ["async", "promise"] });
    const edges: GraphEdge[] = [];
    const prompt = buildLanguageLessonPrompt(node, edges);
    expect(prompt).toContain("async/await");
  });

  test("includes relationships from edges", () => {
    const node = makeNode({ id: "fn:a.ts:main" });
    const edges: GraphEdge[] = [
      { source: "fn:a.ts:main", target: "fn:b.ts:helper", type: "calls", description: "calls helper" },
    ];
    const prompt = buildLanguageLessonPrompt(node, edges);
    expect(prompt).toContain("calls");
    expect(prompt).toContain("fn:b.ts:helper");
  });

  test("uses default TypeScript language", () => {
    const node = makeNode();
    const edges: GraphEdge[] = [];
    const prompt = buildLanguageLessonPrompt(node, edges);
    expect(prompt).toContain("TypeScript");
  });

  test("uses custom language when specified", () => {
    const node = makeNode();
    const edges: GraphEdge[] = [];
    const prompt = buildLanguageLessonPrompt(node, edges, "Python");
    expect(prompt).toContain("Python");
  });
});

// ─── parseLanguageLessonResponse ────────────────────────────────────────────────

describe("parseLanguageLessonResponse", () => {
  test("parses valid JSON response", () => {
    const response = JSON.stringify({
      languageNotes: "Uses async/await pattern for non-blocking I/O.",
      concepts: [
        { name: "async/await", explanation: "Async/await simplifies promise handling." },
        { name: "error handling", explanation: "Try/catch blocks handle errors." },
      ],
    });
    const result = parseLanguageLessonResponse(response);
    expect(result.languageNotes).toContain("async/await");
    expect(result.concepts.length).toBe(2);
    expect(result.concepts[0].name).toBe("async/await");
  });

  test("parses fenced JSON response", () => {
    const response = '```json\n{"languageNotes": "Some notes.", "concepts": [{"name": "generics", "explanation": "Type parameters."}]}\n```';
    const result = parseLanguageLessonResponse(response);
    expect(result.languageNotes).toBe("Some notes.");
    expect(result.concepts.length).toBe(1);
    expect(result.concepts[0].name).toBe("generics");
  });

  test("returns safe defaults on malformed input", () => {
    const result = parseLanguageLessonResponse("not valid json at all");
    expect(result.languageNotes).toBe("");
    expect(result.concepts).toEqual([]);
  });

  test("returns safe defaults on empty string", () => {
    const result = parseLanguageLessonResponse("");
    expect(result.languageNotes).toBe("");
    expect(result.concepts).toEqual([]);
  });

  test("filters concepts missing required fields", () => {
    const response = JSON.stringify({
      languageNotes: "Notes",
      concepts: [
        { name: "valid", explanation: "A valid concept" },
        { name: "missing-explanation" },
        { explanation: "missing name" },
        42,
        null,
      ],
    });
    const result = parseLanguageLessonResponse(response);
    expect(result.concepts.length).toBe(1);
    expect(result.concepts[0].name).toBe("valid");
  });

  test("handles response with extra text around JSON", () => {
    const response = `Here is the analysis:
{"languageNotes": "Extra text notes", "concepts": []}
Hope this helps!`;
    const result = parseLanguageLessonResponse(response);
    expect(result.languageNotes).toBe("Extra text notes");
    expect(result.concepts).toEqual([]);
  });
});
