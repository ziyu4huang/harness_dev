export const meta = {
  name: 'deepseek-cli-self-improve',
  description: 'Iterative self-improving workflow for deepseek-cli bun app. Uses bun-app own scripts (audit, quality-check, benchmark) for measurement. Workflow also self-improves itself.',
  whenToUse: 'Run to iteratively improve deepseek-cli. Each iteration: audit → build → quality-gate → benchmark → reflect → improve → regression-check → report. Quality gates prevent repeating known failures.',
  phases: [
    { title: 'Resolve', detail: 'Detect absolute project root path to eliminate PWD-dependent relative paths' },
    { title: 'History', detail: 'Load metrics history from previous runs, display trend summary' },
    { title: 'Pre-flight', detail: 'Run bun-app quality-check script to verify baseline state before starting' },
    { title: 'Audit', detail: 'Run bun-app audit script to inventory current state' },
    { title: 'Build', detail: 'Build bundle using bun-app package.json build script, then run quality-check' },
    { title: 'Benchmark', detail: 'Run bun-app benchmark script against bundled artifact' },
    { title: 'Reflect', detail: 'Analyze results with Opus, plan improvements for both bun-app AND workflow' },
    { title: 'Improve', detail: 'Implement improvements to bun-app source and workflow .js' },
    { title: 'Regression', detail: 'Re-build, re-run quality-check + benchmark, verify no regressions' },
    { title: 'Report', detail: 'Generate iteration report, persist to metrics history' },
  ],
}

/*
 * deepseek-cli-self-improve workflow v2
 *
 * Key architectural change from v1:
 *   - bun-app has its own scripts (audit, quality-check, benchmark) that do the work
 *   - workflow calls these scripts via `bun run <script>` instead of inline agents
 *   - quality-check gate runs before AND after each critical phase
 *   - workflow self-improves its own .js file in the Improve phase
 *
 * Known failure modes encoded in quality-check.ts:
 *   1. Bun --outfile resolves relative to ENTRY FILE, not CWD
 *   2. dist/ directory missing
 *   3. Misplaced build artifacts in wrong directories
 *   4. Missing shebang in bundle
 *
 * Usage:
 *   Workflow({ name: 'deepseek-cli-self-improve' })
 *   Workflow({ name: 'deepseek-cli-self-improve', args: { iterations: 3 } })
 */

// ─── Configuration: static constants only ───────────────────────────────────

const BUNDLE_NAME = 'deepseek-cli.js'
const BUNDLE_MAP_NAME = 'deepseek-cli.js.map'
const WORKFLOW_REL = '.claude/workflows/deepseek-cli-self-improve.js'

const DEFAULTS = {
  iterations: 1,
  targetBundleSizeKB: 100,
  minTestPassRate: 0.8,
  minFeatures: 6,
}

const config = { ...DEFAULTS, ...(args || {}) }

// ─── Phase -1: Resolve absolute paths ───────────────────────────────────────
//
// The workflow JS runs in a sandbox (no import.meta.dir / __dirname).
// We resolve the project root ONCE via a cheap haiku agent, then derive
// ALL paths as absolute. This eliminates the entire class of PWD-dependent
// bugs (bun outfile resolving to wrong dir, agents with drifted CWD, etc).

phase('Resolve')

const PATH_SCHEMA = {
  type: 'object',
  properties: {
    projectRoot: { type: 'string', description: 'Absolute path to the git project root' },
  },
  required: ['projectRoot'],
}

const pathResolution = await agent(
  `Detect the absolute path of the git project root for deepseek-cli.

  Run: Bash("git rev-parse --show-toplevel")

  This returns the absolute path to the repository root.
  Return it as { projectRoot: "<the-path>" }.

  IMPORTANT: Return ONLY the JSON object. Normalize backslashes to forward slashes.`,
  { label: 'resolve-paths', phase: 'Resolve', model: 'haiku', schema: PATH_SCHEMA },
)

// Normalize to forward slashes for consistent string interpolation in agent prompts
const PROJECT_ROOT = (pathResolution?.projectRoot || '').replace(/\\/g, '/')
if (!PROJECT_ROOT) {
  log('ERROR: Could not resolve project root. Falling back to relative paths — this may cause path issues.')
}

// ─── Derived paths (all absolute) ──────────────────────────────────────────

const CLI_DIR = PROJECT_ROOT ? `${PROJECT_ROOT}/bun_apps/deepseek-cli` : 'bun_apps/deepseek-cli'
const DIST_DIR = PROJECT_ROOT ? `${PROJECT_ROOT}/dist` : 'dist'
const BUNDLE_PATH = `${DIST_DIR}/${BUNDLE_NAME}`
const BUNDLE_MAP_PATH = `${DIST_DIR}/${BUNDLE_MAP_NAME}`
const SRC_ENTRY = `${CLI_DIR}/src/index.ts`
const HISTORY_FILE = `${DIST_DIR}/deepseek-cli-metrics-history.json`
const WORKFLOW_FILE = PROJECT_ROOT ? `${PROJECT_ROOT}/${WORKFLOW_REL}` : WORKFLOW_REL
const WORKFLOW_SCRIPTS = [
  `${CLI_DIR}/scripts/audit.ts`,
  `${CLI_DIR}/scripts/quality-check.ts`,
  `${CLI_DIR}/scripts/benchmark.ts`,
]

