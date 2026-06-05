#!/usr/bin/env bun
/**
 * audit.ts — Self-audit script for deepseek-cli.
 *
 * Scans source files, counts features/tests/code lines, finds issues.
 * Outputs structured JSON for the self-improve workflow to consume.
 *
 * Usage:
 *   bun run audit
 *   bun run audit --json
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, resolve, extname, relative } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const CLI_DIR = resolve(import.meta.dir, "..");
const SRC_DIR = join(CLI_DIR, "src");
const DIST_DIR = join(PROJECT_ROOT, "dist");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walkDir(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, ext));
    } else if (ext.includes(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function countCodeLines(content: string): { total: number; code: number; blank: number; comment: number } {
  const lines = content.split("\n");
  let blank = 0;
  let comment = 0;
  let code = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      blank++;
    } else if (inBlockComment) {
      comment++;
      if (trimmed.includes("*/")) inBlockComment = false;
    } else if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      comment++;
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) inBlockComment = true;
    } else {
      code++;
    }
  }

  return { total: lines.length, code, blank, comment };
}

// ─── Scan source files ────────────────────────────────────────────────────────

const sourceFiles = walkDir(SRC_DIR, [".ts"]).filter(
  (f) => !f.includes(".test.") && !f.includes(".spec.")
);
const testFiles = walkDir(SRC_DIR, [".ts"]).filter(
  (f) => f.includes(".test.") || f.includes(".spec.")
);

// ─── Analyze source code ──────────────────────────────────────────────────────

interface Feature {
  name: string;
  type: "cli-flag" | "agent-tool" | "mode" | "helper" | "export";
  description: string;
  file: string;
}

interface Issue {
  file: string;
  line: number;
  type: "TODO" | "FIXME" | "HACK" | "WARN";
  text: string;
}

const features: Feature[] = [];
const issues: Issue[] = [];
let totalCodeLines = 0;
let totalTestCases = 0;
let dependencyCount = 0;

// Scan each source file
for (const filePath of sourceFiles) {
  const rel = relative(PROJECT_ROOT, filePath);
  const content = readFileSync(filePath, "utf8");
  const lines = countCodeLines(content);
  totalCodeLines += lines.code;

  // Find TODOs/FIXMEs/HACKs
  const contentLines = content.split("\n");
  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    const match = line.match(/\/\/\s*(TODO|FIXME|HACK|WARN)\s*[:)]?\s*(.*)/i);
    if (match) {
      issues.push({
        file: rel,
        line: i + 1,
        type: match[1].toUpperCase() as "TODO" | "FIXME" | "HACK" | "WARN",
        text: match[2].trim(),
      });
    }
  }

  // Extract features from each file
  if (rel.includes("config.ts")) {
    // CLI flags from printUsage
    const flagMatches = content.matchAll(/(--[\w-]+(?:,\s*-\w+)?)/g);
    const seenFlags = new Set<string>();
    for (const m of flagMatches) {
      const flag = m[1].trim();
      if (!seenFlags.has(flag) && (flag.startsWith("--") || flag.startsWith("-"))) {
        seenFlags.add(flag);
      }
    }
    // Manually extract known flags from the args parsing
    const knownFlags = ["--model", "--max-steps", "--timeout", "--agent", "-a", "-v", "--version", "-h", "--help"];
    for (const flag of knownFlags) {
      if (!features.some((f) => f.name === flag)) {
        features.push({ name: flag, type: "cli-flag", description: `CLI flag: ${flag}`, file: rel });
      }
    }

    // Extract models
    const modelMatches = content.matchAll(/(\w+):\s*["']([^"']+)["']/g);
    for (const m of modelMatches) {
      if (["pro", "flash"].includes(m[1])) {
        features.push({ name: `model:${m[1]}`, type: "helper", description: `Model alias: ${m[1]} → ${m[2]}`, file: rel });
      }
    }
  }

  if (rel.includes("tools.ts")) {
    // Extract tool names from toolExecutors
    const toolMatches = content.matchAll(/(\w+):\s*async\s+\(/g);
    for (const m of toolMatches) {
      const toolName = m[1];
      if (["calculator", "read_file", "write_file", "web_fetch", "list_directory", "grep_search"].includes(toolName)) {
        features.push({ name: toolName, type: "agent-tool", description: `Agent tool: ${toolName}`, file: rel });
      }
    }

    // Extract exported helpers
    if (content.includes("export function mathEval")) {
      features.push({ name: "mathEval", type: "helper", description: "Math expression evaluator with input sanitization", file: rel });
    }
    if (content.includes("export function normalizePath")) {
      features.push({ name: "normalizePath", type: "helper", description: "Cross-platform path normalization", file: rel });
    }
  }

  if (rel.includes("stream.ts")) {
    if (content.includes("export async function retryFetch")) {
      features.push({ name: "retryFetch", type: "helper", description: "HTTP fetch with exponential backoff for 429/5xx", file: rel });
    }
    if (content.includes("export async function streamChatCompletion")) {
      features.push({ name: "streamChatCompletion", type: "export", description: "SSE streaming chat completion client", file: rel });
    }
    if (content.includes("export async function runAgentLoop")) {
      features.push({ name: "agent-mode", type: "mode", description: "Agent loop with tool calling", file: rel });
    }
  }

  if (rel.includes("index.ts")) {
    if (content.includes("agentMode")) {
      features.push({ name: "simple-mode", type: "mode", description: "Simple single-prompt mode", file: rel });
    }
  }
}

