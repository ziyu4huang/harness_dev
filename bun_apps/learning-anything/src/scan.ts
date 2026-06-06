/**
 * Scan: Directory scanning and structural graph construction.
 *
 * Provides a lightweight scan pipeline that walks a project directory,
 * creates file-level graph nodes, resolves import/export relationships,
 * and links child function/class nodes via 'contains' edges.
 *
 * This closes the gap where the bun-app produces 0 file nodes and 0
 * 'contains' edges, compared to UA which produces 9 file nodes and 12
 * 'contains' edges for the same project.
 *
 * Port of UA's graph-builder.ts file-node and import/export resolution,
 * re-implemented without TreeSitter dependency (regex-based extraction).
 */

import type { GraphNode, GraphEdge } from "./graph.js";
import { autoParse } from "./parsers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Root directory to scan. */
  projectDir: string;
  /** Glob patterns to include. Default: ts, js, tsx, jsx extensions. */
  filePatterns?: string[];
  /** Glob patterns to exclude (default: node_modules, dist, .git, coverage). */
  excludePatterns?: string[];
}

export interface ScanResult {
  fileNodes: GraphNode[];
  containsEdges: GraphEdge[];
  stats: {
    filesScanned: number;
    fileNodesCreated: number;
    containsEdgesCreated: number;
  };
}

export interface ImportExportResult {
  importEdges: GraphEdge[];
  exportEdges: GraphEdge[];
  stats: {
    importsResolved: number;
    exportsResolved: number;
    filesAnalyzed: number;
  };
}

export interface NonCodeScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    filesScanned: number;
    nodesCreated: number;
    edgesCreated: number;
  };
}

export interface TestEdgeResult {
  testEdges: GraphEdge[];
  stats: {
    testFilesFound: number;
    testedByEdgesCreated: number;
  };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FILE_PATTERNS = [
  "**/*.ts",
  "**/*.js",
  "**/*.tsx",
  "**/*.jsx",
];

const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/coverage/**",
  "**/__tmp_*/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.d.ts",
];

const NON_CODE_FILE_PATTERNS = [
  "**/*.md",
  "**/*.mdx",
  "**/*.markdown",
  "**/*.yaml",
  "**/*.yml",
  "**/*.json",
  "**/*.toml",
  "**/.env*",
  "**/Dockerfile",
  "**/docker-compose*.yml",
];

const TEST_FILE_PATTERNS = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.test.js",
  "**/*.spec.js",
];

const NON_CODE_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/coverage/**",
  "**/__tmp_*/**",
  "**/package-lock.json",
  "**/bun.lock",
  "**/yarn.lock",
];

// ─── File Node Generation ─────────────────────────────────────────────────────

/** Collect source files matching patterns, excluding unwanted paths. */
function collectSourceFiles(projectDir: string, filePatterns: string[], excludePatterns: string[]): string[] {
  const allFiles = new Set<string>();
  for (const pattern of filePatterns) {
    try {
      const glob = new Bun.Glob(pattern);
      const matches = glob.scanSync({ cwd: projectDir, dot: false });
      for (const match of matches) allFiles.add(match.replace(/\\/g, "/"));
    } catch { /* pattern may not match */ }
  }
  const excludeGlobs = excludePatterns.map(p => new Bun.Glob(p));
  return [...allFiles].filter(filePath => !excludeGlobs.some(g => g.match(filePath)));
}

/** Build a map of filePath → child nodes (function/class/method) from existing graph nodes. */
function buildChildNodesByFile(existingNodes: GraphNode[]): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const node of existingNodes) {
    if (node.filePath) {
      const normalized = node.filePath.replace(/\\/g, "/");
      const arr = map.get(normalized) ?? [];
      arr.push(node);
      map.set(normalized, arr);
    }
  }
  return map;
}

/** Determine the language type from a file extension. */
function fileTypeFromExt(ext: string): string {
  if (["ts", "tsx"].includes(ext)) return "typescript";
  if (["js", "jsx"].includes(ext)) return "javascript";
  return "source";
}