log(`Resolved paths:`)
log(`  PROJECT_ROOT: ${PROJECT_ROOT || '(fallback: relative)'}`)
log(`  CLI_DIR:      ${CLI_DIR}`)
log(`  DIST_DIR:     ${DIST_DIR}`)
log(`  BUNDLE_PATH:  ${BUNDLE_PATH}`)
log(`  HISTORY_FILE: ${HISTORY_FILE}`)

// ─── Schemas ─────────────────────────────────────────────────────────────────

const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          iterations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                iteration: { type: 'number' },
                qualityScore: { type: 'number' },
                bundleSizeKB: { type: 'number' },
                testPassRate: { type: 'number' },
                featureCount: { type: 'number' },
                testCount: { type: 'number' },
                testPassed: { type: 'number' },
                improvementsApplied: { type: 'number' },
                regressionsDetected: { type: 'number' },
                verdict: { type: 'string' },
                changesSummary: { type: 'string' },
                workflowImprovements: { type: 'number', description: 'Number of improvements to the workflow .js itself' },
              },
              required: ['iteration', 'qualityScore', 'bundleSizeKB', 'testPassRate', 'featureCount'],
            },
          },
        },
        required: ['runId', 'iterations'],
      },
    },
  },
  required: ['runs'],
}

const QUALITY_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    score: { type: 'number' },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gate: { type: 'string' },
          passed: { type: 'boolean' },
          severity: { type: 'string' },
          message: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['gate', 'passed', 'severity', 'message'],
      },
    },
    bundleSizeKB: { type: 'number' },
    misplacedArtifacts: { type: 'array', items: { type: 'string' } },
    testResults: {
      type: 'object',
      properties: {
        passed: { type: 'number' },
        failed: { type: 'number' },
        total: { type: 'number' },
      },
    },
  },
  required: ['overallPassed', 'score', 'gates'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['name', 'type', 'description'],
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          type: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    health: {
      type: 'object',
      properties: {
        undeclaredDeps: { type: 'array', items: { type: 'string' } },
        unusedDeps: { type: 'array', items: { type: 'string' } },
        deadExports: { type: 'array', items: { type: 'string' } },
      },
    },
    stats: {
      type: 'object',
      properties: {
        codeLines: { type: 'number' },
        testCases: { type: 'number' },
        dependencyCount: { type: 'number' },
        existingBundleSizeKB: { type: 'number' },
        sourceFileCount: { type: 'number' },
        testFileCount: { type: 'number' },
      },
    },
  },
  required: ['features', 'stats'],
}

const BENCHMARK_SCHEMA = {
  type: 'object',
  properties: {
    totalTests: { type: 'number' },
    passedTests: { type: 'number' },
    failedTests: { type: 'number' },
    totalLatencyMs: { type: 'number' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          passed: { type: 'boolean' },
          latencyMs: { type: 'number' },
          failureReason: { type: 'string' },
        },
      },
    },
    featureInventory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          status: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    perfRegressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testName: { type: 'string' },
          previousLatencyMs: { type: 'number' },
          currentLatencyMs: { type: 'number' },
          regressionPercent: { type: 'number' },
          severity: { type: 'string' },
        },
      },
    },
  },
  required: ['totalTests', 'passedTests', 'failedTests', 'results'],
}

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    bunAppImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          effort: { type: 'string' },
          impact: { type: 'string' },
          approach: { type: 'string' },
          filesToModify: { type: 'array', items: { type: 'string' } },
        },
        required: ['priority', 'title', 'description', 'category', 'effort', 'impact', 'approach'],
      },
    },
    workflowImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          approach: { type: 'string' },
        },
        required: ['title', 'description', 'approach'],
      },
    },
    scriptImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          script: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          approach: { type: 'string' },
        },
        required: ['script', 'title', 'description', 'approach'],
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
  },
  required: ['bunAppImprovements', 'workflowImprovements', 'strengths', 'weaknesses'],
}

const IMPROVEMENT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    bunAppChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          change: { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string', enum: ['applied', 'skipped', 'failed'] },
        },
        required: ['file', 'change', 'category', 'status'],
      },
    },
    workflowChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          change: { type: 'string' },
          status: { type: 'string', enum: ['applied', 'skipped', 'failed'] },
        },
        required: ['change', 'status'],
      },
    },
    scriptChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          script: { type: 'string' },
          change: { type: 'string' },
          status: { type: 'string', enum: ['applied', 'skipped', 'failed'] },
        },
        required: ['script', 'change', 'status'],
      },
    },
    testsAdded: { type: 'number' },
    featuresAdded: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['bunAppChanges', 'workflowChanges', 'testsAdded', 'featuresAdded', 'summary'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    iteration: { type: 'number' },
    qualityScore: {
      type: 'object',
      properties: {
        before: { type: 'number' },
        after: { type: 'number' },
        delta: { type: 'number' },
      },
      required: ['before', 'after', 'delta'],
    },
    bundleSize: {
      type: 'object',
      properties: {
        beforeKB: { type: 'number' },
        afterKB: { type: 'number' },
        deltaKB: { type: 'number' },
      },
    },
    changesSummary: { type: 'string' },
    improvementsApplied: { type: 'number' },
    workflowImprovements: { type: 'number' },
    regressionsDetected: { type: 'number' },
    overallVerdict: { type: 'string', enum: ['significant-improvement', 'marginal-improvement', 'no-change', 'regressed', 'blocked'] },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['iteration', 'qualityScore', 'changesSummary', 'improvementsApplied', 'regressionsDetected', 'overallVerdict'],
}

