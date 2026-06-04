export const meta = {
  name: 'demo-bun-image-self-improve',
  description: 'Iterative self-improving workflow for demo-bun-image bun app. Builds minified bundle with sourcemaps, runs quality gates, benchmarks Bun.Image API coverage, self-reflects, applies improvements, and regression-tests each iteration.',
  whenToUse: 'Run to iteratively improve demo-bun-image. Each iteration audits → quality-gates → builds → benchmarks → reflects → improves. Quality measured on bundled dist/demo-bun-image.js.',
  phases: [
    { title: 'History', detail: 'Load metrics history from previous runs, display trend summary' },
    { title: 'Audit', detail: 'Inventory current state: source files, tests, bundle size, API coverage, known issues' },
    { title: 'Quality-Gate', detail: 'Evaluate quality metrics: bundle size, test coverage, API coverage, code health, output correctness' },
    { title: 'Build', detail: 'Build minified dist/demo-bun-image.js with external sourcemaps, measure build time and output size' },
    { title: 'Benchmark', detail: 'Run test suite and demo benchmarks against the bundled artifact: API coverage, output file integrity, format support' },
    { title: 'Self-Reflect', detail: 'Analyze benchmark results, identify improvement targets, prioritize by impact/effort (Opus)' },
    { title: 'Improve', detail: 'Implement top-priority improvements: new API demos, tests, bundle size reduction, code quality' },
    { title: 'Regression', detail: 'Re-build, re-benchmark, verify no regressions. Compare metrics to previous iteration' },
    { title: 'Report', detail: 'Generate iteration report: delta metrics, changes applied, remaining issues, next-step suggestions. Append to persistent history.' },
  ],
}

