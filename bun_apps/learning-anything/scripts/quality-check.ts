#!/usr/bin/env bun
/**
 * quality-check.ts — Quality gate checks for the learning-anything bun app.
 *
 * Verifies: dist/ exists, bundle correct, no misplaced artifacts, bundle runnable.
 * Output: JSON report for workflow consumption.
 *
 * Usage: bun scripts/quality-check.ts [--json]
 */

import { existsSync, statSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const ROOT = import.meta.dir.replace(/[/\\]scripts$/, "");
const DIST = join(ROOT, "..", "..", "dist");
const BUNDLE = join(DIST, "learning-anything.js");
const BUNDLE_MAP = join(DIST, "learning-anything.js.map");
const isJson = process.argv.includes("--json");

interface Gate {
  gate: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  detail?: string;
}

interface QualityReport {
  overallPassed: boolean;
  score: number;
  gates: Gate[];
  bundleSizeKB: number;
  misplacedArtifacts: string[];
}

async function check(): Promise<QualityReport> {
  const gates: Gate[] = [];
  const misplacedArtifacts: string[] = [];
  let score = 100;

  // Gate 1: dist/ directory exists
  const distExists = existsSync(DIST);
  gates.push({
    gate: "dist-exists",
    passed: distExists,
    severity: "critical",
    message: distExists ? "dist/ directory exists" : "dist/ directory missing",
  });
  if (!distExists) score -= 30;

  // Gate 2: Bundle file exists
  const bundleExists = existsSync(BUNDLE);
  gates.push({
    gate: "bundle-exists",
    passed: bundleExists,
    severity: "critical",
    message: bundleExists ? "Bundle file exists" : "Bundle file missing at dist/learning-anything.js",
  });
  if (!bundleExists) score -= 30;

  // Gate 3: Bundle is non-trivial
  let bundleSizeKB = 0;
  if (bundleExists) {
    bundleSizeKB = Math.round(statSync(BUNDLE).size / 1024 * 10) / 10;
    const nonTrivial = bundleSizeKB > 1;
    gates.push({
      gate: "bundle-non-trivial",
      passed: nonTrivial,
      severity: "critical",
      message: nonTrivial ? `Bundle is ${bundleSizeKB} KB` : `Bundle is suspiciously small: ${bundleSizeKB} KB`,
    });
    if (!nonTrivial) score -= 20;
  }

  // Gate 4: Sourcemap exists
  const mapExists = existsSync(BUNDLE_MAP);
  gates.push({
    gate: "sourcemap-exists",
    passed: mapExists,
    severity: "warning",
    message: mapExists ? "Sourcemap exists" : "Sourcemap missing",
  });
  if (!mapExists) score -= 5;

  // Gate 5: No misplaced artifacts in src/
  const srcDir = join(ROOT, "src");
  if (existsSync(srcDir)) {
    const misplaced = readdirSync(srcDir).filter(f =>
      f.endsWith(".js") || f.endsWith(".js.map")
    );
    for (const f of misplaced) {
      const full = join(srcDir, f);
      misplacedArtifacts.push(full);
    }
    gates.push({
      gate: "no-misplaced-artifacts",
      passed: misplaced.length === 0,
      severity: "warning",
      message: misplaced.length === 0
        ? "No misplaced build artifacts"
        : `Found ${misplaced.length} misplaced artifacts in src/`,
      detail: misplaced.join(", "),
    });
    if (misplaced.length > 0) score -= 10;
  }

  // Gate 6: Source files have expected structure (including new UA-ported modules)
  const expectedFiles = [
    "src/index.ts",
    "src/config.ts",
    "src/graph.ts",
    "src/agent.ts",
    "src/routes.ts",
    "src/context.ts",
    "src/explain.ts",
    "src/diff.ts",
    "src/onboard.ts",
    "src/validate.ts",
    "src/search.ts",
    "src/analyzer.ts",
    "src/ignore.ts",
    "src/middleware.ts",
    "src/tour.ts",
    "src/fingerprint.ts",
    "src/change-classifier.ts",
    "src/layer-detector.ts",
    "src/language-lesson.ts",
  ];
  const missingSrc = expectedFiles.filter(f => !existsSync(join(ROOT, f)));
  gates.push({
    gate: "source-structure",
    passed: missingSrc.length === 0,
    severity: "warning",
    message: missingSrc.length === 0
      ? "All expected source files present"
      : `Missing source files: ${missingSrc.join(", ")}`,
  });
  if (missingSrc.length > 0) score -= missingSrc.length * 5;

  // Gate 7: package.json has required scripts
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  );
  const requiredScripts = ["build", "audit", "quality-check", "benchmark"];
  const missingScripts = requiredScripts.filter(s => !pkg.scripts?.[s]);
  gates.push({
    gate: "package-scripts",
    passed: missingScripts.length === 0,
    severity: "warning",
    message: missingScripts.length === 0
      ? "All required scripts present"
      : `Missing scripts: ${missingScripts.join(", ")}`,
  });
  if (missingScripts.length > 0) score -= missingScripts.length * 3;

  // Gate 8: UA feature coverage — minimum 60%
  const routesFile = join(ROOT, "src", "routes.ts");
  const newEndpoints = ["api/chat/stream", "api/explain", "api/diff/analyze", "api/onboard", "api/staleness", "api/health/detailed", "api/hotspots"];
  let endpointCoverage = 0;
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");
    endpointCoverage = newEndpoints.filter(e => routesContent.includes(`"${e}"`)).length;
  }
  const uaCoveragePercent = Math.round((endpointCoverage / newEndpoints.length) * 100);
  const uaCoveragePass = uaCoveragePercent >= 60;
  gates.push({
    gate: "ua-coverage",
    passed: uaCoveragePass,
    severity: "warning",
    message: uaCoveragePass
      ? `UA feature coverage: ${uaCoveragePercent}%`
      : `UA feature coverage too low: ${uaCoveragePercent}% (need >= 60%)`,
  });
  if (!uaCoveragePass) score -= 10;

  // Gate 9: Endpoint count — minimum 15 endpoints
  let endpointCount = 0;
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");
    endpointCount = (routesContent.match(/"api\//g) || []).length;
  }
  const endpointCountPass = endpointCount >= 15;
  gates.push({
    gate: "endpoint-count",
    passed: endpointCountPass,
    severity: "info",
    message: endpointCountPass
      ? `Endpoint count: ${endpointCount}`
      : `Endpoint count low: ${endpointCount} (target >= 15)`,
  });
  if (!endpointCountPass) score -= 5;

  // Gate 10: Undeclared dependencies check
  // Scan source files for bare import specifiers not in package.json
  // Note: srcDir is already declared above (line 86)
  const declaredDeps = new Set(Object.keys(pkg.dependencies ?? {}));
  const BARE_IMPORT_RE = /(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])(@?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+)*)/g;
  const foundImports = new Set<string>();

  if (existsSync(srcDir)) {
    const builtins = new Set(["fs", "path", "http", "https", "url", "stream", "crypto", "os", "util", "events", "buffer", "child_process", "net", "tls", "zlib", "assert", "process", "bun"]);
    const allSrcFiles = readdirSync(srcDir, { recursive: true })
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => join(srcDir, f));

    for (const file of allSrcFiles) {
      const content = readFileSync(file, "utf-8");
      let match: RegExpExecArray | null;
      while ((match = BARE_IMPORT_RE.exec(content)) !== null) {
        const specifier = match[1];
        if (!specifier.startsWith("@") && !specifier.includes("/")) {
          if (builtins.has(specifier)) continue;
        }
        const pkgName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier;
        foundImports.add(pkgName);
      }
    }
  }

  const undeclaredDeps = [...foundImports].filter(dep => !declaredDeps.has(dep));
  const undeclaredPass = undeclaredDeps.length === 0;
  gates.push({
    gate: "undeclared-deps",
    passed: undeclaredPass,
    severity: "warning",
    message: undeclaredPass
      ? "All imports are declared in package.json"
      : `Undeclared dependencies: ${undeclaredDeps.join(", ")}`,
    detail: undeclaredDeps.join(", "),
  });
  if (!undeclaredPass) score -= 10;

  // Gate 11: TypeScript compilation check
  let tsCompiles = false;
  try {
    const proc = Bun.spawnSync(
      ["bun", "build", "--no-bundle", join(ROOT, "src", "index.ts")],
      { cwd: ROOT, encoding: "utf-8", stderr: "pipe" },
    );
    tsCompiles = proc.exitCode === 0;
  } catch {
    tsCompiles = false;
  }
  gates.push({
    gate: "typescript-compiles",
    passed: tsCompiles,
    severity: "critical",
    message: tsCompiles
      ? "TypeScript compilation succeeds"
      : "TypeScript compilation failed — run `bun build --no-bundle src/index.ts` for details",
  });
  if (!tsCompiles) score -= 10;

  // Gate 12: Function complexity — flag exported functions longer than 80 lines
  const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  const oversizedFunctions: string[] = [];
  if (existsSync(srcDir)) {
    const srcFilesForComplexity = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => join(srcDir, f));

    for (const file of srcFilesForComplexity) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      let fm: RegExpExecArray | null;
      FUNCTION_RE.lastIndex = 0;
      while ((fm = FUNCTION_RE.exec(content)) !== null) {
        const fnName = fm[1];
        const startLine = content.substring(0, fm.index).split("\n").length - 1;
        let depth = 0;
        let foundOpen = false;
        let endLine = startLine;
        for (let i = startLine; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === "{") { depth++; foundOpen = true; }
            if (ch === "}") depth--;
          }
          if (foundOpen && depth <= 0) { endLine = i; break; }
        }
        const lineCount = endLine - startLine + 1;
        if (lineCount > 80) {
          const basename = file.split(/[/\\]/).pop() ?? file;
          oversizedFunctions.push(`${basename}:${fnName} (${lineCount} lines)`);
        }
      }
    }
  }
  const complexityPass = oversizedFunctions.length === 0;
  gates.push({
    gate: "function-complexity",
    passed: complexityPass,
    severity: "warning",
    message: complexityPass
      ? "No exported functions exceed 80 lines"
      : `${oversizedFunctions.length} function(s) exceed 80 lines: ${oversizedFunctions.slice(0, 5).join(", ")}`,
    detail: oversizedFunctions.join(", "),
  });
  score -= oversizedFunctions.length * 5;

  // Gate 13: TODO/FIXME/HACK accumulation tracking
  const TODO_RE = /\/\/\s*(TODO|FIXME|HACK)\b/gi;
  const todoItems: string[] = [];
  if (existsSync(srcDir)) {
    const srcFilesForTodos = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => join(srcDir, f));

    for (const file of srcFilesForTodos) {
      const content = readFileSync(file, "utf-8");
      const fileLines = content.split("\n");
      let tm: RegExpExecArray | null;
      TODO_RE.lastIndex = 0;
      while ((tm = TODO_RE.exec(content)) !== null) {
        const lineNum = content.substring(0, tm.index).split("\n").length;
        const basename = file.split(/[/\\]/).pop() ?? file;
        todoItems.push(`${basename}:${lineNum}: ${tm[0].trim()}`);
      }
    }
  }
  const todoCount = todoItems.length;
  const todoSeverity: "critical" | "warning" | "info" = todoCount > 20 ? "critical" : todoCount > 10 ? "warning" : "info";
  const todoPass = todoCount <= 10;
  gates.push({
    gate: "todo-accumulation",
    passed: todoPass,
    severity: todoSeverity,
    message: todoPass
      ? `TODO/FIXME/HACK count is manageable: ${todoCount}`
      : `High TODO/FIXME/HACK count: ${todoCount} (threshold: 10 warning, 20 critical)`,
    detail: todoItems.slice(0, 10).join("\n"),
  });
  if (todoCount > 10) score -= (todoCount - 10) * 2;

  // Gate 14: Test coverage estimate (exports vs test count ratio)
  const EXPORT_RE = /(?:export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+))/g;
  const exportedSymbols = new Set<string>();
  if (existsSync(srcDir)) {
    const srcFilesForExports = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => join(srcDir, f));

    for (const file of srcFilesForExports) {
      const content = readFileSync(file, "utf-8");
      let em: RegExpExecArray | null;
      EXPORT_RE.lastIndex = 0;
      while ((em = EXPORT_RE.exec(content)) !== null) {
        exportedSymbols.add(em[1]);
      }
    }
  }

  const testDir = join(ROOT, "src", "__tests__");
  let testCount = 0;
  if (existsSync(testDir)) {
    const testFiles = readdirSync(testDir, { recursive: true })
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => join(testDir, f));

    for (const file of testFiles) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/\btest\s*\(/g);
      testCount += matches ? matches.length : 0;
    }
  }

  const exportCount = exportedSymbols.size;
  const coverageRatio = exportCount > 0 ? testCount / exportCount : 0;
  const coveragePass = coverageRatio >= 0.2 || exportCount === 0;
  gates.push({
    gate: "test-coverage-estimate",
    passed: coveragePass,
    severity: "warning",
    message: coveragePass
      ? `Test coverage estimate: ${testCount} tests for ${exportCount} exports (ratio: ${coverageRatio.toFixed(2)})`
      : `Low test coverage: ${testCount} tests for ${exportCount} exports (ratio: ${coverageRatio.toFixed(2)}, target >= 0.20)`,
    detail: `Exports: ${[...exportedSymbols].slice(0, 20).join(", ")}`,
  });
  if (!coveragePass) score -= 10;

  const overallPassed = score >= 60 && !gates.some(g => g.severity === "critical" && !g.passed);

  return {
    overallPassed,
    score: Math.max(0, score),
    gates,
    bundleSizeKB,
    misplacedArtifacts,
  };
}

const report = await check();
if (isJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n=== learning-anything Quality Check ===\n`);
  console.log(`Overall: ${report.overallPassed ? "PASS ✅" : "FAIL ❌"} (${report.score}/100)`);
  console.log(`Bundle:  ${report.bundleSizeKB} KB\n`);
  for (const g of report.gates) {
    const icon = g.passed ? "✅" : "❌";
    console.log(`  ${icon} [${g.severity}] ${g.gate}: ${g.message}`);
  }
  if (report.misplacedArtifacts.length > 0) {
    console.log(`\nMisplaced artifacts:`);
    for (const a of report.misplacedArtifacts) {
      console.log(`  - ${a}`);
    }
  }
  console.log();
}
