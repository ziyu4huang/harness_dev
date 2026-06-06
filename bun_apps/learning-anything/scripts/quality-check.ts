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
    "src/normalize.ts",
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
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts") && !(f as string).includes("__tests__"))
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

  // Gate 15: API endpoint consistency — cross-check routes.ts vs index.ts banner
  let endpointConsistencyPass = true;
  let missingFromBanner: string[] = [];
  let staleBannerEntries: string[] = [];
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");
    const indexFile = join(ROOT, "src", "index.ts");
    const indexContent = existsSync(indexFile) ? readFileSync(indexFile, "utf-8") : "";

    // Extract endpoint paths from routes.ts: strings matching "api/..." in GET_ROUTES and POST_ROUTES
    const routeEndpointRe = /"(api\/[^"]+)"/g;
    const routeEndpoints = new Set<string>();
    let rMatch: RegExpExecArray | null;
    while ((rMatch = routeEndpointRe.exec(routesContent)) !== null) {
      routeEndpoints.add(rMatch[1]);
    }

    // Also extract dynamic route patterns from handleDynamicGet regexes
    // Matches patterns like: /^api\/nodes\/([^/]+)$/ -> extracts "api/nodes/:id"
    // and /^api\/path$/ -> extracts "api/path"
    const dynamicRouteRe = /\^api\\\/(\w+)\\\/\(\[\^\/\]\+\)\$/g;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = dynamicRouteRe.exec(routesContent)) !== null) {
      routeEndpoints.add(`api/${dMatch[1]}/:id`);
    }
    // Also match /^api\/path$/
    const pathMatchRe = /\^api\\\/path\$/g;
    if (pathMatchRe.test(routesContent)) {
      routeEndpoints.add("api/path");
    }

    // Extract endpoint paths from index.ts banner: lines containing '/api/'
    const bannerEndpointRe = /\/(api\/\S+)/g;
    const bannerEndpoints = new Set<string>();
    let bMatch: RegExpExecArray | null;
    while ((bMatch = bannerEndpointRe.exec(indexContent)) !== null) {
      // Trim trailing punctuation and query params
      const cleaned = bMatch[1].replace(/[\s,;]+$/, "").split("?")[0];
      bannerEndpoints.add(cleaned);
    }

    // Find endpoints in routes but missing from banner
    for (const ep of routeEndpoints) {
      // Also check without the :id/:path suffix for dynamic routes
      const baseEp = ep.replace(/\/:[^/]+$/, "");
      const inBanner = [...bannerEndpoints].some(b => b === ep || b === baseEp || b.startsWith(ep));
      if (!inBanner) {
        missingFromBanner.push(ep);
      }
    }

    // Find banner entries that don't match any route
    for (const bEp of bannerEndpoints) {
      const inRoutes = [...routeEndpoints].some(r => r === bEp || r.startsWith(bEp) || bEp.startsWith(r));
      if (!inRoutes) {
        staleBannerEntries.push(bEp);
      }
    }

    endpointConsistencyPass = missingFromBanner.length === 0 && staleBannerEntries.length === 0;
  }
  gates.push({
    gate: "endpoint-consistency",
    passed: endpointConsistencyPass,
    severity: "warning",
    message: endpointConsistencyPass
      ? "All routes.ts endpoints are listed in index.ts banner"
      : `Endpoint inconsistencies: ${missingFromBanner.length} missing from banner, ${staleBannerEntries.length} stale banner entries`,
    detail: [
      ...missingFromBanner.map(e => `Missing from banner: ${e}`),
      ...staleBannerEntries.map(e => `Stale banner entry: ${e}`),
    ].join("\n"),
  });
  score -= (missingFromBanner.length + staleBannerEntries.length) * 2;

  // Gate 16: Route consistency — no route path appears in both GET and POST routes
  let routeOverlapPass = true;
  let overlappingRoutes: string[] = [];
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");

    // Extract GET route keys
    const getRoutesRe = /GET_ROUTES\s*[:=]\s*\{([^}]+)\}/s;
    const getMatch = getRoutesRe.exec(routesContent);
    const getKeys = new Set<string>();
    if (getMatch) {
      const inner = getMatch[1];
      const keyRe = /"([^"]+)"/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(inner)) !== null) {
        getKeys.add(km[1]);
      }
    }

    // Extract POST route keys
    const postRoutesRe = /POST_ROUTES\s*[:=]\s*\{([^}]+)\}/s;
    const postMatch = postRoutesRe.exec(routesContent);
    const postKeys = new Set<string>();
    if (postMatch) {
      const inner = postMatch[1];
      const keyRe = /"([^"]+)"/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(inner)) !== null) {
        postKeys.add(km[1]);
      }
    }

    // Check for overlaps
    for (const key of getKeys) {
      if (postKeys.has(key)) {
        overlappingRoutes.push(key);
      }
    }
    routeOverlapPass = overlappingRoutes.length === 0;
  }
  gates.push({
    gate: "route-consistency",
    passed: routeOverlapPass,
    severity: "warning",
    message: routeOverlapPass
      ? "No overlapping GET/POST route paths"
      : `${overlappingRoutes.length} route(s) appear in both GET and POST routes: ${overlappingRoutes.join(", ")}`,
    detail: overlappingRoutes.join(", "),
  });
  score -= overlappingRoutes.length * 3;

  // Gate 17: Body validation — POST handlers that expect JSON should call validateBody
  let bodyValidationPass = true;
  let missingValidationRoutes: string[] = [];
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");

    // Find all POST route keys
    const postRouteKeyRe = /"(api\/[^"]+)"\s*:\s*async/g;
    const postSectionStart = routesContent.indexOf("POST_ROUTES");
    if (postSectionStart >= 0) {
      const postSection = routesContent.slice(postSectionStart);
      let prMatch: RegExpExecArray | null;
      const postRouteEntries: { key: string; handlerBody: string }[] = [];

      // Extract each POST handler block
      const handlerBlockRe = /"(api\/[^"]+)"\s*:\s*async\s*\([^)]*\)\s*=>\s*\{/g;
      handlerBlockRe.lastIndex = 0;
      while ((prMatch = handlerBlockRe.exec(postSection)) !== null) {
        const key = prMatch[1];
        // Find the matching closing brace (depth tracking)
        const startIdx = prMatch.index + prMatch[0].length - 1;
        let depth = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < postSection.length; i++) {
          if (postSection[i] === "{") depth++;
          if (postSection[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        const handlerBody = postSection.slice(startIdx, endIdx);
        postRouteEntries.push({ key, handlerBody });
      }

      // Check handlers that have a body parameter for validateBody calls
      // Skip routes that are clearly non-body routes (reload, save, etc.)
      const noValidationNeeded = new Set([
        "api/graph/reload", "api/graph/save",
        "api/tour/generate", "api/layers/detect/llm",
        "api/analyze/architecture", "api/analyze/project-summary",
        "api/tour/generate/llm",
      ]);
      for (const entry of postRouteEntries) {
        if (noValidationNeeded.has(entry.key)) continue;
        // If the handler references "body" or has a destructured body, check for validateBody
        if (entry.handlerBody.includes("body") && !entry.handlerBody.includes("validateBody")) {
          missingValidationRoutes.push(entry.key);
        }
      }
    }
    bodyValidationPass = missingValidationRoutes.length === 0;
  }
  gates.push({
    gate: "body-validation",
    passed: bodyValidationPass,
    severity: "warning",
    message: bodyValidationPass
      ? "All POST handlers validate request body when expected"
      : `${missingValidationRoutes.length} POST handler(s) reference body without validateBody: ${missingValidationRoutes.join(", ")}`,
    detail: missingValidationRoutes.join(", "),
  });
  score -= missingValidationRoutes.length * 2;

  // Gate 18: Benchmark POST endpoint coverage
  // Verify that benchmark.ts has runtime tests for POST endpoints, not just GET endpoints.
  let postCoveragePass = false;
  let postTestCount = 0;
  const benchmarkFile = join(ROOT, "scripts", "benchmark.ts");
  if (existsSync(benchmarkFile)) {
    const benchmarkContent = readFileSync(benchmarkFile, "utf-8");
    // Count test entries that reference POST endpoints (by name pattern or path)
    const postTestPatterns = [
      /schema-post-/g,
      /http-post-/g,
      /name:\s*["'].*post.*["']/gi,
      /fetchEndpoint\(["']POST["']/g,
    ];
    const postMatches = new Set<string>();
    for (const pattern of postTestPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(benchmarkContent)) !== null) {
        postMatches.add(match[0]);
      }
    }
    postTestCount = postMatches.size;
    postCoveragePass = postTestCount >= 3;
  }
  gates.push({
    gate: "benchmark-post-coverage",
    passed: postCoveragePass,
    severity: "warning",
    message: postCoveragePass
      ? `Benchmark has ${postTestCount} POST endpoint test references (>= 3 required)`
      : `Benchmark has only ${postTestCount} POST endpoint test references (need >= 3). Add schema tests for POST endpoints like /api/graph/merge, /api/graph/normalize, /api/tour/generate.`,
    detail: `${postTestCount} POST test references found`,
  });
  if (!postCoveragePass) score -= 5;

  // Gate 19: Circular import detection — detect cycles in internal module dependency graph
  let circularImportPass = true;
  let circularPaths: string[] = [];
  let excessiveFanIn: string[] = [];
  if (existsSync(srcDir)) {
    const IMPORT_REL_RE = /from\s+['"](\.\/[^'"]+|\.?\.\.\/[^'"]+)['"]/g;
    const srcFilesForImports = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts"))
      .map((f) => ({ file: f, fullPath: join(srcDir, f) }));

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const { file, fullPath } of srcFilesForImports) {
      const content = readFileSync(fullPath, "utf-8");
      const deps = new Set<string>();
      let m: RegExpExecArray | null;
      IMPORT_REL_RE.lastIndex = 0;
      while ((m = IMPORT_REL_RE.exec(content)) !== null) {
        // Normalize: strip .js/.ts extension, resolve relative paths
        let dep = m[1].replace(/\.(js|ts)$/, "");
        // For same-dir imports (./xxx), just use the module name
        if (dep.startsWith("./")) dep = dep.slice(2);
        else if (dep.startsWith("../")) {
          // For parent dir imports, keep as-is (these go outside src/)
          continue;
        }
        deps.add(dep);
      }
      adj.set(file.replace(/\.ts$/, ""), deps);
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): boolean {
      if (stack.has(node)) {
        // Found cycle — extract cycle path
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          const cycle = [...path.slice(cycleStart), node].join(" -> ");
          circularPaths.push(cycle);
        }
        return true;
      }
      if (visited.has(node)) return false;
      visited.add(node);
      stack.add(node);
      path.push(node + ".ts");
      const deps = adj.get(node);
      if (deps) {
        for (const dep of deps) {
          if (adj.has(dep)) { // Only check modules within src/
            dfs(dep);
          }
        }
      }
      path.pop();
      stack.delete(node);
      return false;
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) dfs(node);
    }

    // Check for excessive fan-in (>8 imports from other src/ modules)
    const reverseFanIn = new Map<string, number>();
    for (const [, deps] of adj) {
      for (const dep of deps) {
        if (adj.has(dep)) {
          reverseFanIn.set(dep, (reverseFanIn.get(dep) ?? 0) + 1);
        }
      }
    }
    for (const [mod, count] of reverseFanIn) {
      if (count > 8) {
        excessiveFanIn.push(`${mod}.ts (${count} incoming imports)`);
      }
    }

    circularImportPass = circularPaths.length === 0;
  }
  gates.push({
    gate: "circular-import-detection",
    passed: circularImportPass,
    severity: circularPaths.length > 0 ? "critical" : excessiveFanIn.length > 0 ? "warning" : "info",
    message: circularImportPass
      ? (excessiveFanIn.length > 0
        ? `No circular imports detected (${excessiveFanIn.length} modules with >8 incoming imports: ${excessiveFanIn.join(", ")})`
        : "No circular imports detected")
      : `${circularPaths.length} circular import cycle(s) detected: ${circularPaths.join("; ")}`,
    detail: [...circularPaths, ...excessiveFanIn.map(e => `High fan-in: ${e}`)].join("\n"),
  });
  score -= circularPaths.length * 15; // 15 points per cycle
  // Fan-in is informational — high fan-in is expected for central modules like graph.ts

  // Gate 20: Test-file-per-module coverage — each source module should have a test file
  let testFileCoveragePass = false;
  const modulesWithoutTests: string[] = [];
  const testFileCoverageDir = join(ROOT, "src", "__tests__");
  if (existsSync(srcDir) && existsSync(testFileCoverageDir)) {
    // List source modules (excluding __tests__ subdirectory and index.ts)
    const srcModules = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts") && (f as string) !== "index.ts")
      .map((f) => f.replace(/\.ts$/, ""));

    // List test files
    const testFiles = new Set(
      readdirSync(testFileCoverageDir)
        .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".test.ts"))
        .map((f) => f.replace(/\.test\.ts$/, ""))
    );

    // Allow certain trivial modules to be uncovered without penalty
    const allowedUncovered = new Set(["config", "index"]);

    for (const mod of srcModules) {
      if (allowedUncovered.has(mod)) continue;
      if (!testFiles.has(mod)) {
        modulesWithoutTests.push(mod);
      }
    }

    const totalNonTrivial = srcModules.filter(m => !allowedUncovered.has(m)).length;
    const coveredCount = totalNonTrivial - modulesWithoutTests.length;
    const coveragePercent = totalNonTrivial > 0 ? Math.round((coveredCount / totalNonTrivial) * 100) : 100;
    testFileCoveragePass = coveragePercent >= 75;

    gates.push({
      gate: "test-file-coverage",
      passed: testFileCoveragePass,
      severity: "warning",
      message: testFileCoveragePass
        ? `Test file coverage: ${coveragePercent}% (${coveredCount}/${totalNonTrivial} modules have test files)`
        : `Test file coverage too low: ${coveragePercent}% (${coveredCount}/${totalNonTrivial} modules). Uncovered: ${modulesWithoutTests.join(", ")}`,
      detail: modulesWithoutTests.length > 0 ? `Modules without test files: ${modulesWithoutTests.join(", ")}` : undefined,
    });
  } else {
    gates.push({
      gate: "test-file-coverage",
      passed: false,
      severity: "warning",
      message: "Cannot check test file coverage: src/ or src/__tests__/ directory missing",
    });
  }
  // Deduct 3 points per uncovered module above the 25% threshold
  if (!testFileCoveragePass && modulesWithoutTests.length > 0) {
    const totalNonTrivial = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts") && (f as string) !== "index.ts")
      .length;
    const allowedMissing = Math.ceil(totalNonTrivial * 0.25);
    const excessMissing = Math.max(0, modulesWithoutTests.length - allowedMissing);
    score -= excessMissing * 3;
  }

  // Gate 21: Dead export detection — exported functions/classes not imported elsewhere
  let deadExportsPass = true;
  const deadExports: string[] = [];
  if (existsSync(srcDir)) {
    const srcFiles = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts") && (f as string) !== "index.ts");

    // Collect all exported function/class names per file
    const exportsByFile = new Map<string, string[]>();
    for (const file of srcFiles) {
      if (file === "index.ts") continue;
      const content = readFileSync(join(srcDir, file), "utf-8");
      const exported: string[] = [];
      // Match: export function name, export async function name, export class Name
      const exportRegex = /export\s+(?:async\s+)?function\s+(\w+)|export\s+class\s+(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = exportRegex.exec(content)) !== null) {
        exported.push(m[1] || m[2]);
      }
      if (exported.length > 0) {
        exportsByFile.set(file, exported);
      }
    }

    // For each exported name, check if it's referenced in other src/ or __tests__/ files
    const allSrcContent = new Map<string, string>();
    for (const file of srcFiles) {
      allSrcContent.set(file, readFileSync(join(srcDir, file), "utf-8"));
    }
    const testDir = join(srcDir, "__tests__");
    if (existsSync(testDir)) {
      for (const tf of readdirSync(testDir)) {
        if (typeof tf === "string" && tf.endsWith(".ts")) {
          allSrcContent.set(`__tests__/${tf}`, readFileSync(join(testDir, tf), "utf-8"));
        }
      }
    }

    for (const [file, exported] of exportsByFile) {
      for (const name of exported) {
        // Check if this name is referenced anywhere other than its own file
        let referencedElsewhere = false;
        for (const [otherFile, content] of allSrcContent) {
          if (otherFile === file) continue; // Skip own file
          // Check for import { name } or import name or direct usage
          if (content.includes(name)) {
            referencedElsewhere = true;
            break;
          }
        }
        if (!referencedElsewhere) {
          deadExports.push(`${file}:${name}`);
        }
      }
    }

    deadExportsPass = deadExports.length === 0;
    const deadExportPenalty = Math.min(10, deadExports.length * 2);
    if (!deadExportsPass) {
      score -= deadExportPenalty;
    }

    gates.push({
      gate: "dead-exports",
      passed: deadExportsPass,
      severity: "warning",
      message: deadExportsPass
        ? "No dead exports detected — all exported functions/classes are referenced elsewhere"
        : `${deadExports.length} potentially dead export(s) detected: ${deadExports.slice(0, 10).join(", ")}${deadExports.length > 10 ? "..." : ""}`,
      detail: deadExports.length > 0 ? `Dead exports: ${deadExports.join(", ")}` : undefined,
    });
  }

  // Gate 23: Test module coverage ratio — minimum 90% coverage threshold
  let testModuleCoveragePass = false;
  if (existsSync(srcDir) && existsSync(testFileCoverageDir)) {
    const srcModules = readdirSync(srcDir)
      .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".ts") && (f as string) !== "index.ts")
      .map((f) => f.replace(/\.ts$/, ""));

    const testFiles = new Set(
      readdirSync(testFileCoverageDir)
        .filter((f): f is string => typeof f === "string" && (f as string).endsWith(".test.ts"))
        .map((f) => f.replace(/\.test\.ts$/, ""))
    );

    const allowedUncovered = new Set(["config", "index"]);
    const coverableModules = srcModules.filter(m => !allowedUncovered.has(m));
    const coveredModules = coverableModules.filter(m => testFiles.has(m));
    const ratio = coverableModules.length > 0 ? Math.round((coveredModules.length / coverableModules.length) * 100) : 100;
    testModuleCoveragePass = ratio >= 90;

    const uncoveredNames = coverableModules.filter(m => !testFiles.has(m));

    gates.push({
      gate: "test-module-coverage-ratio",
      passed: testModuleCoveragePass,
      severity: testModuleCoveragePass ? "info" : "warning",
      message: testModuleCoveragePass
        ? `Test module coverage: ${ratio}% (${coveredModules.length}/${coverableModules.length} modules have test files)`
        : `Test module coverage below 90%: ${ratio}% (${coveredModules.length}/${coverableModules.length}). Missing test files for: ${uncoveredNames.join(", ")}`,
      detail: uncoveredNames.length > 0 ? `Modules without test files: ${uncoveredNames.join(", ")}` : undefined,
    });

    if (!testModuleCoveragePass && uncoveredNames.length > 0) {
      score -= uncoveredNames.length * 1; // 1 point per uncovered module below threshold
    }
  }

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