// ─── Helper: run bun-app script and parse JSON output directly ──────────────
//
// Optimization: instead of spawning a haiku agent to run the script and parse
// its JSON output, we run the script directly via Bash with --json flag and
// parse the output inline. This saves ~30-60s per iteration and reduces token
// consumption. Falls back to agent-based parsing only on failure.

async function runBunScript(scriptName, iteration, phaseName, schema) {
  const label = `${scriptName}-${iteration}`

  // Strategy 1: Run script with --json flag directly and parse output inline
  log(`[${iteration}] Running ${scriptName} directly via Bash with --json flag...`)

  const directResult = await agent(
    `Run the bun-app script "${scriptName}" with the --json flag and return its parsed JSON output.

    Run the command:
    Bash("cd ${CLI_DIR} && bun run ${scriptName} --json 2>&1")

    The output is pure JSON. Parse it and return the object directly.
    If the command fails (exit code 1), the JSON is still valid — parse it.
    Do NOT wrap the result in markdown or extra text.

    Return ONLY the parsed JSON object.`,
    { label, phase: phaseName, model: 'haiku', schema },
  )

  if (directResult && typeof directResult === 'object' && !Array.isArray(directResult)) {
    return directResult
  }

  // Strategy 2: Fallback — run without --json flag and extract JSON from mixed output
  log(`[${iteration}] ${scriptName} direct parse failed, falling back to agent-based extraction...`)

  const fallbackResult = await agent(
    `Run the deepseek-cli bun-app's "${scriptName}" script and return its JSON output.

    Step 1: Run the script:
    Bash("cd ${CLI_DIR} && bun run ${scriptName} 2>&1")

    Step 2: The script outputs JSON (possibly with other text before it).
    Parse the JSON from the output and return it.
    If the script fails (exit code 1), the JSON still contains the report — parse it.

    IMPORTANT: Return ONLY the parsed JSON object. Do not wrap it in markdown or extra text.

    Return the parsed JSON object.`,
    { label: `${label}-fallback`, phase: phaseName, model: 'haiku', schema },
  )

  return fallbackResult
}

// ─── Phase 0: History ──────────────────────────────────────────────────────────

phase('History')

const historyResult = await agent(
  `Load the metrics history for deepseek-cli self-improvement.

  Step 1: Ensure dist directory exists:
  Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

  Step 2: Read history file if it exists:
  Bash("if (Test-Path '${HISTORY_FILE}') { Get-Content '${HISTORY_FILE}' -Raw } else { '{ \"runs\": [] }' }")

  Step 3: Parse the JSON. Return { runs: [] } if invalid or empty.`,
  { label: 'load-history', phase: 'History', model: 'haiku', schema: HISTORY_SCHEMA },
)

const metricsHistory = historyResult || { runs: [] }
const totalPreviousRuns = metricsHistory.runs.length
const currentRunId = `run-${totalPreviousRuns + 1}`

const allHistoricalRecords = metricsHistory.runs.flatMap(r => r.iterations)

if (allHistoricalRecords.length > 0) {
  const last = allHistoricalRecords[allHistoricalRecords.length - 1]
  const first = allHistoricalRecords[0]
  log(`History: ${totalPreviousRuns} previous runs, ${allHistoricalRecords.length} total iterations`)
  log(`  Quality: ${first.qualityScore} → ${last.qualityScore}`)
  log(`  Bundle:  ${first.bundleSizeKB?.toFixed(1)} → ${last.bundleSizeKB?.toFixed(1)} KB`)
  log(`  Tests:   ${(first.testPassRate * 100).toFixed(0)}% → ${(last.testPassRate * 100).toFixed(0)}%`)
} else {
  log('History: No previous runs found. Starting fresh.')
}

// ─── Iteration loop ──────────────────────────────────────────────────────────

const MAX_ITERATIONS = Math.min(config.iterations, 5)
let previousMetrics = allHistoricalRecords.length > 0
  ? allHistoricalRecords[allHistoricalRecords.length - 1]
  : null
const runIterations = []

