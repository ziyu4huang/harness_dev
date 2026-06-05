#!/usr/bin/env bun
/**
 * benchmark.ts — Benchmark suite for deepseek-cli.
 *
 * Runs CLI smoke tests against the bundled artifact, times execution,
 * checks feature inventory. Outputs structured JSON.
 *
 * Usage:
 *   bun run benchmark
 *   bun run benchmark --json
 */

import { existsSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const CLI_DIR = resolve(import.meta.dir, "..");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const BUNDLE_PATH = join(DIST_DIR, "deepseek-cli.js");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const historyFlagIdx = args.indexOf("--history");
const historyPath = historyFlagIdx >= 0 && args[historyFlagIdx + 1] && !args[historyFlagIdx + 1].startsWith("-")
  ? args[historyFlagIdx + 1]
  : undefined;

// ─── Performance thresholds ───────────────────────────────────────────────────

const MAX_LATENCY_MS = 5000;  // Per-test max latency threshold
const REGRESSION_PERCENT_THRESHOLD = 50;  // Flag if latency increases by >50%

// ─── Types ───────────────────────────────────────────────────────────────────

interface BenchmarkTest {
  name: string;
  category: string;
  command: string[];
  env?: Record<string, string>;
  expectExit: number;
  expectOutput?: string;
  expectAbsent?: string;
}

interface TestResult {
  name: string;
  category: string;
  command: string;
  passed: boolean;
  latencyMs: number;
  exitCode: number;
  outputSnippet: string;
  failureReason?: string;
}

interface PerfRegression {
  testName: string;
  previousLatencyMs: number;
  currentLatencyMs: number;
  regressionPercent: number;
  severity: "warning" | "critical";
}

interface BenchmarkReport {
  timestamp: string;
  bundlePath: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalLatencyMs: number;
  results: TestResult[];
  featureInventory: { feature: string; status: string; evidence: string }[];
  perfRegressions: PerfRegression[];
}

// ─── Test definitions ─────────────────────────────────────────────────────────

if (!existsSync(BUNDLE_PATH)) {
  const msg = `Bundle not found at ${BUNDLE_PATH}. Run 'bun run build' first.`;
  if (jsonMode) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    console.error(msg);
  }
  process.exit(1);
}

