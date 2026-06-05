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
  const bundlePath = join(ROOT, "..", "..", "dist", "learning-anything-server.js");
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

  return {
    features,
    issues,
    health: {
      undeclaredDeps: [],
      unusedDeps: [],
      deadExports: [],
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
  console.log(`\n=== learning-anything-server Audit ===\n`);
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
  console.log();
}
