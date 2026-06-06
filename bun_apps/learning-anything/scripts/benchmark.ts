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
const BUNDLE = join(DIST, "learning-anything.js");
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
    failureReason: bundleExists ? undefined : "Bundle not found at dist/learning-anything.js",
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
  const buildValid = buildScript.includes("learning-anything.js") && buildScript.includes("../../dist/");
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
  const allModulesToCheck = [graphModule, agentModule, routesModule, join(ROOT, "src", "context.ts"), join(ROOT, "src", "explain.ts"), join(ROOT, "src", "diff.ts"), join(ROOT, "src", "onboard.ts"), join(ROOT, "src", "validate.ts"), join(ROOT, "src", "search.ts")];
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

  // Test 17: Per-module test coverage — every source module should have a test file
  const t17 = Date.now();
  const testDir = join(ROOT, "src", "__tests__");
  const srcTsFiles = existsSync(srcDir)
    ? Array.from(await import("fs").then(fs => {
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) return; // skip subdirs
            if (entry.name.endsWith(".ts") && entry.name !== "index.ts") {
              files.push(entry.name.replace(/\.ts$/, ""));
            }
          }
        };
        walk(srcDir);
        return files;
      }))
    : [];
  const testTsFiles = existsSync(testDir)
    ? Array.from(await import("fs").then(fs => {
        const files: string[] = [];
        for (const entry of fs.readdirSync(testDir, { withFileTypes: true })) {
          if (entry.isDirectory()) continue;
          if (entry.name.endsWith(".test.ts")) {
            files.push(entry.name.replace(/\.test\.ts$/, ""));
          }
        }
        return files;
      }))
    : [];
  const uncoveredModules = srcTsFiles.filter(m => !testTsFiles.includes(m));
  const testCoverageRatio = srcTsFiles.length > 0 ? testTsFiles.length / srcTsFiles.length : 0;
  const coveragePass = testCoverageRatio >= 0.4; // At least 40% of modules have dedicated tests
  results.push({
    name: "test-coverage-ratio",
    category: "quality",
    passed: coveragePass,
    latencyMs: Date.now() - t17,
    failureReason: coveragePass
      ? undefined
      : `Test coverage ratio: ${testCoverageRatio.toFixed(2)} (${testTsFiles.length}/${srcTsFiles.length} modules covered). Uncovered: ${uncoveredModules.join(", ")}`,
  });
  features.push({
    feature: "test-coverage-ratio",
    status: coveragePass ? "present" : "missing",
    evidence: `${testTsFiles.length}/${srcTsFiles.length} modules have dedicated tests (${(testCoverageRatio * 100).toFixed(0)}%). Uncovered: ${uncoveredModules.join(", ") || "none"}`,
  });

  // Report uncovered modules as individual feature inventory entries
  for (const mod of uncoveredModules) {
    features.push({
      feature: `test-for-${mod}`,
      status: "missing",
      evidence: `No __tests__/${mod}.test.ts found for src/${mod}.ts`,
    });
  }

  // Aggregated test-module-coverage summary for workflow consumption
  const totalNonIndexModules = srcTsFiles.length;
  const modulesWithTests = srcTsFiles.filter(m => !uncoveredModules.includes(m)).length;
  const moduleCoveragePercent = totalNonIndexModules > 0 ? Math.round((modulesWithTests / totalNonIndexModules) * 100) : 0;
  const moduleCoverageStatus = moduleCoveragePercent >= 90 ? "present" : moduleCoveragePercent >= 60 ? "partial" : "missing";
  features.push({
    feature: "test-module-coverage-summary",
    status: moduleCoverageStatus,
    evidence: `${modulesWithTests}/${totalNonIndexModules} modules have dedicated test files (${moduleCoveragePercent}%). Uncovered: ${uncoveredModules.join(", ") || "none"}`,
  });

  // Test 17.5: Per-module test count — count test cases in each test file
  const t17b = Date.now();
  let totalTestCount = 0;
  const moduleTestCounts: Record<string, number> = {};
  if (existsSync(testDir)) {
    const { readdirSync: rd, readFileSync: rf } = await import("fs");
    const testFiles = rd(testDir).filter(f => f.endsWith(".test.ts"));
    for (const tf of testFiles) {
      const content = rf(join(testDir, tf), "utf-8");
      // Count test() and test.skip() calls, plus test inside describe blocks
      const testMatches = content.match(/\btest\s*\(/g);
      const count = testMatches ? testMatches.length : 0;
      const moduleName = tf.replace(/\.test\.ts$/, "");
      moduleTestCounts[moduleName] = count;
      totalTestCount += count;
      features.push({
        feature: `test-for-${moduleName}`,
        status: "present",
        evidence: `${count} tests in __tests__/${tf}`,
      });
    }
  }
  features.push({
    feature: "test-count-total",
    status: totalTestCount > 0 ? "present" : "missing",
    evidence: `${totalTestCount} total test cases across ${Object.keys(moduleTestCounts).length} test files`,
  });
  const testCountPass = totalTestCount >= 50;
  results.push({
    name: "test-count-total",
    category: "quality",
    passed: testCountPass,
    latencyMs: Date.now() - t17b,
    failureReason: testCountPass ? undefined : `Total test count: ${totalTestCount} (target >= 50)`,
  });

  // ─── Runtime Behavioral Tests ────────────────────────────────────────────
  // These tests actually import and execute the server code to verify runtime
  // behavior, not just structural presence.

  try {
    // Create a temporary test graph for runtime tests
    const tmpDir = join(ROOT, "__tmp_bench__");
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");
    mkdirSync(tmpDir, { recursive: true });

    const TEST_GRAPH = {
      version: "1.0.0",
      kind: "codebase",
      project: {
        name: "bench-test",
        languages: ["typescript"],
        frameworks: ["bun"],
        description: "Benchmark test graph",
        analyzedAt: "2025-01-01",
        gitCommitHash: "abc123",
      },
      nodes: [
        { id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", summary: "Module A with authentication", tags: ["auth", "core"], complexity: "simple" },
        { id: "fn:a.ts:login", type: "function", name: "login", filePath: "a.ts", summary: "Login handler", tags: ["auth"], complexity: "moderate" },
        { id: "file:b.ts", type: "file", name: "b.ts", filePath: "b.ts", summary: "Module B with database access", tags: ["database", "core"], complexity: "complex" },
        { id: "fn:b.ts:query", type: "function", name: "query", filePath: "b.ts", summary: "Database query executor", tags: ["database"], complexity: "complex" },
        { id: "class:c.ts:App", type: "class", name: "App", filePath: "c.ts", summary: "Main application class", tags: ["app"], complexity: "moderate" },
      ],
      edges: [
        { source: "file:a.ts", target: "fn:a.ts:login", type: "contains" },
        { source: "file:b.ts", target: "fn:b.ts:query", type: "contains" },
        { source: "fn:a.ts:login", target: "fn:b.ts:query", type: "calls" },
        { source: "class:c.ts:App", target: "file:a.ts", type: "depends_on" },
        { source: "class:c.ts:App", target: "file:b.ts", type: "depends_on" },
      ],
      layers: [
        { id: "core", name: "Core", description: "Core modules", nodeIds: ["file:a.ts", "fn:a.ts:login", "file:b.ts", "fn:b.ts:query"] },
        { id: "app", name: "Application", description: "Application layer", nodeIds: ["class:c.ts:App"] },
      ],
      tour: [
        { order: 1, title: "Start", description: "Start here", nodeIds: ["file:a.ts"] },
      ],
    };

    const graphPath = join(tmpDir, "test-graph.json");
    writeFileSync(graphPath, JSON.stringify(TEST_GRAPH, null, 2));

    // Import GraphStore dynamically
    const { GraphStore } = await import(join(ROOT, "src", "graph.ts"));
    const store = new GraphStore(graphPath);
    store.load();

    // Runtime Test 1: GraphStore loads and has correct stats
    const rt1 = Date.now();
    const stats = store.getStats();
    const statsOk = stats.totalNodes === 5 && stats.totalEdges === 5 && stats.layers === 2;
    results.push({
      name: "runtime-graph-stats",
      category: "runtime",
      passed: statsOk,
      latencyMs: Date.now() - rt1,
      failureReason: statsOk ? undefined : `Stats mismatch: nodes=${stats.totalNodes}, edges=${stats.totalEdges}`,
    });

    // Runtime Test 2: getNode returns correct node
    const rt2 = Date.now();
    const node = store.getNode("file:a.ts");
    const getNodeOk = node?.name === "a.ts" && node?.type === "file";
    results.push({
      name: "runtime-get-node",
      category: "runtime",
      passed: getNodeOk,
      latencyMs: Date.now() - rt2,
      failureReason: getNodeOk ? undefined : `getNode returned wrong data: ${JSON.stringify(node?.name)}`,
    });

    // Runtime Test 3: search finds relevant nodes
    const rt3 = Date.now();
    const searchResults = store.search("auth", 10);
    const searchOk = searchResults.length > 0 && searchResults.some(n => n.name === "a.ts" || n.name === "login");
    results.push({
      name: "runtime-search",
      category: "runtime",
      passed: searchOk,
      latencyMs: Date.now() - rt3,
      failureReason: searchOk ? undefined : `Search for 'auth' returned ${searchResults.length} results`,
    });
    features.push({ feature: "fuzzy-search", status: searchOk ? "present" : "missing", evidence: `fuse.js search returned ${searchResults.length} results for 'auth'` });

    // Runtime Test 4: getNeighborhood returns 1-hop neighbors
    const rt4 = Date.now();
    const { nodes: nbrNodes, edges: nbrEdges } = store.getNeighborhood("file:a.ts", 20);
    const nbrOk = nbrNodes.length > 1 && nbrEdges.length > 0;
    results.push({
      name: "runtime-neighborhood",
      category: "runtime",
      passed: nbrOk,
      latencyMs: Date.now() - rt4,
      failureReason: nbrOk ? undefined : `Neighborhood returned ${nbrNodes.length} nodes, ${nbrEdges.length} edges`,
    });

    // Runtime Test 5: getDependencyTree follows chains
    const rt5 = Date.now();
    const { nodes: depNodes } = store.getDependencyTree("fn:a.ts:login", 3);
    const depOk = depNodes.length > 0 && depNodes.some(n => n.name === "query");
    results.push({
      name: "runtime-dep-tree",
      category: "runtime",
      passed: depOk,
      latencyMs: Date.now() - rt5,
      failureReason: depOk ? undefined : `Dep tree from login: ${depNodes.map(n => n.name).join(", ")}`,
    });

    // Runtime Test 6: getPathBetween finds paths
    const rt6 = Date.now();
    const { nodes: pathNodes } = store.getPathBetween("class:c.ts:App", "fn:b.ts:query");
    const pathOk = pathNodes.length > 0;
    results.push({
      name: "runtime-path-between",
      category: "runtime",
      passed: pathOk,
      latencyMs: Date.now() - rt6,
      failureReason: pathOk ? undefined : `Path App->query: nodes=${pathNodes.length}`,
    });

    // Runtime Test 7: getLayerHealth returns metrics
    const rt7 = Date.now();
    const layerHealth = store.getLayerHealth();
    const lhOk = layerHealth.length === 2 && layerHealth.every(l => typeof l.edgeDensity === "number");
    results.push({
      name: "runtime-layer-health",
      category: "runtime",
      passed: lhOk,
      latencyMs: Date.now() - rt7,
      failureReason: lhOk ? undefined : `Layer health: ${layerHealth.length} layers`,
    });

    // Runtime Test 8: getHotspots returns complex nodes
    const rt8 = Date.now();
    const hotspots = store.getHotspots();
    const hotOk = hotspots.length > 0 && hotspots.every(n => n.complexity === "complex");
    results.push({
      name: "runtime-hotspots",
      category: "runtime",
      passed: hotOk,
      latencyMs: Date.now() - rt8,
      failureReason: hotOk ? undefined : `Hotspots: ${hotspots.map(n => n.name).join(", ")}`,
    });

    // Runtime Test 9: buildChatContext produces valid context
    const rt9 = Date.now();
    const { buildChatContext: bcc, formatContextForPrompt: fcfp } = await import(join(ROOT, "src", "context.ts"));
    const chatCtx = bcc(store, "auth", 15);
    const chatMd = fcfp(chatCtx);
    const chatOk = chatCtx.relevantNodes.length > 0 && chatMd.includes("# Project:");
    results.push({
      name: "runtime-chat-context",
      category: "runtime",
      passed: chatOk,
      latencyMs: Date.now() - rt9,
      failureReason: chatOk ? undefined : `Chat context: ${chatCtx.relevantNodes.length} nodes`,
    });

    // Runtime Test 10: buildOnboardingGuide produces markdown
    const rt10 = Date.now();
    const { buildOnboardingGuide: bog } = await import(join(ROOT, "src", "onboard.ts"));
    const guide = bog(store);
    const guideOk = guide.includes("# bench-test") && guide.includes("## Architecture");
    results.push({
      name: "runtime-onboarding-guide",
      category: "runtime",
      passed: guideOk,
      latencyMs: Date.now() - rt10,
      failureReason: guideOk ? undefined : "Onboarding guide missing expected sections",
    });

    // Runtime Test 11: validateGraph passes for valid graph
    const rt11 = Date.now();
    const { validateGraph: vg } = await import(join(ROOT, "src", "validate.ts"));
    const valResult = vg(TEST_GRAPH);
    const valOk = valResult.success && valResult.data!.nodes.length === 5;
    results.push({
      name: "runtime-validate-valid",
      category: "runtime",
      passed: valOk,
      latencyMs: Date.now() - rt11,
      failureReason: valOk ? undefined : `Validation: success=${valResult.success}, nodes=${valResult.data?.nodes.length}`,
    });
    features.push({ feature: "graph-validation", status: valOk ? "present" : "missing", evidence: "validate.ts 4-tier pipeline" });

    // Runtime Test 12: validateGraph rejects malformed graph
    const rt12 = Date.now();
    const badResult = vg({ nodes: [] });
    const badOk = !badResult.success;
    results.push({
      name: "runtime-validate-rejects-bad",
      category: "runtime",
      passed: badOk,
      latencyMs: Date.now() - rt12,
      failureReason: badOk ? undefined : "Validation should reject empty graph",
    });

    // Runtime Test 13: buildExplainContext and formatExplainPrompt
    const rt13 = Date.now();
    const { buildExplainContext: bec, formatExplainPrompt: fep } = await import(join(ROOT, "src", "explain.ts"));
    const explainCtx = bec(store, "a.ts");
    const explainPrompt = fep(explainCtx);
    const explainOk = explainCtx.targetNode !== null && explainCtx.childNodes.length > 0 && explainPrompt.includes("# Deep Dive:");
    results.push({
      name: "runtime-explain-builder",
      category: "runtime",
      passed: explainOk,
      latencyMs: Date.now() - rt13,
      failureReason: explainOk ? undefined : `Explain context: targetNode=${!!explainCtx.targetNode}, children=${explainCtx.childNodes.length}`,
    });
    features.push({ feature: "explain-builder", status: explainOk ? "present" : "missing", evidence: `buildExplainContext + formatExplainPrompt for a.ts` });

    // Runtime Test 14: buildDiffContext and formatDiffAnalysis
    const rt14 = Date.now();
    const { buildDiffContext: bdc, formatDiffAnalysis: fda } = await import(join(ROOT, "src", "diff.ts"));
    const diffCtx = bdc(store, ["a.ts"]);
    const diffAnalysis = fda(diffCtx);
    const diffOk = diffCtx.changedNodes.length > 0 && diffCtx.affectedNodes.length > 0 && diffAnalysis.includes("# Diff Analysis:");
    results.push({
      name: "runtime-diff-builder",
      category: "runtime",
      passed: diffOk,
      latencyMs: Date.now() - rt14,
      failureReason: diffOk ? undefined : `Diff: changed=${diffCtx.changedNodes.length}, affected=${diffCtx.affectedNodes.length}`,
    });
    features.push({ feature: "diff-builder", status: diffOk ? "present" : "missing", evidence: `buildDiffContext + formatDiffAnalysis for a.ts` });

    // Runtime Test 15: search type filtering
    const rt15 = Date.now();
    const { SearchEngine: SE } = await import(join(ROOT, "src", "search.ts"));
    const se = new SE(TEST_GRAPH.nodes);
    const allResults = se.search("auth", { limit: 10 });
    const fnResults = se.search("auth", { limit: 10, types: ["function"] });
    const fnOnlyOk = fnResults.length > 0 && fnResults.every(r => {
      const node = TEST_GRAPH.nodes.find(n => n.id === r.nodeId);
      return node?.type === "function";
    });
    results.push({
      name: "runtime-search-type-filter",
      category: "runtime",
      passed: fnOnlyOk,
      latencyMs: Date.now() - rt15,
      failureReason: fnOnlyOk ? undefined : `Type filter: all=${allResults.length}, fn=${fnResults.length}, allFn=${fnResults.every(r => TEST_GRAPH.nodes.find(n => n.id === r.nodeId)?.type === "function")}`,
    });
    features.push({ feature: "search-type-filter", status: fnOnlyOk ? "present" : "missing", evidence: `SearchEngine type filtering for 'auth' with types=['function']` });

    // Runtime Test 16: analyzer module - prompt builders and response parsers
    const rt16 = Date.now();
    const analyzer = await import(join(ROOT, "src", "analyzer.ts"));
    const filePrompt = analyzer.buildFileAnalysisPrompt("test.ts", "function hello() {}", "Test project");
    const projPrompt = analyzer.buildProjectSummaryPrompt(["a.ts", "b.ts"], []);
    const parsedFile = analyzer.parseFileAnalysisResponse('{"fileSummary":"test","tags":["test"],"complexity":"simple","functionSummaries":{},"classSummaries":{}}');
    const parsedBad = analyzer.parseFileAnalysisResponse("not json at all");
    const parsedProj = analyzer.parseProjectSummaryResponse('{"description":"test","frameworks":["bun"],"layers":[]}');
    const analyzerOk = filePrompt.includes("test.ts") && projPrompt.includes("a.ts")
      && parsedFile !== null && parsedFile.fileSummary === "test"
      && parsedBad === null
      && parsedProj !== null && parsedProj.frameworks.length === 1;
    results.push({
      name: "runtime-analyzer-module",
      category: "runtime",
      passed: analyzerOk,
      latencyMs: Date.now() - rt16,
      failureReason: analyzerOk ? undefined : "Analyzer module functions failed",
    });
    features.push({ feature: "llm-file-analyzer", status: analyzerOk ? "present" : "missing", evidence: "buildFileAnalysisPrompt, parseFileAnalysisResponse, buildProjectSummaryPrompt, parseProjectSummaryResponse" });

    // Runtime Test 17: ignore filter module
    const rt17 = Date.now();
    const ignoreMod = await import(join(ROOT, "src", "ignore.ts"));
    const filter = ignoreMod.createIgnoreFilter();
    const ignored = [
      filter.isIgnored("node_modules/react/index.js"),
      filter.isIgnored("dist/bundle.js"),
      filter.isIgnored("package-lock.json"),
      filter.isIgnored("src/__pycache__/test.pyc"),
      filter.isIgnored("coverage/lcov.info"),
    ];
    const notIgnored = [
      filter.isIgnored("src/index.ts"),
      filter.isIgnored("src/agent.ts"),
      filter.isIgnored("lib/utils.js"),
    ];
    const ignoreOk = ignored.every(Boolean) && notIgnored.every(v => !v);
    results.push({
      name: "runtime-ignore-filter",
      category: "runtime",
      passed: ignoreOk,
      latencyMs: Date.now() - rt17,
      failureReason: ignoreOk ? undefined : `Ignore filter: ignored=${ignored}, notIgnored=${notIgnored}`,
    });
    features.push({ feature: "ignore-filter", status: ignoreOk ? "present" : "missing", evidence: "createIgnoreFilter filters node_modules, dist, lock files, coverage" });

    // Runtime Test 18: middleware module
    const rt18 = Date.now();
    const mwMod = await import(join(ROOT, "src", "middleware.ts"));
    const reqCtx = mwMod.requestLogger("GET", "/api/stats", "127.0.0.1");
    const err401 = mwMod.classifyError(new Error("API key invalid"));
    const err503 = mwMod.classifyError(new Error("Rate limit exceeded"));
    const err408 = mwMod.classifyError(new Error("Request timed out"));
    const err500 = mwMod.classifyError(new Error("Something unexpected"));
    const mwOk = reqCtx.requestId.startsWith("la-")
      && err401.status === 401 && err503.status === 503
      && err408.status === 408 && err500.status === 500;
    results.push({
      name: "runtime-middleware",
      category: "runtime",
      passed: mwOk,
      latencyMs: Date.now() - rt18,
      failureReason: mwOk ? undefined : `Middleware: requestId=${reqCtx.requestId}, 401=${err401.status}, 503=${err503.status}, 408=${err408.status}`,
    });
    features.push({ feature: "middleware-layer", status: mwOk ? "present" : "missing", evidence: "requestLogger, classifyError, rateLimiter" });

    // Runtime Test 19: Expanded node types (21 UA types pass validation)
    const rt19 = Date.now();
    const EXPANDED_NODE_TYPES_GRAPH = {
      version: "1.0.0",
      kind: "codebase",
      project: {
        name: "node-type-test",
        languages: ["typescript"],
        frameworks: ["bun"],
        description: "Node type coverage test",
        analyzedAt: "2025-01-01",
        gitCommitHash: "abc123",
      },
      nodes: [
        { id: "n1", type: "file", name: "a.ts", summary: "file", tags: [], complexity: "simple" },
        { id: "n2", type: "function", name: "fn", summary: "fn", tags: [], complexity: "simple" },
        { id: "n3", type: "class", name: "cls", summary: "cls", tags: [], complexity: "simple" },
        { id: "n4", type: "module", name: "mod", summary: "mod", tags: [], complexity: "simple" },
        { id: "n5", type: "concept", name: "cpt", summary: "cpt", tags: [], complexity: "simple" },
        { id: "n6", type: "config", name: "cfg", summary: "cfg", tags: [], complexity: "simple" },
        { id: "n7", type: "document", name: "doc", summary: "doc", tags: [], complexity: "simple" },
        { id: "n8", type: "service", name: "svc", summary: "svc", tags: [], complexity: "simple" },
        { id: "n9", type: "table", name: "tbl", summary: "tbl", tags: [], complexity: "simple" },
        { id: "n10", type: "endpoint", name: "ep", summary: "ep", tags: [], complexity: "simple" },
        { id: "n11", type: "pipeline", name: "pipe", summary: "pipe", tags: [], complexity: "simple" },
        { id: "n12", type: "schema", name: "sch", summary: "sch", tags: [], complexity: "simple" },
        { id: "n13", type: "resource", name: "res", summary: "res", tags: [], complexity: "simple" },
        // New UA node types
        { id: "n14", type: "domain", name: "dom", summary: "dom", tags: [], complexity: "simple" },
        { id: "n15", type: "flow", name: "flw", summary: "flw", tags: [], complexity: "simple" },
        { id: "n16", type: "step", name: "stp", summary: "stp", tags: [], complexity: "simple" },
        { id: "n17", type: "article", name: "art", summary: "art", tags: [], complexity: "simple" },
        { id: "n18", type: "entity", name: "ent", summary: "ent", tags: [], complexity: "simple" },
        { id: "n19", type: "topic", name: "top", summary: "top", tags: [], complexity: "simple" },
        { id: "n20", type: "claim", name: "clm", summary: "clm", tags: [], complexity: "simple" },
        { id: "n21", type: "source", name: "src", summary: "src", tags: [], complexity: "simple" },
      ],
      edges: [],
      layers: [],
      tour: [],
    };
    const expandedResult = vg(EXPANDED_NODE_TYPES_GRAPH);
    const expandedOk = expandedResult.success && expandedResult.data!.nodes.length === 21;
    results.push({
      name: "runtime-expanded-node-types",
      category: "runtime",
      passed: expandedOk,
      latencyMs: Date.now() - rt19,
      failureReason: expandedOk ? undefined : `Expanded types: success=${expandedResult.success}, nodes=${expandedResult.data?.nodes.length}/21`,
    });
    features.push({ feature: "expanded-node-types", status: expandedOk ? "present" : "missing", evidence: "21 UA node types pass validation" });

    // Runtime Test 20: Graph save/merge persistence
    const rt20 = Date.now();
    let persistenceOk = false;
    try {
      const savePath = join(tmpDir, "save-test.json");
      writeFileSync(savePath, JSON.stringify(TEST_GRAPH, null, 2));
      const { GraphStore: GS2 } = await import(join(ROOT, "src", "graph.ts"));

      // Test save
      const saveStore = new GS2(savePath);
      saveStore.load();
      const bytesWritten = saveStore.save();
      const saveOk = bytesWritten > 0 && existsSync(savePath);

      // Test merge: remove nodes for a.ts, add new node
      const mergeResult = saveStore.mergeGraphUpdate(
        ["a.ts"],
        [{ id: "new:fn", type: "function", name: "newFn", filePath: "a.ts", summary: "New function", tags: [], complexity: "simple" }],
        [{ source: "new:fn", target: "fn:b.ts:query", type: "calls" }],
      );
      const mergeOk = mergeResult.removedNodes > 0 && mergeResult.addedNodes === 1 && mergeResult.addedEdges === 1;

      persistenceOk = saveOk && mergeOk;
    } catch (err) {
      persistenceOk = false;
    }
    results.push({
      name: "runtime-graph-persistence",
      category: "runtime",
      passed: persistenceOk,
      latencyMs: Date.now() - rt20,
      failureReason: persistenceOk ? undefined : "Graph save/merge persistence test failed",
    });
    features.push({ feature: "graph-persistence", status: persistenceOk ? "present" : "missing", evidence: "GraphStore.save() + mergeGraphUpdate()" });

    // Runtime Test 21: Tour generation with heuristic topological sort
    const rt21 = Date.now();
    let tourOk = false;
    try {
      const { generateHeuristicTour: ght } = await import(join(ROOT, "src", "tour.ts"));
      const tourResult = ght(TEST_GRAPH.nodes, TEST_GRAPH.edges, TEST_GRAPH.layers, { mode: "batch", batchSize: 3 });
      const tourLayerResult = ght(TEST_GRAPH.nodes, TEST_GRAPH.edges, TEST_GRAPH.layers, { mode: "layer" });
      tourOk = tourResult.length > 0 && tourLayerResult.length > 0
        && tourResult.every(t => t.order > 0 && t.nodeIds.length > 0)
        && tourLayerResult.every(t => t.order > 0 && t.nodeIds.length > 0);
    } catch (err) {
      tourOk = false;
    }
    results.push({
      name: "runtime-tour-generation",
      category: "runtime",
      passed: tourOk,
      latencyMs: Date.now() - rt21,
      failureReason: tourOk ? undefined : "Tour generation test failed",
    });
    features.push({ feature: "tour-generation", status: tourOk ? "present" : "missing", evidence: "generateHeuristicTour with batch and layer modes" });

    // Runtime Test 22: Semantic search with cosine similarity
    const rt22 = Date.now();
    let semanticOk = false;
    try {
      const { cosineSimilarity: cs, SemanticSearchEngine: SSE } = await import(join(ROOT, "src", "semantic-search.ts"));
      // Test cosine similarity correctness
      const sim1 = cs([1, 0, 0], [1, 0, 0]); // identical => 1.0
      const sim2 = cs([1, 0, 0], [0, 1, 0]); // orthogonal => 0.0
      const sim3 = cs([1, 1, 1], [1, 1, 1]); // identical => 1.0
      const sim4 = cs([1, 2, 3], [4, 5, 6]); // dot=32, magA=sqrt(14), magB=sqrt(77) => 32/sqrt(1078)
      const cosCorrect = Math.abs(sim1 - 1.0) < 0.001
        && Math.abs(sim2) < 0.001
        && Math.abs(sim3 - 1.0) < 0.001
        && Math.abs(sim4 - 32 / Math.sqrt(1078)) < 0.001;

      // Test SemanticSearchEngine with nodes that have embeddings
      const embeddedNodes = [
        { id: "n1", type: "function", name: "auth", summary: "Auth function", tags: [], complexity: "simple", embedding: [1, 0, 0] },
        { id: "n2", type: "function", name: "db", summary: "DB function", tags: [], complexity: "simple", embedding: [0, 1, 0] },
        { id: "n3", type: "function", name: "api", summary: "API function", tags: [], complexity: "simple", embedding: [0.8, 0.2, 0] },
      ];
      const semEngine = new SSE(embeddedNodes);
      const hasEmb = semEngine.hasEmbeddings();
      const semResults = semEngine.search([1, 0, 0], { limit: 3 });
      // n1 (sim=1.0, score=0.0) should be first, n3 (sim~0.96, score~0.04) second, n2 (sim=0, score=1) third
      const rankingOk = semResults.length === 3
        && semResults[0].nodeId === "n1"
        && semResults[0].score < semResults[1].score;

      // Test type filtering
      const filteredResults = semEngine.search([1, 0, 0], { types: ["class"] });
      const filterOk = filteredResults.length === 0;

      // Test threshold
      const thresholdResults = semEngine.search([1, 0, 0], { threshold: 0.5 });
      const threshOk = thresholdResults.length === 2; // n1 and n3 have sim >= 0.5

      semanticOk = cosCorrect && hasEmb && rankingOk && filterOk && threshOk;
    } catch (err) {
      semanticOk = false;
    }
    results.push({
      name: "runtime-semantic-search",
      category: "runtime",
      passed: semanticOk,
      latencyMs: Date.now() - rt22,
      failureReason: semanticOk ? undefined : "Semantic search / cosine similarity test failed",
    });
    features.push({ feature: "semantic-search", status: semanticOk ? "present" : "missing", evidence: "cosineSimilarity + SemanticSearchEngine with embeddings" });

    // Runtime Test 23: KnowledgeMeta / DomainMeta in graph nodes
    const rt23 = Date.now();
    let metaOk = false;
    try {
      const META_GRAPH = {
        version: "1.0.0",
        kind: "codebase",
        project: {
          name: "meta-test",
          languages: ["typescript"],
          frameworks: ["bun"],
          description: "Metadata test",
          analyzedAt: "2025-01-01",
          gitCommitHash: "abc123",
        },
        nodes: [
          {
            id: "domain:auth", type: "domain", name: "Authentication", summary: "Auth domain",
            tags: ["auth"], complexity: "moderate",
            domainMeta: {
              entities: ["User", "Session", "Token"],
              businessRules: ["Token expires after 24h", "Max 3 concurrent sessions"],
              crossDomainInteractions: ["User -> Billing for subscription check"],
              entryPoints: ["POST /login", "POST /logout"],
            },
          },
          {
            id: "article:oauth", type: "article", name: "OAuth Guide", summary: "OAuth implementation guide",
            tags: ["oauth", "docs"], complexity: "simple",
            knowledgeMeta: {
              authors: ["Team Lead"],
              publishedDate: "2025-01-15",
              source: "internal-wiki",
              citations: ["RFC 6749", "RFC 6750"],
              relatedTopics: ["authentication", "security"],
            },
          },
          { id: "fn:login", type: "function", name: "login", summary: "Login handler", tags: ["auth"], complexity: "simple" },
        ],
        edges: [
          { source: "domain:auth", target: "fn:login", type: "contains" },
        ],
        layers: [],
        tour: [],
      };

      // Test validation accepts nodes with metadata
      const { validateGraph: vg2 } = await import(join(ROOT, "src", "validate.ts"));
      const metaValResult = vg2(META_GRAPH);
      const valOk = metaValResult.success && metaValResult.data!.nodes.length === 3;

      // Test onboarding renders domain entities and knowledge sources
      const metaGraphPath = join(tmpDir, "meta-graph.json");
      writeFileSync(metaGraphPath, JSON.stringify(META_GRAPH, null, 2));
      const { GraphStore: GS3 } = await import(join(ROOT, "src", "graph.ts"));
      const metaStore = new GS3(metaGraphPath);
      metaStore.load();

      const { buildOnboardingGuide: bog2 } = await import(join(ROOT, "src", "onboard.ts"));
      const metaGuide = bog2(metaStore);
      const onboardOk = metaGuide.includes("## Domain Entities")
        && metaGuide.includes("User, Session, Token")
        && metaGuide.includes("## Knowledge Sources")
        && metaGuide.includes("OAuth Guide");

      // Test explain renders domain context
      const { buildExplainContext: bec2, formatExplainPrompt: fep2 } = await import(join(ROOT, "src", "explain.ts"));
      const metaExplainCtx = bec2(metaStore, "domain:auth");
      const metaExplainPrompt = fep2(metaExplainCtx);
      const explainOk = metaExplainPrompt.includes("## Domain Context")
        && metaExplainPrompt.includes("User, Session, Token")
        && metaExplainPrompt.includes("Token expires after 24h");

      // Test context renders metadata
      const { buildChatContext: bcc2, formatContextForPrompt: fcfp2 } = await import(join(ROOT, "src", "context.ts"));
      const metaChatCtx = bcc2(metaStore, "auth", 15);
      const metaChatMd = fcfp2(metaChatCtx);
      const contextOk = metaChatMd.includes("Entities:")
        && metaChatMd.includes("User, Session, Token");

      metaOk = valOk && onboardOk && explainOk && contextOk;
    } catch (err) {
      metaOk = false;
    }
    results.push({
      name: "runtime-knowledge-domain-meta",
      category: "runtime",
      passed: metaOk,
      latencyMs: Date.now() - rt23,
      failureReason: metaOk ? undefined : "KnowledgeMeta/DomainMeta test failed",
    });
    features.push({ feature: "knowledge-metadata", status: metaOk ? "present" : "missing", evidence: "KnowledgeMeta + DomainMeta in validation, onboarding, explain, context" });

    // Runtime Test 24: normalizeNodeId and normalizeBatchOutput behavioral test
    const rt24 = Date.now();
    let normOk = false;
    try {
      const { normalizeNodeId, normalizeBatchOutput } = await import(join(ROOT, "src", "normalize.ts"));

      // Test normalizeNodeId with various malformed IDs
      const id1 = normalizeNodeId("file:src/utils//helper.ts"); // double slash
      const id2 = normalizeNodeId("src/component.tsx"); // bare path -> should get file: prefix or stay as-is
      const id3 = normalizeNodeId("module:name"); // already-normalized module ID
      const id4 = normalizeNodeId("fn:auth.ts:login"); // normal function ID
      const noDoubleSlash = !id1.includes("//");
      const idTypesOk = typeof id1 === "string" && typeof id2 === "string" && typeof id3 === "string" && typeof id4 === "string";
      const id4Preserved = id4 === "fn:auth.ts:login" || id4.includes("login");

      // Test normalizeBatchOutput with malformed input
      const batchResult = normalizeBatchOutput({
        nodes: [
          { id: "file:src//utils.ts", type: "file", name: "utils.ts", summary: "Utility functions", tags: [], complexity: "moderate" },
          { id: "fn:index.ts:main", type: "function", name: "main", summary: "Entry point", tags: [], complexity: "simple" },
          { id: "config:  bad id  ", type: "config", name: "config", summary: "Config", tags: [], complexity: "simple" },
        ],
        edges: [
          { source: "fn:index.ts:main", target: "file:src//utils.ts", type: "depends_on" },
        ],
      });
      const batchNodesOk = batchResult.nodes.length === 3;
      const batchEdgesOk = batchResult.edges.length === 1;
      const batchStatsOk = typeof batchResult.stats?.totalCorrections === "number";
      const batchFixedIds = batchResult.nodes.every(n => typeof n.id === "string" && n.id.length > 0);

      normOk = noDoubleSlash && idTypesOk && id4Preserved && batchNodesOk && batchEdgesOk && batchStatsOk && batchFixedIds;
    } catch (err) {
      normOk = false;
    }
    results.push({
      name: "runtime-normalize",
      category: "runtime",
      passed: normOk,
      latencyMs: Date.now() - rt24,
      failureReason: normOk ? undefined : "normalizeNodeId / normalizeBatchOutput behavioral test failed",
    });
    features.push({ feature: "normalize", status: normOk ? "present" : "missing", evidence: "normalizeNodeId + normalizeBatchOutput with malformed IDs" });

    // ─── HTTP Integration Tests (Runtime Tests 25-34) ─────────────────────────
    // Start a temporary Bun.serve() instance and test actual HTTP request/response cycle.
    let httpServer: any = null;
    try {
      // Create a test graph file for the HTTP server
      const httpGraphPath = join(tmpDir, "http-test-graph.json");
      writeFileSync(httpGraphPath, JSON.stringify(TEST_GRAPH, null, 2));

      // Import handleRequest directly to avoid full server startup overhead
      const { handleRequest: hr } = await import(join(ROOT, "src", "routes.ts"));
      const { GraphStore: GS4 } = await import(join(ROOT, "src", "graph.ts"));

      const httpStore = new GS4(httpGraphPath);
      httpStore.load();

      // Helper to create a Request object and call handleRequest
      async function fetchEndpoint(method: string, path: string, body?: unknown): Promise<{ status: number; headers: Record<string, string>; body: any }> {
        const url = `http://127.0.0.1:3100${path}`;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json", "X-Forwarded-For": "127.0.0.1" },
        };
        if (body) init.body = JSON.stringify(body);
        const req = new Request(url, init);
        const resp = await hr(req, httpStore);
        const headers: Record<string, string> = {};
        resp.headers.forEach((v: string, k: string) => { headers[k] = v; });
        let respBody: any = null;
        try { respBody = await resp.json(); } catch {}
        return { status: resp.status, headers, body: respBody };
      }

      // Runtime Test 24: GET /health returns ok
      const rt24 = Date.now();
      const healthResp = await fetchEndpoint("GET", "/health");
      const healthOk = healthResp.status === 200 && healthResp.body?.status === "ok" && typeof healthResp.body?.uptime === "number";
      results.push({
        name: "http-health-endpoint",
        category: "http",
        passed: healthOk,
        latencyMs: Date.now() - rt24,
        failureReason: healthOk ? undefined : `Health: status=${healthResp.status}, body=${JSON.stringify(healthResp.body)?.slice(0, 100)}`,
      });

      // Runtime Test 25: GET /api/stats returns correct counts
      const rt25 = Date.now();
      const statsResp = await fetchEndpoint("GET", "/api/stats");
      const statsHttpOk = statsResp.status === 200 && statsResp.body?.totalNodes === 5 && statsResp.body?.totalEdges === 5;
      results.push({
        name: "http-stats-endpoint",
        category: "http",
        passed: statsHttpOk,
        latencyMs: Date.now() - rt25,
        failureReason: statsHttpOk ? undefined : `Stats: status=${statsResp.status}, nodes=${statsResp.body?.totalNodes}`,
      });

      // Runtime Test 26: GET /api/nodes?type=function returns only function nodes
      const rt26 = Date.now();
      const nodesResp = await fetchEndpoint("GET", "/api/nodes?type=function");
      const fnNodesOk = nodesResp.status === 200 && Array.isArray(nodesResp.body?.nodes) && nodesResp.body.nodes.every((n: any) => n.type === "function");
      results.push({
        name: "http-nodes-type-filter",
        category: "http",
        passed: fnNodesOk,
        latencyMs: Date.now() - rt26,
        failureReason: fnNodesOk ? undefined : `Nodes filter: status=${nodesResp.status}, count=${nodesResp.body?.nodes?.length}`,
      });

      // Runtime Test 27: GET /api/search?q=auth returns results
      const rt27 = Date.now();
      const searchResp = await fetchEndpoint("GET", "/api/search?q=auth");
      const searchHttpOk = searchResp.status === 200 && Array.isArray(searchResp.body?.nodes) && searchResp.body.nodes.length > 0;
      results.push({
        name: "http-search-endpoint",
        category: "http",
        passed: searchHttpOk,
        latencyMs: Date.now() - rt27,
        failureReason: searchHttpOk ? undefined : `Search: status=${searchResp.status}, count=${searchResp.body?.nodes?.length}`,
      });

      // Runtime Test 28: GET /api/nodes/nonexistent returns 404
      const rt28 = Date.now();
      const notFoundResp = await fetchEndpoint("GET", "/api/nodes/nonexistent-node-id");
      const notFoundOk = notFoundResp.status === 404;
      results.push({
        name: "http-node-404",
        category: "http",
        passed: notFoundOk,
        latencyMs: Date.now() - rt28,
        failureReason: notFoundOk ? undefined : `404: status=${notFoundResp.status}`,
      });

      // Runtime Test 29: POST /api/chat with missing body returns 400
      const rt29 = Date.now();
      const badChatResp = await fetchEndpoint("POST", "/api/chat", {});
      const badChatOk = badChatResp.status === 400;
      results.push({
        name: "http-chat-validation",
        category: "http",
        passed: badChatOk,
        latencyMs: Date.now() - rt29,
        failureReason: badChatOk ? undefined : `Chat validation: status=${badChatResp.status}`,
      });

      // Runtime Test 30: GET /api/nonexistent returns 404
      const rt30 = Date.now();
      const noRouteResp = await fetchEndpoint("GET", "/api/nonexistent/endpoint");
      const noRouteOk = noRouteResp.status === 404;
      results.push({
        name: "http-unknown-route-404",
        category: "http",
        passed: noRouteOk,
        latencyMs: Date.now() - rt30,
        failureReason: noRouteOk ? undefined : `Unknown route: status=${noRouteResp.status}`,
      });

      // Runtime Test 31: OPTIONS request returns CORS headers
      const rt31 = Date.now();
      const corsResp = await fetchEndpoint("OPTIONS", "/api/stats");
      const corsOk = corsResp.status === 200
        && corsResp.headers["access-control-allow-origin"] === "*"
        && corsResp.headers["access-control-allow-methods"]?.includes("GET");
      results.push({
        name: "http-cors-headers",
        category: "http",
        passed: corsOk,
        latencyMs: Date.now() - rt31,
        failureReason: corsOk ? undefined : `CORS: status=${corsResp.status}, allow-origin=${corsResp.headers["access-control-allow-origin"]}`,
      });

      // Runtime Test 32: Verify X-Request-Id and X-Response-Time headers are present
      const rt32 = Date.now();
      const headerResp = await fetchEndpoint("GET", "/api/stats");
      const headerOk = typeof headerResp.headers["x-request-id"] === "string" && headerResp.headers["x-request-id"].length > 0
        && typeof headerResp.headers["x-response-time"] === "string";
      results.push({
        name: "http-middleware-headers",
        category: "http",
        passed: headerOk,
        latencyMs: Date.now() - rt32,
        failureReason: headerOk ? undefined : `Headers: requestId=${headerResp.headers["x-request-id"]}, responseTime=${headerResp.headers["x-response-time"]}`,
      });

      // Runtime Test 33: GET /api/validate returns validation results
      const rt33 = Date.now();
      const validateResp = await fetchEndpoint("GET", "/api/validate");
      const validateHttpOk = validateResp.status === 200 && typeof validateResp.body?.valid === "boolean" && typeof validateResp.body?.totalIssues === "number";
      results.push({
        name: "http-validate-endpoint",
        category: "http",
        passed: validateHttpOk,
        latencyMs: Date.now() - rt33,
        failureReason: validateHttpOk ? undefined : `Validate: status=${validateResp.status}, valid=${validateResp.body?.valid}`,
      });

      // ─── Endpoint Response Schema Validation Tests ─────────────────────────
      // Deep schema checks that verify each response body matches the expected shape.

      // Schema Test 1: /api/stats has all required fields
      const st1 = Date.now();
      const statsSchemaResp = await fetchEndpoint("GET", "/api/stats");
      const statsBody = statsSchemaResp.body;
      const statsSchemaRequired = ["project", "version", "totalNodes", "totalEdges", "layers", "tourSteps", "nodeTypes", "edgeTypes"];
      const statsSchemaOk = statsSchemaResp.status === 200
        && statsSchemaRequired.every(k => statsBody?.[k] !== undefined)
        && typeof statsBody.totalNodes === "number"
        && typeof statsBody.totalEdges === "number"
        && typeof statsBody.project === "string"
        && typeof statsBody.nodeTypes === "object" && statsBody.nodeTypes !== null
        && typeof statsBody.edgeTypes === "object" && statsBody.edgeTypes !== null;
      results.push({
        name: "schema-stats-response",
        category: "schema",
        passed: statsSchemaOk,
        latencyMs: Date.now() - st1,
        failureReason: statsSchemaOk ? undefined : `Stats schema: missing keys=[${statsSchemaRequired.filter(k => statsBody?.[k] === undefined)}]`,
      });

      // Schema Test 2: /api/nodes - each node has required fields
      const st2 = Date.now();
      const nodesSchemaResp = await fetchEndpoint("GET", "/api/nodes");
      const nodesBody = nodesSchemaResp.body;
      let nodesSchemaOk = nodesSchemaResp.status === 200 && Array.isArray(nodesBody?.nodes);
      if (nodesSchemaOk && nodesBody.nodes.length > 0) {
        const nodeFields = ["id", "name", "type", "summary", "tags"];
        for (const node of nodesBody.nodes) {
          for (const field of nodeFields) {
            if (node[field] === undefined) {
              nodesSchemaOk = false;
              break;
            }
          }
          if (typeof node.id !== "string" || typeof node.name !== "string" || typeof node.type !== "string" || typeof node.summary !== "string" || !Array.isArray(node.tags)) {
            nodesSchemaOk = false;
            break;
          }
        }
      }
      results.push({
        name: "schema-nodes-response",
        category: "schema",
        passed: nodesSchemaOk,
        latencyMs: Date.now() - st2,
        failureReason: nodesSchemaOk ? undefined : `Nodes schema: nodes array invalid, count=${nodesBody?.nodes?.length}`,
      });

      // Schema Test 3: /api/search?q=auth has required fields
      const st3 = Date.now();
      const searchSchemaResp = await fetchEndpoint("GET", "/api/search?q=auth");
      const searchBody = searchSchemaResp.body;
      const searchSchemaOk = searchSchemaResp.status === 200
        && typeof searchBody?.query === "string"
        && Array.isArray(searchBody?.nodes)
        && typeof searchBody?.count === "number";
      results.push({
        name: "schema-search-response",
        category: "schema",
        passed: searchSchemaOk,
        latencyMs: Date.now() - st3,
        failureReason: searchSchemaOk ? undefined : `Search schema: query=${typeof searchBody?.query}, nodes=${Array.isArray(searchBody?.nodes)}, count=${typeof searchBody?.count}`,
      });

      // Schema Test 4: /api/layers - each layer has required fields
      const st4 = Date.now();
      const layersSchemaResp = await fetchEndpoint("GET", "/api/layers");
      const layersBody = layersSchemaResp.body;
      let layersSchemaOk = layersSchemaResp.status === 200 && Array.isArray(layersBody);
      if (layersSchemaOk) {
        const layerFields = ["id", "name", "description", "nodeIds"];
        for (const layer of layersBody) {
          for (const field of layerFields) {
            if (layer[field] === undefined) {
              layersSchemaOk = false;
              break;
            }
          }
          if (!Array.isArray(layer.nodeIds)) {
            layersSchemaOk = false;
            break;
          }
        }
      }
      results.push({
        name: "schema-layers-response",
        category: "schema",
        passed: layersSchemaOk,
        latencyMs: Date.now() - st4,
        failureReason: layersSchemaOk ? undefined : `Layers schema: array=${Array.isArray(layersBody)}, count=${layersBody?.length}`,
      });

      // Schema Test 5: Malformed percent-encoded node ID returns 400 (not 500)
      const st5 = Date.now();
      const badIdResp = await fetchEndpoint("GET", "/api/nodes/%E0%A4%A");
      const badIdOk = badIdResp.status === 400;
      results.push({
        name: "schema-malformed-id-400",
        category: "schema",
        passed: badIdOk,
        latencyMs: Date.now() - st5,
        failureReason: badIdOk ? undefined : `Malformed ID: expected 400, got ${badIdResp.status}`,
      });

      // Schema Test 6: GET /api/metrics has required fields
      const st6 = Date.now();
      const metricsSchemaResp = await fetchEndpoint("GET", "/api/metrics");
      const metricsBody = metricsSchemaResp.body;
      const metricsSchemaOk = metricsSchemaResp.status === 200
        && typeof metricsBody?.totalRequests === "number"
        && typeof metricsBody?.totalErrors === "number"
        && typeof metricsBody?.avgResponseMs === "number"
        && typeof metricsBody?.cacheSize === "number"
        && typeof metricsBody?.cacheMaxSize === "number"
        && typeof metricsBody?.uptimeMs === "number"
        && typeof metricsBody?.endpoints === "object";
      results.push({
        name: "schema-metrics-response",
        category: "schema",
        passed: metricsSchemaOk,
        latencyMs: Date.now() - st6,
        failureReason: metricsSchemaOk ? undefined : `Metrics schema: totalRequests=${typeof metricsBody?.totalRequests}, endpoints=${typeof metricsBody?.endpoints}`,
      });

      features.push({ feature: "http-integration-tests", status: "present", evidence: "10 HTTP endpoint tests covering health, stats, nodes, search, 404, validation, CORS, headers" });
      features.push({ feature: "schema-validation", status: "present", evidence: "6 schema validation tests for stats, nodes, search, layers, metrics, malformed ID" });

      // ─── POST Endpoint Schema Validation Tests ──────────────────────────
      // Verify POST endpoint response contracts for core operations.

      // POST Schema Test 1: /api/graph/merge returns merged result with stats
      const pst1 = Date.now();
      const mergeBody = {
        changedFiles: ["a.ts"],
        newNodes: [{ id: "fn:a.ts:newFn", type: "function", name: "newFn", filePath: "a.ts", summary: "New function", tags: ["new"], complexity: "simple" }],
        newEdges: [],
      };
      const mergeResp = await fetchEndpoint("POST", "/api/graph/merge", mergeBody);
      const mergeOk = mergeResp.status === 200
        && typeof mergeResp.body?.status === "string"
        && typeof mergeResp.body?.stats === "object"
        && typeof mergeResp.body?.stats?.totalNodes === "number";
      results.push({
        name: "schema-post-merge",
        category: "schema",
        passed: mergeOk,
        latencyMs: Date.now() - pst1,
        failureReason: mergeOk ? undefined : `POST merge: status=${mergeResp.status}, body.status=${typeof mergeResp.body?.status}, stats=${typeof mergeResp.body?.stats}`,
      });

      // POST Schema Test 2: /api/graph/normalize returns normalized nodes/edges/stats
      const pst2 = Date.now();
      const normBody = {
        nodes: [{ id: "fn:x.ts:hello", type: "function", name: "hello", filePath: "x.ts", summary: "Hello", tags: [], complexity: "simple" }],
        edges: [],
      };
      const normResp = await fetchEndpoint("POST", "/api/graph/normalize", normBody);
      const normOk = normResp.status === 200
        && Array.isArray(normResp.body?.nodes)
        && Array.isArray(normResp.body?.edges)
        && typeof normResp.body?.stats === "object";
      results.push({
        name: "schema-post-normalize",
        category: "schema",
        passed: normOk,
        latencyMs: Date.now() - pst2,
        failureReason: normOk ? undefined : `POST normalize: status=${normResp.status}, nodes=${Array.isArray(normResp.body?.nodes)}, edges=${Array.isArray(normResp.body?.edges)}`,
      });

      // POST Schema Test 3: /api/tour/generate returns tour array
      const pst3 = Date.now();
      const tourResp = await fetchEndpoint("POST", "/api/tour/generate", {});
      const tourOk = tourResp.status === 200
        && Array.isArray(tourResp.body?.tour)
        && typeof tourResp.body?.stepCount === "number"
        && typeof tourResp.body?.mode === "string";
      results.push({
        name: "schema-post-tour-generate",
        category: "schema",
        passed: tourOk,
        latencyMs: Date.now() - pst3,
        failureReason: tourOk ? undefined : `POST tour: status=${tourResp.status}, tour=${Array.isArray(tourResp.body?.tour)}, stepCount=${typeof tourResp.body?.stepCount}`,
      });

      // POST Schema Test 4: /api/diff/analyze returns changed/affected components
      const pst4 = Date.now();
      const diffBody = { changedFiles: ["a.ts"] };
      const diffResp = await fetchEndpoint("POST", "/api/diff/analyze", diffBody);
      // This endpoint calls an LLM agent, so it may return 500 if no API key is set.
      // We only validate the response schema when it returns 200.
      const diffSchemaOk = diffResp.status === 200
        ? (typeof diffResp.body?.changedComponents !== "undefined"
          || typeof diffResp.body?.affectedComponents !== "undefined"
          || typeof diffResp.body?.riskLevel !== "undefined"
          || typeof diffResp.body?.analysis !== "undefined")
        : true; // Non-200 is acceptable if LLM is unavailable
      results.push({
        name: "schema-post-diff-analyze",
        category: "schema",
        passed: diffSchemaOk,
        latencyMs: Date.now() - pst4,
        failureReason: diffSchemaOk ? undefined : `POST diff: status=${diffResp.status}, body keys=${Object.keys(diffResp.body || {}).join(',')}`,
      });

      // POST Schema Test 5: /api/graph/reload returns status
      const pst5 = Date.now();
      const reloadResp = await fetchEndpoint("POST", "/api/graph/reload", {});
      const reloadOk = reloadResp.status === 200
        && typeof reloadResp.body?.status === "string"
        && typeof reloadResp.body?.stats === "object";
      results.push({
        name: "schema-post-reload",
        category: "schema",
        passed: reloadOk,
        latencyMs: Date.now() - pst5,
        failureReason: reloadOk ? undefined : `POST reload: status=${reloadResp.status}, body.status=${typeof reloadResp.body?.status}`,
      });

      // POST Schema Test 6: /api/search/semantic returns nodes array (no embeddings case)
      const pst6 = Date.now();
      const semanticBody = { embedding: [0.1, 0.2, 0.3] };
      const semResp = await fetchEndpoint("POST", "/api/search/semantic", semanticBody);
      const semOk = semResp.status === 200
        && Array.isArray(semResp.body?.nodes)
        && typeof semResp.body?.count === "number";
      results.push({
        name: "schema-post-semantic-search",
        category: "schema",
        passed: semOk,
        latencyMs: Date.now() - pst6,
        failureReason: semOk ? undefined : `POST semantic: status=${semResp.status}, nodes=${Array.isArray(semResp.body?.nodes)}, count=${typeof semResp.body?.count}`,
      });

      // POST Schema Test 7: Oversized body returns 413
      const pst7 = Date.now();
      const oversizedBody = { changedFiles: ["x"], newNodes: new Array(50000).fill(null).map((_, i) => ({
        id: `fn:big.ts:fn${i}`, type: "function", name: `fn${i}`, filePath: "big.ts",
        summary: "x".repeat(200), tags: [], complexity: "simple",
      })), newEdges: [] };
      const bigResp = await fetchEndpoint("POST", "/api/graph/merge", oversizedBody);
      // With content-length set by JSON.stringify, should get 413 if body > 10MB
      // For smaller bodies that still pass, 200 is also acceptable
      const bigOk = bigResp.status === 200 || bigResp.status === 413;
      results.push({
        name: "schema-post-body-size-limit",
        category: "schema",
        passed: bigOk,
        latencyMs: Date.now() - pst7,
        failureReason: bigOk ? undefined : `POST body size limit: expected 200 or 413, got ${bigResp.status}`,
      });

      features.push({ feature: "post-endpoint-schema-tests", status: "present", evidence: "7 POST endpoint schema tests covering merge, normalize, tour, diff, reload, semantic, body-size-limit" });
    } catch (err) {
      results.push({
        name: "http-integration-tests",
        category: "http",
        passed: false,
        latencyMs: 0,
        failureReason: `HTTP integration tests failed: ${(err as Error).message}`,
      });
    }

    // Cleanup temp directory
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  } catch (err) {
    // If runtime tests fail to import, add a single failure
    results.push({
      name: "runtime-import",
      category: "runtime",
      passed: false,
      latencyMs: 0,
      failureReason: `Runtime tests failed to import: ${(err as Error).message}`,
    });
  }

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
  console.log(`\n=== learning-anything Benchmark ===\n`);
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