/** Create a GraphNode representing a source file. */
function createFileNode(filePath: string): GraphNode {
  const basename = filePath.split("/").pop() ?? filePath;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return {
    id: `file:${filePath}`,
    type: "file",
    name: basename,
    filePath,
    summary: `Source file: ${basename} (${fileTypeFromExt(ext)})`,
    tags: ["source", fileTypeFromExt(ext)],
  };
}

/** Create 'contains' edges linking a file node to its function/class/method children. */
function linkContainsEdges(fileNode: GraphNode, childrenByFile: Map<string, GraphNode[]>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const children = childrenByFile.get(fileNode.filePath) ?? [];
  for (const child of children) {
    if (child.type === "function" || child.type === "class" || child.type === "method") {
      edges.push({
        source: fileNode.id,
        target: child.id,
        type: "contains",
        description: `${fileNode.name} contains ${child.type} ${child.name}`,
      });
    }
  }
  return edges;
}

/**
 * Walk a directory and create file-level graph nodes, then link existing
 * function/class nodes to their parent file via 'contains' edges.
 */
export function buildFileNodes(
  options: ScanOptions,
  existingNodes: GraphNode[],
): ScanResult {
  const { projectDir, filePatterns = DEFAULT_FILE_PATTERNS, excludePatterns = DEFAULT_EXCLUDE_PATTERNS } = options;
  const filteredFiles = collectSourceFiles(projectDir, filePatterns, excludePatterns);
  const childrenByFile = buildChildNodesByFile(existingNodes);

  const fileNodes: GraphNode[] = [];
  const containsEdges: GraphEdge[] = [];
  for (const filePath of filteredFiles) {
    const fileNode = createFileNode(filePath);
    fileNodes.push(fileNode);
    containsEdges.push(...linkContainsEdges(fileNode, childrenByFile));
  }

  return {
    fileNodes,
    containsEdges,
    stats: {
      filesScanned: filteredFiles.length,
      fileNodesCreated: fileNodes.length,
      containsEdgesCreated: containsEdges.length,
    },
  };
}

// ─── Import/Export Edge Resolution ────────────────────────────────────────────

/**
 * Resolve import and export relationships between source files.
 * Reads each file, extracts import/export statements via regex,
 * and creates 'imports' and 'exports' edges between graph nodes.
 *
 * @param projectDir - Root directory of the project
 * @param existingNodes - Current graph nodes (must include file nodes)
 * @returns ImportExportResult with import and export edges
 */
