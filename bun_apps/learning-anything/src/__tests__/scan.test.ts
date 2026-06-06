/**
 * Tests for the scan module — file node generation, non-code scanning,
 * import/export edge resolution, and tested_by edge creation.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  buildFileNodes,
  resolveImportExportEdges,
  buildNonCodeNodes,
  resolveTestEdges,
  type ScanOptions,
} from "../scan.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const TMP_DIR = join(import.meta.dir, "__tmp_scan_test__");

const TS_FILE_A = `
import { helper } from './utils';
export function main() {
  return helper();
}
`;

const TS_FILE_B = `
export function helper() {
  return 42;
}
`;

const TS_FILE_UTILS = `
export function helper(): number { return 42; }
export function formatName(name: string): string { return name.trim(); }
`;

const TEST_FILE_A = `
import { main } from './module-a';
describe('main', () => { test('works', () => { expect(main()).toBeDefined(); }) });
`;

const MARKDOWN_FILE = `# Project README

## Getting Started
Install dependencies and run the server.

\`\`\`bash
bun install
\`\`\`

## API Reference
See the docs for details.
`;

const YAML_FILE = `
version: "3"
services:
  web:
    image: nginx
  db:
    image: postgres
`;

const JSON_FILE = JSON.stringify({
  name: "test-project",
  version: "1.0.0",
  dependencies: { "express": "^4.18.0" },
}, null, 2);

beforeAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(join(TMP_DIR, "src"), { recursive: true });
  mkdirSync(join(TMP_DIR, "src", "__tests__"), { recursive: true });

  writeFileSync(join(TMP_DIR, "src", "module-a.ts"), TS_FILE_A);
  writeFileSync(join(TMP_DIR, "src", "utils.ts"), TS_FILE_UTILS);
  writeFileSync(join(TMP_DIR, "README.md"), MARKDOWN_FILE);
  writeFileSync(join(TMP_DIR, "docker-compose.yml"), YAML_FILE);
  writeFileSync(join(TMP_DIR, "package.json"), JSON_FILE);
  writeFileSync(join(TMP_DIR, "src", "__tests__", "module-a.test.ts"), TEST_FILE_A);
});

afterAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

// ─── buildFileNodes ─────────────────────────────────────────────────────────────

describe("buildFileNodes", () => {
  test("creates file nodes for matching source files", () => {
    const result = buildFileNodes({ projectDir: TMP_DIR }, []);
    expect(result.fileNodes.length).toBeGreaterThanOrEqual(2);
    expect(result.fileNodes.some(n => n.name === "module-a.ts")).toBe(true);
    expect(result.fileNodes.some(n => n.name === "utils.ts")).toBe(true);
  });

  test("creates file nodes with correct IDs and types", () => {
    const result = buildFileNodes({ projectDir: TMP_DIR }, []);
    for (const node of result.fileNodes) {
      expect(node.id).toMatch(/^file:/);
      expect(node.type).toBe("file");
      expect(node.filePath).toBeDefined();
    }
  });

  test("creates contains edges linking file nodes to function/class children", () => {
    // Simulate existing function nodes from the same files
    const existingNodes = [
      { id: "fn:src/utils.ts:helper", type: "function", name: "helper", filePath: "src/utils.ts", summary: "", tags: [] },
      { id: "fn:src/module-a.ts:main", type: "function", name: "main", filePath: "src/module-a.ts", summary: "", tags: [] },
    ] as any;
    const result = buildFileNodes({ projectDir: TMP_DIR }, existingNodes);
    expect(result.containsEdges.length).toBeGreaterThanOrEqual(2);
    expect(result.containsEdges.some(e => e.type === "contains")).toBe(true);
  });

  test("respects file patterns", () => {
    const result = buildFileNodes({
      projectDir: TMP_DIR,
      filePatterns: ["**/*.ts"],
      excludePatterns: ["**/node_modules/**"],
    }, []);
    // Should not include .js files
    expect(result.fileNodes.every(n => n.name.endsWith(".ts"))).toBe(true);
  });

  test("excludes test files by default", () => {
    const result = buildFileNodes({ projectDir: TMP_DIR }, []);
    const testFileNodes = result.fileNodes.filter(n =>
      n.name.includes(".test.") || n.name.includes(".spec.")
    );
    expect(testFileNodes.length).toBe(0);
  });

  test("stats report correct counts", () => {
    const result = buildFileNodes({ projectDir: TMP_DIR }, []);
    expect(result.stats.filesScanned).toBe(result.fileNodes.length);
    expect(result.stats.fileNodesCreated).toBe(result.fileNodes.length);
  });
});

// ─── resolveImportExportEdges ───────────────────────────────────────────────────

