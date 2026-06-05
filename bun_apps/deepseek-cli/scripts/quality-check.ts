#!/usr/bin/env bun
/**
 * quality-check.ts — Self-check script for deepseek-cli.
 *
 * Validates build artifacts, test results, and known failure modes.
 * Exit 0 = all gates pass, exit 1 = one or more gates failed.
 *
 * Usage:
 *   bun run quality-check
 *   bun run quality-check --json        # machine-readable output
 *   bun run quality-check --strict      # fail on warnings too
 *
 * Known failure modes encoded here (from past incidents):
 *   1. Bun --outfile resolves relative to ENTRY FILE, not CWD
 *      → build writes to bun_apps/deepseek-cli/src/ instead of dist/
 *   2. dist/ directory deleted or never created
 *   3. Bundle missing after workflow run
 *   4. Misplaced build artifacts in wrong directories
 */

import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, resolve, relative } from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const CLI_DIR = resolve(import.meta.dir, "..");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const BUNDLE_NAME = "deepseek-cli.js";
const BUNDLE_MAP_NAME = "deepseek-cli.js.map";
const BUNDLE_PATH = join(DIST_DIR, BUNDLE_NAME);
const BUNDLE_MAP_PATH = join(DIST_DIR, BUNDLE_MAP_NAME);

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const strictMode = args.includes("--strict");

// ─── Types ───────────────────────────────────────────────────────────────────

interface GateResult {
  gate: string;
  passed: boolean;
  severity: "critical" | "warning";
  message: string;
  detail?: string;
}

interface QualityReport {
  timestamp: string;
  overallPassed: boolean;
  score: number;
  gates: GateResult[];
  bundlePath: string;
  bundleSizeKB: number;
  sourceMapExists: boolean;
  misplacedArtifacts: string[];
  testResults: { passed: number; failed: number; total: number } | null;
}

// ─── Gate checks ─────────────────────────────────────────────────────────────

const gates: GateResult[] = [];
let bundleSizeKB = 0;
let misplacedArtifacts: string[] = [];
let testResults: { passed: number; failed: number; total: number } | null = null;

// Gate 1: dist/ directory exists
if (existsSync(DIST_DIR)) {
  gates.push({ gate: "dist-dir-exists", passed: true, severity: "critical", message: "dist/ directory exists" });
} else {
  gates.push({ gate: "dist-dir-exists", passed: false, severity: "critical", message: "dist/ directory is missing" });
}

// Gate 2: Bundle exists in correct location
if (existsSync(BUNDLE_PATH)) {
  const stat = statSync(BUNDLE_PATH);
  bundleSizeKB = Math.round((stat.size / 1024) * 100) / 100;
  if (stat.size > 0) {
    gates.push({
      gate: "bundle-exists",
      passed: true,
      severity: "critical",
      message: `Bundle exists at dist/${BUNDLE_NAME} (${bundleSizeKB} KB)`,
      detail: BUNDLE_PATH,
    });
  } else {
    gates.push({ gate: "bundle-exists", passed: false, severity: "critical", message: `Bundle exists but is empty (0 bytes)` });
  }
} else {
  gates.push({
    gate: "bundle-exists",
    passed: false,
    severity: "critical",
    message: `Bundle missing: dist/${BUNDLE_NAME}`,
    detail: `Expected at ${BUNDLE_PATH}`,
  });
}

// Gate 3: Source map exists
if (existsSync(BUNDLE_MAP_PATH)) {
  gates.push({ gate: "sourcemap-exists", passed: true, severity: "warning", message: `Source map exists at dist/${BUNDLE_MAP_NAME}` });
} else {
  gates.push({ gate: "sourcemap-exists", passed: false, severity: "warning", message: `Source map missing: dist/${BUNDLE_MAP_NAME}` });
}

// Gate 4: Shebang in bundle
if (existsSync(BUNDLE_PATH)) {
  try {
    const firstLine = readFileSync(BUNDLE_PATH, "utf8").split("\n")[0];
    if (firstLine.startsWith("#!")) {
      gates.push({ gate: "bundle-shebang", passed: true, severity: "warning", message: `Bundle has shebang: ${firstLine.trim()}` });
    } else {
      gates.push({ gate: "bundle-shebang", passed: false, severity: "warning", message: `Bundle missing shebang (first line: "${firstLine.slice(0, 40)}...")` });
    }
  } catch {
    gates.push({ gate: "bundle-shebang", passed: false, severity: "warning", message: "Could not read bundle for shebang check" });
  }
}