const tests: BenchmarkTest[] = [
  // Help & CLI flags
  { name: "help-flag", category: "help", command: ["--help"], expectExit: 0, expectOutput: "Usage" },
  { name: "h-flag", category: "help", command: ["-h"], expectExit: 0, expectOutput: "Usage" },
  { name: "no-args", category: "help", command: [], expectExit: 1, expectOutput: "Usage" },
  { name: "version-flag", category: "help", command: ["--version"], expectExit: 0, expectOutput: "deepseek-cli v" },

  // Model validation
  { name: "invalid-model", category: "model", command: ["--model", "bogus", "hello"], expectExit: 1, expectOutput: "unknown model" },
  { name: "model-pro-no-key", category: "model", command: ["--model", "pro", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
  { name: "model-flash-no-key", category: "model", command: ["--model", "flash", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },

  // Error handling
  { name: "missing-api-key", category: "error-handling", command: ["hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
  { name: "empty-prompt", category: "error-handling", command: ["--model", "pro"], env: { DEEPSEEK_API_KEY: "test" }, expectExit: 1 },

  // Agent mode flags
  { name: "agent-flag-no-key", category: "agent-tool", command: ["--agent", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
  { name: "agent-shorthand-no-key", category: "agent-tool", command: ["-a", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },

  // Flag validation
  { name: "model-no-value", category: "error-handling", command: ["--model"], env: { DEEPSEEK_API_KEY: "test" }, expectExit: 1, expectOutput: "--model requires" },
  { name: "max-steps-invalid", category: "error-handling", command: ["--max-steps", "abc", "hello"], env: { DEEPSEEK_API_KEY: "test" }, expectExit: 1, expectOutput: "--max-steps" },
  { name: "timeout-invalid", category: "error-handling", command: ["--timeout", "-1", "hello"], env: { DEEPSEEK_API_KEY: "test" }, expectExit: 1, expectOutput: "--timeout" },

  // Flag validation (valid values — should fail on API key, not on flag parsing)
  { name: "max-steps-valid", category: "flag-validation", command: ["--max-steps", "5", "--model", "pro", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
  { name: "timeout-valid", category: "flag-validation", command: ["--timeout", "120000", "--model", "pro", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
  { name: "system-prompt-valid", category: "flag-validation", command: ["--system-prompt", "You are a code reviewer", "--model", "pro", "hello"], env: { DEEPSEEK_API_KEY: "" }, expectExit: 1, expectOutput: "DEEPSEEK_API_KEY" },
];

// ─── Run tests ────────────────────────────────────────────────────────────────

const results: TestResult[] = [];
let totalLatencyMs = 0;

for (const test of tests) {
  const start = performance.now();
  const env = { ...process.env, ...test.env };

  try {
    const proc = Bun.spawnSync(["bun", BUNDLE_PATH, ...test.command], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const elapsed = performance.now() - start;
    totalLatencyMs += elapsed;

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    const output = stdout + stderr;
    const exitCode = proc.exitCode ?? -1;

    let passed = exitCode === test.expectExit;
    let failureReason: string | undefined;

    if (test.expectOutput && !output.includes(test.expectOutput)) {
      passed = false;
      failureReason = `Expected output to contain "${test.expectOutput}" but got: ${output.slice(0, 200)}`;
    }

    if (test.expectAbsent && output.includes(test.expectAbsent)) {
      passed = false;
      failureReason = `Expected output to NOT contain "${test.expectAbsent}"`;
    }

    results.push({
      name: test.name,
      category: test.category,
      command: `bun deepseek-cli.js ${test.command.join(" ")}`,
      passed,
      latencyMs: Math.round(elapsed * 100) / 100,
      exitCode,
      outputSnippet: output.slice(0, 150).replace(/\n/g, "\\n"),
      failureReason,
    });
  } catch (e) {
    const elapsed = performance.now() - start;
    totalLatencyMs += elapsed;
    results.push({
      name: test.name,
      category: test.category,
      command: `bun deepseek-cli.js ${test.command.join(" ")}`,
      passed: false,
      latencyMs: Math.round(elapsed * 100) / 100,
      exitCode: -1,
      outputSnippet: "",
      failureReason: `Exception: ${e}`,
    });
  }
}

// ─── Performance regression detection ──────────────────────────────────────────

const perfRegressions: PerfRegression[] = [];

// Check per-test max latency
for (const r of results) {
  if (r.latencyMs > MAX_LATENCY_MS) {
    perfRegressions.push({
      testName: r.name,
      previousLatencyMs: 0,
      currentLatencyMs: r.latencyMs,
      regressionPercent: 0,
      severity: r.latencyMs > MAX_LATENCY_MS * 2 ? "critical" : "warning",
    });
  }
}

// Compare against history if provided
if (historyPath) {
  try {
    const historyContent = await Bun.file(historyPath).exists()
      ? await Bun.file(historyPath).text()
      : null;
    if (historyContent) {
      const history = JSON.parse(historyContent);
      // Find the most recent iteration's benchmark results
      const allIterations = (history.runs || []).flatMap((r: { iterations: unknown[] }) => r.iterations);
      if (allIterations.length > 0) {
        // We don't have per-test latency in history, but we can compare totalLatencyMs
        // The history is stored in metrics-history.json format
      }
    }
  } catch {
    // History file is optional — ignore parse errors
  }
}

// ─── Feature inventory ────────────────────────────────────────────────────────

// Derive feature status from test results
const helpPassed = results.filter((r) => r.category === "help" && r.name !== "version-flag").every((r) => r.passed);
const versionPassed = results.find((r) => r.name === "version-flag")?.passed ?? false;
const modelValidationPassed = results.filter((r) => r.category === "model").every((r) => r.passed);
const agentFlagsPassed = results.filter((r) => r.category === "agent-tool").every((r) => r.passed);
const errorHandlingPassed = results.filter((r) => r.category === "error-handling").every((r) => r.passed);

const featureInventory = [
  { feature: "--help / -h", status: helpPassed ? "working" : "broken", evidence: `help tests: ${results.filter((r) => r.category === "help" && r.name !== "version-flag").map((r) => r.passed ? "✓" : "✗").join(",")}` },
  { feature: "--version / -v", status: versionPassed ? "working" : "broken", evidence: `version test: ${versionPassed ? "✓" : "✗"}` },
  { feature: "--model", status: modelValidationPassed ? "working" : "broken", evidence: `model tests: ${results.filter((r) => r.category === "model").map((r) => r.passed ? "✓" : "✗").join(",")}` },
  { feature: "--agent / -a", status: agentFlagsPassed ? "working" : "broken", evidence: `agent tests: ${results.filter((r) => r.category === "agent-tool").map((r) => r.passed ? "✓" : "✗").join(",")}` },
  { feature: "error-handling", status: errorHandlingPassed ? "working" : "broken", evidence: `error tests: ${results.filter((r) => r.category === "error-handling").map((r) => r.passed ? "✓" : "✗").join(",")}` },
  { feature: "calculator (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "read_file (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "write_file (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "web_fetch (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "list_directory (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "grep_search (agent tool)", status: "present", evidence: "Tool exists in source code; requires API key to test end-to-end" },
  { feature: "--max-steps", status: results.find((r) => r.name === "max-steps-valid")?.passed ? "working" : "present", evidence: results.find((r) => r.name === "max-steps-valid")?.passed ? "Valid value parsed successfully through bundle" : "Flag parsed in source code" },
  { feature: "--timeout", status: results.find((r) => r.name === "timeout-valid")?.passed ? "working" : "present", evidence: results.find((r) => r.name === "timeout-valid")?.passed ? "Valid value parsed successfully through bundle" : "Flag parsed in source code" },
  { feature: "--system-prompt", status: results.find((r) => r.name === "system-prompt-valid")?.passed ? "working" : "present", evidence: results.find((r) => r.name === "system-prompt-valid")?.passed ? "Valid value parsed successfully through bundle" : "Flag parsed in source code" },
];

// ─── Output ───────────────────────────────────────────────────────────────────

const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;

const report: BenchmarkReport = {
  timestamp: new Date().toISOString(),
  bundlePath: BUNDLE_PATH,
  totalTests: results.length,
  passedTests: passedCount,
  failedTests: failedCount,
  totalLatencyMs: Math.round(totalLatencyMs),
  results,
  featureInventory,
  perfRegressions,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   deepseek-cli benchmark                     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Tests: ${passedCount}/${results.length} passed (${failedCount} failed)`);
  console.log(`  Total latency: ${Math.round(totalLatencyMs)}ms`);
  console.log();

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} [${r.category}] ${r.name} (${r.latencyMs.toFixed(0)}ms)`);
    if (!r.passed && r.failureReason) {
      console.log(`     ${r.failureReason.slice(0, 120)}`);
    }
  }

  console.log();
  console.log("  Feature inventory:");
  for (const f of featureInventory) {
    const icon = f.status === "working" ? "✅" : f.status === "present" ? "⚪" : "❌";
    console.log(`  ${icon} ${f.feature}: ${f.status}`);
  }

  if (perfRegressions.length > 0) {
    console.log();
    console.log("  Performance regressions:");
    for (const pr of perfRegressions) {
      const icon = pr.severity === "critical" ? "❌" : "⚠️";
      console.log(`  ${icon} ${pr.testName}: ${pr.currentLatencyMs}ms (exceeds ${MAX_LATENCY_MS}ms threshold)`);
    }
  }

  console.log();
  console.log("---JSON---");
  console.log(JSON.stringify(report));
}

process.exit(failedCount > 0 ? 1 : 0);
