export const meta = {
  name: 'deepseek-cli-self-improve',
  description: 'Iterative self-improving workflow for deepseek-cli bun app. Builds bundle, runs quality gates, benchmarks features, self-reflects, applies improvements, and regression-tests each iteration.',
  whenToUse: 'Run to iteratively improve deepseek-cli. Each iteration audits → builds → benchmarks → reflects → improves. Quality measured on bundled dist/deepseek-cli.js with sourcemaps, not dev mode.',
  phases: [
    { title: 'History', detail: 'Load metrics history from previous runs, display trend summary' },
    { title: 'Audit', detail: 'Inventory current state: source files, tests, bundle size, features, known issues' },
    { title: 'Quality-Gate', detail: 'Define and evaluate quality metrics against baseline (bundle size, runtime, token cost, feature count, stability)' },
    { title: 'Build', detail: 'Build bundled dist/deepseek-cli.js with sourcemaps, measure build time and output size' },
    { title: 'Benchmark', detail: 'Run CLI benchmarks against the bundled artifact: feature tests, latency, token efficiency, error handling' },
    { title: 'Self-Reflect', detail: 'Analyze benchmark results, identify improvement targets, prioritize by impact/effort (Opus)' },
    { title: 'Improve', detail: 'Implement top-priority improvements: new features, bug fixes, performance, token optimization' },
    { title: 'Regression', detail: 'Re-build, re-benchmark, verify no regressions. Compare metrics to previous iteration' },
    { title: 'Report', detail: 'Generate iteration report: delta metrics, changes applied, remaining issues, next-step suggestions. Append to persistent history.' },
  ],
}