/*
 * demo-bun-image-self-improve workflow
 *
 * Iterative self-improvement loop for the demo-bun-image Bun app.
 *
 * Usage:
 *   Workflow({ name: 'demo-bun-image-self-improve' })
 *   Workflow({ name: 'demo-bun-image-self-improve', args: { iterations: 3 } })
 *   Workflow({ name: 'demo-bun-image-self-improve', args: { skipBuild: true } })
 *   Workflow({ name: 'demo-bun-image-self-improve', args: { targetBundleSizeKB: 15 } })
 *
 * Quality dimensions:
 *   1. Bundle size (KB) — smaller is better, measured on dist/demo-bun-image.js
 *   2. Test coverage — % of Bun.Image API surface covered by tests
 *   3. API coverage — number of Bun.Image methods/options exercised
 *   4. Output correctness — generated images are valid and have expected dimensions/format
 *   5. Code health — lines of code, duplication, readability, no dead code
 *   6. Build quality — sourcemap valid, bundle runs, minification ratio
 *
 * Each iteration:
 *   Audit → Quality-Gate → Build → Benchmark → Self-Reflect → Improve → Regression → Report
 *
 * The workflow uses the bundled artifact (dist/demo-bun-image.js) for ALL quality
 * measurements. Bundle is built with external sourcemaps for debugging;
 * sourcemaps can be deleted and the bundle still runs standalone.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const APP_DIR = 'bun_apps/demo-bun-image'
const DIST_DIR = 'dist'
const BUNDLE_NAME = 'demo-bun-image.js'
const BUNDLE_MAP_NAME = 'demo-bun-image.js.map'
const BUNDLE_PATH = `${DIST_DIR}/${BUNDLE_NAME}`
const BUNDLE_MAP_PATH = `${DIST_DIR}/${BUNDLE_MAP_NAME}`
const SRC_ENTRY = `${APP_DIR}/src/index.ts`
const TEST_FILE = `${APP_DIR}/src/index.test.ts`
const HISTORY_FILE = `${DIST_DIR}/demo-bun-image-metrics-history.json`
const OUTPUT_DIR = 'output'

const DEFAULTS = {
  iterations: 1,
  targetBundleSizeKB: 15,       // target max bundle size in KB
  minTestPassRate: 0.95,        // minimum test pass rate (0-1)
  minApiCoverage: 15,           // minimum Bun.Image API methods covered
  skipBuild: false,
  skipReflect: false,
}

const config = { ...DEFAULTS, ...(args || {}) }

// ─── Bun.Image API surface (for coverage tracking) ──────────────────────────

const BUN_IMAGE_API = [
  'constructor(path)',
  'constructor(buffer)',
  'constructor(BunFile)',
  'Bun.file().image()',
  'metadata()',
  'resize(width)',
  'resize(width, height)',
  'resize(width, height, {fit})',
  'resize(width, height, {filter})',
  'rotate(degrees)',
  'flip()',
  'flop()',
  'modulate({brightness})',
  'modulate({saturation})',
  'jpeg({quality})',
  'jpeg({progressive})',
  'png({compressionLevel})',
  'png({palette})',
  'webp({quality})',
  'webp({lossless})',
  'bytes()',
  'buffer()',
  'blob()',
  'toBase64()',
  'dataurl()',
  'placeholder()',
  'write(path)',
  'fromClipboard()',
]

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
                apiCoverage: { type: 'number' },
                testCount: { type: 'number' },
                testPassed: { type: 'number' },
                demoCount: { type: 'number' },
                improvementsApplied: { type: 'number' },
                regressionsDetected: { type: 'number' },
                verdict: { type: 'string' },
                changesSummary: { type: 'string' },
              },
              required: ['iteration', 'qualityScore', 'bundleSizeKB', 'testPassRate', 'apiCoverage'],
            },
          },
        },
        required: ['runId', 'iterations'],
      },
    },
  },
  required: ['runs'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    sourceFiles: { type: 'array', items: { type: 'string' } },
    testFiles: { type: 'array', items: { type: 'string' } },
    codeLines: { type: 'number' },
    testCount: { type: 'number' },
    demoFunctions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          apisCovered: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['name', 'apisCovered', 'description'],
      },
    },
    apiMethodsCovered: { type: 'array', items: { type: 'string' } },
    apiMethodsMissing: { type: 'array', items: { type: 'string' } },
    existingBundleSizeKB: { type: 'number' },
    dependencyCount: { type: 'number' },
    knownIssues: { type: 'array', items: { type: 'string' } },
    potentialImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['title', 'description', 'effort', 'impact'],
      },
    },
  },
  required: ['sourceFiles', 'testFiles', 'codeLines', 'testCount', 'demoFunctions', 'apiMethodsCovered', 'apiMethodsMissing', 'existingBundleSizeKB', 'dependencyCount'],
}

const QUALITY_GATE_SCHEMA = {
  type: 'object',
  properties: {
    overallScore: { type: 'number' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          score: { type: 'number' },
          metric: { type: 'string' },
          target: { type: 'string' },
          pass: { type: 'boolean' },
          gap: { type: 'string' },
        },
        required: ['name', 'score', 'metric', 'target', 'pass'],
      },
    },
    passing: { type: 'number' },
    total: { type: 'number' },
    verdict: { type: 'string', enum: ['excellent', 'good', 'acceptable', 'needs-work', 'failing'] },
    blockers: { type: 'array', items: { type: 'string' } },
    improvementAreas: { type: 'array', items: { type: 'string' } },
  },
  required: ['overallScore', 'dimensions', 'passing', 'total', 'verdict'],
}

const BUILD_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    bundlePath: { type: 'string' },
    bundleSizeKB: { type: 'number' },
    sourceMapPath: { type: 'string' },
    sourceMapSizeKB: { type: 'number' },
    buildTimeMs: { type: 'number' },
    buildCommand: { type: 'string' },
    minified: { type: 'boolean' },
    targetRuntime: { type: 'string' },
    minificationRatio: { type: 'number', description: 'bundle size / source size (lower = better compression)' },
    warnings: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
    bundleRunsStandalone: { type: 'boolean', description: 'Does the bundle run without the sourcemap present?' },
  },
  required: ['success', 'bundlePath', 'bundleSizeKB', 'buildTimeMs', 'minified'],
}

const BENCHMARK_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    totalTests: { type: 'number' },
    passedTests: { type: 'number' },
    failedTests: { type: 'number' },
    totalLatencyMs: { type: 'number' },
    bundleLoadMs: { type: 'number' },
    testResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: ['metadata', 'resize', 'convert', 'modulate', 'flip', 'encode', 'placeholder', 'base64', 'serve', 'clipboard', 'bundle-integrity'] },
          passed: { type: 'boolean' },
          latencyMs: { type: 'number' },
          observedBehavior: { type: 'string' },
          failureReason: { type: 'string' },
        },
        required: ['name', 'category', 'passed', 'latencyMs'],
      },
    },
    apiCoverage: {
      type: 'object',
      properties: {
        covered: { type: 'array', items: { type: 'string' } },
        missing: { type: 'array', items: { type: 'string' } },
        coveragePercent: { type: 'number' },
      },
    },
    outputFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          format: { type: 'string' },
          sizeBytes: { type: 'number' },
          valid: { type: 'boolean' },
        },
        required: ['name', 'format', 'sizeBytes', 'valid'],
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['overallPassed', 'totalTests', 'passedTests', 'failedTests', 'totalLatencyMs', 'testResults', 'recommendations'],
}

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    improvementPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', enum: ['api-coverage', 'test-coverage', 'bundle-size', 'code-quality', 'demo-feature', 'output-correctness', 'developer-experience'] },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
          approach: { type: 'string' },
          filesToModify: { type: 'array', items: { type: 'string' } },
          estimatedBundleSizeDeltaKB: { type: 'number' },
          riskLevel: { type: 'string', enum: ['safe', 'moderate', 'risky'] },
        },
        required: ['priority', 'title', 'description', 'category', 'effort', 'impact', 'approach'],
      },
    },
    bundleSizeAnalysis: { type: 'string' },
    apiGapAnalysis: { type: 'string' },
    architecturalSuggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['strengths', 'weaknesses', 'improvementPlan', 'bundleSizeAnalysis', 'apiGapAnalysis'],
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
          change: { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string', enum: ['applied', 'skipped', 'failed'] },
          reason: { type: 'string' },
        },
        required: ['file', 'change', 'category', 'status'],
      },
    },
    testsAdded: { type: 'number' },
    demosAdded: { type: 'number' },
    linesChanged: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['changesApplied', 'testsAdded', 'demosAdded', 'linesChanged', 'summary'],
}

const REGRESSION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    previousBundleSizeKB: { type: 'number' },
    newBundleSizeKB: { type: 'number' },
    bundleSizeDeltaKB: { type: 'number' },
    previousTestPassRate: { type: 'number' },
    newTestPassRate: { type: 'number' },
    testPassRateDelta: { type: 'number' },
    buildStillWorks: { type: 'boolean' },
    bundleRunsWithoutSourcemap: { type: 'boolean' },
    allTestsPass: { type: 'boolean' },
    regressionCount: { type: 'number' },
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
    improvements: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['improved', 'neutral', 'regressed', 'blocked'] },
  },
  required: ['overallPassed', 'previousBundleSizeKB', 'newBundleSizeKB', 'bundleSizeDeltaKB', 'buildStillWorks', 'allTestsPass', 'regressionCount', 'regressions', 'verdict'],
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
    testResults: {
      type: 'object',
      properties: {
        before: { type: 'string' },
        after: { type: 'string' },
      },
    },
    apiCoverage: {
      type: 'object',
      properties: {
        before: { type: 'number' },
        after: { type: 'number' },
      },
    },
    changesSummary: { type: 'string' },
    improvementsApplied: { type: 'number' },
    regressionsDetected: { type: 'number' },
    nextSteps: { type: 'array', items: { type: 'string' } },
    overallVerdict: { type: 'string', enum: ['significant-improvement', 'marginal-improvement', 'no-change', 'regressed', 'blocked'] },
  },
  required: ['iteration', 'qualityScore', 'changesSummary', 'improvementsApplied', 'regressionsDetected', 'overallVerdict'],
}

// ─── Phase 0: History — load previous metrics and show trend ──────────────────

phase('History')

const historyResult = await agent(
  `You are loading the metrics history for demo-bun-image self-improvement.

  ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

  Step 1 — Ensure the dist directory exists:
  Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

  Step 2 — Check if the history file exists and read it:
  Bash("if (Test-Path '${HISTORY_FILE}') { Get-Content '${HISTORY_FILE}' -Raw } else { '{ \"runs\": [] }' }")

  Step 3 — Parse the JSON. If it's invalid or empty, return { runs: [] }.
  If it loaded successfully, return the full history.

  Step 4 — If there is history, produce a brief trend summary:
  - How many previous runs?
  - What's the trend for quality score, bundle size, test pass rate, API coverage?
  - What was the last known state?

  Return the full parsed history object.`,
  { label: 'load-history', phase: 'History', model: 'haiku', schema: HISTORY_SCHEMA },
)

const metricsHistory = historyResult || { runs: [] }
const totalPreviousRuns = metricsHistory.runs.length
const currentRunId = `run-${totalPreviousRuns + 1}`

const allHistoricalRecords = metricsHistory.runs.flatMap(r => r.iterations)

if (allHistoricalRecords.length > 0) {
  const lastRecord = allHistoricalRecords[allHistoricalRecords.length - 1]
  const firstRecord = allHistoricalRecords[0]
  log(`History: ${totalPreviousRuns} previous runs, ${allHistoricalRecords.length} total iterations`)
  log(`  First → Last quality score: ${firstRecord.qualityScore} → ${lastRecord.qualityScore}`)
  log(`  First → Last bundle size:   ${firstRecord.bundleSizeKB?.toFixed(1)} → ${lastRecord.bundleSizeKB?.toFixed(1)} KB`)
  log(`  First → Last test pass rate: ${(firstRecord.testPassRate * 100).toFixed(0)}% → ${(lastRecord.testPassRate * 100).toFixed(0)}%`)
  log(`  First → Last API coverage:   ${firstRecord.apiCoverage} → ${lastRecord.apiCoverage} methods`)
} else {
  log('History: No previous runs found. Starting fresh.')
}

// ─── Iteration loop ──────────────────────────────────────────────────────────

const MAX_ITERATIONS = Math.min(config.iterations, 5)
let previousMetrics = allHistoricalRecords.length > 0
  ? allHistoricalRecords[allHistoricalRecords.length - 1]
  : null
const runIterations = []

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {

  log(`\n${'═'.repeat(60)}`)
  log(`ITERATION ${iteration} of ${MAX_ITERATIONS}`)
  log(`${'═'.repeat(60)}\n`)

  // ====================================================================
  // PHASE 1: Audit — inventory current state
  // ====================================================================
  phase('Audit')

  log(`[${iteration}] Phase 1: Auditing current demo-bun-image state...`)

  const audit = await agent(
    `You are auditing the demo-bun-image Bun app at "${APP_DIR}".

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    Step 1 — Map all source and test files:
    - Glob("${APP_DIR}/src/**/*.ts")

    Step 2 — Read key files:
    - Read "${APP_DIR}/package.json"
    - Read "${APP_DIR}/src/index.ts" (full source — this is the main demo)
    - Read "${APP_DIR}/src/index.test.ts" (full test file)

    Step 3 — Check for existing bundle:
    - Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 0 }")

    Step 4 — Analyze source code:
    - Count total non-blank, non-comment lines in src/index.ts
    - Count test cases in the test file
    - Extract all demo function names (functions starting with "demo")
    - For each demo function, list which Bun.Image API methods it exercises
    - Find any TODO/FIXME/HACK comments
    - Count PNG generator helper lines vs actual demo lines

    Step 5 — Map API coverage:
    The full Bun.Image API surface is:
    ${JSON.stringify(BUN_IMAGE_API)}

    For each API method, check if it's exercised in either the demo or test code.
    Build apiMethodsCovered and apiMethodsMissing arrays.

    Step 6 — Produce audit result with all required fields.`,
    { label: `audit-${iteration}`, phase: 'Audit', model: 'haiku', schema: AUDIT_SCHEMA },
  )

  log(`[${iteration}] Audit: ${audit?.demoFunctions?.length || 0} demos, ${audit?.testCount || 0} tests, ${audit?.apiMethodsCovered?.length || 0}/${BUN_IMAGE_API.length} API methods, ${audit?.codeLines || 0} lines`)

  // ====================================================================
  // PHASE 2: Quality Gate — evaluate against targets
  // ====================================================================
  phase('Quality-Gate')

  log(`[${iteration}] Phase 2: Running quality gate evaluation...`)

  const qualityGate = await agent(
    `You are evaluating the quality of the demo-bun-image Bun app against defined targets.

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    ## Audit Results
    ${JSON.stringify(audit, null, 2)}

    ## Quality Targets
    - Bundle size: < ${config.targetBundleSizeKB} KB (minified, without sourcemap)
    - Test pass rate: >= ${config.minTestPassRate} (${config.minTestPassRate * 100}%)
    - Minimum API coverage: >= ${config.minApiCoverage} Bun.Image methods exercised
    - Sourcemap: must exist alongside bundle, but bundle must run standalone without it
    - Zero external dependencies (demo should use only Bun built-ins)

    ## Evaluation Dimensions

    1. **bundle-size**: Score based on existingBundleSizeKB vs target.
       90+ if under target, 70 if within 20%, 50 if within 50%.
       If no bundle exists, score 0 (blocked).

    2. **test-coverage**: Score = (testCount / apiMethodsCovered.length) * 100.
       At least 1 test per API method is the goal.

    3. **api-coverage**: Score = (apiMethodsCovered.length / ${BUN_IMAGE_API.length}) * 100.
       Higher is better — aim for comprehensive Bun.Image coverage.

    4. **output-correctness**: Are generated images valid? Do they have expected
       dimensions and formats? Score based on test pass rate.

    5. **code-health**: Score based on code organization, helper:demo ratio,
       duplication between index.ts and index.test.ts (PNG generator is duplicated).
       Less duplication = better.

    6. **build-quality**: Does the build produce a clean minified bundle with
       a valid external sourcemap? Can the bundle run without the sourcemap?

    Produce verdict, blockers, and improvement areas.`,
    { label: `quality-gate-${iteration}`, phase: 'Quality-Gate', model: 'haiku', schema: QUALITY_GATE_SCHEMA },
  )

  log(`[${iteration}] Quality gate: score ${qualityGate?.overallScore || 0}/100, verdict: ${qualityGate?.verdict || 'unknown'}`)
  if (qualityGate?.blockers?.length) {
    log(`[${iteration}] Blockers: ${qualityGate.blockers.join('; ')}`)
  }

  // ====================================================================
  // PHASE 3: Build — create minified bundle with external sourcemaps
  // ====================================================================
  phase('Build')

  let buildResult = null

  if (!config.skipBuild) {
    log(`[${iteration}] Phase 3: Building dist/${BUNDLE_NAME} with external sourcemaps...`)

    buildResult = await agent(
      `You are building the demo-bun-image Bun app into a single minified bundle with external sourcemaps.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Build Requirements
      1. Single output file: dist/demo-bun-image.js (minified)
      2. External sourcemap: dist/demo-bun-image.js.map (debuggable)
      3. The bundle MUST run standalone even if the .map file is deleted
      4. Target: Bun runtime
      5. No shebang needed (this is a library, not a CLI tool)

      ## Step 1: Ensure dist directory exists
      Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

      ## Step 2: Measure source size for minification ratio
      Bash("(Get-Item '${SRC_ENTRY}').Length / 1KB")

      ## Step 3: Build with minify + external sourcemap
      bun build outputs index.js by default. We need to rename it.
      Run the package.json build script:
      Bash("cd ${APP_DIR} && bun run build 2>&1")

      ## Step 4: Verify the build outputs
      - Bash("Test-Path '${BUNDLE_PATH}'")
      - Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 0 }")
      - Bash("Test-Path '${BUNDLE_MAP_PATH}'")
      - Bash("if (Test-Path '${BUNDLE_MAP_PATH}') { (Get-Item '${BUNDLE_MAP_PATH}').Length / 1KB } else { 0 }")

      ## Step 5: Time the build
      Bash("Measure-Command { cd ${APP_DIR} && bun run build 2>&1 | Out-Null } | Select-Object -ExpandProperty TotalMilliseconds")

      ## Step 6: Verify bundle runs standalone
      Bash("bun '${BUNDLE_PATH}' --demo metadata --output ./output 2>&1")
      Check it exits successfully with exit code 0.

      ## Step 7: Verify bundle runs WITHOUT sourcemap
      Temporarily rename the sourcemap:
      Bash("if (Test-Path '${BUNDLE_MAP_PATH}') { Move-Item '${BUNDLE_MAP_PATH}' '${BUNDLE_MAP_PATH}.bak' -Force }")
      Bash("bun '${BUNDLE_PATH}' --demo metadata --output ./output 2>&1")
      Restore it:
      Bash("if (Test-Path '${BUNDLE_MAP_PATH}.bak') { Move-Item '${BUNDLE_MAP_PATH}.bak' '${BUNDLE_MAP_PATH}' -Force }")

      ## Step 8: Record build result
      - success, bundlePath, bundleSizeKB, sourceMapPath, sourceMapSizeKB
      - buildTimeMs, buildCommand, minified: true, targetRuntime: "bun"
      - minificationRatio: bundleSizeKB / sourceSizeKB
      - bundleRunsStandalone: true/false`,
      { label: `build-${iteration}`, phase: 'Build', model: 'sonnet', schema: BUILD_RESULT_SCHEMA },
    )

    log(`[${iteration}] Build: ${buildResult?.success ? 'OK' : 'FAILED'} — ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB in ${buildResult?.buildTimeMs?.toFixed(0) || '?'}ms, standalone: ${buildResult?.bundleRunsStandalone}`)
  } else {
    log(`[${iteration}] Build: skipped (using existing bundle)`)
    buildResult = { success: true, bundlePath: BUNDLE_PATH, bundleSizeKB: audit?.existingBundleSizeKB || 0, buildTimeMs: 0, sourceMapPath: BUNDLE_MAP_PATH, minified: true, targetRuntime: 'bun' }
  }

  if (!buildResult?.success) {
    log(`[${iteration}] BUILD FAILED — ending iteration early.`)
    break
  }

  // ====================================================================
  // PHASE 4: Benchmark — run tests and demo against bundled artifact
  // ====================================================================
  phase('Benchmark')

  log(`[${iteration}] Phase 4: Running benchmarks against bundled artifact...`)

  const benchmark = await agent(
    `You are benchmarking the bundled demo-bun-image at "${BUNDLE_PATH}".

    ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

    IMPORTANT: Use the BUNDLED artifact "${BUNDLE_PATH}" for all runtime tests, NOT "bun src/index.ts".
    The unit test suite should be run normally with bun test.

    ## Benchmark Suite

    ### Category 1: Unit tests
    1. **unit-tests**: Run the test suite
       Bash("cd ${APP_DIR} && bun test 2>&1")
       Record pass/fail counts.

    ### Category 2: Bundle integrity
    2. **bundle-load-time**: Time loading the bundle
       Bash("Measure-Command { bun '${BUNDLE_PATH}' --demo metadata --output ./output 2>&1 | Out-Null } | Select-Object -ExpandProperty TotalMilliseconds")
    3. **source-map-exists**: Bash("Test-Path '${BUNDLE_MAP_PATH}'")
    4. **bundle-minified-size**: Bash("(Get-Item '${BUNDLE_PATH}').Length")

    ### Category 3: Demo execution (each demo against the bundle)
    5. **demo-metadata**: Bash("bun '${BUNDLE_PATH}' --demo metadata --output ./output 2>&1")
    6. **demo-resize**: Bash("bun '${BUNDLE_PATH}' --demo resize --output ./output 2>&1")
    7. **demo-convert**: Bash("bun '${BUNDLE_PATH}' --demo convert --output ./output 2>&1")
    8. **demo-modulate**: Bash("bun '${BUNDLE_PATH}' --demo modulate --output ./output 2>&1")
    9. **demo-flip**: Bash("bun '${BUNDLE_PATH}' --demo flip --output ./output 2>&1")
    10. **demo-encode**: Bash("bun '${BUNDLE_PATH}' --demo encode --output ./output 2>&1")
    11. **demo-placeholder**: Bash("bun '${BUNDLE_PATH}' --demo placeholder --output ./output 2>&1")
    12. **demo-base64**: Bash("bun '${BUNDLE_PATH}' --demo base64 --output ./output 2>&1")
    13. **demo-all**: Run all demos and verify no errors
        Bash("bun '${BUNDLE_PATH}' --output ./output 2>&1")

    ### Category 4: Output file validation
    14. **output-files-valid**: After running --demo all, list the output directory
        Bash("Get-ChildItem ./output | ForEach-Object { '{0} {1} bytes' -f $_.Name, $_.Length }")
        For each generated file, verify it exists and has non-zero size.

    ### Category 5: Image format verification
    15. **format-jpeg**: Verify output/converted.jpeg exists and has JPEG magic bytes
    16. **format-webp**: Verify output/converted.webp exists and has WebP magic bytes
    17. **format-png**: Verify output/source.png exists and has PNG magic bytes

    ## API Coverage Check
    After running all demos, determine which Bun.Image API methods were exercised
    by checking for "✅" markers and successful operations in the output.

    Known API surface: ${JSON.stringify(BUN_IMAGE_API)}

    Produce the full benchmark result with test results, API coverage, and recommendations.`,
    { label: `benchmark-${iteration}`, phase: 'Benchmark', model: 'sonnet', schema: BENCHMARK_RESULT_SCHEMA },
  )

  log(`[${iteration}] Benchmark: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed, ${benchmark?.apiCoverage?.coveragePercent?.toFixed(0) || '?'}% API coverage`)

  // ====================================================================
  // PHASE 5: Self-Reflect — analyze and plan improvements (Opus)
  // ====================================================================
  phase('Self-Reflect')

  if (!config.skipReflect) {
    log(`[${iteration}] Phase 5: Self-reflecting on benchmark results (Opus)...`)

    const reflection = await agent(
      `You are a senior image processing API expert performing a deep self-reflection on the demo-bun-image app.

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

      ## Full Bun.Image API surface
      ${JSON.stringify(BUN_IMAGE_API)}

      ## Your Task

      1. **strengths**: What the demo does well (API coverage, test quality, output correctness)
      2. **weaknesses**: What needs improvement (missing APIs, code duplication, test gaps)
      3. **improvementPlan**: Prioritized list (max 5) with concrete implementation approaches
         - Focus on: covering more Bun.Image API surface, reducing PNG generator duplication,
           adding missing demos (e.g. HEIC/AVIF with graceful fallback, data: URL input,
           security options like maxPixels/autoOrient, Bun.s3().image())
         - Each must have filesToModify and estimatedBundleSizeDeltaKB
         - High impact + low effort first
      4. **bundleSizeAnalysis**: Where does the 11 KB come from? Can the PNG generator
         helpers be reduced? Can tests share the helper code?
      5. **apiGapAnalysis**: Which Bun.Image methods are missing? Group by theme
         (input sources, transforms, output formats, platform features).
      6. **architecturalSuggestions**: Should the PNG generator be extracted to a shared
         module? Should tests import from index.ts instead of duplicating?

      CONSTRAINTS:
      - Maximum 5 improvements per iteration
      - Must not break existing 21 tests
      - Must maintain zero-dependency policy
      - Prefer reducing code duplication`,
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
      `You are implementing improvements to the demo-bun-image Bun app.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Improvement Plan (from reflection)
      ${JSON.stringify(reflection?.improvementPlan || [], null, 2)}

      ## Current Source Code Location
      - Main source: ${SRC_ENTRY}
      - Tests: ${TEST_FILE}
      - Package config: ${APP_DIR}/package.json

      ## Implementation Rules
      1. Read the current source files FIRST before making any changes
      2. Implement ONLY the improvements listed in the plan
      3. Each improvement: read → modify → verify
      4. After ALL changes, run the test suite:
         Bash("cd ${APP_DIR} && bun test 2>&1")
      5. If tests fail, debug and fix before proceeding
      6. For each change, record: file, change description, category, status

      ## Code Quality Guidelines
      - Extract the PNG generator to a shared helper if it reduces duplication
      - Keep demos focused: each demo exercises specific API surface
      - Add tests for any new API methods covered
      - Use the same arg parsing pattern already in the file
      - Follow existing code style (no unnecessary abstractions)

      ## Bundle Size Guidelines
      - Zero external dependencies
      - Prefer inline implementations
      - Use Bun built-in APIs only
      - Keep the PNG generator minimal

      After implementing:
      1. Bash("cd ${APP_DIR} && bun test 2>&1")
      2. Bash("bun '${BUNDLE_PATH}' --demo metadata 2>&1")
      3. Record all changes, tests added, demos added, lines changed.`,
      { label: `improve-${iteration}`, phase: 'Improve', model: 'sonnet', schema: IMPROVEMENT_RESULT_SCHEMA },
    )

    log(`[${iteration}] Improvements: ${improvements?.changesApplied?.length || 0} changes, ${improvements?.demosAdded || 0} new demos, ${improvements?.testsAdded || 0} new tests`)

    // ====================================================================
    // PHASE 7: Regression — re-build, re-benchmark, verify
    // ====================================================================
    phase('Regression')

    log(`[${iteration}] Phase 7: Running regression checks...`)

    const regression = await agent(
      `You are running regression tests after improvements were applied to demo-bun-image.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Previous Metrics
      - Bundle size: ${buildResult?.bundleSizeKB || 0} KB
      - Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed

      ## Improvements Applied
      ${JSON.stringify(improvements?.changesApplied || [], null, 2)}

      ## Step 1: Re-build the bundle
      Bash("cd ${APP_DIR} && bun run build 2>&1")

      ## Step 2: Measure new bundle size
      Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 0 }")

      ## Step 3: Verify source map exists
      Bash("Test-Path '${BUNDLE_MAP_PATH}'")

      ## Step 4: Run the test suite
      Bash("cd ${APP_DIR} && bun test 2>&1")

      ## Step 5: Verify bundle still runs
      Bash("bun '${BUNDLE_PATH}' --demo metadata --output ./output 2>&1")

      ## Step 6: Test bundle runs WITHOUT sourcemap
      Bash("if (Test-Path '${BUNDLE_MAP_PATH}') { Move-Item '${BUNDLE_MAP_PATH}' '${BUNDLE_MAP_PATH}.bak' -Force }")
      Bash("bun '${BUNDLE_PATH}' --demo resize --output ./output 2>&1")
      Bash("if (Test-Path '${BUNDLE_MAP_PATH}.bak') { Move-Item '${BUNDLE_MAP_PATH}.bak' '${BUNDLE_MAP_PATH}' -Force }")

      ## Step 7: Compare metrics and produce regression results.
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
      `You are generating a summary report for iteration ${iteration} of demo-bun-image self-improvement.

      ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable.

      ## Audit Summary
      Demos: ${audit?.demoFunctions?.length || 0}, Tests: ${audit?.testCount || 0}, API methods covered: ${audit?.apiMethodsCovered?.length || 0}/${BUN_IMAGE_API.length}

      ## Quality Gate
      Score: ${qualityGate?.overallScore || 0}/100 (${qualityGate?.verdict || 'unknown'})

      ## Build
      Bundle: ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB, Minified: ${buildResult?.minified}, Standalone: ${buildResult?.bundleRunsStandalone}

      ## Benchmark
      Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0} passed, API coverage: ${benchmark?.apiCoverage?.coveragePercent?.toFixed(0) || '?'}%

      ## Improvements Applied
      ${improvements?.summary || 'No improvements'}

      ## Regression
      Verdict: ${regression?.verdict || 'unknown'}, Bundle delta: ${regression?.bundleSizeDeltaKB?.toFixed(1) || '?'} KB, Regressions: ${regression?.regressionCount || 0}

      ## Previous Metrics
      ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

      Generate the report with all required fields.`,
      { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
    )

    const iterationRecord = {
      iteration,
      qualityScore: report?.qualityScore?.after || qualityGate?.overallScore || 0,
      bundleSizeKB: regression?.newBundleSizeKB || buildResult?.bundleSizeKB || 0,
      testPassRate: regression?.newTestPassRate || (benchmark?.passedTests / Math.max(benchmark?.totalTests, 1)),
      apiCoverage: audit?.apiMethodsCovered?.length || 0,
      testCount: benchmark?.totalTests || 0,
      testPassed: benchmark?.passedTests || 0,
      demoCount: audit?.demoFunctions?.length || 0,
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
    log(`  API:     ${report?.apiCoverage?.before || '?'} → ${report?.apiCoverage?.after || '?'} methods covered`)
    log(`  Verdict: ${report?.overallVerdict || 'unknown'}`)
    log(`${'─'.repeat(60)}\n`)

  } else {
    log(`[${iteration}] Self-reflection skipped (skipReflect=true)`)

    const iterationRecord = {
      iteration,
      qualityScore: qualityGate?.overallScore || 0,
      bundleSizeKB: buildResult?.bundleSizeKB || 0,
      testPassRate: benchmark?.passedTests / Math.max(benchmark?.totalTests, 1),
      apiCoverage: audit?.apiMethodsCovered?.length || 0,
      testCount: benchmark?.totalTests || 0,
      testPassed: benchmark?.passedTests || 0,
      demoCount: audit?.demoFunctions?.length || 0,
      improvementsApplied: 0,
      regressionsDetected: 0,
      verdict: 'audit-only',
      changesSummary: '',
    }
    previousMetrics = iterationRecord
    runIterations.push(iterationRecord)

    phase('Report')
    log(`[${iteration}] Audit-only complete. Quality: ${qualityGate?.overallScore || '?'}/100, Bundle: ${buildResult?.bundleSizeKB?.toFixed(1) || '?'} KB, Tests: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0}, API: ${audit?.apiMethodsCovered?.length || 0}/${BUN_IMAGE_API.length}`)
  }

} // end iteration loop