describe("resolveImportExportEdges", () => {
  test("creates import edges between files", () => {
    // First create file nodes
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    const result = resolveImportExportEdges(TMP_DIR, scanResult.fileNodes);
    // module-a.ts imports from utils.ts
    const importEdges = result.importEdges.filter(e => e.type === "imports");
    expect(importEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("creates export edges for exported functions", () => {
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    // Add function nodes that the scan should find
    const functionNodes = [
      { id: "fn:src/utils.ts:helper", type: "function", name: "helper", filePath: "src/utils.ts", summary: "", tags: [] },
      { id: "fn:src/utils.ts:formatName", type: "function", name: "formatName", filePath: "src/utils.ts", summary: "", tags: [] },
    ] as any;
    const allNodes = [...scanResult.fileNodes, ...functionNodes];
    const result = resolveImportExportEdges(TMP_DIR, allNodes);
    expect(result.exportEdges.length).toBeGreaterThanOrEqual(1);
    expect(result.exportEdges.some(e => e.type === "exports")).toBe(true);
  });

  test("deduplicates edges by source+target+type", () => {
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    const result = resolveImportExportEdges(TMP_DIR, scanResult.fileNodes);
    const keys = result.importEdges.map(e => `${e.source}|${e.target}|${e.type}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });
});

// ─── buildNonCodeNodes ──────────────────────────────────────────────────────────

describe("buildNonCodeNodes", () => {
  test("creates document nodes from markdown files", () => {
    const result = buildNonCodeNodes(TMP_DIR, []);
    const docNodes = result.nodes.filter(n => n.type === "document");
    expect(docNodes.length).toBeGreaterThanOrEqual(1);
    const readmeNode = docNodes.find(n => n.filePath?.includes("README.md"));
    expect(readmeNode).toBeDefined();
    expect(readmeNode!.tags).toContain("markdown");
  });

  test("creates config nodes from YAML files", () => {
    const result = buildNonCodeNodes(TMP_DIR, []);
    const configNodes = result.nodes.filter(n => n.type === "config");
    expect(configNodes.length).toBeGreaterThanOrEqual(1);
    const composeNode = configNodes.find(n => n.filePath?.includes("docker-compose"));
    expect(composeNode).toBeDefined();
  });

  test("creates config nodes from JSON files", () => {
    const result = buildNonCodeNodes(TMP_DIR, []);
    const jsonNodes = result.nodes.filter(n => n.type === "config" && n.filePath?.includes("package.json"));
    expect(jsonNodes.length).toBeGreaterThanOrEqual(1);
  });

  test("creates configures edges for YAML services", () => {
    const result = buildNonCodeNodes(TMP_DIR, []);
    const configuresEdges = result.edges.filter(e => e.type === "configures");
    expect(configuresEdges.length).toBeGreaterThanOrEqual(1);
  });

  test("does not duplicate existing nodes", () => {
    const first = buildNonCodeNodes(TMP_DIR, []);
    // Pass the first result as existing nodes to simulate duplicate check
    const second = buildNonCodeNodes(TMP_DIR, first.nodes);
    // Second pass should not create duplicate nodes with the same IDs
    const allIds = [...first.nodes.map(n => n.id), ...second.nodes.map(n => n.id)];
    const uniqueIds = new Set(allIds);
    expect(allIds.length).toBe(uniqueIds.size);
  });

  test("stats report correct counts", () => {
    const result = buildNonCodeNodes(TMP_DIR, []);
    expect(result.stats.filesScanned).toBeGreaterThanOrEqual(3);
    expect(result.stats.nodesCreated).toBe(result.nodes.length);
    expect(result.stats.edgesCreated).toBe(result.edges.length);
  });
});

// ─── resolveTestEdges ───────────────────────────────────────────────────────────

describe("resolveTestEdges", () => {
  test("creates tested_by edges for test files", () => {
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    const result = resolveTestEdges(TMP_DIR, scanResult.fileNodes);
    expect(result.testEdges.length).toBeGreaterThanOrEqual(1);
    expect(result.testEdges.some(e => e.type === "tested_by")).toBe(true);
  });

  test("test edges link subject file to test file", () => {
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    const result = resolveTestEdges(TMP_DIR, scanResult.fileNodes);
    const testedByEdge = result.testEdges.find(e => e.type === "tested_by");
    if (testedByEdge) {
      expect(testedByEdge.source).toMatch(/^file:.*module-a/);
      expect(testedByEdge.target).toMatch(/^file:.*module-a\.test/);
      expect(testedByEdge.description).toContain("tested by");
    }
  });

  test("stats report test file count", () => {
    const scanResult = buildFileNodes({ projectDir: TMP_DIR }, []);
    const result = resolveTestEdges(TMP_DIR, scanResult.fileNodes);
    expect(result.stats.testFilesFound).toBeGreaterThanOrEqual(1);
  });
});