// ─── Count test cases ─────────────────────────────────────────────────────────

for (const testFile of testFiles) {
  const content = readFileSync(testFile, "utf8");
  // Count test() and it() calls
  const testMatches = content.match(/(?:test|it)\s*\(/g);
  if (testMatches) {
    totalTestCases += testMatches.length;
  }
}

// ─── Check dependencies ──────────────────────────────────────────────────────

let packageDependencies: string[] = [];
try {
  const pkgJson = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
  packageDependencies = Object.keys(pkgJson.dependencies || {});
  dependencyCount = packageDependencies.length;
} catch {
  dependencyCount = 0;
}

// ─── Health scan: undeclared/unused deps + dead exports ──────────────────────

const undeclaredDeps: string[] = [];
const unusedDeps: string[] = [];
const deadExports: string[] = [];

// Scan all source files for import/require statements
const allSourceFiles = walkDir(SRC_DIR, [".ts"]);
const importedPackages = new Set<string>();
const exportedSymbols = new Map<string, string>(); // symbol -> file
const usedSymbols = new Set<string>();

for (const filePath of allSourceFiles) {
  const content = readFileSync(filePath, "utf8");
  const rel = relative(PROJECT_ROOT, filePath);

  // Extract bare imports: import ... from "package-name" or require("package-name")
  const importMatches = content.matchAll(/(?:import\s+.*?\s+from\s+|require\s*\()\s*["']([^"']+)["']/g);
  for (const m of importMatches) {
    const specifier = m[1];
    // Only care about bare package imports (not relative paths)
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      // Extract the root package name (e.g. "@ai-sdk/openai" -> "@ai-sdk/openai", "mathjs" -> "mathjs")
      const parts = specifier.split("/");
      const pkgName = specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      importedPackages.add(pkgName);
    }
  }

  // Collect exported symbols
  const exportMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g);
  for (const m of exportMatches) {
    exportedSymbols.set(m[1], rel);
  }

  // Collect usages of exported symbols from other files (approximation: any identifier reference)
  // We check each exported symbol for usage in files other than where it's defined
  const identifierPattern = /\b(\w+)\b/g;
  let idMatch;
  while ((idMatch = identifierPattern.exec(content)) !== null) {
    usedSymbols.add(idMatch[1]);
  }
}

// Find undeclared deps: packages imported but not in package.json
// Exclude built-in Node/Bun modules
const BUILTIN_MODULES = new Set([
  "fs", "path", "os", "http", "https", "url", "util", "stream",
  "crypto", "buffer", "events", "child_process", "net", "tls",
  "assert", "zlib", "readline", "querystring", "string_decoder",
  "bun", "bun:test",
]);
for (const pkg of importedPackages) {
  if (!BUILTIN_MODULES.has(pkg) && !packageDependencies.includes(pkg)) {
    undeclaredDeps.push(pkg);
  }
}