export function resolveImportExportEdges(
  projectDir: string,
  existingNodes: GraphNode[],
): ImportExportResult {
  const importEdges: GraphEdge[] = [];
  const exportEdges: GraphEdge[] = [];
  let filesAnalyzed = 0;

  // Build lookup: filePath -> file node
  const fileNodesByPath = new Map<string, GraphNode>();
  for (const node of existingNodes) {
    if (node.type === "file" && node.filePath) {
      fileNodesByPath.set(node.filePath.replace(/\\/g, "/"), node);
    }
  }

  // Build lookup: filePath -> child nodes (function/class)
  const childrenByFilePath = new Map<string, GraphNode[]>();
  for (const node of existingNodes) {
    if (node.filePath && (node.type === "function" || node.type === "class" || node.type === "method")) {
      const normalized = node.filePath.replace(/\\/g, "/");
      const existing = childrenByFilePath.get(normalized) ?? [];
      existing.push(node);
      childrenByFilePath.set(normalized, existing);
    }
  }

  // For each file node, read its content and extract imports/exports
  for (const [filePath, fileNode] of fileNodesByPath) {
    try {
      const { readFileSync } = require("fs");
      const { join } = require("path");
      const fullPath = join(projectDir, filePath);
      const content = readFileSync(fullPath, "utf-8");
      filesAnalyzed++;

      // --- Extract imports ---
      // Match: import ... from './relative' or '../relative'
      const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*from\s+['"](\.[^'"]+)['"]/g;
      let importMatch: RegExpExecArray | null;
      while ((importMatch = importRegex.exec(content)) !== null) {
        const rawImportPath = importMatch[1];
        const resolvedPath = resolveImportPath(filePath, rawImportPath, fileNodesByPath);
        if (resolvedPath && resolvedPath !== filePath) {
          const targetFileNode = fileNodesByPath.get(resolvedPath);
          if (targetFileNode) {
            importEdges.push({
              source: fileNode.id,
              target: targetFileNode.id,
              type: "imports",
              description: `${fileNode.name} imports from ${targetFileNode.name}`,
            });
          }
        }
      }

      // --- Extract exports ---
      // Match: export function name, export class Name, export const/let/var name
      const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;
      let exportMatch: RegExpExecArray | null;
      while ((exportMatch = exportRegex.exec(content)) !== null) {
        const exportedName = exportMatch[1];
        // Find the child node matching this exported name in this file
        const children = childrenByFilePath.get(filePath) ?? [];
        const childNode = children.find(c => c.name === exportedName);
        if (childNode) {
          exportEdges.push({
            source: fileNode.id,
            target: childNode.id,
            type: "exports",
            description: `${fileNode.name} exports ${childNode.type} ${exportedName}`,
          });
        }
      }

    } catch {
      // File may not be readable, skip
    }
  }

  // Deduplicate edges by source+target+type
  const seen = new Set<string>();
  const dedupedImportEdges = importEdges.filter(e => {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dedupedExportEdges = exportEdges.filter(e => {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    importEdges: dedupedImportEdges,
    exportEdges: dedupedExportEdges,
    stats: {
      importsResolved: dedupedImportEdges.length,
      exportsResolved: dedupedExportEdges.length,
      filesAnalyzed,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a relative import path to an absolute file path.
 * Handles .ts, .tsx, .js, .jsx extensions and index files.
 */
function resolveImportPath(
  fromFile: string,
  importPath: string,
  fileNodesByPath: Map<string, GraphNode>,
): string | null {
  const dir = fromFile.includes("/") ? fromFile.substring(0, fromFile.lastIndexOf("/")) : "";
  const parts = importPath.split("/");
  const resolved = dir ? `${dir}/${parts.join("/")}` : parts.join("/");

  // Normalize: remove ./ and resolve ../
  const normalized = normalizePath(resolved);

  // Try exact match first
  if (fileNodesByPath.has(normalized)) return normalized;

  // Try with extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx"];
  for (const ext of extensions) {
    if (fileNodesByPath.has(normalized + ext)) return normalized + ext;
  }

  // Try index file
  for (const ext of extensions) {
    const indexPath = `${normalized}/index${ext}`;
    if (fileNodesByPath.has(indexPath)) return indexPath;
  }

  return null;
}

/**
 * Normalize a path by resolving . and .. segments.
 */
function normalizePath(path: string): string {
  const segments = path.split("/");
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (result.length > 0) result.pop();
    } else {
      result.push(segment);
    }
  }

  return result.join("/");
}

// ─── Non-Code File Node Generation ────────────────────────────────────────────

/**
 * Scan for non-code files (.md, .yaml, .json, .toml, .env, Dockerfile)
 * and create document/config/service/endpoint nodes using the parsers module.
 *
 * This closes the gap where the bun-app produces 0 document nodes and 0
 * config nodes, compared to UA which produces document nodes from .md files
 * and config nodes from .yaml/.json files.
 */
export function buildNonCodeNodes(
  projectDir: string,
  existingNodes: GraphNode[],
): NonCodeScanResult {
  const files = collectSourceFiles(projectDir, NON_CODE_FILE_PATTERNS, NON_CODE_EXCLUDE_PATTERNS);

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  // Build a set of existing node IDs to avoid duplicates
  const existingIds = new Set(existingNodes.map(n => n.id));

  const { readFileSync } = require("fs");
  const { join } = require("path");

  for (const filePath of files) {
    try {
      const fullPath = join(projectDir, filePath);
      const content = readFileSync(fullPath, "utf-8");
      const parseResult = autoParse(filePath, content);

      for (const rawNode of parseResult.nodes) {
        // Ensure node has required fields and no duplicate
        if (!rawNode.id || existingIds.has(rawNode.id)) continue;
        const node: GraphNode = {
          id: rawNode.id,
          type: rawNode.type ?? "document",
          name: rawNode.name ?? filePath.split("/").pop() ?? filePath,
          filePath: rawNode.filePath ?? filePath,
          summary: rawNode.summary ?? "",
          tags: rawNode.tags ?? [],
        };
        allNodes.push(node);
        existingIds.add(node.id);
      }

      for (const rawEdge of parseResult.edges) {
        if (!rawEdge.source || !rawEdge.target || !rawEdge.type) continue;
        const edge: GraphEdge = {
          source: rawEdge.source,
          target: rawEdge.target,
          type: rawEdge.type,
          description: rawEdge.description ?? "",
        };
        allEdges.push(edge);
      }
    } catch {
      // File may not be readable, skip
    }
  }

  // Deduplicate edges
  const seenEdges = new Set<string>();
  const dedupedEdges = allEdges.filter(e => {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  return {
    nodes: allNodes,
    edges: dedupedEdges,
    stats: {
      filesScanned: files.length,
      nodesCreated: allNodes.length,
      edgesCreated: dedupedEdges.length,
    },
  };
}

// ─── Test Edge Resolution ─────────────────────────────────────────────────────

/** Derive candidate subject file paths from a test file path. */
function deriveSubjectPaths(normalized: string, testFileName: string): string[] {
  const subjectFileName = testFileName.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, ".$2");
  const testDir = normalized.includes("/") ? normalized.substring(0, normalized.lastIndexOf("/")) : "";
  return [
    testDir ? `${testDir}/${subjectFileName}` : subjectFileName,
    testDir.includes("__tests__") ? `${testDir.replace(/\/__tests__$/, "")}/${subjectFileName}` : null,
  ].filter((p): p is string => p !== null);
}

/** Find or create a file node for a test file. */
function ensureTestFileNode(normalized: string, testFileName: string, fileNodesByPath: Map<string, GraphNode>): GraphNode {
  let node = fileNodesByPath.get(normalized);
  if (!node) {
    node = { id: `file:${normalized}`, type: "file", name: testFileName, filePath: normalized, summary: `Test file: ${testFileName}`, tags: ["test", "source"] };
    fileNodesByPath.set(normalized, node);
  }
  return node;
}

/**
 * Detect test files and create 'tested_by' edges linking source nodes
 * to their corresponding test files.
 */
export function resolveTestEdges(
  projectDir: string,
  existingNodes: GraphNode[],
): TestEdgeResult {
  const testFiles = collectSourceFiles(projectDir, TEST_FILE_PATTERNS, ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/__tmp_*/**"]);
  const fileNodesByPath = new Map<string, GraphNode>();
  for (const node of existingNodes) {
    if (node.type === "file" && node.filePath) fileNodesByPath.set(node.filePath.replace(/\\/g, "/"), node);
  }

  const testEdges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const testFilePath of testFiles) {
    const normalized = testFilePath.replace(/\\/g, "/");
    const testFileName = normalized.split("/").pop() ?? normalized;
    const subjectFileNode = deriveSubjectPaths(normalized, testFileName).reduce<GraphNode | undefined>((found, p) => found ?? fileNodesByPath.get(p), undefined);
    if (!subjectFileNode) continue;

    const testFileNode = ensureTestFileNode(normalized, testFileName, fileNodesByPath);
    const edgeKey = `${subjectFileNode.id}|${testFileNode.id}|tested_by`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    testEdges.push({ source: subjectFileNode.id, target: testFileNode.id, type: "tested_by", description: `${subjectFileNode.name} is tested by ${testFileNode.name}` });
  }

  return { testEdges, stats: { testFilesFound: testFiles.length, testedByEdgesCreated: testEdges.length } };
}
