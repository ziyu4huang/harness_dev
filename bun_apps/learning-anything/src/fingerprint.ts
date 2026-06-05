/**
 * Fingerprint: Structural fingerprinting for incremental graph updates.
 *
 * Port of UA's fingerprint.ts, re-implemented using regex-based structural
 * extraction instead of tree-sitter. Since the bun-app has no tree-sitter
 * dependency, we extract function/class/import/export signatures via
 * pattern matching against TypeScript source code.
 *
 * Change levels:
 *   - NONE:      content hash identical (file unchanged)
 *   - COSMETIC:  content differs but structural signatures match
 *   - STRUCTURAL: signature-level changes detected (new/removed functions, etc.)
 */

import { createHash } from "crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { GraphNode } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FunctionFingerprint {
  name: string;
  params: string[];
  exported: boolean;
  lineCount: number;
}

export interface ClassFingerprint {
  name: string;
  methods: string[];
  properties: string[];
  exported: boolean;
  lineCount: number;
}

export interface ImportFingerprint {
  source: string;
  specifiers: string[];
}

export interface FileFingerprint {
  filePath: string;
  contentHash: string;
  functions: FunctionFingerprint[];
  classes: ClassFingerprint[];
  imports: ImportFingerprint[];
  exports: string[];
  totalLines: number;
  hasStructuralAnalysis: boolean;
}

export interface FingerprintStore {
  version: "1.0.0";
  gitCommitHash: string;
  generatedAt: string;
  files: Record<string, FileFingerprint>;
}

export type ChangeLevel = "NONE" | "COSMETIC" | "STRUCTURAL";

export interface FileChangeResult {
  filePath: string;
  changeLevel: ChangeLevel;
  details: string[];
}

export interface ChangeAnalysis {
  fileChanges: FileChangeResult[];
  newFiles: string[];
  deletedFiles: string[];
  structurallyChangedFiles: string[];
  cosmeticOnlyFiles: string[];
  unchangedFiles: string[];
}

// ─── Content Hash ────────────────────────────────────────────────────────────

/** Compute SHA-256 content hash for a string. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ─── Regex-based Structural Extraction ───────────────────────────────────────

/**
 * Extract structural fingerprint from a source file using regex.
 * Covers: function signatures, class signatures, imports, exports.
 * Works for TypeScript/JavaScript source files.
 */
export function extractFileFingerprint(
  filePath: string,
  content: string,
): FileFingerprint {
  const hash = contentHash(content);
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Extract exported names
  const exportNames = new Set<string>();
  const exportRe = /(?:export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)|export\s+\{([^}]+)\}|export\s+default\s+(\w+))/g;
  let em: RegExpExecArray | null;
  while ((em = exportRe.exec(content)) !== null) {
    if (em[1]) exportNames.add(em[1]);
    if (em[2]) {
      for (const spec of em[2].split(",")) {
        const name = spec.trim().split(/\s+as\s+/)[0].trim();
        if (name) exportNames.add(name);
      }
    }
    if (em[3]) exportNames.add(em[3]);
  }

  // Extract functions
  const functions: FunctionFingerprint[] = [];
  const funcRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let fm: RegExpExecArray | null;
  while ((fm = funcRe.exec(content)) !== null) {
    const name = fm[1];
    const params = fm[2] ? fm[2].split(",").map(p => p.trim().split(/[:=]/)[0].trim()).filter(Boolean) : [];
    const startLine = content.substring(0, fm.index).split("\n").length;
    const lineCount = estimateBlockLines(lines, startLine - 1);
    functions.push({ name, params, exported: exportNames.has(name), lineCount });
  }

  // Extract arrow functions (exported only, to avoid noise)
  const arrowRe = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/g;
  while ((fm = arrowRe.exec(content)) !== null) {
    const name = fm[1];
    // Skip if already captured as a regular function
    if (functions.some(f => f.name === name)) continue;
    const params = fm[2] ? fm[2].split(",").map(p => p.trim().split(/[:=]/)[0].trim()).filter(Boolean) : [];
    const startLine = content.substring(0, fm.index).split("\n").length;
    const lineCount = estimateBlockLines(lines, startLine - 1);
    functions.push({ name, params, exported: exportNames.has(name), lineCount });
  }

  // Extract classes
  const classes: ClassFingerprint[] = [];
  const classRe = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(content)) !== null) {
    const name = cm[1];
    const startLine = content.substring(0, cm.index).split("\n").length;
    const lineCount = estimateBlockLines(lines, startLine - 1);
    const classContent = extractBlockContent(lines, startLine - 1);
    const methods: string[] = [];
    const properties: string[] = [];

    const methodRe = /(?:(?:public|private|protected|static|async|abstract|override)\s+)*(\w+)\s*\(/g;
    let mm: RegExpExecArray | null;
    while ((mm = methodRe.exec(classContent)) !== null) {
      const mname = mm[1];
      if (mname === "constructor") { methods.push(mname); continue; }
      if (!["if", "for", "while", "switch", "catch", "return", "throw", "new", "typeof", "delete"].includes(mname)) {
        methods.push(mname);
      }
    }

    const propRe = /(?:(?:public|private|protected|static|readonly|abstract)\s+)+(\w+)\s*[=!:;]/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(classContent)) !== null) {
      properties.push(pm[1]);
    }

    classes.push({ name, methods, properties, exported: exportNames.has(name), lineCount });
  }

  // Extract imports
  const imports: ImportFingerprint[] = [];
  const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(content)) !== null) {
    const source = im[4];
    const specifiers: string[] = [];
    if (im[1]) {
      for (const s of im[1].split(",")) {
        const name = s.trim().split(/\s+as\s+/)[0].trim();
        if (name) specifiers.push(name);
      }
    }
    if (im[2]) specifiers.push(`* as ${im[2]}`);
    if (im[3]) specifiers.push(im[3]);
    imports.push({ source, specifiers });
  }

  const exports = [...exportNames];

  return {
    filePath,
    contentHash: hash,
    functions,
    classes,
    imports,
    exports,
    totalLines,
    hasStructuralAnalysis: true,
  };
}