// Find unused deps: packages in package.json but never imported
for (const dep of packageDependencies) {
  if (!importedPackages.has(dep)) {
    unusedDeps.push(dep);
  }
}

// Find dead exports: symbols exported but never used in any other file
for (const [symbol, file] of exportedSymbols) {
  // A symbol is "dead" if it's only used in the file where it's defined
  // This is an approximation — it checks if the symbol appears in any other file's content
  let usedElsewhere = false;
  for (const filePath of allSourceFiles) {
    const otherRel = relative(PROJECT_ROOT, filePath);
    if (otherRel === file) continue;
    const otherContent = readFileSync(filePath, "utf8");
    if (otherContent.includes(symbol)) {
      usedElsewhere = true;
      break;
    }
  }
  // Also consider a symbol "used" if it appears in the test files or is re-exported from index.ts
  if (!usedElsewhere) {
    const indexContent = existsSync(join(SRC_DIR, "index.ts"))
      ? readFileSync(join(SRC_DIR, "index.ts"), "utf8")
      : "";
    if (indexContent.includes(symbol)) {
      usedElsewhere = true;
    }
  }
  if (!usedElsewhere) {
    deadExports.push(`${symbol} (${file})`);
  }
}

// ─── Check existing bundle ────────────────────────────────────────────────────

let existingBundleSizeKB = 0;
if (existsSync(join(DIST_DIR, "deepseek-cli.js"))) {
  existingBundleSizeKB = Math.round((statSync(join(DIST_DIR, "deepseek-cli.js")).size / 1024) * 100) / 100;
}

// ─── Output ───────────────────────────────────────────────────────────────────

interface AuditReport {
  timestamp: string;
  sourceFiles: string[];
  testFiles: string[];
  features: Feature[];
  issues: Issue[];
  health: {
    undeclaredDeps: string[];
    unusedDeps: string[];
    deadExports: string[];
  };
  stats: {
    codeLines: number;
    testCases: number;
    dependencyCount: number;
    existingBundleSizeKB: number;
    sourceFileCount: number;
    testFileCount: number;
  };
}

const report: AuditReport = {
  timestamp: new Date().toISOString(),
  sourceFiles: sourceFiles.map((f) => relative(PROJECT_ROOT, f)),
  testFiles: testFiles.map((f) => relative(PROJECT_ROOT, f)),
  features,
  issues,
  health: {
    undeclaredDeps,
    unusedDeps,
    deadExports,
  },
  stats: {
    codeLines: totalCodeLines,
    testCases: totalTestCases,
    dependencyCount,
    existingBundleSizeKB,
    sourceFileCount: sourceFiles.length,
    testFileCount: testFiles.length,
  },
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   deepseek-cli audit                         ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Source files:     ${report.stats.sourceFileCount}`);
  console.log(`  Test files:       ${report.stats.testFileCount}`);
  console.log(`  Code lines:       ${report.stats.codeLines}`);
  console.log(`  Test cases:       ${report.stats.testCases}`);
  console.log(`  Dependencies:     ${report.stats.dependencyCount}`);
  console.log(`  Existing bundle:  ${report.stats.existingBundleSizeKB} KB`);
  console.log();
  console.log("  Features:");
  for (const f of features) {
    console.log(`    [${f.type}] ${f.name}`);
  }
  if (issues.length > 0) {
    console.log();
    console.log("  Issues:");
    for (const issue of issues) {
      console.log(`    ${issue.type} ${issue.file}:${issue.line}: ${issue.text}`);
    }
  }
  if (undeclaredDeps.length > 0 || unusedDeps.length > 0 || deadExports.length > 0) {
    console.log();
    console.log("  Dependency health:");
    if (undeclaredDeps.length > 0) {
      console.log(`    Undeclared deps: ${undeclaredDeps.join(", ")}`);
    }
    if (unusedDeps.length > 0) {
      console.log(`    Unused deps: ${unusedDeps.join(", ")}`);
    }
    if (deadExports.length > 0) {
      console.log(`    Dead exports: ${deadExports.join(", ")}`);
    }
  }
  console.log();
}

// Always output JSON on last line for machine parsing
if (!jsonMode) {
  console.log("---JSON---");
}
if (jsonMode) {
  // Already output above
} else {
  console.log(JSON.stringify(report));
}