// ─── Convergence tracking ──────────────────────────────────────────────────
// Early-stopping: if improvements plateau for 2 consecutive iterations, stop.
let consecutiveLowDelta = 0
const CONVERGENCE_DELTA_THRESHOLD = 2  // quality score delta threshold
const CONVERGENCE_MAX_LOW_DELTAS = 2    // number of consecutive low deltas before stopping
let converged = false
let convergenceReason = ''

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {

  log(`\n${'═'.repeat(60)}`)
  log(`ITERATION ${iteration} of ${MAX_ITERATIONS}`)
  log(`${'═'.repeat(60)}\n`)

  // ====================================================================
  // PHASE 1: Pre-flight quality check — verify baseline state
  // ====================================================================
  phase('Pre-flight')

  log(`[${iteration}] Phase 1: Pre-flight quality check...`)

  const preflightCheck = await runBunScript('quality-check', iteration, 'Pre-flight', QUALITY_CHECK_SCHEMA)

  const preflightPassed = preflightCheck?.overallPassed !== false
  log(`[${iteration}] Pre-flight: ${preflightPassed ? 'PASS ✅' : 'FAIL ❌'} (score: ${preflightCheck?.score || 0}/100)`)

  if (!preflightPassed) {
    // Show what's failing
    const failedGates = (preflightCheck?.gates || []).filter(g => !g.passed)
    for (const gate of failedGates) {
      log(`[${iteration}]   ❌ ${gate.gate}: ${gate.message}`)
    }

    // Try to fix: build the bundle first
    if (!preflightCheck?.gates?.some(g => g.gate === 'bundle-exists' && g.passed)) {
      log(`[${iteration}] Bundle missing — attempting build...`)
      const buildFix = await agent(
        `Build the deepseek-cli bundle. The bundle is missing.

        ⚠ CRITICAL: bun's --outfile resolves relative to the ENTRY FILE, not CWD.
        You MUST cd into ${CLI_DIR} first, then run bun run build.

        Step 1: Ensure dist directory:
        Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

        Step 2: Build:
        Bash("cd ${CLI_DIR} && bun run build 2>&1")

        Step 3: Verify:
        Bash("Test-Path '${BUNDLE_PATH}'")
        Bash("bun '${BUNDLE_PATH}' --help")

        Return whether the build succeeded.`,
        { label: `preflight-build-${iteration}`, phase: 'Pre-flight', model: 'haiku' },
      )
    }

    // Clean up misplaced artifacts
    if (preflightCheck?.misplacedArtifacts?.length > 0) {
      log(`[${iteration}] Cleaning up misplaced artifacts...`)
      await agent(
        `Delete misplaced build artifacts found by quality-check.

        Misplaced artifacts:
        ${preflightCheck.misplacedArtifacts.map(a => `- ${a}`).join('\n')}

        Delete each one:
        ${preflightCheck.misplacedArtifacts.map(a => `Bash("Remove-Item -Force '${a}' 2>$null")`).join('\n')}

        Return "ok".`,
        { label: `preflight-cleanup-${iteration}`, phase: 'Pre-flight', model: 'haiku' },
      )
    }
  }

  // ====================================================================
  // PHASE 2: Audit — use bun-app's own audit script
  // ====================================================================
  phase('Audit')

  log(`[${iteration}] Phase 2: Running bun-app audit script...`)

  const audit = await runBunScript('audit', iteration, 'Audit', AUDIT_SCHEMA)

  const featureCount = audit?.features?.length || 0
  const testCount = audit?.stats?.testCases || 0
  const codeLines = audit?.stats?.codeLines || 0
  log(`[${iteration}] Audit: ${featureCount} features, ${testCount} tests, ${codeLines} code lines`)

  if (audit?.issues?.length > 0) {
    log(`[${iteration}] Issues found: ${audit.issues.map(i => `${i.type} ${i.file}:${i.line}: ${i.text}`).join('; ')}`)
  }

  // ====================================================================
  // PHASE 3: Build — use bun-app's package.json build script
  // ====================================================================
  phase('Build')

  log(`[${iteration}] Phase 3: Building bundle...`)

  const buildResult = await agent(
    `Build the deepseek-cli bundle and run quality-check after.

    ⚠ CRITICAL: bun's --outfile resolves relative to the ENTRY FILE, not CWD.
    You MUST cd into ${CLI_DIR} first, then run bun run build.
    NEVER run bun build from project root.

    Step 1: Ensure dist directory:
    Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

    Step 2: Time the build:
    Bash("cd ${CLI_DIR} && Measure-Command { bun run build } | Select-Object -ExpandProperty TotalMilliseconds")

    Step 3: Verify the bundle:
    Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 'MISSING' }")
    Bash("Test-Path '${BUNDLE_MAP_PATH}'")
    Bash("(Get-Content '${BUNDLE_PATH}' -First 1)")

    Step 4: Run bundle smoke test:
    Bash("bun '${BUNDLE_PATH}' --help")

    Step 5: Run quality-check to verify build quality:
    Bash("cd ${CLI_DIR} && bun run quality-check 2>&1")

    Return JSON with: { success, bundleSizeKB, buildTimeMs, qualityScore, bundleRunnable }`,
    { label: `build-${iteration}`, phase: 'Build', model: 'sonnet' },
  )

  log(`[${iteration}] Build: ${buildResult?.includes?.('success') ? 'checking...' : 'completed'}`)

  // Parse build metrics from the agent output
  let buildBundleKB = 0
  let buildTimeMs = 0
  try {
    const buildJson = JSON.parse(buildResult || '{}')
    buildBundleKB = buildJson.bundleSizeKB || 0
    buildTimeMs = buildJson.buildTimeMs || 0
  } catch {
    // Agent returned text, try to extract numbers
    const sizeMatch = (buildResult || '').match(/(\d+\.?\d*)\s*KB/)
    if (sizeMatch) buildBundleKB = parseFloat(sizeMatch[1])
  }

  log(`[${iteration}] Build complete: ${buildBundleKB.toFixed(1)} KB`)

  // ====================================================================
  // PHASE 4: Benchmark — use bun-app's own benchmark script
  // ====================================================================
  phase('Benchmark')

  log(`[${iteration}] Phase 4: Running bun-app benchmark script...`)

  const benchmark = await runBunScript('benchmark', iteration, 'Benchmark', BENCHMARK_SCHEMA)

  const passedTests = benchmark?.passedTests || 0
  const totalTests = benchmark?.totalTests || 0
  const totalLatency = benchmark?.totalLatencyMs || 0
  log(`[${iteration}] Benchmark: ${passedTests}/${totalTests} passed, ${totalLatency}ms total`)

  // ====================================================================
  // PHASE 5: Reflect — analyze and plan improvements (Opus)
  // ====================================================================
  phase('Reflect')

  log(`[${iteration}] Phase 5: Self-reflecting (Opus)...`)

  const reflection = await agent(
    `You are a senior CLI tool architect performing deep self-reflection on the deepseek-cli app
    AND the self-improve workflow that orchestrates it.

    ## Current Audit
    Features: ${featureCount}, Tests: ${testCount}, Code: ${codeLines} lines
    Bundle: ${buildBundleKB.toFixed(1)} KB
    Issues: ${JSON.stringify(audit?.issues || [])}

    ## Benchmark Results
    ${passedTests}/${totalTests} tests passed, ${totalLatency}ms total
    Feature inventory: ${JSON.stringify(benchmark?.featureInventory || [])}

    ## Previous Metrics
    ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

    ## Workflow Scripts
    The bun-app now has its own scripts:
    - audit.ts: Self-audit (features, tests, code lines, issues)
    - quality-check.ts: Quality gates (dist exists, bundle correct, no misplaced artifacts, tests pass)
    - benchmark.ts: CLI smoke tests against bundled artifact

    ## Your Task

    Produce THREE categories of improvements:

    1. **bunAppImprovements** (max 3): Improvements to the deepseek-cli source code
       - Each must have concrete approach, filesToModify, effort/impact rating
       - Focus on high-impact, low-effort changes
       - Must not break existing tests

    2. **workflowImprovements** (max 2): Improvements to THIS workflow .js file at ${WORKFLOW_FILE}
       - Can the workflow be more efficient?
       - Are there missing quality gates?
       - Can agent prompts be improved for better results?
       - Can phases be restructured for better flow?

    3. **scriptImprovements** (max 2): Improvements to the bun-app's scripts
       - audit.ts, quality-check.ts, benchmark.ts
       - Better detection of issues?
       - More comprehensive checks?
       - Better output format?

    Also provide strengths and weaknesses of the current state.`,
    { label: `reflect-${iteration}`, phase: 'Reflect', model: 'opus', schema: REFLECTION_SCHEMA },
  )

  const bunAppPlanCount = reflection?.bunAppImprovements?.length || 0
  const workflowPlanCount = reflection?.workflowImprovements?.length || 0
  const scriptPlanCount = reflection?.scriptImprovements?.length || 0
  log(`[${iteration}] Reflection: ${bunAppPlanCount} bun-app + ${workflowPlanCount} workflow + ${scriptPlanCount} script improvements planned`)

  if (reflection?.bunAppImprovements?.length) {
    reflection.bunAppImprovements.slice(0, 3).forEach((item, i) => {
      log(`  ${i + 1}. [${item.category}] ${item.title} (${item.effort} effort, ${item.impact} impact)`)
    })
  }
  if (reflection?.workflowImprovements?.length) {
    log(`  Workflow: ${reflection.workflowImprovements.map(w => w.title).join(', ')}`)
  }

  // ====================================================================
  // Early-exit gate: skip Improve phase when no improvements planned
  // ====================================================================
  const noBunAppImprovements = !reflection?.bunAppImprovements?.length
  const noWorkflowImprovements = !reflection?.workflowImprovements?.length
  const noScriptImprovements = !reflection?.scriptImprovements?.length

  if (noBunAppImprovements && noWorkflowImprovements && noScriptImprovements) {
    log(`[${iteration}] No improvements planned. Skipping Improve phase.`)

    // ====================================================================
    // PHASE 8: Report (early) — generate iteration report with no-change verdict
    // ====================================================================
    phase('Report')

    log(`[${iteration}] Phase 8: Generating iteration report (no-change)...`)

    const report = await agent(
      `Generate a summary report for iteration ${iteration} where no improvements were applied.

    ## Pre-flight Quality Score
    ${preflightCheck?.score || 0}/100

    ## Audit
    Features: ${featureCount}, Tests: ${testCount}, Code: ${codeLines} lines

    ## Build
    Bundle: ${buildBundleKB.toFixed(1)} KB

    ## Benchmark
    ${passedTests}/${totalTests} passed

    ## Improvements Applied
    None — reflection yielded zero improvements.

    ## Regression
    Verdict: no-change, Regressions: 0
    Bundle: ${buildBundleKB.toFixed(1)} KB

    ## Previous Metrics
    ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

    Generate report with:
    - qualityScore: { before: previous or pre-flight score, after: pre-flight score, delta: 0 }
    - bundleSize: { beforeKB: ${buildBundleKB.toFixed(1)}, afterKB: ${buildBundleKB.toFixed(1)}, deltaKB: 0 }
    - changesSummary: "No improvements planned or applied this iteration."
    - improvementsApplied: 0
    - workflowImprovements: 0
    - regressionsDetected: 0
    - nextSteps: 3-5 suggestions for next iteration
    - overallVerdict: "no-change"`,
      { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
    )

    // Store metrics and skip to next iteration
    const iterationRecord = {
      iteration,
      qualityScore: report?.qualityScore?.after || preflightCheck?.score || 0,
      bundleSizeKB: buildBundleKB,
      testPassRate: totalTests > 0 ? passedTests / totalTests : 0,
      featureCount: featureCount,
      testCount: totalTests,
      testPassed: passedTests,
      improvementsApplied: 0,
      regressionsDetected: 0,
      verdict: report?.overallVerdict || 'no-change',
      changesSummary: 'No improvements planned or applied this iteration.',
      workflowImprovements: 0,
    }
    previousMetrics = iterationRecord
    runIterations.push(iterationRecord)

    log(`\n${'─'.repeat(60)}`)
    log(`ITERATION ${iteration} COMPLETE (early exit — no changes)`)
    log(`  Quality: ${report?.qualityScore?.before || '?'} → ${report?.qualityScore?.after || '?'} (Δ0)`)
    log(`  Bundle:  ${buildBundleKB.toFixed(1)} KB`)
    log(`  Verdict: no-change`)
    log(`${'─'.repeat(60)}\n`)

    continue // skip to next iteration
  }

  // ====================================================================
  // PHASE 6: Improve — implement improvements to bun-app + workflow
  // ====================================================================
  phase('Improve')

  log(`[${iteration}] Phase 6: Implementing improvements...`)

  const improvements = await agent(
    `You are implementing improvements to BOTH the deepseek-cli bun-app AND the self-improve workflow.

    ## Bun-App Improvement Plan
    ${JSON.stringify(reflection?.bunAppImprovements || [], null, 2)}

    ## Workflow Improvement Plan
    ${JSON.stringify(reflection?.workflowImprovements || [], null, 2)}

    ## Script Improvement Plan
    ${JSON.stringify(reflection?.scriptImprovements || [], null, 2)}

    ## Files
    Bun-app source:
    - ${SRC_ENTRY} (main CLI)
    - ${CLI_DIR}/src/config.ts (config, models, usage)
    - ${CLI_DIR}/src/tools.ts (agent tools)
    - ${CLI_DIR}/src/stream.ts (streaming client)
    - ${CLI_DIR}/src/index.test.ts (tests)

    Bun-app scripts:
    - ${CLI_DIR}/scripts/audit.ts
    - ${CLI_DIR}/scripts/quality-check.ts
    - ${CLI_DIR}/scripts/benchmark.ts

    Workflow:
    - ${WORKFLOW_FILE}

    ## Implementation Rules

    ### For bun-app changes:
    1. Read the current source files FIRST
    2. Apply improvements incrementally
    3. After ALL changes, run tests: Bash("cd ${CLI_DIR} && bun test 2>&1")
    4. If tests fail, debug and fix

    ### For workflow changes:
    1. Read ${WORKFLOW_FILE} FIRST
    2. Apply improvements carefully — this is the script that orchestrates everything
    3. Do NOT break the existing phase structure or schemas
    4. Test that the workflow syntax is valid

    ### For script changes:
    1. Read the current script FIRST
    2. Apply improvements
    3. Test the script: Bash("cd ${CLI_DIR} && bun run <script-name> 2>&1")

    ## SCOPE GUARD — CRITICAL
    You MUST ONLY modify files listed in the "Files" section above.
    NEVER modify, delete, or create files outside these exact paths:
    - ${CLI_DIR}/src/* (bun-app source and tests)
    - ${CLI_DIR}/scripts/* (bun-app scripts)
    - ${WORKFLOW_FILE} (this workflow)
    Do NOT touch: bun_apps/demo-bun-image/*, scripts/*, docs/*, or any other file.
    Do NOT delete any file that is not listed above.

    ## Important Constraints
    - Build command must ALWAYS be: cd ${CLI_DIR} && bun run build
    - NEVER run: bun build ... --outfile dist/... from project root
    - All workflow agent prompts must include the bun outfile resolution warning
    - Quality checks must verify no misplaced artifacts exist

    Record all changes applied for bun-app, workflow, and scripts separately.`,
    { label: `improve-${iteration}`, phase: 'Improve', model: 'sonnet', schema: IMPROVEMENT_RESULT_SCHEMA },
  )

  const bunAppChanges = improvements?.bunAppChanges?.length || 0
  const workflowChanges = improvements?.workflowChanges?.length || 0
  const scriptChanges = improvements?.scriptChanges?.length || 0
  log(`[${iteration}] Improvements: ${bunAppChanges} bun-app + ${workflowChanges} workflow + ${scriptChanges} script changes`)

  // ====================================================================
  // PHASE 7: Regression — re-build, quality-check, benchmark
  // ====================================================================
  phase('Regression')

  log(`[${iteration}] Phase 7: Running regression checks...`)

  const regression = await agent(
    `You are running regression tests after improvements were applied.

    ⚠ CRITICAL BUILD RULE: You MUST cd into ${CLI_DIR} before running bun build.
    The --outfile flag resolves relative to the entry file, not CWD.
    Command: cd ${CLI_DIR} && bun run build

    ## Previous Metrics
    - Bundle size: ${buildBundleKB.toFixed(1)} KB
    - Tests: ${passedTests}/${totalTests} passed

    ## Step 1: Re-build
    Bash("cd ${CLI_DIR} && bun run build 2>&1")

    ## Step 2: Run quality-check (verifies no misplaced artifacts, correct location, etc.)
    Bash("cd ${CLI_DIR} && bun run quality-check 2>&1")
    Parse the JSON output. This checks:
    - dist/ exists
    - bundle in correct location
    - NO misplaced artifacts (the known bug)
    - bundle runnable
    - tests pass
    - bundle size reasonable

    ## Step 3: Run benchmark
    Bash("cd ${CLI_DIR} && bun run benchmark 2>&1")
    Parse the JSON output.

    ## Step 4: Compare metrics
    Compare new vs previous for:
    - Bundle size (KB)
    - Test pass rate
    - Benchmark pass rate
    - Quality score

    Return JSON with: {
      overallPassed: boolean,
      previousBundleSizeKB: number,
      newBundleSizeKB: number,
      bundleSizeDeltaKB: number,
      qualityScore: number,
      benchmarkPassed: number,
      benchmarkTotal: number,
      regressionCount: number,
      regressions: [{metric, previous, current, severity}],
      verdict: "improved" | "neutral" | "regressed" | "blocked"
    }`,
    { label: `regression-${iteration}`, phase: 'Regression', model: 'sonnet' },
  )

  // Parse regression results
  let regressionData = {}
  try {
    regressionData = JSON.parse(regression || '{}')
  } catch {
    // Try to extract data from text
  }

  const prevKB = regressionData.previousBundleSizeKB || buildBundleKB
  const newKB = regressionData.newBundleSizeKB || buildBundleKB
  const deltaKB = regressionData.bundleSizeDeltaKB || (newKB - prevKB)
  const regressionVerdict = regressionData.verdict || 'unknown'
  const regressionCount = regressionData.regressionCount || 0
  const qualityScoreAfter = regressionData.qualityScore || 0

  log(`[${iteration}] Regression: ${regressionVerdict} — bundle ${prevKB.toFixed(1)} → ${newKB.toFixed(1)} KB (${deltaKB >= 0 ? '+' : ''}${deltaKB.toFixed(1)} KB)`)

  if (regressionCount > 0) {
    log(`[${iteration}] WARNING: ${regressionCount} regressions!`)
    const regs = regressionData.regressions || []
    for (const r of regs) {
      log(`  - ${r.metric}: ${r.previous} → ${r.current} (${r.severity})`)
    }
  }

  // ====================================================================
  // PHASE 8: Report — generate iteration report
  // ====================================================================
  phase('Report')

  log(`[${iteration}] Phase 8: Generating iteration report...`)

  const report = await agent(
    `Generate a summary report for iteration ${iteration}.

    ## Pre-flight Quality Score
    ${preflightCheck?.score || 0}/100

    ## Audit
    Features: ${featureCount}, Tests: ${testCount}, Code: ${codeLines} lines

    ## Build
    Bundle: ${buildBundleKB.toFixed(1)} KB

    ## Benchmark
    ${passedTests}/${totalTests} passed

    ## Improvements Applied
    Bun-app: ${bunAppChanges} changes
    Workflow: ${workflowChanges} changes
    Scripts: ${scriptChanges} changes
    ${improvements?.summary || 'No summary'}

    ## Regression
    Verdict: ${regressionVerdict}, Regressions: ${regressionCount}
    Bundle: ${prevKB.toFixed(1)} → ${newKB.toFixed(1)} KB

    ## Previous Metrics
    ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

    Generate report with:
    - qualityScore: { before: previous or pre-flight score, after: post-regression score, delta }
    - bundleSize: { beforeKB, afterKB, deltaKB }
    - changesSummary: 2-3 sentence summary
    - improvementsApplied: count of bun-app changes
    - workflowImprovements: count of workflow changes
    - regressionsDetected: count
    - nextSteps: 3-5 suggestions
    - overallVerdict`,
    { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
  )

  // Store metrics for next iteration and history
  const iterationRecord = {
    iteration,
    qualityScore: report?.qualityScore?.after || preflightCheck?.score || 0,
    bundleSizeKB: newKB || buildBundleKB,
    testPassRate: totalTests > 0 ? passedTests / totalTests : 0,
    featureCount: featureCount,
    testCount: totalTests,
    testPassed: passedTests,
    improvementsApplied: bunAppChanges,
    regressionsDetected: regressionCount,
    verdict: report?.overallVerdict || 'unknown',
    changesSummary: improvements?.summary || '',
    workflowImprovements: workflowChanges,
  }
  previousMetrics = iterationRecord
  runIterations.push(iterationRecord)

  log(`\n${'─'.repeat(60)}`)
  log(`ITERATION ${iteration} COMPLETE`)
  log(`  Quality: ${report?.qualityScore?.before || '?'} → ${report?.qualityScore?.after || '?'} (Δ${report?.qualityScore?.delta >= 0 ? '+' : ''}${report?.qualityScore?.delta || '?'})`)
  log(`  Bundle:  ${report?.bundleSize?.beforeKB?.toFixed(1) || '?'} → ${report?.bundleSize?.afterKB?.toFixed(1) || '?'} KB (Δ${report?.bundleSize?.deltaKB >= 0 ? '+' : ''}${report?.bundleSize?.deltaKB?.toFixed(1) || '?'})`)
  log(`  Bun-app: ${bunAppChanges} changes, Workflow: ${workflowChanges} changes`)
  log(`  Verdict: ${report?.overallVerdict || 'unknown'}`)
  log(`${'─'.repeat(60)}\n`)

  // ─── Convergence detection gate ──────────────────────────────────────────
  // Stop iterating when improvements plateau:
  //   (a) No improvements were applied AND no workflow/script changes, OR
  //   (b) Last 2 iterations both had qualityScore delta < threshold
  const totalChanges = bunAppChanges + workflowChanges + (improvements?.scriptChanges?.length || 0)
  const qualityDelta = Math.abs(report?.qualityScore?.delta || 0)

  if (totalChanges === 0) {
    consecutiveLowDelta++
    if (consecutiveLowDelta >= CONVERGENCE_MAX_LOW_DELTAS) {
      converged = true
      convergenceReason = `No changes applied for ${consecutiveLowDelta} consecutive iterations`
    }
  } else if (qualityDelta < CONVERGENCE_DELTA_THRESHOLD) {
    consecutiveLowDelta++
    if (consecutiveLowDelta >= CONVERGENCE_MAX_LOW_DELTAS) {
      converged = true
      convergenceReason = `Quality score delta < ${CONVERGENCE_DELTA_THRESHOLD} for ${consecutiveLowDelta} consecutive iterations (last delta: ${qualityDelta})`
    }
  } else {
    consecutiveLowDelta = 0
  }

  if (converged) {
    log(`\n${'═'.repeat(60)}`)
    log(`CONVERGENCE DETECTED — stopping early at iteration ${iteration}`)
    log(`  Reason: ${convergenceReason}`)
    log(`  Skipping ${MAX_ITERATIONS - iteration} remaining iteration(s)`)
    log(`${'═'.repeat(60)}\n`)
    break
  }

} // end iteration loop

// ─── Persist history ──────────────────────────────────────────────────────────

metricsHistory.runs.push({
  runId: currentRunId,
  iterations: runIterations,
})

const updatedHistoryJSON = JSON.stringify(metricsHistory, null, 2)

await agent(
  `Persist the metrics history file.

  Write the following JSON to ${HISTORY_FILE}:
  ${updatedHistoryJSON}

  Use the Write tool to write to ${HISTORY_FILE}.
  Then verify: Bash("Test-Path '${HISTORY_FILE}'")
  Return "ok" on success.`,
  { label: 'save-history', model: 'haiku' },
)

log(`History saved to ${HISTORY_FILE}`)

// ─── Final summary ────────────────────────────────────────────────────────────

log(`\n${'═'.repeat(60)}`)
log(`ALL ITERATIONS COMPLETE`)
log(`${'═'.repeat(60)}`)

if (previousMetrics) {
  log(`Final bundle size: ${previousMetrics.bundleSizeKB?.toFixed(1) || '?'} KB`)
  log(`Final quality score: ${previousMetrics.qualityScore || '?'}/100`)
  log(`Final test pass rate: ${((previousMetrics.testPassRate || 0) * 100).toFixed(0)}%`)
  log(`Features: ${previousMetrics.featureCount || '?'}`)
  if (previousMetrics.workflowImprovements) {
    log(`Workflow improvements: ${previousMetrics.workflowImprovements}`)
  }
}

// ─── History trend table ─────────────────────────────────────────────────────

const allRecords = metricsHistory.runs.flatMap(r =>
  r.iterations.map(it => ({ runId: r.runId, ...it }))
)

if (allRecords.length > 0) {
  log(`\n${'─'.repeat(60)}`)
  log(`METRICS HISTORY (${allRecords.length} data points across ${metricsHistory.runs.length} runs)`)
  log(`${'─'.repeat(60)}`)

  const hdr = '| Run         | Iter | Quality | Bundle KB | Pass Rate | Features | WF Imps | Verdict              |'
  const sep = '|' + '-'.repeat(13) + '|' + '-'.repeat(6) + '|' + '-'.repeat(9) + '|' + '-'.repeat(11) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|' + '-'.repeat(22) + '|'
  log(hdr)
  log(sep)

  for (const r of allRecords) {
    const quality = String(r.qualityScore).padEnd(7)
    const bundle = (r.bundleSizeKB || 0).toFixed(1).padEnd(8)
    const passRate = ((r.testPassRate || 0) * 100).toFixed(0) + '%'
    const features = String(r.featureCount || 0).padEnd(8)
    const wfImps = String(r.workflowImprovements || 0).padEnd(7)
    const verdict = (r.verdict || '?').padEnd(20)
    log(`| ${r.runId.padEnd(11)} | ${String(r.iteration).padEnd(3)} | ${quality} | ${bundle} | ${passRate.padEnd(8)} | ${features} | ${wfImps} | ${verdict} |`)
  }
  log(sep)

  const first = allRecords[0]
  const last = allRecords[allRecords.length - 1]

  log(`\nTrend (first → last):`)
  log(`  Quality:    ${first.qualityScore} → ${last.qualityScore} (${(last.qualityScore - first.qualityScore) >= 0 ? '+' : ''}${last.qualityScore - first.qualityScore})`)
  log(`  Bundle:     ${first.bundleSizeKB?.toFixed(1)} → ${last.bundleSizeKB?.toFixed(1)} KB`)
  log(`  Pass rate:  ${((first.testPassRate || 0) * 100).toFixed(0)}% → ${((last.testPassRate || 0) * 100).toFixed(0)}%`)
  log(`  Features:   ${first.featureCount} → ${last.featureCount}`)

  const barLen = 20
  log(`\nQuality score visual (${barLen} chars = 100):`)
  for (const r of allRecords) {
    const filled = Math.round((r.qualityScore / 100) * barLen)
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
    log(`  ${r.runId} #${r.iteration}: ${bar} ${r.qualityScore}`)
  }
}

log(`\nWorkflow complete. Bundle: ${BUNDLE_PATH}`)
log(`Quality check: cd ${CLI_DIR} && bun run quality-check`)
log(`Metrics: ${HISTORY_FILE}`)