/**
 * Estimate the number of lines in a code block starting at the given line.
 * Looks for balanced braces to find the end of the block.
 */
function estimateBlockLines(lines: string[], startLineIdx: number): number {
  if (startLineIdx >= lines.length) return 1;
  let depth = 0;
  let foundOpen = false;
  for (let i = startLineIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
    }
    if (foundOpen && depth <= 0) {
      return i - startLineIdx + 1;
    }
  }
  return lines.length - startLineIdx;
}

/**
 * Extract the content of a code block (balanced braces) starting at a line.
 */
function extractBlockContent(lines: string[], startLineIdx: number): string {
  if (startLineIdx >= lines.length) return "";
  let depth = 0;
  let foundOpen = false;
  const blockLines: string[] = [];
  for (let i = startLineIdx; i < lines.length; i++) {
    blockLines.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
    }
    if (foundOpen && depth <= 0) break;
  }
  return blockLines.join("\n");
}

// ─── Fingerprint Comparison ──────────────────────────────────────────────────

/**
 * Compare two file fingerprints and determine the change level.
 * - NONE: identical content hash
 * - COSMETIC: content differs but structural signatures match
 * - STRUCTURAL: signature-level changes detected
 */
export function compareFingerprints(
  oldFp: FileFingerprint,
  newFp: FileFingerprint,
): FileChangeResult {
  const details: string[] = [];

  // Fast path: identical content
  if (oldFp.contentHash === newFp.contentHash) {
    return { filePath: newFp.filePath, changeLevel: "NONE", details: [] };
  }

  // Conservative path: if either fingerprint lacks structural analysis
  if (!oldFp.hasStructuralAnalysis || !newFp.hasStructuralAnalysis) {
    return {
      filePath: newFp.filePath,
      changeLevel: "STRUCTURAL",
      details: ["no structural analysis available -- conservative classification"],
    };
  }

  // Compare function signatures
  const oldFuncNames = new Set(oldFp.functions.map(f => f.name));
  const newFuncNames = new Set(newFp.functions.map(f => f.name));

  for (const name of newFuncNames) {
    if (!oldFuncNames.has(name)) details.push(`new function: ${name}`);
  }
  for (const name of oldFuncNames) {
    if (!newFuncNames.has(name)) details.push(`removed function: ${name}`);
  }

  // Compare shared functions for signature changes
  for (const newFn of newFp.functions) {
    const oldFn = oldFp.functions.find(f => f.name === newFn.name);
    if (!oldFn) continue;
    if (JSON.stringify(oldFn.params) !== JSON.stringify(newFn.params)) {
      details.push(`params changed: ${newFn.name}`);
    }
    if (oldFn.exported !== newFn.exported) {
      details.push(`export status changed: ${newFn.name}`);
    }
    if (oldFn.lineCount > 0) {
      const ratio = newFn.lineCount / oldFn.lineCount;
      if (ratio > 1.5 || ratio < 0.5) {
        details.push(`significant size change: ${newFn.name} (${oldFn.lineCount} -> ${newFn.lineCount} lines)`);
      }
    }
  }

  // Compare class signatures
  const oldClassNames = new Set(oldFp.classes.map(c => c.name));
  const newClassNames = new Set(newFp.classes.map(c => c.name));

  for (const name of newClassNames) {
    if (!oldClassNames.has(name)) details.push(`new class: ${name}`);
  }
  for (const name of oldClassNames) {
    if (!newClassNames.has(name)) details.push(`removed class: ${name}`);
  }

  for (const newCls of newFp.classes) {
    const oldCls = oldFp.classes.find(c => c.name === newCls.name);
    if (!oldCls) continue;
    if (JSON.stringify([...oldCls.methods].sort()) !== JSON.stringify([...newCls.methods].sort())) {
      details.push(`methods changed: ${newCls.name}`);
    }
    if (JSON.stringify([...oldCls.properties].sort()) !== JSON.stringify([...newCls.properties].sort())) {
      details.push(`properties changed: ${newCls.name}`);
    }
    if (oldCls.exported !== newCls.exported) {
      details.push(`export status changed: ${newCls.name}`);
    }
  }

  // Compare imports
  const oldImports = oldFp.imports.map(i => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort();
  const newImports = newFp.imports.map(i => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort();
  if (JSON.stringify(oldImports) !== JSON.stringify(newImports)) {
    details.push("imports changed");
  }

  // Compare exports
  const oldExports = [...oldFp.exports].sort();
  const newExports = [...newFp.exports].sort();
  if (JSON.stringify(oldExports) !== JSON.stringify(newExports)) {
    details.push("exports changed");
  }

  if (details.length > 0) {
    return { filePath: newFp.filePath, changeLevel: "STRUCTURAL", details };
  }

  // Content changed but structure is identical
  return {
    filePath: newFp.filePath,
    changeLevel: "COSMETIC",
    details: ["internal logic changed (no structural impact)"],
  };
}

// ─── Fingerprint Store ───────────────────────────────────────────────────────

/**
 * Build a fingerprint store from graph nodes by reading their source files.
 * Falls back to content-hash-only fingerprints for non-code files.
 */
export function buildFingerprintStore(
  projectDir: string,
  nodes: GraphNode[],
  gitCommitHash: string,
): FingerprintStore {
  const files: Record<string, FileFingerprint> = {};
  const seenPaths = new Set<string>();

  for (const node of nodes) {
    if (!node.filePath || node.type !== "file") continue;
    const normalized = node.filePath.replace(/\\/g, "/");
    if (seenPaths.has(normalized)) continue;
    seenPaths.add(normalized);

    const absolutePath = join(projectDir, normalized);
    if (!existsSync(absolutePath)) continue;

    const content = readFileSync(absolutePath, "utf-8");

    // Only do structural extraction for TS/JS files
    if (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
      files[normalized] = extractFileFingerprint(normalized, content);
    } else {
      files[normalized] = {
        filePath: normalized,
        contentHash: contentHash(content),
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: content.split("\n").length,
        hasStructuralAnalysis: false,
      };
    }
  }

  return {
    version: "1.0.0",
    gitCommitHash,
    generatedAt: new Date().toISOString(),
    files,
  };
}

// ─── Change Analysis ─────────────────────────────────────────────────────────

/**
 * Analyze changes between current file state and stored fingerprints.
 * Returns a detailed breakdown of what changed and at what level.
 */
export function analyzeChanges(
  projectDir: string,
  changedFiles: string[],
  existingStore: FingerprintStore,
): ChangeAnalysis {
  const fileChanges: FileChangeResult[] = [];
  const newFiles: string[] = [];
  const deletedFiles: string[] = [];
  const structurallyChangedFiles: string[] = [];
  const cosmeticOnlyFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const filePath of changedFiles) {
    const normalized = filePath.replace(/\\/g, "/");
    const absolutePath = join(projectDir, normalized);
    const existedBefore = normalized in existingStore.files;
    const existsNow = existsSync(absolutePath);

    // File was deleted
    if (!existsNow) {
      if (existedBefore) {
        deletedFiles.push(normalized);
        fileChanges.push({
          filePath: normalized,
          changeLevel: "STRUCTURAL",
          details: ["file deleted"],
        });
      }
      continue;
    }

    // File is new
    if (!existedBefore) {
      newFiles.push(normalized);
      fileChanges.push({
        filePath: normalized,
        changeLevel: "STRUCTURAL",
        details: ["new file"],
      });
      continue;
    }

    // File exists in both -- compare fingerprints
    const content = readFileSync(absolutePath, "utf-8");
    const oldFp = existingStore.files[normalized];

    let newFp: FileFingerprint;
    if (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
      newFp = extractFileFingerprint(normalized, content);
    } else {
      newFp = {
        filePath: normalized,
        contentHash: contentHash(content),
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: content.split("\n").length,
        hasStructuralAnalysis: false,
      };
    }

    const result = compareFingerprints(oldFp, newFp);
    fileChanges.push(result);

    switch (result.changeLevel) {
      case "NONE": unchangedFiles.push(normalized); break;
      case "COSMETIC": cosmeticOnlyFiles.push(normalized); break;
      case "STRUCTURAL": structurallyChangedFiles.push(normalized); break;
    }
  }

  return {
    fileChanges,
    newFiles,
    deletedFiles,
    structurallyChangedFiles,
    cosmeticOnlyFiles,
    unchangedFiles,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Load a fingerprint store from a JSON file. Returns null on failure. */
export function loadFingerprintStore(filePath: string): FingerprintStore | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as FingerprintStore;
  } catch {
    return null;
  }
}

/** Save a fingerprint store to a JSON file. */
export function saveFingerprintStore(store: FingerprintStore, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}