// Gate 5: NO misplaced artifacts — check known wrong locations
const WRONG_LOCATIONS = [
  join(CLI_DIR, "src", BUNDLE_NAME),
  join(CLI_DIR, "src", BUNDLE_MAP_NAME),
  join(CLI_DIR, BUNDLE_NAME),
  join(CLI_DIR, BUNDLE_MAP_NAME),
  join(PROJECT_ROOT, BUNDLE_NAME),
];

for (const wrongPath of WRONG_LOCATIONS) {
  if (existsSync(wrongPath)) {
    const rel = relative(PROJECT_ROOT, wrongPath);
    misplacedArtifacts.push(rel);
    gates.push({
      gate: "no-misplaced-artifacts",
      passed: false,
      severity: "critical",
      message: `Misplaced build artifact: ${rel}`,
      detail: "This is a known issue caused by bun --outfile resolving relative to entry file, not CWD. Use 'cd bun_apps/deepseek-cli && bun run build' instead of 'bun build ... --outfile dist/...' from project root.",
    });
  }
}

if (misplacedArtifacts.length === 0) {
  gates.push({ gate: "no-misplaced-artifacts", passed: true, severity: "critical", message: "No misplaced build artifacts found" });
}

// Gate 6: Bundle is runnable (--help works)
if (existsSync(BUNDLE_PATH)) {
  try {
    const proc = Bun.spawnSync(["bun", BUNDLE_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = proc.stdout.toString();
    if (output.includes("deepseek-cli") && output.includes("Usage")) {
      gates.push({ gate: "bundle-runnable", passed: true, severity: "critical", message: "Bundle --help output looks correct" });
    } else {
      gates.push({ gate: "bundle-runnable", passed: false, severity: "critical", message: `Bundle --help output unexpected: ${output.slice(0, 100)}` });
    }
  } catch (e) {
    gates.push({ gate: "bundle-runnable", passed: false, severity: "critical", message: `Bundle failed to run: ${e}` });
  }
}

// Gate 7: Tests pass
try {
  const proc = Bun.spawnSync(["bun", "test"], {
    cwd: CLI_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const rawOutput = proc.stdout.toString() + proc.stderr.toString();
  // Strip ANSI escape codes for reliable matching
  const output = rawOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  // Match bun test summary lines like " 59 pass" and " 0 fail" — leading spaces present
  // Avoid matching "attempt 1/3 failed" from retry logs
  const passMatch = output.match(/^\s*(\d+) pass/m);
  const failMatch = output.match(/^\s*(\d+) fail/m);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  testResults = { passed, failed, total: passed + failed };

  if (failed === 0 && passed > 0) {
    gates.push({ gate: "tests-pass", passed: true, severity: "critical", message: `All ${passed} tests pass` });
  } else if (passed === 0 && failed === 0) {
    gates.push({ gate: "tests-pass", passed: false, severity: "warning", message: "No tests found or test runner failed" });
  } else {
    gates.push({ gate: "tests-pass", passed: false, severity: "critical", message: `${failed}/${passed + failed} tests failed` });
  }
} catch (e) {
  gates.push({ gate: "tests-pass", passed: false, severity: "critical", message: `Test runner failed: ${e}` });
}

// Gate 8: Bundle size within reasonable bounds
if (bundleSizeKB > 0) {
  if (bundleSizeKB < 100) {
    gates.push({ gate: "bundle-size", passed: true, severity: "warning", message: `Bundle size ${bundleSizeKB} KB is under 100 KB target` });
  } else {
    gates.push({ gate: "bundle-size", passed: false, severity: "warning", message: `Bundle size ${bundleSizeKB} KB exceeds 100 KB target` });
  }
}

// Gate 9: Import consistency — verify index.ts re-exports match actual module exports
try {
  const SRC_DIR_PATH = join(CLI_DIR, "src");
  const indexContent = readFileSync(join(SRC_DIR_PATH, "index.ts"), "utf8");

  // Extract re-export names from index.ts: export { Name1, Name2 } from "./module.ts"
  const reExportRegex = /export\s*\{([^}]+)\}\s*from\s*["']\.\/([^"']+)["']/g;
  const reExportsByModule = new Map<string, Set<string>>();
  let match;
  while ((match = reExportRegex.exec(indexContent)) !== null) {
    const names = match[1].split(",").map((n) => n.trim()).filter((n) => n.length > 0);
    const modPath = match[2];
    if (!reExportsByModule.has(modPath)) {
      reExportsByModule.set(modPath, new Set());
    }
    for (const name of names) {
      reExportsByModule.get(modPath)!.add(name);
    }
  }

  const mismatches: string[] = [];

  for (const [modPath, reExportedNames] of reExportsByModule) {
    const fullModPath = join(SRC_DIR_PATH, modPath);
    if (!existsSync(fullModPath)) {
      mismatches.push(`Module ${modPath} not found (re-exported: ${[...reExportedNames].join(", ")})`);
      continue;
    }
    const modContent = readFileSync(fullModPath, "utf8");
    // Extract export declarations: export [async] function/const/class/type/interface Name
    const exportRegex = /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g;
    const actualExports = new Set<string>();
    let expMatch;
    while ((expMatch = exportRegex.exec(modContent)) !== null) {
      actualExports.add(expMatch[1]);
    }
    // Also match export { Name1, Name2 }
    const namedExportRegex = /export\s*\{([^}]+)\}/g;
    while ((expMatch = namedExportRegex.exec(modContent)) !== null) {
      const names = expMatch[1].split(",").map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[0].trim();
      }).filter((n) => n.length > 0);
      for (const name of names) {
        actualExports.add(name);
      }
    }

    for (const name of reExportedNames) {
      if (!actualExports.has(name)) {
        mismatches.push(`index.ts re-exports "${name}" from "${modPath}" but it is not exported by that module`);
      }
    }
  }

  if (mismatches.length === 0) {
    const totalReExports = [...reExportsByModule.values()].reduce((sum, s) => sum + s.size, 0);
    gates.push({ gate: "export-consistency", passed: true, severity: "warning", message: `All ${totalReExports} re-exports in index.ts match actual module exports` });
  } else {
    gates.push({ gate: "export-consistency", passed: false, severity: "warning", message: `${mismatches.length} re-export mismatch(es) in index.ts`, detail: mismatches.join("; ") });
  }
} catch (e) {
  gates.push({ gate: "export-consistency", passed: false, severity: "warning", message: `Could not verify export consistency: ${e instanceof Error ? e.message : String(e)}` });
}

