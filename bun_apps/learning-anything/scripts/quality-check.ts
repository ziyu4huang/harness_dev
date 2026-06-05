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
const BUNDLE = join(DIST, "learning-anything-server.js");
const BUNDLE_MAP = join(DIST, "learning-anything-server.js.map");
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
    message: bundleExists ? "Bundle file exists" : "Bundle file missing at dist/learning-anything-server.js",
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
  console.log(`\n=== learning-anything-server Quality Check ===\n`);
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
