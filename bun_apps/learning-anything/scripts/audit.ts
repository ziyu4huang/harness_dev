#!/usr/bin/env bun
/**
 * audit.ts — Inventory current state of the learning-anything bun app.
 *
 * Scans source files for features, counts code lines, detects issues.
 * Output: JSON report for workflow consumption.
 *
 * Usage: bun scripts/audit.ts [--json]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, extname, relative } from "path";

const ROOT = import.meta.dir.replace(/[/\\]scripts$/, "");
const SRC = join(ROOT, "src");
const isJson = process.argv.includes("--json");

interface Feature {
  name: string;
  type: string;
  description: string;
  file: string;
}

interface Issue {
  file: string;
  line: number;
  type: string;
  text: string;
}

interface AuditReport {
  features: Feature[];
  issues: Issue[];
  health: {
    undeclaredDeps: string[];
    unusedDeps: string[];
    deadExports: string[];
  };
  stats: {
    codeLines: number;
    sourceFiles: number;
    scriptFiles: number;
    testFiles: number;
    dependencyCount: number;
    existingBundleSizeKB: number;
    apiEndpoints: number;
  };
  uaFeatureCoverage: {
    portedFeatures: string[];
    missingFeatures: string[];
    coverage: number;
  };
}

function walkDir(dir: string, ext: string[]): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (ext.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function audit(): AuditReport {
  const features: Feature[] = [];
  const issues: Issue[] = [];
  let codeLines = 0;

  // Scan source files
  const srcFiles = walkDir(SRC, [".ts", ".tsx"]);
  for (const file of srcFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    const relPath = relative(ROOT, file).replace(/\\/g, "/");
    codeLines += lines.filter(l => l.trim() && !l.trim().startsWith("//")).length;

    // Detect features: exported functions/classes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const exportFn = line.match(/^export\s+(async\s+)?function\s+(\w+)/);
      if (exportFn) {
        features.push({
          name: exportFn[2],
          type: "function",
          description: `Exported function in ${relPath}:${i + 1}`,
          file: relPath,
        });
      }

      const exportClass = line.match(/^export\s+(class|interface|type)\s+(\w+)/);
      if (exportClass) {
        features.push({
          name: exportClass[2],
          type: exportClass[1],
          description: `Exported ${exportClass[1]} in ${relPath}:${i + 1}`,
          file: relPath,
        });
      }

      // Detect issues: TODO, FIXME, HACK, console.log
      if (line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) {
        issues.push({ file: relPath, line: i + 1, type: "todo", text: line.trim() });
      }
    }
  }

  // Scan scripts
  const scriptFiles = walkDir(join(ROOT, "scripts"), [".ts"]);
  for (const file of scriptFiles) {
    const content = readFileSync(file, "utf-8");
    codeLines += content.split("\n").filter(l => l.trim() && !l.trim().startsWith("//")).length;
  }

  // Test files
  const testFiles = walkDir(ROOT, [".test.ts", ".spec.ts"]);
  let testCount = 0;
  for (const file of testFiles) {
    const content = readFileSync(file, "utf-8");
    testCount += (content.match(/\btest\(|\bit\(/g) || []).length;
  }

  // Bundle size
  const bundlePath = join(ROOT, "..", "..", "dist", "learning-anything.js");
  const bundleSizeKB = existsSync(bundlePath)
    ? Math.round(statSync(bundlePath).size / 1024 * 10) / 10
    : 0;

  // Dependencies from package.json
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const depCount = Object.keys(pkg.dependencies ?? {}).length;

  // Count API endpoints from routes.ts
  const routesFile = join(SRC, "routes.ts");
  let apiEndpoints = 0;
  if (existsSync(routesFile)) {
    const routesContent = readFileSync(routesFile, "utf-8");
    apiEndpoints = (routesContent.match(/"api\//g) || []).length;
  }

  // UA feature coverage tracking
  const UA_FEATURES = [
    "knowledge-graph-store",       // graph.ts
    "llm-agent",                   // agent.ts
    "api-routes",                  // routes.ts
    "deepseek-models",             // config.ts
    "rich-context-builder",        // context.ts (port of UA context-builder.ts)
    "explain-builder",             // explain.ts (port of UA explain-builder.ts)
    "diff-analyzer",               // diff.ts (port of UA diff-analyzer.ts)
    "onboard-builder",             // onboard.ts (port of UA onboard-builder.ts)
    "streaming-chat",              // chatStream in agent.ts + route
    "layer-health",                // getLayerHealth in graph.ts
    "path-finding",                // getPathBetween in graph.ts
    "staleness-detection",         // checkStaleness in graph.ts
    "hotspot-detection",           // getHotspots in graph.ts
    "node-by-path",                // getNodeByPath in graph.ts
    "child-nodes",                 // getChildNodes in graph.ts
    // Phase 2 features (gap analysis)
    "llm-file-analyzer",           // analyzer.ts + agent.ts analyzeFile
    "project-summarizer",          // agent.ts summarizeProject
    "ignore-filter",               // ignore.ts
    "middleware-layer",            // middleware.ts (request logging, rate limiting, error boundary)
    "rate-limiting",               // middleware.ts rateLimiter
    "search-ignore-filtering",     // routes.ts search with ignored parameter
    "request-logging",             // middleware.ts requestLogger
    "error-classification",        // middleware.ts classifyError
    // Phase 3 features (new ports)
    "graph-persistence",           // graph.ts save() + mergeGraphUpdate()
    "tour-generation",             // tour.ts generateHeuristicTour()
    "expanded-node-types",         // validate.ts 21 UA node types
  ];

  const portedFeatures: string[] = [];
  const missingFeatures: string[] = [];
  const moduleFiles = readdirSync(SRC).map(f => f.replace(/\.ts$/, ""));
  for (const feat of UA_FEATURES) {
    // Check if the supporting module exists
    const moduleMap: Record<string, string> = {
      "rich-context-builder": "context",
      "explain-builder": "explain",
      "diff-analyzer": "diff",
      "onboard-builder": "onboard",
      "knowledge-graph-store": "graph",
      "llm-agent": "agent",
      "api-routes": "routes",
      "deepseek-models": "config",
      "llm-file-analyzer": "analyzer",
      "ignore-filter": "ignore",
      "middleware-layer": "middleware",
      "project-summarizer": "agent",
      "rate-limiting": "middleware",
      "search-ignore-filtering": "routes",
      "request-logging": "middleware",
      "error-classification": "middleware",
      "tour-generation": "tour",
    };
    const requiredModule = moduleMap[feat];
    if (requiredModule) {
      if (moduleFiles.includes(requiredModule)) {
        portedFeatures.push(feat);
      } else {
        missingFeatures.push(feat);
      }
    } else {
      // Check for specific function existence in source files
      const fnPatterns: Record<string, string> = {
        "streaming-chat": "chatStream",
        "layer-health": "getLayerHealth",
        "path-finding": "getPathBetween",
        "staleness-detection": "checkStaleness",
        "hotspot-detection": "getHotspots",
        "node-by-path": "getNodeByPath",
        "child-nodes": "getChildNodes",
        "llm-file-analyzer": "analyzeFile",
        "project-summarizer": "summarizeProject",
        "rate-limiting": "rateLimiter",
        "request-logging": "requestLogger",
        "error-classification": "classifyError",
        "search-ignore-filtering": "createIgnoreFilter",
        "graph-persistence": "save",
        "expanded-node-types": "domain",
      };
      const pattern = fnPatterns[feat];
      if (pattern) {
        let found = false;
        for (const file of srcFiles) {
          if (readFileSync(file, "utf-8").includes(pattern)) {
            found = true;
            break;
          }
        }
        if (found) portedFeatures.push(feat);
        else missingFeatures.push(feat);
      }
    }
  }

  const coverage = UA_FEATURES.length > 0
    ? Math.round((portedFeatures.length / UA_FEATURES.length) * 100)
    : 0;

  // ─── Dependency Health Checks ─────────────────────────────────────────────

  const declaredDeps = new Set(Object.keys(pkg.dependencies ?? {}));

  // Scan for bare import specifiers (not starting with . or /)
  const BARE_IMPORT_RE = /(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])(@?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+)*)/g;
  const foundImports = new Set<string>();
  for (const file of [...srcFiles, ...scriptFiles]) {
    const content = readFileSync(file, "utf-8");
    let match: RegExpExecArray | null;
    while ((match = BARE_IMPORT_RE.exec(content)) !== null) {
      const specifier = match[1];
      // Skip Bun/Node built-ins
      if (!specifier.startsWith("@") && !specifier.includes("/")) {
        const builtins = new Set(["fs", "path", "http", "https", "url", "stream", "crypto", "os", "util", "events", "buffer", "child_process", "net", "tls", "zlib", "assert", "process", "bun"]);
        if (builtins.has(specifier)) continue;
      }
      // Normalize scoped package: @scope/pkg -> @scope/pkg
      // For non-scoped: take first segment (e.g. fuse.js -> fuse.js)
      const pkgName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier;
      foundImports.add(pkgName);
    }
  }

  // Undeclared: imported but not in package.json dependencies
  const undeclaredDeps = [...foundImports].filter(dep => !declaredDeps.has(dep));

  // Unused: declared but never imported
  const unusedDeps = [...declaredDeps].filter(dep => !foundImports.has(dep));

  // ─── Dead Export Detection ────────────────────────────────────────────────

  // Collect all exported names
  const exportedNames = new Map<string, string[]>(); // name -> [files that export it]
  for (const file of srcFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const fnMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
      if (fnMatch) {
        const name = fnMatch[1];
        const arr = exportedNames.get(name) ?? [];
        arr.push(relative(ROOT, file).replace(/\\/g, "/"));
        exportedNames.set(name, arr);
      }
      const classMatch = line.match(/^export\s+(?:class|interface|type)\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[1];
        const arr = exportedNames.get(name) ?? [];
        arr.push(relative(ROOT, file).replace(/\\/g, "/"));
        exportedNames.set(name, arr);
      }
      const constMatch = line.match(/^export\s+const\s+(\w+)/);
      if (constMatch) {
        const name = constMatch[1];
        const arr = exportedNames.get(name) ?? [];
        arr.push(relative(ROOT, file).replace(/\\/g, "/"));
        exportedNames.set(name, arr);
      }
    }
  }

  // Check which exports are never imported elsewhere
  const deadExports: string[] = [];
  for (const [name] of exportedNames) {
    let used = false;
    for (const file of [...srcFiles, ...scriptFiles]) {
      const content = readFileSync(file, "utf-8");
      // Check if the name appears in an import statement
      if (content.match(new RegExp(`import.*\\b${name}\\b.*from`, "m")) || content.match(new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}`, "m"))) {
        used = true;
        break;
      }
      // Also check if used as a type annotation or in code within the same file
      const exportingFiles = exportedNames.get(name) ?? [];
      for (const ef of exportingFiles) {
        if (!relative(ROOT, file).replace(/\\/g, "/").includes(ef.replace(/\/[^/]+$/, ""))) {
          // Different directory -- check for any reference
          if (content.includes(name)) {
            used = true;
            break;
          }
        }
      }
      if (used) break;
    }
    if (!used) {
      const files = exportedNames.get(name)?.join(", ") ?? "unknown";
      deadExports.push(`${name} (in ${files})`);
    }
  }

  return {
    features,
    issues,
    health: {
      undeclaredDeps,
      unusedDeps,
      deadExports,
    },
    stats: {
      codeLines,
      sourceFiles: srcFiles.length,
      scriptFiles: scriptFiles.length,
      testFiles: testCount,
      dependencyCount: depCount,
      existingBundleSizeKB: bundleSizeKB,
      apiEndpoints,
    },
    uaFeatureCoverage: {
      portedFeatures,
      missingFeatures,
      coverage,
    },
  };
}

const report = audit();
if (isJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n=== learning-anything Audit ===\n`);
  console.log(`Features:       ${report.features.length}`);
  console.log(`Source files:   ${report.stats.sourceFiles}`);
  console.log(`Script files:   ${report.stats.scriptFiles}`);
  console.log(`Code lines:     ${report.stats.codeLines}`);
  console.log(`Test cases:     ${report.stats.testFiles}`);
  console.log(`Dependencies:   ${report.stats.dependencyCount}`);
  console.log(`API endpoints:  ${report.stats.apiEndpoints}`);
  console.log(`Bundle size:    ${report.stats.existingBundleSizeKB} KB`);
  console.log(`UA coverage:    ${report.uaFeatureCoverage.coverage}% (${report.uaFeatureCoverage.portedFeatures.length}/${report.uaFeatureCoverage.portedFeatures.length + report.uaFeatureCoverage.missingFeatures.length})`);
  console.log(`Issues:         ${report.issues.length}`);
  if (report.issues.length > 0) {
    for (const i of report.issues) {
      console.log(`  ${i.type}: ${i.file}:${i.line}: ${i.text}`);
    }
  }
  if (report.uaFeatureCoverage.missingFeatures.length > 0) {
    console.log(`\nMissing UA features:`);
    for (const f of report.uaFeatureCoverage.missingFeatures) {
      console.log(`  - ${f}`);
    }
  }
  if (report.health.undeclaredDeps.length > 0) {
    console.log(`\nUndeclared dependencies (imported but not in package.json):`);
    for (const d of report.health.undeclaredDeps) {
      console.log(`  - ${d}`);
    }
  }
  if (report.health.unusedDeps.length > 0) {
    console.log(`\nUnused dependencies (declared but never imported):`);
    for (const d of report.health.unusedDeps) {
      console.log(`  - ${d}`);
    }
  }
  if (report.health.deadExports.length > 0) {
    console.log(`\nDead exports (never referenced outside their file):`);
    for (const e of report.health.deadExports) {
      console.log(`  - ${e}`);
    }
  }
  console.log();
}
