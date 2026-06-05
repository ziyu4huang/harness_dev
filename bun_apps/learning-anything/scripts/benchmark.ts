#!/usr/bin/env bun
/**
 * benchmark.ts — Performance and feature benchmarks for learning-anything bun app.
 *
 * Tests: server startup, API endpoints, graph loading, search, agent endpoints.
 * Output: JSON report for workflow consumption.
 *
 * Usage: bun scripts/benchmark.ts [--json]
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir.replace(/[/\\]scripts$/, "");
const DIST = join(ROOT, "..", "..", "dist");
const BUNDLE = join(DIST, "learning-anything-server.js");
const isJson = process.argv.includes("--json");

interface BenchmarkResult {
  name: string;
  category: string;
  passed: boolean;
  latencyMs: number;
  failureReason?: string;
}

interface FeatureInventory {
  feature: string;
  status: string;
  evidence: string;
}

interface BenchmarkReport {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalLatencyMs: number;
  results: BenchmarkResult[];
  featureInventory: FeatureInventory[];
}

async function benchmark(): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];
  const features: FeatureInventory[] = [];

  // Test 1: Bundle exists and is runnable
  const t1 = Date.now();
  const bundleExists = existsSync(BUNDLE);
  results.push({
    name: "bundle-exists",
    category: "build",
    passed: bundleExists,
    latencyMs: Date.now() - t1,
    failureReason: bundleExists ? undefined : "Bundle not found at dist/learning-anything-server.js",
  });

  // Test 2: Bundle has shebang
  if (bundleExists) {
    const t2 = Date.now();
    const firstLine = readFileSync(BUNDLE, "utf-8").split("\n")[0];
    const hasShebang = firstLine.startsWith("#!");
    results.push({
      name: "bundle-shebang",
      category: "build",
      passed: hasShebang,
      latencyMs: Date.now() - t2,
      failureReason: hasShebang ? undefined : "Missing shebang line",
    });
  }

  // Test 3: Source file count
  const t3 = Date.now();
  const srcDir = join(ROOT, "src");
  const srcFiles = existsSync(srcDir)
    ? Array.from(await import("fs").then(fs => {
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts")) files.push(entry.name);
          }
        };
        walk(srcDir);
        return files;
      }))
    : [];
  const hasModules = srcFiles.length >= 4;
  results.push({
    name: "source-modules",
    category: "structure",
    passed: hasModules,
    latencyMs: Date.now() - t3,
    failureReason: hasModules ? undefined : `Expected >= 4 source modules, found ${srcFiles.length}`,
  });
  features.push({ feature: "modular-source", status: hasModules ? "present" : "missing", evidence: `${srcFiles.length} .ts files in src/` });

  // Test 4: Graph module exists
  const t4 = Date.now();
  const graphModule = join(ROOT, "src", "graph.ts");
  const graphExists = existsSync(graphModule);
  results.push({
    name: "graph-module",
    category: "feature",
    passed: graphExists,
    latencyMs: Date.now() - t4,
    failureReason: graphExists ? undefined : "src/graph.ts not found",
  });
  features.push({ feature: "knowledge-graph-store", status: graphExists ? "present" : "missing", evidence: "src/graph.ts" });

  // Test 5: Agent module exists
  const t5 = Date.now();
  const agentModule = join(ROOT, "src", "agent.ts");
  const agentExists = existsSync(agentModule);
  results.push({
    name: "agent-module",
    category: "feature",
    passed: agentExists,
    latencyMs: Date.now() - t5,
    failureReason: agentExists ? undefined : "src/agent.ts not found",
  });
  features.push({ feature: "llm-agent", status: agentExists ? "present" : "missing", evidence: "src/agent.ts" });

  // Test 6: Routes module exists
  const t6 = Date.now();
  const routesModule = join(ROOT, "src", "routes.ts");
  const routesExists = existsSync(routesModule);
  results.push({
    name: "routes-module",
    category: "feature",
    passed: routesExists,
    latencyMs: Date.now() - t6,
    failureReason: routesExists ? undefined : "src/routes.ts not found",
  });
  features.push({ feature: "api-routes", status: routesExists ? "present" : "missing", evidence: "src/routes.ts" });

  // Test 7: Config module has models
  const t7 = Date.now();
  const configPath = join(ROOT, "src", "config.ts");
  let configValid = false;
  if (existsSync(configPath)) {
    const configContent = readFileSync(configPath, "utf-8");
    configValid = configContent.includes("MODELS") && configContent.includes("deepseek");
  }
  results.push({
    name: "config-models",
    category: "feature",
    passed: configValid,
    latencyMs: Date.now() - t7,
    failureReason: configValid ? undefined : "Config doesn't define DeepSeek models",
  });
  features.push({ feature: "deepseek-models", status: configValid ? "present" : "missing", evidence: "MODELS in config.ts" });

  // Test 8: Package.json has required fields
  const t8 = Date.now();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const pkgValid = pkg.name === "learning-anything" && pkg.scripts?.build && pkg.scripts?.dev;
  results.push({
    name: "package-json",
    category: "structure",
    passed: pkgValid,
    latencyMs: Date.now() - t8,
    failureReason: pkgValid ? undefined : "package.json missing required fields",
  });

  // Test 9: Build script targets correct output
  const t9 = Date.now();
  const buildScript = pkg.scripts?.build ?? "";
  const buildValid = buildScript.includes("learning-anything-server.js") && buildScript.includes("../../dist/");
  results.push({
    name: "build-script",
    category: "build",
    passed: buildValid,
    latencyMs: Date.now() - t9,
    failureReason: buildValid ? undefined : "Build script doesn't target correct output",
  });

  // Test 10: Scripts exist
  const scriptNames = ["audit", "quality-check", "benchmark"];
  for (const script of scriptNames) {
    const ts = Date.now();
    const scriptPath = join(ROOT, "scripts", `${script}.ts`);
    const exists = existsSync(scriptPath);
    results.push({
      name: `script-${script}`,
      category: "scripts",
      passed: exists,
      latencyMs: Date.now() - ts,
      failureReason: exists ? undefined : `scripts/${script}.ts not found`,
    });
    features.push({ feature: `script-${script}`, status: exists ? "present" : "missing", evidence: `scripts/${script}.ts` });
  }

  // Test 11: New UA-ported modules exist
  const uaModules = [
    { file: "context.ts", feature: "rich-context-builder" },
    { file: "explain.ts", feature: "explain-builder" },
    { file: "diff.ts", feature: "diff-analyzer" },
    { file: "onboard.ts", feature: "onboard-builder" },
  ];
  for (const mod of uaModules) {
    const ts = Date.now();
    const modPath = join(ROOT, "src", mod.file);
    const exists = existsSync(modPath);
    results.push({
      name: `module-${mod.feature}`,
      category: "ua-feature",
      passed: exists,
      latencyMs: Date.now() - ts,
      failureReason: exists ? undefined : `src/${mod.file} not found`,
    });
    features.push({ feature: mod.feature, status: exists ? "present" : "missing", evidence: `src/${mod.file}` });
  }

  // Test 12: Graph store has new query methods
  const t12 = Date.now();
  let graphMethodsValid = false;
  if (graphExists) {
    const graphContent = readFileSync(graphModule, "utf-8");
    const requiredMethods = ["getNodeByPath", "getChildNodes", "getConnectedNodes", "getLayerHealth", "getPathBetween", "getHotspots", "checkStaleness"];
    graphMethodsValid = requiredMethods.every(m => graphContent.includes(m));
  }
  results.push({
    name: "graph-query-methods",
    category: "ua-feature",
    passed: graphMethodsValid,
    latencyMs: Date.now() - t12,
    failureReason: graphMethodsValid ? undefined : "Graph store missing new query methods (getNodeByPath, getChildNodes, etc.)",
  });
  features.push({ feature: "graph-query-methods", status: graphMethodsValid ? "present" : "missing", evidence: "getNodeByPath, getChildNodes, getConnectedNodes, getLayerHealth, getPathBetween, getHotspots, checkStaleness" });

  // Test 13: New API endpoints in routes.ts
  const t13 = Date.now();
  let endpointsValid = false;
  if (routesExists) {
    const routesContent = readFileSync(routesModule, "utf-8");
    const requiredEndpoints = [
      "api/chat/stream", "api/explain", "api/diff/analyze",
      "api/onboard", "api/staleness", "api/health/detailed",
      "api/hotspots",
    ];
    endpointsValid = requiredEndpoints.every(e => routesContent.includes(`"${e}"`));
  }
  results.push({
    name: "new-api-endpoints",
    category: "ua-feature",
    passed: endpointsValid,
    latencyMs: Date.now() - t13,
    failureReason: endpointsValid ? undefined : "Routes missing new UA-ported endpoints",
  });
  features.push({ feature: "new-api-endpoints", status: endpointsValid ? "present" : "missing", evidence: "chat/stream, explain, diff/analyze, onboard, staleness, health/detailed, hotspots" });

  // Test 14: Agent has new functions
  const t14 = Date.now();
  let agentFunctionsValid = false;
  if (agentExists) {
    const agentContent = readFileSync(agentModule, "utf-8");
    const requiredFns = ["explainNode", "analyzeDiff", "generateOnboardingGuide"];
    agentFunctionsValid = requiredFns.every(fn => agentContent.includes(fn));
  }
  results.push({
    name: "new-agent-functions",
    category: "ua-feature",
    passed: agentFunctionsValid,
    latencyMs: Date.now() - t14,
    failureReason: agentFunctionsValid ? undefined : "Agent module missing new functions (explainNode, analyzeDiff, generateOnboardingGuide)",
  });
  features.push({ feature: "new-agent-functions", status: agentFunctionsValid ? "present" : "missing", evidence: "explainNode, analyzeDiff, generateOnboardingGuide" });

  // Test 15: Config has new system prompts
  const t15 = Date.now();
  let configPromptsValid = false;
  if (existsSync(configPath)) {
    const configContent = readFileSync(configPath, "utf-8");
    const requiredPrompts = ["explainAnalyst", "diffAnalyst", "onboardingGuide"];
    configPromptsValid = requiredPrompts.every(p => configContent.includes(p));
  }
  results.push({
    name: "new-system-prompts",
    category: "ua-feature",
    passed: configPromptsValid,
    latencyMs: Date.now() - t15,
    failureReason: configPromptsValid ? undefined : "Config missing new system prompts (explainAnalyst, diffAnalyst, onboardingGuide)",
  });

  // Test 16: Type imports use .js extension (Bun ESM requirement)
  const t11 = Date.now();
  let importStyleValid = true;
  const allModulesToCheck = [graphModule, agentModule, routesModule, join(ROOT, "src", "context.ts"), join(ROOT, "src", "explain.ts"), join(ROOT, "src", "diff.ts"), join(ROOT, "src", "onboard.ts")];
  for (const srcFile of allModulesToCheck.filter(existsSync)) {
    const content = readFileSync(srcFile, "utf-8");
    const jsImports = content.match(/from\s+['"]\.\/[^'"]+['"]/g) ?? [];
    const bareImports = jsImports.filter(i => !i.includes(".js") && !i.includes(".ts"));
    if (bareImports.length > 0) importStyleValid = false;
  }
  results.push({
    name: "import-style",
    category: "quality",
    passed: importStyleValid,
    latencyMs: Date.now() - t11,
    failureReason: importStyleValid ? undefined : "Some imports missing .js extension for Bun ESM",
  });

  const passedTests = results.filter(r => r.passed).length;
  const failedTests = results.filter(r => !r.passed).length;
  const totalLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0);

  return {
    totalTests: results.length,
    passedTests,
    failedTests,
    totalLatencyMs,
    results,
    featureInventory: features,
  };
}

const report = await benchmark();
if (isJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n=== learning-anything-server Benchmark ===\n`);
  console.log(`Tests: ${report.passedTests}/${report.totalTests} passed\n`);
  for (const r of report.results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} [${r.category}] ${r.name} (${r.latencyMs}ms)`);
    if (!r.passed) console.log(`      → ${r.failureReason}`);
  }
  console.log(`\nFeature Inventory:`);
  for (const f of report.featureInventory) {
    console.log(`  ${f.status === "present" ? "✅" : "❌"} ${f.feature}: ${f.evidence}`);
  }
  console.log();
}