// ─── Persist history to disk ─────────────────────────────────────────────────

metricsHistory.runs.push({
  runId: currentRunId,
  iterations: runIterations,
})

const updatedHistoryJSON = JSON.stringify(metricsHistory, null, 2)

await agent(
  `Persist the metrics history file for demo-bun-image self-improvement.

  Write the following JSON to ${HISTORY_FILE}:

  ${updatedHistoryJSON}

  Use the Write tool to write to ${HISTORY_FILE}.

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
  log(`Final API coverage: ${previousMetrics.apiCoverage || '?'}/${BUN_IMAGE_API.length} methods`)
  log(`Final demo count: ${previousMetrics.demoCount || '?'}`)
}

// ─── History trend table ─────────────────────────────────────────────────────

const allRecords = metricsHistory.runs.flatMap(r =>
  r.iterations.map(it => ({ runId: r.runId, ...it }))
)

if (allRecords.length > 0) {
  log(`\n${'─'.repeat(80)}`)
  log(`METRICS HISTORY (${allRecords.length} data points across ${metricsHistory.runs.length} runs)`)
  log(`${'─'.repeat(80)}`)

  const hdr = '| Run         | Iter | Quality | Bundle KB | Pass Rate | API Cov | Demos | Verdict              |'
  const sep = '|' + '-'.repeat(13) + '|' + '-'.repeat(6) + '|' + '-'.repeat(9) + '|' + '-'.repeat(11) + '|' + '-'.repeat(10) + '|' + '-'.repeat(8) + '|' + '-'.repeat(7) + '|' + '-'.repeat(22) + '|'
  log(hdr)
  log(sep)

  for (const r of allRecords) {
    const quality = String(r.qualityScore).padEnd(7)
    const bundle = (r.bundleSizeKB || 0).toFixed(1).padEnd(8)
    const passRate = ((r.testPassRate || 0) * 100).toFixed(0) + '%'
    const apiCov = `${r.apiCoverage || 0}/${BUN_IMAGE_API.length}`
    const demos = String(r.demoCount || 0).padEnd(5)
    const verdict = (r.verdict || '?').padEnd(20)
    const row = `| ${r.runId.padEnd(11)} | ${String(r.iteration).padEnd(3)} | ${quality} | ${bundle} | ${passRate.padEnd(8)} | ${apiCov.padEnd(6)} | ${demos} | ${verdict} |`
    log(row)
  }

  log(sep)

  const first = allRecords[0]
  const last = allRecords[allRecords.length - 1]
  const qDelta = (last.qualityScore || 0) - (first.qualityScore || 0)
  const bDelta = (last.bundleSizeKB || 0) - (first.bundleSizeKB || 0)
  const pDelta = ((last.testPassRate || 0) - (first.testPassRate || 0)) * 100
  const aDelta = (last.apiCoverage || 0) - (first.apiCoverage || 0)

  log(`\nTrend (first → last):`)
  log(`  Quality:    ${first.qualityScore} → ${last.qualityScore} (${qDelta >= 0 ? '+' : ''}${qDelta})`)
  log(`  Bundle:     ${first.bundleSizeKB?.toFixed(1)} → ${last.bundleSizeKB?.toFixed(1)} KB (${bDelta >= 0 ? '+' : ''}${bDelta.toFixed(1)})`)
  log(`  Pass rate:  ${((first.testPassRate || 0) * 100).toFixed(0)}% → ${((last.testPassRate || 0) * 100).toFixed(0)}% (${pDelta >= 0 ? '+' : ''}${pDelta.toFixed(0)}%)`)
  log(`  API cov:    ${first.apiCoverage}/${BUN_IMAGE_API.length} → ${last.apiCoverage}/${BUN_IMAGE_API.length} (+${aDelta})`)

  // Quality sparkline
  const scores = allRecords.map(r => r.qualityScore || 0)
  const barLen = 20
  log(`\nQuality score visual (${barLen} chars = 100):`)
  for (const r of allRecords) {
    const filled = Math.round((r.qualityScore / 100) * barLen)
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
    log(`  ${r.runId} #${r.iteration}: ${bar} ${r.qualityScore}`)
  }
}

log(`\nWorkflow complete. Review the bundled artifact at: ${BUNDLE_PATH}`)
log(`Source map for debugging: ${BUNDLE_MAP_PATH} (can be deleted — bundle still runs)`)
log(`Metrics history: ${HISTORY_FILE}`)