// ─── Score calculation ────────────────────────────────────────────────────────

const criticalGates = gates.filter((g) => g.severity === "critical");
const warningGates = gates.filter((g) => g.severity === "warning");
const criticalPassed = criticalGates.filter((g) => g.passed).length;
const warningPassed = warningGates.filter((g) => g.passed).length;

const criticalScore = criticalGates.length > 0 ? (criticalPassed / criticalGates.length) * 70 : 70;
const warningScore = warningGates.length > 0 ? (warningPassed / warningGates.length) * 30 : 30;
const score = Math.round(criticalScore + warningScore);

const allCriticalPass = criticalGates.every((g) => g.passed);
const allWarningPass = warningGates.every((g) => g.passed);
const overallPassed = strictMode ? allCriticalPass && allWarningPass : allCriticalPass;

// ─── Output ───────────────────────────────────────────────────────────────────

const report: QualityReport = {
  timestamp: new Date().toISOString(),
  overallPassed,
  score,
  gates,
  bundlePath: BUNDLE_PATH,
  bundleSizeKB,
  sourceMapExists: existsSync(BUNDLE_MAP_PATH),
  misplacedArtifacts,
  testResults,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   deepseek-cli quality-check                 ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  for (const gate of gates) {
    const icon = gate.passed ? "✅" : (gate.severity === "critical" ? "❌" : "⚠️");
    console.log(`  ${icon} [${gate.severity}] ${gate.gate}: ${gate.message}`);
    if (gate.detail && !gate.passed) {
      console.log(`     💡 ${gate.detail}`);
    }
  }

  console.log();
  console.log(`  Score: ${score}/100`);
  console.log(`  Result: ${overallPassed ? "PASS ✅" : "FAIL ❌"}`);

  if (misplacedArtifacts.length > 0) {
    console.log();
    console.log("  ⚠ MISPLACED ARTIFACTS DETECTED:");
    for (const artifact of misplacedArtifacts) {
      console.log(`    - ${artifact}`);
    }
    console.log("  These should be deleted and the build should use: cd bun_apps/deepseek-cli && bun run build");
  }

  console.log();
}

process.exit(overallPassed ? 0 : 1);