/*
 * deepseek-cli-self-improve workflow
 *
 * Iterative self-improvement loop for the deepseek-cli Bun app.
 *
 * Usage:
 *   Workflow({ name: 'deepseek-cli-self-improve' })
 *   Workflow({ name: 'deepseek-cli-self-improve', args: { iterations: 3 } })
 *   Workflow({ name: 'deepseek-cli-self-improve', args: { skipBuild: true } })
 *   Workflow({ name: 'deepseek-cli-self-improve', args: { targetBundleSizeKB: 50 } })
 *   Workflow({ name: 'deepseek-cli-self-improve', args: { maxLatencyMs: 5000 } })
 *
 * Quality dimensions:
 *   1. Bundle size (KB) — smaller is better, measured on dist/deepseek-cli.js
 *   2. Runtime speed (ms) — cold start + prompt processing latency
 *   3. Token efficiency — prompt/output token ratio for tool calls
 *   4. Feature completeness — count of working tools, CLI flags, modes
 *   5. Stability — test pass rate, error handling coverage, edge case resilience
 *   6. Code health — cyclomatic complexity, duplication, type safety
 *
 * Each iteration:
 *   Audit → Quality-Gate → Build → Benchmark → Self-Reflect → Improve → Regression → Report
 *
 * The workflow uses the bundled artifact (dist/deepseek-cli.js) for ALL quality
 * measurements — never dev mode (bun src/index.ts). Bundle is built with
 * sourcemaps for better debugging by claude-code agents.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const CLI_DIR = 'bun_apps/deepseek-cli'
const DIST_DIR = 'dist'
const BUNDLE_NAME = 'deepseek-cli.js'
const BUNDLE_MAP_NAME = 'deepseek-cli.js.map'
const BUNDLE_PATH = `${DIST_DIR}/${BUNDLE_NAME}`
const BUNDLE_MAP_PATH = `${DIST_DIR}/${BUNDLE_MAP_NAME}`
const SRC_ENTRY = `${CLI_DIR}/src/index.ts`
const HISTORY_FILE = `${DIST_DIR}/deepseek-cli-metrics-history.json`

const DEFAULTS = {
  iterations: 1,           // number of improvement iterations
  targetBundleSizeKB: 80,  // target max bundle size in KB
  maxLatencyMs: 10000,     // max acceptable cold-start latency
  minTestPassRate: 0.8,    // minimum test pass rate (0-1)
  minFeatures: 6,          // minimum tool count in agent mode
  skipBuild: false,        // skip build phase (use existing bundle)
  skipReflect: false,      // skip self-reflection (only audit+benchmark)
}

const config = { ...DEFAULTS, ...(args || {}) }

// ─── Schemas ─────────────────────────────────────────────────────────────────

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    sourceFiles: {
      type: 'array',
      items: { type: 'string' },
      description: 'All source .ts files in the CLI app',
    },
    testFiles: {
      type: 'array',
      items: { type: 'string' },
      description: 'All test files',
    },
    currentFeatures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['cli-flag', 'agent-tool', 'mode', 'helper'] },
          description: { type: 'string' },
          working: { type: 'boolean', description: 'Is this feature known to work?' },
        },
        required: ['name', 'type', 'description', 'working'],
      },
    },
    existingBundleSizeKB: { type: 'number', description: 'Size of existing bundle in KB (0 if none)' },
    dependencyCount: { type: 'number', description: 'Number of runtime dependencies' },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          purpose: { type: 'string' },
          bundledSizeKB: { type: 'number', description: 'Estimated contribution to bundle size' },
        },
        required: ['name', 'version', 'purpose'],
      },
    },
    codeLines: { type: 'number', description: 'Total lines of source code (non-blank, non-comment)' },
    testCount: { type: 'number', description: 'Number of test cases' },
    knownIssues: {
      type: 'array',
      items: { type: 'string' },
      description: 'Known issues, TODOs, or limitations found in code comments',
    },
    potentialFeatures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['name', 'description', 'effort', 'impact'],
      },
      description: 'Suggested new features that would improve the CLI',
    },
  },
  required: ['sourceFiles', 'testFiles', 'currentFeatures', 'dependencyCount', 'codeLines', 'testCount', 'knownIssues'],
}

const QUALITY_GATE_SCHEMA = {
  type: 'object',
  properties: {
    overallScore: { type: 'number', description: '0-100 quality score' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Dimension name (bundle-size, runtime, tokens, features, stability, code-health)' },
          score: { type: 'number', description: '0-100 for this dimension' },
          metric: { type: 'string', description: 'The raw metric value and unit' },
          target: { type: 'string', description: 'The target threshold' },
          pass: { type: 'boolean', description: 'Does it meet the target?' },
          gap: { type: 'string', description: 'Description of gap if not passing' },
        },
        required: ['name', 'score', 'metric', 'target', 'pass'],
      },
    },
    passing: { type: 'number', description: 'Count of passing dimensions' },
    total: { type: 'number', description: 'Total dimensions evaluated' },
    verdict: { type: 'string', enum: ['excellent', 'good', 'acceptable', 'needs-work', 'failing'] },
    blockers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Critical issues that must be fixed before release',
    },
    improvementAreas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Non-blocking areas with room for improvement',
    },
  },
  required: ['overallScore', 'dimensions', 'passing', 'total', 'verdict'],
}

const BUILD_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    bundlePath: { type: 'string' },
    bundleSizeKB: { type: 'number', description: 'Bundle size in KB' },
    sourceMapPath: { type: 'string' },
    sourceMapSizeKB: { type: 'number', description: 'Source map size in KB' },
    buildTimeMs: { type: 'number', description: 'Build wall-clock time in ms' },
    buildCommand: { type: 'string', description: 'Exact build command used' },
    warnings: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
    hasShebang: { type: 'boolean', description: 'Does the bundle start with #!/usr/bin/env bun?' },
    minified: { type: 'boolean', description: 'Was minification applied?' },
    targetRuntime: { type: 'string', description: 'Target runtime (bun, node, browser)' },
  },
  required: ['success', 'bundlePath', 'bundleSizeKB', 'buildTimeMs'],
}

const BENCHMARK_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    totalTests: { type: 'number' },
    passedTests: { type: 'number' },
    failedTests: { type: 'number' },
    skippedTests: { type: 'number' },
    totalLatencyMs: { type: 'number' },
    coldStartMs: { type: 'number', description: 'Time to first output for a simple prompt' },
    bundleLoadMs: { type: 'number', description: 'Time for bun to load and parse the bundle (no API call)' },
    testResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: ['help', 'model', 'agent-tool', 'error-handling', 'edge-case', 'performance'] },
          command: { type: 'string', description: 'CLI command executed' },
          passed: { type: 'boolean' },
          latencyMs: { type: 'number' },
          expectedBehavior: { type: 'string' },
          observedBehavior: { type: 'string' },
          failureReason: { type: 'string' },
          tokenEstimate: { type: 'number', description: 'Estimated tokens consumed (if API call made)' },
        },
        required: ['name', 'category', 'command', 'passed', 'latencyMs'],
      },
    },
    featureInventory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          status: { type: 'string', enum: ['working', 'broken', 'missing'] },
          evidence: { type: 'string' },
        },
        required: ['feature', 'status', 'evidence'],
      },
    },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['overallPassed', 'totalTests', 'passedTests', 'failedTests', 'totalLatencyMs', 'testResults', 'recommendations'],
}

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'What the CLI does well',
    },
    weaknesses: {
      type: 'array',
      items: { type: 'string' },
      description: 'What needs improvement',
    },
    improvementPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'number', description: '1=highest' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', enum: ['feature', 'bug-fix', 'performance', 'token-optimization', 'bundle-size', 'stability', 'code-quality', 'developer-experience'] },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
          approach: { type: 'string', description: 'Concrete implementation approach' },
          filesToModify: { type: 'array', items: { type: 'string' } },
          estimatedBundleSizeDeltaKB: { type: 'number', description: 'Estimated change in bundle size (+ or -)' },
          riskLevel: { type: 'string', enum: ['safe', 'moderate', 'risky'] },
        },
        required: ['priority', 'title', 'description', 'category', 'effort', 'impact', 'approach'],
      },
    },
    bundleSizeAnalysis: {
      type: 'string',
      description: 'Where bundle bloat comes from and how to reduce it',
    },
    tokenEfficiencyAnalysis: {
      type: 'string',
      description: 'How to reduce token usage in tool descriptions and prompts',
    },
    featureGaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Missing features that would significantly improve the CLI',
    },
    architecturalSuggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Structural changes to improve maintainability',
    },
  },
  required: ['strengths', 'weaknesses', 'improvementPlan', 'bundleSizeAnalysis', 'tokenEfficiencyAnalysis'],
}

const IMPROVEMENT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    changesApplied: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          change: { type: 'string', description: 'What was changed' },
          category: { type: 'string', enum: ['feature', 'bug-fix', 'performance', 'token-optimization', 'bundle-size', 'stability', 'code-quality', 'developer-experience'] },
          status: { type: 'string', enum: ['applied', 'skipped', 'failed'] },
          reason: { type: 'string', description: 'Why skipped/failed, or confirmation of success' },
        },
        required: ['file', 'change', 'category', 'status'],
      },
    },
    testsAdded: { type: 'number', description: 'Number of new test cases added' },
    featuresAdded: { type: 'number', description: 'Number of new features added' },
    linesChanged: { type: 'number', description: 'Total lines added/modified' },
    summary: { type: 'string' },
  },
  required: ['changesApplied', 'testsAdded', 'featuresAdded', 'linesChanged', 'summary'],
}

const REGRESSION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    previousBundleSizeKB: { type: 'number' },
    newBundleSizeKB: { type: 'number' },
    bundleSizeDeltaKB: { type: 'number', description: 'Positive = grew, negative = shrunk' },
    previousTestPassRate: { type: 'number' },
    newTestPassRate: { type: 'number' },
    testPassRateDelta: { type: 'number' },
    buildStillWorks: { type: 'boolean' },
    sourceMapValid: { type: 'boolean', description: 'Does the source map correctly map back to source?' },
    allTestsPass: { type: 'boolean' },
    regressionCount: { type: 'number', description: 'Number of regressions detected' },
    regressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          previousValue: { type: 'string' },
          newValue: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'moderate', 'minor'] },
          description: { type: 'string' },
        },
        required: ['metric', 'previousValue', 'newValue', 'severity', 'description'],
      },
    },
    improvements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Metrics that improved',
    },
    verdict: { type: 'string', enum: ['improved', 'neutral', 'regressed', 'blocked'] },
  },
  required: ['overallPassed', 'previousBundleSizeKB', 'newBundleSizeKB', 'bundleSizeDeltaKB', 'buildStillWorks', 'allTestsPass', 'regressionCount', 'regressions', 'verdict'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    iteration: { type: 'number' },
    timestamp: { type: 'string', description: 'ISO-ish timestamp of report generation' },
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
    testResults: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'e.g. "4/5 passed"' },
        after: { type: 'string' },
      },
    },
    changesSummary: { type: 'string' },
    improvementsApplied: { type: 'number' },
    regressionsDetected: { type: 'number' },
    nextSteps: {
      type: 'array',
      items: { type: 'string' },
    },
    overallVerdict: { type: 'string', enum: ['significant-improvement', 'marginal-improvement', 'no-change', 'regressed', 'blocked'] },
  },
  required: ['iteration', 'qualityScore', 'changesSummary', 'improvementsApplied', 'regressionsDetected', 'overallVerdict'],
}

// ─── History loading ──────────────────────────────────────────────────────────

const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Unique run identifier (date-based)' },
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

// ─── Phase 0: History — load previous metrics and show trend ──────────────────

phase('History')

const historyResult = await agent(
  `You are loading the metrics history for deepseek-cli self-improvement.

  ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

  Step 1 — Ensure the dist directory exists:
  Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

  Step 2 — Check if the history file exists and read it:
  Bash("if (Test-Path '${HISTORY_FILE}') { Get-Content '${HISTORY_FILE}' -Raw } else { '{ \"runs\": [] }' }")

  Step 3 — Parse the JSON. If it's invalid or empty, return { runs: [] }.
  If it loaded successfully, return the full history.

  Step 4 — If there is history, produce a brief trend summary:
  - How many previous runs?
  - What's the trend for quality score, bundle size, test pass rate?
  - What was the last known state?

  Return the full parsed history object.`,
  { label: 'load-history', phase: 'History', model: 'haiku', schema: HISTORY_SCHEMA },
)

const metricsHistory = historyResult || { runs: [] }
const totalPreviousRuns = metricsHistory.runs.length
const currentRunId = `run-${totalPreviousRuns + 1}`

// Build a flat list of all historical iteration records for trend analysis
const allHistoricalRecords = metricsHistory.runs.flatMap(r => r.iterations)

if (allHistoricalRecords.length > 0) {
  const lastRecord = allHistoricalRecords[allHistoricalRecords.length - 1]
  const firstRecord = allHistoricalRecords[0]
  log(`History: ${totalPreviousRuns} previous runs, ${allHistoricalRecords.length} total iterations`)
  log(`  First → Last quality score: ${firstRecord.qualityScore} → ${lastRecord.qualityScore}`)
  log(`  First → Last bundle size:   ${firstRecord.bundleSizeKB?.toFixed(1)} → ${lastRecord.bundleSizeKB?.toFixed(1)} KB`)
  log(`  First → Last test pass rate: ${(firstRecord.testPassRate * 100).toFixed(0)}% → ${(lastRecord.testPassRate * 100).toFixed(0)}%`)
  log(`  First → Last features:       ${firstRecord.featureCount} → ${lastRecord.featureCount}`)
} else {
  log('History: No previous runs found. Starting fresh.')
}

// ─── Iteration loop ──────────────────────────────────────────────────────────

const MAX_ITERATIONS = Math.min(config.iterations, 5)  // cap at 5 for safety
let previousMetrics = allHistoricalRecords.length > 0
  ? allHistoricalRecords[allHistoricalRecords.length - 1]
  : null  // carried across iterations
const runIterations = []  // collect this run's iteration records

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {

  log(`\n${'═'.repeat(60)}`)
  log(`ITERATION ${iteration} of ${MAX_ITERATIONS}`)
  log(`${'═'.repeat(60)}\n`)

  // ====================================================================
  // PHASE 1: Audit — inventory current state
  // ====================================================================
  phase('Audit')

  log(`[${iteration}] Phase 1: Auditing current deepseek-cli state...`)

  const audit = await agent(
    `You are auditing the deepseek-cli Bun app at "${CLI_DIR}".

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    Step 1 — Map all source and test files:
    - Glob("${CLI_DIR}/src/**/*.ts")
    - Glob("${CLI_DIR}/**/*.test.*")
    - Glob("${CLI_DIR}/**/*.spec.*")

    Step 2 — Read key files:
    - Read "${CLI_DIR}/package.json" (dependencies, scripts, version)
    - Read "${CLI_DIR}/src/index.ts" (full source)
    - Read "${CLI_DIR}/src/index.test.ts" (full test file)
    - Read "${CLI_DIR}/tsconfig.json"

    Step 3 — Check for existing bundle:
    - Run: Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 0 }")
    This gives the existing bundle size in KB.

    Step 4 — Analyze source code:
    - Count total non-blank, non-comment lines in src/index.ts
    - Count test cases in the test file
    - Extract all tool names from the TOOLS object
    - Extract all CLI flags from the args parsing section
    - Find any TODO/FIXME/HACK comments
    - Identify error handling patterns (try/catch blocks)

    Step 5 — Produce audit result:
    - sourceFiles: list of all .ts source files
    - testFiles: list of test files
    - currentFeatures: each feature with name, type, description, and whether it's working
    - existingBundleSizeKB: size of existing dist/deepseek-cli.js (0 if none)
    - dependencyCount: number of runtime dependencies in package.json
    - dependencies: each dep with name, version, purpose
    - codeLines: non-blank non-comment line count
    - testCount: number of test cases
    - knownIssues: any TODOs, FIXMEs, or limitations found
    - potentialFeatures: suggest 3-5 features that would improve the CLI, with effort/impact ratings

    Be thorough — read every file completely.`,
    { label: `audit-${iteration}`, phase: 'Audit', model: 'haiku', schema: AUDIT_SCHEMA },
  )

  log(`[${iteration}] Audit complete: ${audit?.currentFeatures?.length || 0} features, ${audit?.testCount || 0} tests, ${audit?.codeLines || 0} lines`)

  // ====================================================================
  // PHASE 2: Quality Gate — evaluate against targets
  // ====================================================================
  phase('Quality-Gate')

  log(`[${iteration}] Phase 2: Running quality gate evaluation...`)

  const qualityGate = await agent(
    `You are evaluating the quality of the deepseek-cli Bun app against defined targets.

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    ## Audit Results
    ${JSON.stringify(audit, null, 2)}

    ## Quality Targets
    - Bundle size: < ${config.targetBundleSizeKB} KB
    - Cold-start latency: < ${config.maxLatencyMs} ms
    - Test pass rate: >= ${config.minTestPassRate} (${config.minTestPassRate * 100}%)
    - Minimum features: >= ${config.minFeatures} agent tools
    - Source map: must exist alongside bundle
    - No critical errors on --help, --model, basic invocation

    ## Evaluation Dimensions

    Evaluate each dimension 0-100:

    1. **bundle-size**: Score based on existingBundleSizeKB vs target. Lower is better.
       90+ if under target, 70 if within 20%, 50 if within 50%, below 50 if over 50%.
       If no bundle exists yet, score 0 (blocked).

    2. **runtime**: Estimate cold-start performance. Score based on dependency count
       and code complexity. Fewer deps + simpler code = faster. Estimate based on
       codeLines and dependencyCount.

    3. **tokens**: Evaluate tool descriptions for token efficiency. Shorter, more
       precise descriptions = better. Check if parameter descriptions are verbose.
       Score based on total description text length.

    4. **features**: Score = (currentFeatures.filter(f=>f.working).length / minFeatures) * 100.
       Cap at 100.

    5. **stability**: Score based on testCount and error handling coverage.
       0 tests = 0, 5+ tests with good coverage = 90+.
       Factor in knownIssues count.

    6. **code-health**: Score based on codeLines per feature, dependency efficiency,
       and code organization. Modular = better, monolithic = worse.

    Produce an overall verdict and list any blockers (issues that MUST be fixed)
    and improvement areas (nice-to-haves).`,
    { label: `quality-gate-${iteration}`, phase: 'Quality-Gate', model: 'haiku', schema: QUALITY_GATE_SCHEMA },
  )

  log(`[${iteration}] Quality gate: score ${qualityGate?.overallScore || 0}/100, verdict: ${qualityGate?.verdict || 'unknown'}`)
  if (qualityGate?.blockers?.length) {
    log(`[${iteration}] Blockers: ${qualityGate.blockers.join('; ')}`)
  }

  // ====================================================================
  // PHASE 3: Build — create bundle with sourcemaps
  // ====================================================================
  phase('Build')

  let buildResult = null
  let preBuildBundleSizeKB = 0

  if (!config.skipBuild) {
    log(`[${iteration}] Phase 3: Building dist/${BUNDLE_NAME} with sourcemaps...`)

    // Record pre-build bundle size for comparison
    buildResult = await agent(
      `You are building the deepseek-cli Bun app into a bundled artifact with sourcemaps.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Build Requirements
      1. The bundle MUST be built with sourcemaps for debugging
      2. The bundle MUST target the Bun runtime
      3. Minification should be applied
      4. The shebang line must be preserved

      ## Step 1: Check current bundle size
      Run: Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 0 }")
      Record this as the pre-build size.

      ## Step 2: Ensure dist directory exists
      Run: Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

      ## Step 3: Build with sourcemaps
      Run the bun build command. The build script in package.json does NOT include sourcemaps,
      so we need a custom build command:

      Bash("bun build ${SRC_ENTRY} --outfile '${BUNDLE_PATH}' --target bun --minify --sourcemap")

      Time the build:
      Bash("Measure-Command { bun build ${SRC_ENTRY} --outfile '${BUNDLE_PATH}' --target bun --minify --sourcemap } | Select-Object -ExpandProperty TotalMilliseconds")

      ## Step 4: Verify the build
      - Check that ${BUNDLE_PATH} exists and get its size in KB
      - Check that ${BUNDLE_MAP_PATH} exists and get its size in KB
      - Verify the bundle starts with a shebang: Bash("(Get-Content '${BUNDLE_PATH}' -First 1)")
      - If no shebang, add it: Bash("$content = Get-Content '${BUNDLE_PATH}' -Raw; '#!/usr/bin/env bun\\n' + $content | Set-Content '${BUNDLE_PATH}' -NoNewline")

      ## Step 5: Verify bundle runs
      Run: Bash("bun '${BUNDLE_PATH}' --help")
      This should print usage info. If it fails, the build is broken.

      ## Step 6: Record build result
      - success: true/false based on whether bundle runs
      - bundlePath: the output path
      - bundleSizeKB: size in KB
      - sourceMapPath: the .map path
      - sourceMapSizeKB: size of .map in KB
      - buildTimeMs: build time in milliseconds
      - buildCommand: the exact bun build command used
      - hasShebang: whether the bundle has a shebang
      - minified: true
      - targetRuntime: "bun"
      - warnings: any build warnings
      - errors: any errors encountered`,
      { label: `build-${iteration}`, phase: 'Build', model: 'sonnet', schema: BUILD_RESULT_SCHEMA },
    )

    log(`[${iteration}] Build: ${buildResult?.success ? 'OK' : 'FAILED'} — ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB in ${buildResult?.buildTimeMs?.toFixed(0) || '?'}ms`)
  } else {
    log(`[${iteration}] Build: skipped (using existing bundle)`)
    buildResult = { success: true, bundlePath: BUNDLE_PATH, bundleSizeKB: audit?.existingBundleSizeKB || 0, buildTimeMs: 0, sourceMapPath: BUNDLE_MAP_PATH, hasShebang: true, minified: true, targetRuntime: 'bun' }
  }

  if (!buildResult?.success) {
    log(`[${iteration}] BUILD FAILED — skipping remaining phases. Attempting diagnosis...`)

    const diagResult = await agent(
      `The build of deepseek-cli failed. Diagnose the issue.

      Build result: ${JSON.stringify(buildResult, null, 2)}

      Step 1: Read the source file to check for syntax errors:
      Read "${SRC_ENTRY}"

      Step 2: Check if dependencies are installed:
      Bash("cd ${CLI_DIR} && bun pm ls 2>&1 | Select-Object -First 20")

      Step 3: Try to install dependencies:
      Bash("bun install 2>&1")

      Step 4: Retry the build:
      Bash("bun build ${SRC_ENTRY} --outfile '${BUNDLE_PATH}' --target bun --minify --sourcemap 2>&1")

      Step 5: If it still fails, analyze the error and suggest a fix.
      Return a JSON object with: { diagnosis: string, fix: string, retrySucceeded: boolean }`,
      { label: `build-diag-${iteration}`, phase: 'Build', model: 'sonnet' },
    )

    if (!diagResult?.includes?.('retrySucceeded') || !JSON.parse(diagResult)?.retrySucceeded) {
      log(`[${iteration}] Build unfixable. Ending iteration early.`)
      break
    }
  }

  // ====================================================================
  // PHASE 4: Benchmark — run tests against bundled artifact
  // ====================================================================
  phase('Benchmark')

  log(`[${iteration}] Phase 4: Running benchmarks against bundled artifact...`)

  const benchmark = await agent(
    `You are benchmarking the bundled deepseek-cli at "${BUNDLE_PATH}".

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    IMPORTANT: ALL tests must use the BUNDLED artifact "${BUNDLE_PATH}", NOT "bun src/index.ts".

    ## Build Context
    ${JSON.stringify(buildResult, null, 2)}

    ## Benchmark Suite

    Run each of these tests and record results. Use PowerShell's Measure-Command for timing.

    ### Category 1: Help & CLI flags
    1. **help-flag**: Run "bun '${BUNDLE_PATH}' --help" — should print usage, exit 0
    2. **h-flag**: Run "bun '${BUNDLE_PATH}' -h" — should print usage, exit 0
    3. **no-args**: Run "bun '${BUNDLE_PATH}'" (no args) — should print usage, exit 1

    ### Category 2: Model validation
    4. **invalid-model**: Run "bun '${BUNDLE_PATH}' --model bogus hello" — should error with "unknown model", exit 1
    5. **model-pro**: Run "bun '${BUNDLE_PATH}' --model pro hello" WITH DEEPSEEK_API_KEY="" — should error about missing API key (proves model parsing works without API call)
    6. **model-flash**: Run "bun '${BUNDLE_PATH}' --model flash hello" WITH DEEPSEEK_API_KEY="" — same as above for flash

    ### Category 3: Error handling
    7. **missing-api-key**: Run "bun '${BUNDLE_PATH}' hello" with DEEPSEEK_API_KEY="" — should error about missing key
    8. **empty-prompt**: Run "bun '${BUNDLE_PATH}' --model pro" (no prompt text) — should print usage, exit 1

    ### Category 4: Bundle integrity
    9. **bundle-load-time**: Time "bun '${BUNDLE_PATH}' --help" — this measures how fast bun loads and parses the bundle (no API call)
       Bash("Measure-Command { bun '${BUNDLE_PATH}' --help 2>&1 | Out-Null } | Select-Object -ExpandProperty TotalMilliseconds")

    10. **source-map-exists**: Check if ${BUNDLE_MAP_PATH} exists
        Bash("Test-Path '${BUNDLE_MAP_PATH}'")

    11. **bundle-has-content**: Verify bundle is not empty/trivial
        Bash("(Get-Content '${BUNDLE_PATH}' | Measure-Object -Line).Lines")

    ### Category 5: Agent mode flags
    12. **agent-flag**: Run "bun '${BUNDLE_PATH}' --agent hello" WITH DEEPSEEK_API_KEY="" — should error about API key (not about --agent being unknown)
    13. **agent-shorthand**: Run "bun '${BUNDLE_PATH}' -a hello" WITH DEEPSEEK_API_KEY="" — same for -a shorthand

    ### Category 6: Existing unit tests
    14. **unit-tests**: Run the existing test suite
        Bash("cd ${CLI_DIR} && bun test 2>&1")
        Record how many pass/fail.

    ## Feature Inventory
    After running tests, create a feature inventory based on what you observed:
    - Each agent tool (calculator, read_file, write_file, web_fetch, list_directory, grep_search)
    - CLI flags (--model, --agent, -a, -h, --help)
    - Modes (simple mode, agent mode)
    - Mark each as working/broken/missing with evidence

    ## Output
    Produce the full benchmark result with all test results, feature inventory, and recommendations.`,
    { label: `benchmark-${iteration}`, phase: 'Benchmark', model: 'sonnet', schema: BENCHMARK_RESULT_SCHEMA },
  )

  log(`[${iteration}] Benchmark: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed, ${benchmark?.totalLatencyMs?.toFixed(0) || '?'}ms total`)

  // ====================================================================
  // PHASE 5: Self-Reflect — analyze and plan improvements (Opus)
  // ====================================================================
  phase('Self-Reflect')

  if (!config.skipReflect) {
    log(`[${iteration}] Phase 5: Self-reflecting on benchmark results (Opus)...`)

    const reflection = await agent(
      `You are a senior CLI tool architect performing a deep self-reflection on the deepseek-cli app.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Audit Summary
      ${JSON.stringify(audit, null, 2)}

      ## Quality Gate Results
      ${JSON.stringify(qualityGate, null, 2)}

      ## Build Results
      ${JSON.stringify(buildResult, null, 2)}

      ## Benchmark Results
      ${JSON.stringify(benchmark, null, 2)}

      ## Previous Iteration Metrics
      ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration — no previous metrics)'}

      ## Your Task

      Analyze the above data holistically and produce:

      1. **strengths**: What the CLI does well right now (be specific)
      2. **weaknesses**: What needs improvement (be specific, reference test failures or quality gate gaps)
      3. **improvementPlan**: Prioritized list of improvements (max 5 for this iteration)
         - Each must have a concrete implementation approach
         - Include filesToModify
         - Estimate bundle size impact
         - Risk assessment (safe = no breaking changes, moderate = could break tests, risky = major refactor)
         - Focus on HIGH IMPACT + LOW EFFORT first
      4. **bundleSizeAnalysis**: Where is the bundle bloat? Which dependencies contribute most?
         How to reduce? Can any deps be replaced with lighter alternatives or inlined?
      5. **tokenEfficiencyAnalysis**: Analyze tool descriptions and parameter descriptions.
         Are they verbose? Can they be shortened without losing clarity?
         Estimate token savings from optimizations.
      6. **featureGaps**: What features would make this CLI significantly more useful?
         Consider: streaming output, conversation history, file diff, code execution,
         config file support, custom tool registration, etc.
      7. **architecturalSuggestions**: Structural improvements for maintainability

      IMPORTANT CONSTRAINTS for improvementPlan:
      - Maximum 5 items per iteration (focus on highest impact)
      - Each item must be implementable in isolation (no cross-dependencies)
      - Prefer improvements that reduce bundle size or token usage
      - Must not break existing tests
      - Must maintain or improve stability score`,
      { label: `reflect-${iteration}`, phase: 'Self-Reflect', model: 'opus', schema: REFLECTION_SCHEMA },
    )

    log(`[${iteration}] Reflection: ${reflection?.improvementPlan?.length || 0} improvements planned`)
    if (reflection?.improvementPlan?.length) {
      reflection.improvementPlan.slice(0, 3).forEach((item, i) => {
        log(`  ${i + 1}. [${item.category}] ${item.title} (${item.effort} effort, ${item.impact} impact)`)
      })
    }

    // ====================================================================
    // PHASE 6: Improve — implement top-priority improvements
    // ====================================================================
    phase('Improve')

    log(`[${iteration}] Phase 6: Implementing improvements...`)

    const improvements = await agent(
      `You are implementing improvements to the deepseek-cli Bun app.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Improvement Plan (from reflection)
      ${JSON.stringify(reflection?.improvementPlan || [], null, 2)}

      ## Current Source Code Location
      - Main source: ${SRC_ENTRY}
      - Tests: ${CLI_DIR}/src/index.test.ts
      - Package config: ${CLI_DIR}/package.json

      ## Implementation Rules
      1. Read the current source files FIRST before making any changes
      2. Implement ONLY the improvements listed in the plan above
      3. Each improvement should be applied incrementally — read → modify → verify
      4. After ALL changes are applied, run the test suite:
         Bash("cd ${CLI_DIR} && bun test 2>&1")
      5. If tests fail, debug and fix before proceeding
      6. For each change, record: file, change description, category, status

      ## Token Optimization Guidelines
      - Shorten tool descriptions to be concise but clear
      - Remove redundant words from parameter descriptions
      - Keep descriptions under 80 chars where possible
      - Use consistent, terse language

      ## Bundle Size Guidelines
      - Avoid adding new dependencies
      - Prefer inline implementations over imports
      - Use built-in Bun APIs over npm packages where possible
      - Keep the source lean — no unnecessary abstractions

      ## Quality Checks
      After implementing all changes:
      1. Run: Bash("cd ${CLI_DIR} && bun test 2>&1") — all tests must pass
      2. Run: Bash("bun '${BUNDLE_PATH}' --help") — CLI still works
      3. Count total lines changed

      Record all changes applied, tests added, features added, and a summary.`,
      { label: `improve-${iteration}`, phase: 'Improve', model: 'sonnet', schema: IMPROVEMENT_RESULT_SCHEMA },
    )

    log(`[${iteration}] Improvements: ${improvements?.changesApplied?.length || 0} changes, ${improvements?.featuresAdded || 0} new features, ${improvements?.testsAdded || 0} new tests`)

    // ====================================================================
    // PHASE 7: Regression — re-build, re-benchmark, verify
    // ====================================================================
    phase('Regression')

    log(`[${iteration}] Phase 7: Running regression checks...`)

    const regression = await agent(
      `You are running regression tests after improvements were applied to deepseek-cli.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Previous Metrics
      - Bundle size: ${buildResult?.bundleSizeKB || 0} KB
      - Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed

      ## Improvements Applied
      ${JSON.stringify(improvements?.changesApplied || [], null, 2)}

      ## Step 1: Re-build the bundle with sourcemaps
      Bash("bun build ${SRC_ENTRY} --outfile '${BUNDLE_PATH}' --target bun --minify --sourcemap 2>&1")

      Ensure shebang is present:
      Bash("$c = Get-Content '${BUNDLE_PATH}' -Raw; if (-not $c.StartsWith('#!')) { '#!/usr/bin/env bun\n' + $c | Set-Content '${BUNDLE_PATH}' -NoNewline }")

      ## Step 2: Measure new bundle size
      Bash("$bundleKB = (Get-Item '${BUNDLE_PATH}').Length / 1KB; Write-Output $bundleKB")

      ## Step 3: Verify source map exists and is valid
      Bash("Test-Path '${BUNDLE_MAP_PATH}'")
      Read the first few lines of the source map to check it references the original source:
      Bash("(Get-Content '${BUNDLE_MAP_PATH}' -First 5)")

      ## Step 4: Run the test suite
      Bash("cd ${CLI_DIR} && bun test 2>&1")

      ## Step 5: Run bundle-level smoke tests
      Bash("bun '${BUNDLE_PATH}' --help")
      Bash("bun '${BUNDLE_PATH}' --model bogus test 2>&1")  # should fail with unknown model

      ## Step 6: Compare metrics
      Compare new bundle size vs previous.
      Compare test pass rate vs previous.
      Identify any regressions (metric got worse).

      ## Step 7: Source map validation
      Verify the source map correctly maps to source files by checking:
      - The "sources" array in the map includes the original source files
      - The file is valid JSON
      - It's not empty

      Produce regression results with deltas and verdict.`,
      { label: `regression-${iteration}`, phase: 'Regression', model: 'sonnet', schema: REGRESSION_RESULT_SCHEMA },
    )

    log(`[${iteration}] Regression: ${regression?.verdict || 'unknown'} — bundle ${regression?.previousBundleSizeKB?.toFixed(1) || '?'} → ${regression?.newBundleSizeKB?.toFixed(1) || '?'} KB (${regression?.bundleSizeDeltaKB >= 0 ? '+' : ''}${regression?.bundleSizeDeltaKB?.toFixed(1) || '?'} KB)`)

    if (regression?.regressionCount > 0) {
      log(`[${iteration}] WARNING: ${regression.regressionCount} regressions detected!`)
      regression.regressions.forEach(r => {
        log(`  - ${r.metric}: ${r.previousValue} → ${r.newValue} (${r.severity})`)
      })
    }

    // ====================================================================
    // PHASE 8: Report — generate iteration report
    // ====================================================================
    phase('Report')

    log(`[${iteration}] Phase 8: Generating iteration report...`)

    const report = await agent(
      `You are generating a summary report for iteration ${iteration} of deepseek-cli self-improvement.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Audit Summary
      Features: ${audit?.currentFeatures?.length || 0}, Tests: ${audit?.testCount || 0}, Code lines: ${audit?.codeLines || 0}

      ## Quality Gate
      Score: ${qualityGate?.overallScore || 0}/100 (${qualityGate?.verdict || 'unknown'})

      ## Build
      Bundle: ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB, Build time: ${buildResult?.buildTimeMs?.toFixed(0) || '?'}ms, Sourcemap: ${buildResult?.sourceMapSizeKB?.toFixed(1) || '?'} KB

      ## Benchmark
      Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed

      ## Improvements Applied
      ${improvements?.summary || 'No improvements'}

      ## Regression
      Verdict: ${regression?.verdict || 'unknown'}, Bundle delta: ${regression?.bundleSizeDeltaKB?.toFixed(1) || '?'} KB, Regressions: ${regression?.regressionCount || 0}

      ## Previous Metrics
      ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

      Generate the report with:
      - qualityScore: { before: previous iteration score or initial gate score, after: post-regression estimated score, delta }
      - bundleSize: { beforeKB, afterKB, deltaKB }
      - testResults: { before: "x/y passed", after: "x/y passed" }
      - changesSummary: 2-3 sentence summary of what changed
      - improvementsApplied: count
      - regressionsDetected: count
      - nextSteps: 3-5 suggested next steps for future iterations
      - overallVerdict: significant-improvement | marginal-improvement | no-change | regressed | blocked`,
      { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
    )

    // Store metrics for next iteration and history
    const iterationRecord = {
      iteration,
      qualityScore: report?.qualityScore?.after || qualityGate?.overallScore || 0,
      bundleSizeKB: regression?.newBundleSizeKB || buildResult?.bundleSizeKB || 0,
      testPassRate: regression?.newTestPassRate || (benchmark?.passedTests / Math.max(benchmark?.totalTests, 1)),
      featureCount: audit?.currentFeatures?.filter(f => f.working)?.length || 0,
      testCount: benchmark?.totalTests || 0,
      testPassed: benchmark?.passedTests || 0,
      improvementsApplied: improvements?.changesApplied?.length || 0,
      regressionsDetected: regression?.regressionCount || 0,
      verdict: report?.overallVerdict || 'unknown',
      changesSummary: improvements?.summary || '',
    }
    previousMetrics = iterationRecord
    runIterations.push(iterationRecord)

    log(`\n${'─'.repeat(60)}`)
    log(`ITERATION ${iteration} COMPLETE`)
    log(`  Quality: ${report?.qualityScore?.before || '?'} → ${report?.qualityScore?.after || '?'} (Δ${report?.qualityScore?.delta >= 0 ? '+' : ''}${report?.qualityScore?.delta || '?'})`)
    log(`  Bundle:  ${report?.bundleSize?.beforeKB?.toFixed(1) || '?'} → ${report?.bundleSize?.afterKB?.toFixed(1) || '?'} KB (Δ${report?.bundleSize?.deltaKB >= 0 ? '+' : ''}${report?.bundleSize?.deltaKB?.toFixed(1) || '?'})`)
    log(`  Verdict: ${report?.overallVerdict || 'unknown'}`)
    log(`${'─'.repeat(60)}\n`)

  } else {
    // skipReflect path — just report audit + benchmark
    log(`[${iteration}] Self-reflection skipped (skipReflect=true)`)

    const iterationRecord = {
      iteration,
      qualityScore: qualityGate?.overallScore || 0,
      bundleSizeKB: buildResult?.bundleSizeKB || 0,
      testPassRate: benchmark?.passedTests / Math.max(benchmark?.totalTests, 1),
      featureCount: audit?.currentFeatures?.filter(f => f.working)?.length || 0,
      testCount: benchmark?.totalTests || 0,
      testPassed: benchmark?.passedTests || 0,
      improvementsApplied: 0,
      regressionsDetected: 0,
      verdict: 'audit-only',
      changesSummary: '',
    }
    previousMetrics = iterationRecord
    runIterations.push(iterationRecord)

    phase('Report')
    log(`[${iteration}] Audit-only complete. Quality: ${qualityGate?.overallScore || '?'}/100, Bundle: ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB, Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0}`)
  }

} // end iteration loop

// ─── Persist history to disk ─────────────────────────────────────────────────

metricsHistory.runs.push({
  runId: currentRunId,
  iterations: runIterations,
})

const updatedHistoryJSON = JSON.stringify(metricsHistory, null, 2)

// Write history file via agent (uses Bash tool)
await agent(
  `Persist the metrics history file for deepseek-cli self-improvement.

  Write the following JSON to ${HISTORY_FILE}:

  ${updatedHistoryJSON}

  Use: Bash("Set-Content -Path '${HISTORY_FILE}' -Value @'
  <paste the JSON>
  '@ -Encoding UTF8")

  Or if the content is too large for a single command, use the Write tool to write to ${HISTORY_FILE}.

  After writing, verify: Bash("Test-Path '${HISTORY_FILE}'")
  Return "ok" on success.`,
  { label: 'save-history', model: 'haiku' },
)

log(`History saved to ${HISTORY_FILE}`)

// ─── Final summary with history trend ─────────────────────────────────────────

log(`\n${'═'.repeat(60)}`)
log(`ALL ITERATIONS COMPLETE`)
log(`${'═'.repeat(60)}`)

if (previousMetrics) {
  log(`Final bundle size: ${previousMetrics.bundleSizeKB?.toFixed(1) || '?'} KB`)
  log(`Final quality score: ${previousMetrics.qualityScore || '?'}/100`)
  log(`Final test pass rate: ${((previousMetrics.testPassRate || 0) * 100).toFixed(0)}%`)
  log(`Features: ${previousMetrics.featureCount || '?'}`)
}

// ─── History trend table ─────────────────────────────────────────────────────

const allRecords = metricsHistory.runs.flatMap(r =>
  r.iterations.map(it => ({ runId: r.runId, ...it }))
)

if (allRecords.length > 0) {
  log(`\n${'─'.repeat(60)}`)
  log(`METRICS HISTORY (${allRecords.length} data points across ${metricsHistory.runs.length} runs)`)
  log(`${'─'.repeat(60)}`)

  // ASCII table header
  const hdr = '| Run         | Iter | Quality | Bundle KB | Pass Rate | Features | Verdict              |'
  const sep = '|' + '-'.repeat(13) + '|' + '-'.repeat(6) + '|' + '-'.repeat(9) + '|' + '-'.repeat(11) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(22) + '|'
  log(hdr)
  log(sep)

  for (const r of allRecords) {
    const quality = String(r.qualityScore).padEnd(7)
    const bundle = (r.bundleSizeKB || 0).toFixed(1).padEnd(8)
    const passRate = ((r.testPassRate || 0) * 100).toFixed(0) + '%'
    const features = String(r.featureCount || 0).padEnd(8)
    const verdict = (r.verdict || '?').padEnd(20)
    const row = `| ${r.runId.padEnd(11)} | ${String(r.iteration).padEnd(3)} | ${quality} | ${bundle} | ${passRate.padEnd(8)} | ${features} | ${verdict} |`
    log(row)
  }

  log(sep)

  // Trend summary: first → last
  const first = allRecords[0]
  const last = allRecords[allRecords.length - 1]
  const qDelta = (last.qualityScore || 0) - (first.qualityScore || 0)
  const bDelta = (last.bundleSizeKB || 0) - (first.bundleSizeKB || 0)
  const pDelta = ((last.testPassRate || 0) - (first.testPassRate || 0)) * 100
  const fDelta = (last.featureCount || 0) - (first.featureCount || 0)

  log(`\nTrend (first → last):`)
  log(`  Quality:    ${first.qualityScore} → ${last.qualityScore} (${qDelta >= 0 ? '+' : ''}${qDelta})`)
  log(`  Bundle:     ${first.bundleSizeKB?.toFixed(1)} → ${last.bundleSizeKB?.toFixed(1)} KB (${bDelta >= 0 ? '+' : ''}${bDelta.toFixed(1)})`)
  log(`  Pass rate:  ${((first.testPassRate || 0) * 100).toFixed(0)}% → ${((last.testPassRate || 0) * 100).toFixed(0)}% (${pDelta >= 0 ? '+' : ''}${pDelta.toFixed(0)}%)`)
  log(`  Features:   ${first.featureCount} → ${last.featureCount} (${fDelta >= 0 ? '+' : ''}${fDelta})`)

  // Sparkline-style quality score visual
  const scores = allRecords.map(r => r.qualityScore || 0)
  const maxScore = Math.max(...scores, 1)
  const barLen = 20
  log(`\nQuality score visual (${barLen} chars = 100):`)
  for (const r of allRecords) {
    const filled = Math.round((r.qualityScore / 100) * barLen)
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
    log(`  ${r.runId} #${r.iteration}: ${bar} ${r.qualityScore}`)
  }
}

log(`\nWorkflow complete. Review the bundled artifact at: ${BUNDLE_PATH}`)
log(`Source map for debugging: ${BUNDLE_MAP_PATH}`)
log(`Metrics history: ${HISTORY_FILE}`)
