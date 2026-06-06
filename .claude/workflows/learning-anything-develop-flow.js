export const meta = {
  name: 'learning-anything-develop-flow',
  description: 'Self-improving development workflow that learns the Understand-Anything project via its dashboard, then develops bun_apps/learning-anything into a production Bun web server. Uses coding/self-reflection/root-cause-analysis to improve both the bun-app AND the workflow itself.',
  whenToUse: 'Run to develop and iteratively improve the learning-anything bun web server. Each iteration: learn → audit → build → benchmark → reflect → improve → regression → report. Self-reflects to improve the workflow .js itself.',
  phases: [
    { title: 'Resolve', detail: 'Detect absolute project root path via git rev-parse' },
    { title: 'Preflight', detail: 'Check if UA dashboard is reachable before Learn phase' },
    { title: 'Graph Diagnostic', detail: 'Check if knowledge graph files exist for gap analysis' },
    { title: 'Learn', detail: 'Query UA dashboard API + read UA plugin source files to catalog features' },
    { title: 'Gap Analysis', detail: 'Compare UA features vs bun-app features, identify missing capabilities with priorities' },
    { title: 'History', detail: 'Load metrics history from previous runs, display trend summary' },
    { title: 'Audit', detail: 'Run bun-app audit script to inventory current state' },
    { title: 'Build', detail: 'Build bundle using bun-app build script, run quality-check' },
    { title: 'Benchmark', detail: 'Run bun-app benchmark script against bundled artifact' },
    { title: 'Reflect', detail: 'Analyze results with Opus, plan improvements for bun-app AND workflow' },
    { title: 'Improve', detail: 'Implement improvements to bun-app source, workflow .js, and scripts' },
    { title: 'Diff Source', detail: 'Verify actual file changes against claimed improvements via git diff' },
    { title: 'Regression', detail: 'Re-build, re-run quality-check + benchmark, verify no regressions' },
    { title: 'Report', detail: 'Generate iteration report, persist to metrics history' },
  ],
}

/*
 * learning-anything-develop-flow workflow
 *
 * This workflow develops bun_apps/learning-anything into a production
 * Bun web server by learning from the Understand-Anything project itself.
 *
 * Key innovation: The workflow queries the UA dashboard (knowledge graph API)
 * to understand the project architecture, then uses that knowledge to guide
 * development of the bun-app. It self-reflects to improve its own workflow.js.
 *
 * Architecture:
 *   - Bun web server: serves knowledge graph data + LLM agent endpoints
 *   - Vercel AI SDK: chat, streaming, structured output via DeepSeek models
 *   - Knowledge graph: loaded from Understand-Anything plugin output
 *
 * Usage:
 *   Workflow({ name: 'learning-anything-develop-flow' })
 *   Workflow({ name: 'learning-anything-develop-flow', args: { iterations: 3 } })
 *   Workflow({ name: 'learning-anything-develop-flow', args: { dashboardUrl: 'http://127.0.0.1:5174' } })
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const BUNDLE_NAME = 'learning-anything.js'
const BUNDLE_MAP_NAME = 'learning-anything.js.map'
const WORKFLOW_REL = '.claude/workflows/learning-anything-develop-flow.js'

const DEFAULTS = {
  iterations: 1,
  targetBundleSizeKB: 80,
  minTestPassRate: 0.8,
  minFeatures: 10,
  dashboardUrl: 'http://127.0.0.1:5174',
  dashboardToken: '',
}

const config = { ...DEFAULTS, ...(args || {}) }

// ─── All Schemas (declared upfront to avoid temporal dead zone) ──────────────

const PATH_SCHEMA = {
  type: 'object',
  properties: {
    projectRoot: { type: 'string', description: 'Absolute path to the git project root' },
  },
  required: ['projectRoot'],
}

const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    dashboardAvailable: { type: 'boolean' },
    httpStatus: { type: 'number' },
    responseTimeMs: { type: 'number' },
  },
  required: ['dashboardAvailable'],
}

const LEARN_SCHEMA = {
  type: 'object',
  properties: {
    projectInfo: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        languages: { type: 'array', items: { type: 'string' } },
        frameworks: { type: 'array', items: { type: 'string' } },
      },
    },
    architecture: {
      type: 'object',
      properties: {
        layers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, nodeCount: { type: 'number' } } } },
        totalNodes: { type: 'number' },
        totalEdges: { type: 'number' },
        nodeTypes: { type: 'object' },
        edgeTypes: { type: 'object' },
      },
    },
    keyModules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          summary: { type: 'string' },
          connections: { type: 'number' },
        },
      },
    },
    tourSummary: {
      type: 'array',
      items: { type: 'string' },
    },
    uaFeatures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sourceFile: { type: 'string' },
          description: { type: 'string' },
          exports: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  required: ['projectInfo', 'architecture'],
}

const GAP_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          uaSource: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          description: { type: 'string' },
          approach: { type: 'string' },
        },
        required: ['feature', 'uaSource', 'priority', 'description'],
      },
    },
    coverage: {
      type: 'object',
      properties: {
        uaTotalFeatures: { type: 'number' },
        bunAppCovered: { type: 'number' },
        percentage: { type: 'number' },
      },
      required: ['uaTotalFeatures', 'bunAppCovered', 'percentage'],
    },
  },
  required: ['gaps', 'coverage'],
}

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
                workflowImprovements: { type: 'number' },
                remainingGaps: { type: 'number' },
                highPriorityGaps: { type: 'number' },
                gapsClosedThisIteration: { type: 'number' },
                convergenceReason: { type: 'string' },
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
        scriptFileCount: { type: 'number' },
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

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    bundleSizeKB: { type: 'number' },
    qualityScore: { type: 'number' },
  },
  required: ['success', 'bundleSizeKB', 'qualityScore'],
}

const REGRESSION_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean' },
    previousBundleSizeKB: { type: 'number' },
    newBundleSizeKB: { type: 'number' },
    bundleSizeDeltaKB: { type: 'number' },
    qualityScore: { type: 'number' },
    benchmarkPassed: { type: 'number' },
    benchmarkTotal: { type: 'number' },
    regressionCount: { type: 'number' },
    regressions: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['overallPassed', 'newBundleSizeKB', 'qualityScore', 'verdict'],
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
    testCountDelta: { type: 'number', description: 'Number of new tests added this iteration (current testCount - previous testCount)' },
    changesSummary: { type: 'string' },
    improvementsApplied: { type: 'number' },
    workflowImprovements: { type: 'number' },
    regressionsDetected: { type: 'number' },
    overallVerdict: { type: 'string', enum: ['significant-improvement', 'marginal-improvement', 'no-change', 'regressed', 'blocked'] },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['iteration', 'qualityScore', 'changesSummary', 'improvementsApplied', 'regressionsDetected', 'overallVerdict'],
}

// ─── Phase -1: Resolve absolute paths ────────────────────────────────────────

phase('Resolve')

const pathResolution = await agent(
  `Detect the absolute path of the git project root.
  Run: Bash("git rev-parse --show-toplevel")
  Return it as { projectRoot: "<the-path>" }.
  Normalize backslashes to forward slashes.`,
  { label: 'resolve-paths', phase: 'Resolve', model: 'haiku', schema: PATH_SCHEMA },
)

const PROJECT_ROOT = (pathResolution?.projectRoot || '').replace(/\\/g, '/')
if (!PROJECT_ROOT) {
  log('ERROR: Could not resolve project root.')
}

const APP_DIR = PROJECT_ROOT ? `${PROJECT_ROOT}/bun_apps/learning-anything` : 'bun_apps/learning-anything'
const DIST_DIR = PROJECT_ROOT ? `${PROJECT_ROOT}/dist` : 'dist'
const BUNDLE_PATH = `${DIST_DIR}/${BUNDLE_NAME}`
const BUNDLE_MAP_PATH = `${DIST_DIR}/${BUNDLE_MAP_NAME}`
const HISTORY_FILE = `${DIST_DIR}/learning-anything-metrics-history.json`
const STALE_HISTORY_FILE = `${PROJECT_ROOT}/learning-anything-metrics-history.json`
const WORKFLOW_FILE = PROJECT_ROOT ? `${PROJECT_ROOT}/${WORKFLOW_REL}` : WORKFLOW_REL
const WORKFLOW_SCRIPTS = [
  `${APP_DIR}/scripts/audit.ts`,
  `${APP_DIR}/scripts/quality-check.ts`,
  `${APP_DIR}/scripts/benchmark.ts`,
]

// Ensure dist/ exists and clean up stale root-level metrics file
if (PROJECT_ROOT) {
  await agent(
    `Prepare the dist directory and clean up stale metrics file.
    1. Create dist/ if missing: Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")
    2. If a stale metrics file exists at the project root (NOT in dist/), migrate it to dist/ and delete the stale copy:
       Bash("if (Test-Path '${STALE_HISTORY_FILE}') { if (!(Test-Path '${HISTORY_FILE}')) { Move-Item '${STALE_HISTORY_FILE}' '${HISTORY_FILE}' } else { Remove-Item '${STALE_HISTORY_FILE}' } }")
    Return "ok".`,
    { label: 'ensure-dist', phase: 'Resolve', model: 'haiku' },
  )
}

log(`Resolved paths:`)
log(`  PROJECT_ROOT: ${PROJECT_ROOT || '(fallback)'}`)
log(`  APP_DIR:      ${APP_DIR}`)
log(`  DIST_DIR:     ${DIST_DIR}`)
log(`  BUNDLE_PATH:  ${BUNDLE_PATH}`)
log(`  HISTORY_FILE: ${HISTORY_FILE}`)

// ─── Phase -0.5: Preflight health gate ────────────────────────────────────────

phase('Preflight')

const dashboardUrl = config.dashboardUrl.replace(/\/$/, '')
const tokenQuery = config.dashboardToken ? `?token=${config.dashboardToken}` : ''

const preflight = await agent(
  `Check if the UA dashboard at ${dashboardUrl} is reachable.
  Run: Bash("curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 ${dashboardUrl}/health 2>&1 || echo 'unreachable'")
  Return { dashboardAvailable: true/false, httpStatus: <status code or 0>, responseTimeMs: <approximate> }.
  If connection is refused or times out, set dashboardAvailable to false.`,
  { label: 'preflight-check', phase: 'Preflight', model: 'haiku', schema: PREFLIGHT_SCHEMA },
)

const dashboardAvailable = preflight?.dashboardAvailable ?? false
log(`Preflight: Dashboard at ${dashboardUrl} is ${dashboardAvailable ? 'REACHABLE' : 'UNREACHABLE'}`)
if (!dashboardAvailable) {
  log(`  WARNING: Dashboard not available. Learn phase will use file-based fallback only.`)
}

// ─── Phase 0.75: Graph Quality Self-Diagnostic ────────────────────────────────
// Check if the knowledge graph files needed for gap analysis exist.
// If missing, skip graph comparison with a clear log message instead of
// silently producing empty comparison context.

phase('Graph Diagnostic')

const GRAPH_DIAGNOSTIC_SCHEMA = {
  type: 'object',
  properties: {
    laGraphExists: { type: 'boolean' },
    uaGraphExists: { type: 'boolean' },
    graphComparisonSkipped: { type: 'boolean' },
    skipReason: { type: 'string' },
  },
  required: ['laGraphExists', 'uaGraphExists', 'graphComparisonSkipped'],
}

const graphDiagnostic = await agent(
  `Check if the knowledge graph files needed for gap analysis exist.

  Step 1: Check the learning-anything graph:
  Bash("Test-Path 'C:/Users/ziyu4/proj/harness_dev/bun_apps/deepseek-cli/.learning-anything/knowledge-graph.json'")

  Step 2: Check the understand-anything graph:
  Bash("Test-Path 'C:/Users/ziyu4/proj/harness_dev/bun_apps/deepseek-cli/.understand-anything/knowledge-graph.json'")

  Return { laGraphExists: true/false, uaGraphExists: true/false, graphComparisonSkipped: true/false, skipReason: "..." }.
  Set graphComparisonSkipped to true if EITHER file is missing. Set skipReason to explain which file is missing.`,
  { label: 'graph-diagnostic', phase: 'Graph Diagnostic', model: 'haiku', schema: GRAPH_DIAGNOSTIC_SCHEMA },
)

const graphComparisonSkipped = graphDiagnostic?.graphComparisonSkipped ?? true
const graphSkipReason = graphDiagnostic?.skipReason ?? 'Graph diagnostic did not return results'
log(`Graph Diagnostic: LA graph=${graphDiagnostic?.laGraphExists ? 'exists' : 'MISSING'}, UA graph=${graphDiagnostic?.uaGraphExists ? 'exists' : 'MISSING'}`)
if (graphComparisonSkipped) {
  log(`  Graph comparison will be SKIPPED: ${graphSkipReason}`)
} else {
  log(`  Graph comparison will proceed with both files available.`)
}

// ─── Phase 0: Learn from Understand-Anything dashboard ───────────────────────

phase('Learn')

// UA plugin source paths (for reading reference implementations)
const UA_PLUGIN_SRC = 'C:/Users/ziyu4/.claude-glm/plugins/cache/understand-anything/understand-anything/2.7.6/src'
const UA_PLUGIN_CORE = 'C:/Users/ziyu4/.claude-glm/plugins/cache/understand-anything/understand-anything/2.7.6/packages/core/src'

const learned = await agent(
  `Learn the Understand-Anything project by querying its knowledge graph dashboard API AND reading its source files.
  ${dashboardAvailable
    ? `The dashboard is running at ${dashboardUrl}. You can query it.`
    : `IMPORTANT: The dashboard at ${dashboardUrl} is NOT reachable. SKIP ALL curl commands to the dashboard. Go directly to reading source files and the knowledge-graph.json file.`}

  ${dashboardAvailable ? `Step 1: Get project stats:
  Bash("curl -s '${dashboardUrl}/api/stats${tokenQuery}' 2>&1 || echo '{}'" )

  Step 2: Get layers:
  Bash("curl -s '${dashboardUrl}/api/layers${tokenQuery}' 2>&1 || echo '[]'")

  Step 3: Get the guided tour:
  Bash("curl -s '${dashboardUrl}/api/tour${tokenQuery}' 2>&1 || echo '[]'")

  Step 4: Search for key modules (core, dashboard, plugin):
  Bash("curl -s '${dashboardUrl}/api/search?q=core+engine&type=file${tokenQuery}' 2>&1 || echo '[]'")
  Bash("curl -s '${dashboardUrl}/api/search?q=dashboard+component&type=file${tokenQuery}' 2>&1 || echo '[]'")
  Bash("curl -s '${dashboardUrl}/api/search?q=agent+skill&type=file${tokenQuery}' 2>&1 || echo '[]'")

  Step 5: Get the knowledge graph directly:
  Bash("curl -s 'http://127.0.0.1:5174/knowledge-graph.json' 2>&1 | head -c 5000 || echo '{}'")` : `Step 1: Read the knowledge graph file directly:
  Bash("cat 'C:/Users/ziyu4/proj/Understand-Anything/.understand-anything/knowledge-graph.json' | head -c 10000")`}

  Step 6 (IMPORTANT): Read UA plugin source files to catalog ALL features that can be ported:
  Bash("cat '${UA_PLUGIN_SRC}/context-builder.ts' 2>/dev/null | head -c 3000 || echo 'not found'")
  Bash("cat '${UA_PLUGIN_SRC}/explain-builder.ts' 2>/dev/null | head -c 3000 || echo 'not found'")
  Bash("cat '${UA_PLUGIN_SRC}/diff-analyzer.ts' 2>/dev/null | head -c 3000 || echo 'not found'")
  Bash("cat '${UA_PLUGIN_SRC}/onboard-builder.ts' 2>/dev/null | head -c 3000 || echo 'not found'")
  Bash("cat '${UA_PLUGIN_CORE}/staleness.ts' 2>/dev/null | head -c 2000 || echo 'not found'")

  For each UA source file read, extract:
  - The exported functions and their signatures
  - What the function does (from comments and code)
  - What types it depends on

  Parse all responses and synthesize into a structured summary.
  Include a "uaFeatures" array listing each UA feature that can be ported.

  Return the structured summary.`,
  { label: 'learn-dashboard', phase: 'Learn', model: 'sonnet', schema: LEARN_SCHEMA },
)

const projInfo = learned?.projectInfo || {}
const archInfo = learned?.architecture || {}
const keyModules = learned?.keyModules || []
const uaFeatures = learned?.uaFeatures || []

log(`Learned: ${projInfo.name || 'understand-anything'}`)
log(`  ${projInfo.description || 'No description'}`)
log(`  ${archInfo.totalNodes || '?'} nodes, ${archInfo.totalEdges || '?'} edges`)
log(`  Layers: ${(archInfo.layers || []).map((l) => l.name).join(', ')}`)
log(`  Key modules: ${keyModules.slice(0, 5).map((m) => m.name).join(', ')}`)
log(`  UA features cataloged: ${uaFeatures.length}`)

// ─── Phase 1: History ────────────────────────────────────────────────────────

phase('History')

const historyResult = await agent(
  `Load the metrics history for learning-anything development.

  Step 1: Ensure dist directory:
  Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

  Step 2: Read history:
  Bash("if (Test-Path '${HISTORY_FILE}') { Get-Content '${HISTORY_FILE}' -Raw } else { '{ \"runs\": [] }' }")

  Parse the JSON. Return { runs: [] } if invalid.`,
  { label: 'load-history', phase: 'History', model: 'haiku', schema: HISTORY_SCHEMA },
)

const metricsHistory = historyResult || { runs: [] }
const totalPreviousRuns = metricsHistory.runs.length
const currentRunId = `run-${totalPreviousRuns + 1}`
const allHistoricalRecords = metricsHistory.runs.flatMap(r => r.iterations)

if (allHistoricalRecords.length > 0) {
  const last = allHistoricalRecords[allHistoricalRecords.length - 1]
  const first = allHistoricalRecords[0]
  log(`History: ${totalPreviousRuns} runs, ${allHistoricalRecords.length} iterations`)
  log(`  Quality: ${first.qualityScore} → ${last.qualityScore}`)
  log(`  Bundle:  ${first.bundleSizeKB?.toFixed(1)} → ${last.bundleSizeKB?.toFixed(1)} KB`)
} else {
  log('History: No previous runs. Starting fresh.')
}

// ─── Phase 0.5: Feature Gap Analysis ────────────────────────────────────────
// Compare UA features against what the bun-app currently has, identify gaps.
// Diff-aware: loads previous iteration's gaps from history for comparison.

phase('Gap Analysis')

// Extract previous iteration's gap info from history for diff comparison
const previousIterationGaps = allHistoricalRecords.length > 0
  ? {
      remainingGaps: allHistoricalRecords[allHistoricalRecords.length - 1].remainingGaps ?? null,
      highPriorityGaps: allHistoricalRecords[allHistoricalRecords.length - 1].highPriorityGaps ?? null,
      gapHistory: allHistoricalRecords.slice(-3).map(r => ({
        iteration: r.iteration,
        remainingGaps: r.remainingGaps,
        highPriorityGaps: r.highPriorityGaps,
        verdict: r.verdict,
      })),
    }
  : null

if (previousIterationGaps) {
  log(`Gap Diff: Previous iteration had ${previousIterationGaps.remainingGaps ?? '?'} remaining gaps (${previousIterationGaps.highPriorityGaps ?? '?'} high priority)`)
}

// ── Graph Quality Comparison (.learning-anything vs .understand-anything) ──
// Compare the two knowledge graphs produced for deepseek-cli to identify
// quality gaps in the bun-app's graph generation vs the UA plugin's output.
// Skipped if the Graph Diagnostic phase determined the files are missing.
let graphComparisonContext = ''
if (graphComparisonSkipped) {
  log(`Graph comparison: SKIPPED (${graphSkipReason})`)
} else {
try {
  const laGraphRaw = await agent(
    `Read the learning-anything knowledge graph for deepseek-cli and summarize its structure.
    Run: Bash("cat C:/Users/ziyu4/proj/harness_dev/bun_apps/deepseek-cli/.learning-anything/knowledge-graph.json | head -200")
    Return: total nodes, edges, layers, tour steps, node types breakdown, edge types breakdown.`,
    { label: 'graph-compare-la', phase: 'Gap Analysis', model: 'haiku', schema: {
      type: 'object',
      properties: {
        nodes: { type: 'number' }, edges: { type: 'number' },
        layers: { type: 'number' }, tourSteps: { type: 'number' },
        nodeTypes: { type: 'object' }, edgeTypes: { type: 'object' },
        hasFileNodes: { type: 'boolean' }, hasDocumentNodes: { type: 'boolean' },
        hasContainsEdges: { type: 'boolean' }, hasDocumentsEdges: { type: 'boolean' },
        hasConfiguresEdges: { type: 'boolean' }, hasTestedEdges: { type: 'boolean' },
      },
      required: ['nodes', 'edges'],
    }},
  )
  const uaGraphRaw = await agent(
    `Read the understand-anything knowledge graph for deepseek-cli and summarize its structure.
    Run: Bash("cat C:/Users/ziyu4/proj/harness_dev/bun_apps/deepseek-cli/.understand-anything/knowledge-graph.json | head -200")
    Return: total nodes, edges, layers, tour steps, node types breakdown, edge types breakdown.`,
    { label: 'graph-compare-ua', phase: 'Gap Analysis', model: 'haiku', schema: {
      type: 'object',
      properties: {
        nodes: { type: 'number' }, edges: { type: 'number' },
        layers: { type: 'number' }, tourSteps: { type: 'number' },
        nodeTypes: { type: 'object' }, edgeTypes: { type: 'object' },
        hasFileNodes: { type: 'boolean' }, hasDocumentNodes: { type: 'boolean' },
        hasContainsEdges: { type: 'boolean' }, hasDocumentsEdges: { type: 'boolean' },
        hasConfiguresEdges: { type: 'boolean' }, hasTestedEdges: { type: 'boolean' },
      },
      required: ['nodes', 'edges'],
    }},
  )
  if (laGraphRaw && uaGraphRaw) {
    graphComparisonContext = `
## GRAPH QUALITY COMPARISON (deepseek-cli analysis)
This comparison shows concrete quality gaps between what the bun-app produces vs what the UA plugin produces.
The UA plugin analyzed the SAME project (deepseek-cli) and produced a richer graph.

### .learning-anything (bun-app output):
${JSON.stringify(laGraphRaw, null, 2)}

### .understand-anything (UA plugin output — gold standard):
${JSON.stringify(uaGraphRaw, null, 2)}

### Key differences to address:
- Node count: LA=${laGraphRaw.nodes} vs UA=${uaGraphRaw.nodes} (LA produces ${Math.round(laGraphRaw.nodes/uaGraphRaw.nodes*100)}% of UA's nodes)
- Edge count: LA=${laGraphRaw.edges} vs UA=${uaGraphRaw.edges} (LA produces ${Math.round(laGraphRaw.edges/uaGraphRaw.edges*100)}% of UA's edges)
- Layers: LA=${laGraphRaw.layers} vs UA=${uaGraphRaw.layers}
- Tour steps: LA=${laGraphRaw.tourSteps} vs UA=${uaGraphRaw.tourSteps}
- Missing node types in LA: file=${laGraphRaw.hasFileNodes ? 'yes' : 'NO'}, document=${laGraphRaw.hasDocumentNodes ? 'yes' : 'NO'}
- Missing edge types in LA: contains=${laGraphRaw.hasContainsEdges ? 'yes' : 'NO'}, documents=${laGraphRaw.hasDocumentsEdges ? 'yes' : 'NO'}, configures=${laGraphRaw.hasConfiguresEdges ? 'yes' : 'NO'}, tested_by=${laGraphRaw.hasTestedEdges ? 'yes' : 'NO'}

These gaps should be addressed by improving the bun-app's scan/analysis pipeline to produce
richer node types (file, document, config), more edge types (contains, documents, configures, tested_by),
better layer detection, and more informative tour generation.
`
  }
} catch (e) {
  log('Graph comparison: Could not read comparison graphs, skipping. ' + String(e).slice(0, 100))
}
} // end else (graphComparisonSkipped was false)

const gapAnalysis = await agent(
  `Analyze the feature gap between Understand-Anything (UA) and the learning-anything bun-app.

  ## UA Features (from Learn phase)
  ${JSON.stringify(uaFeatures, null, 2)}

  ## Previous Iteration Gap State
  ${previousIterationGaps ? JSON.stringify(previousIterationGaps, null, 2) : '(first run, no previous gaps)'}

  ${graphComparisonContext}

  ## Bun-App Current Source Files
  Run: Bash("ls -la ${APP_DIR}/src/")
  Run: Bash("cat ${APP_DIR}/src/routes.ts | grep -E '(GET|POST|api/)' | head -30")

  ## What the bun-app already has (from previous implementations):
  - graph.ts: GraphStore with node/edge search, neighborhood, dependency tree
  - agent.ts: LLM agent with chat, chatStream, rootCauseAnalysis, analyzeArchitecture, designWorkflow
  - routes.ts: API endpoints for graph queries + agent calls
  - config.ts: DeepSeek V4 models, system prompts
  - semantic-search.ts: cosine similarity search over pre-computed embeddings
  - tour.ts: tour generation with heuristic topological sort

  ## What UA has that we want to port:
  1. context-builder.ts → buildChatContext() + formatContextForPrompt()
  2. explain-builder.ts → buildExplainContext() + formatExplainPrompt()
  3. diff-analyzer.ts → buildDiffContext() + formatDiffAnalysis()
  4. onboard-builder.ts → buildOnboardingGuide()
  5. staleness.ts → isStale() + getChangedFiles()
  6. Layer health scoring
  7. Path finding between nodes
  8. Richer node types (file, document, config, service, endpoint) — see graph comparison above
  9. Richer edge types (contains, documents, configures, tested_by) — see graph comparison above
  10. Better layer detection (heuristic + LLM dual mode)
  11. Better tour generation (more steps, language lessons)

  ${graphComparisonSkipped ? `## GRAPH QUALITY COMPARISON SKIPPED
  The graph quality comparison is unavailable because: ${graphSkipReason}.
  Focus gap analysis on UA feature coverage only. Do not reference graph comparison data.` : ''}

  ## IMPORTANT: Diff-aware analysis instructions
  Instead of just grepping for function names, READ the actual bun-app source files to verify
  the depth and completeness of each feature. Compare previously identified gaps against the
  CURRENT source state by reading relevant files. Mark gaps as:
  - "closed" if the feature is now fully implemented
  - "still-open" if it remains from a previous iteration
  - "new" if it was not previously identified

  Read the bun-app source files to check which features exist and their depth:
  Bash("cat ${APP_DIR}/src/graph.ts | head -60")
  Bash("grep -l 'buildChatContext\\|buildExplainContext\\|buildDiffContext\\|buildOnboardingGuide' ${APP_DIR}/src/*.ts 2>/dev/null || echo 'none found'")
  Bash("grep -c 'getNodeByPath\\|getLayerHealth\\|getPathBetween\\|getHotspots\\|checkStaleness\\|semanticSearch\\|getSemanticSearchEngine' ${APP_DIR}/src/graph.ts 2>/dev/null || echo '0'")

  IMPORTANT: Include the graph comparison gaps above as additional gap items. The bun-app's
  scan/analysis pipeline must be improved to produce file-level nodes, document nodes, config nodes,
  and edge types like contains, documents, configures, and tested_by.

  Return: gaps array (features NOT yet ported, with priority) and coverage stats.
  If all features are already ported, return empty gaps array with 100% coverage.`,
  { label: 'gap-analysis', phase: 'Gap Analysis', model: 'sonnet', schema: GAP_SCHEMA },
)

const gaps = gapAnalysis?.gaps || []
const coverage = gapAnalysis?.coverage || { uaTotalFeatures: 15, bunAppCovered: 0, percentage: 0 }

log(`Gap Analysis: ${gaps.length} gaps, ${coverage.percentage}% coverage`)
if (gaps.length > 0) {
  gaps.slice(0, 5).forEach((g, i) => {
    log(`  ${i + 1}. [${g.priority}] ${g.feature} — ${g.description}`)
  })
} else {
  log('  All UA features ported!')
}

// Store gap analysis for later phases
const GAP_CONTEXT = JSON.stringify(gapAnalysis, null, 2)

// Store learned context for later phases
const LEARNED_CONTEXT = JSON.stringify(learned, null, 2)

// ─── Phase 0.75: Pre-iteration Convergence Gate ──────────────────────────────
// If coverage is 100% with no gaps AND there's history showing non-regressed
// previous iterations, skip the full iteration loop entirely.

let preIterationConverged = false
if (gaps.length === 0 && coverage.percentage >= 100 && allHistoricalRecords.length > 0) {
  const lastRecord = allHistoricalRecords[allHistoricalRecords.length - 1]
  const lastVerdict = lastRecord.verdict || ''
  if (lastVerdict !== 'regressed' && lastVerdict !== 'blocked') {
    preIterationConverged = true
    convergenceReason = `Full coverage achieved (${coverage.percentage}%) with 0 gaps. Last iteration verdict: ${lastVerdict}.`
    log(`\nPRE-ITERATION CONVERGENCE`)
    log(`  ${convergenceReason}`)
    log(`  Skipping ${MAX_ITERATIONS} iteration(s) — project is at full coverage.`)
  }
}

// Track diff summaries across iterations for cross-iteration learning
let iterationDiffSummaries = []

// ─── Helper: run bun-app script ─────────────────────────────────────────────

async function runBunScript(scriptName, iteration, phaseName, schema) {
  const label = `${scriptName}-${iteration}`
  log(`[${iteration}] Running ${scriptName}...`)

  const result = await agent(
    `Run the bun-app script "${scriptName}" with --json and return its parsed output.

    Run: Bash("cd ${APP_DIR} && bun run ${scriptName} --json 2>&1")

    Parse the JSON and return it. If exit code 1, JSON is still valid — parse it.
    Return ONLY the parsed JSON object.`,
    { label, phase: phaseName, model: 'haiku', schema },
  )

  if (result && typeof result === 'object') return result

  // Fallback
  return await agent(
    `Run the understand-thing bun-app's "${scriptName}" script.

    Bash("cd ${APP_DIR} && bun run ${scriptName} 2>&1")

    Parse JSON from output and return it.`,
    { label: `${label}-fallback`, phase: phaseName, model: 'haiku', schema },
  )
}

// ─── Iteration loop ──────────────────────────────────────────────────────────

const MAX_ITERATIONS = Math.min(config.iterations, 5)
let previousMetrics = allHistoricalRecords.length > 0
  ? allHistoricalRecords[allHistoricalRecords.length - 1]
  : null
const runIterations = []

let consecutiveLowDelta = 0
const CONVERGENCE_DELTA_THRESHOLD = 2
const CONVERGENCE_MAX_LOW_DELTAS = 2
let consecutiveZeroGapClosures = 0
const CONVERGENCE_MAX_ZERO_GAP_CLOSURES = 3
let stuckCounter = 0
const STUCK_MAX = 2
let converged = false
let previousModifiedFiles = [] // tracks files modified in previous iteration for Reflect optimization
let convergenceReason = ''
let gapsClosedThisIteration = 0
let gapsRemainingAtStart = gaps.length // snapshot before any iteration
let currentRemainingGaps = gaps.length // running counter, decremented per verified gap closure

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {

  // Pre-iteration convergence gate: skip if already at full coverage
  if (preIterationConverged) {
    log(`[${iteration}] SKIPPED — pre-iteration convergence active.`)
    converged = true
    break
  }

  log(`\n${'═'.repeat(60)}`)
  log(`ITERATION ${iteration} of ${MAX_ITERATIONS}`)
  log(`${'═'.repeat(60)}\n`)

  // ====================================================================
  // PHASE 2: Audit
  // ====================================================================
  phase('Audit')

  log(`[${iteration}] Running audit...`)

  const audit = await runBunScript('audit', iteration, 'Audit', AUDIT_SCHEMA)

  const featureCount = audit?.features?.length || 0
  const codeLines = audit?.stats?.codeLines || 0
  const srcFiles = audit?.stats?.sourceFileCount || 0
  log(`[${iteration}] Audit: ${featureCount} features, ${srcFiles} source files, ${codeLines} code lines`)

  if (audit?.issues?.length > 0) {
    log(`[${iteration}] Issues: ${audit.issues.map(i => `${i.type} ${i.file}:${i.line}`).join('; ')}`)
  }

  // ====================================================================
  // PHASE 3: Build
  // ====================================================================
  phase('Build')

  log(`[${iteration}] Building bundle...`)

  const buildResult = await agent(
    `Build the learning-anything-server bundle.

    ⚠ CRITICAL: bun --outfile resolves relative to ENTRY FILE, not CWD.
    You MUST cd into ${APP_DIR} first, then run bun run build.

    Step 1: Ensure dist directory:
    Bash("New-Item -ItemType Directory -Force -Path '${DIST_DIR}' | Out-Null")

    Step 2: Build:
    Bash("cd ${APP_DIR} && bun run build 2>&1")

    Step 3: Verify:
    Bash("if (Test-Path '${BUNDLE_PATH}') { (Get-Item '${BUNDLE_PATH}').Length / 1KB } else { 'MISSING' }")

    Step 4: Run quality-check with --json:
    Bash("cd ${APP_DIR} && bun run quality-check --json 2>&1")

    Return JSON: { success, bundleSizeKB, qualityScore }`,
    { label: `build-${iteration}`, phase: 'Build', model: 'sonnet', schema: BUILD_SCHEMA },
  )

  let buildBundleKB = buildResult?.bundleSizeKB || 0
  const buildQualityScore = buildResult?.qualityScore || 0
  log(`[${iteration}] Build complete: ${buildBundleKB.toFixed(1)} KB`)

  // ====================================================================
  // PHASE 4: Benchmark
  // ====================================================================
  phase('Benchmark')

  log(`[${iteration}] Running benchmark...`)

  const benchmark = await runBunScript('benchmark', iteration, 'Benchmark', BENCHMARK_SCHEMA)

  const passedTests = benchmark?.passedTests || 0
  const totalTests = benchmark?.totalTests || 0
  log(`[${iteration}] Benchmark: ${passedTests}/${totalTests} passed`)

  // ====================================================================
  // PHASE 4.1: Regression Detection Gate
  // ====================================================================
  // Compare build quality score and test pass rate against previous
  // iteration BEFORE entering Reflect. If quality dropped or tests
  // regressed, redirect Reflect to focus on root-cause analysis.
  let regressionDetected = false
  let regressionContext = ''
  if (previousMetrics) {
    const prevTestPassRate = previousMetrics.testPassRate || 0
    const currentTestPassRate = totalTests > 0 ? passedTests / totalTests : 0
    const qualityDrop = previousMetrics.qualityScore
      ? (buildQualityScore - previousMetrics.qualityScore)
      : 0
    const testRateDrop = currentTestPassRate - prevTestPassRate

    if (qualityDrop < -10) {
      regressionDetected = true
      log(`[${iteration}] REGRESSION GATE: Quality dropped by ${Math.abs(qualityDrop)} points (${previousMetrics.qualityScore} -> ${buildQualityScore})`)
    } else if (testRateDrop < -0.1) {
      regressionDetected = true
      log(`[${iteration}] REGRESSION GATE: Test pass rate dropped by ${(testRateDrop * 100).toFixed(1)}% (${(prevTestPassRate * 100).toFixed(1)}% -> ${(currentTestPassRate * 100).toFixed(1)}%)`)
    }

    if (regressionDetected) {
      regressionContext = `## REGRESSION DETECTED — CRITICAL

Quality score: ${previousMetrics.qualityScore || '?'} -> ${buildQualityScore} (delta: ${qualityDrop >= 0 ? '+' : ''}${qualityDrop})
Test pass rate: ${(prevTestPassRate * 100).toFixed(1)}% -> ${(currentTestPassRate * 100).toFixed(1)}% (delta: ${(testRateDrop * 100).toFixed(1)}%)
Previous iteration verdict: ${previousMetrics.verdict || 'unknown'}

**IMPORTANT**: Focus the Reflect phase EXCLUSIVELY on identifying and fixing this regression.
- Do NOT plan new features or port UA features.
- Analyze what changed since the previous iteration that caused the regression.
- Prioritize root-cause analysis and targeted fixes only.
`
    }
  }

  // ====================================================================
  // PHASE 4.5: Diff Summary (diff-aware context for Reflect)
  // ====================================================================

  // ── Test Stagnation Gate ──────────────────────────────────────────────────
  // Track test growth and inject a context message if tests are stagnant.
  const testCountDelta = totalTests - (previousMetrics?.testCount || 0)
  let testStagnationContext = ''
  if (testCountDelta <= 0 && previousMetrics?.testCountDelta !== undefined && previousMetrics.testCountDelta <= 0) {
    testStagnationContext = `## TEST STAGNATION WARNING
No new tests added for 2 consecutive iterations (${previousMetrics?.testCount || 0} -> ${totalTests}). Uncovered modules may remain. Prioritize adding tests for uncovered modules in the bunAppImprovements plan.`
    log(`[${iteration}] TEST STAGNATION: No new tests for 2 iterations (${totalTests} total)`)
  }
  if (testCountDelta > 0) {
    log(`[${iteration}] Tests added: +${testCountDelta} (${(previousMetrics?.testCount || 0)} -> ${totalTests})`)
  }
  let diffSummaryContext = ''
  if (previousModifiedFiles.length > 0) {
    log(`[${iteration}] Generating diff summary of changes since last iteration...`)
    const diffSummary = await agent(
      `Generate a concise diff summary of the changes made since the last iteration.

      Run: Bash("cd ${APP_DIR} && git diff --stat -- ${previousModifiedFiles.map(f => f.replace(/^.*[\\/]src[\\/]/, 'src/')).join(' ')} 2>&1 || echo 'no changes'")
      Run: Bash("cd ${APP_DIR} && git diff --unified=3 -- ${previousModifiedFiles.map(f => f.replace(/^.*[\\/]src[\\/]/, 'src/')).join(' ')} 2>&1 | head -100 || echo 'no diff'")

      Return a concise summary of what changed, or "No changes since last iteration." if nothing changed.`,
      { label: `diff-summary-${iteration}`, phase: 'Benchmark', model: 'haiku', schema: {
        type: 'object',
        properties: {
          filesChanged: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          linesAdded: { type: 'number' },
          linesRemoved: { type: 'number' },
        },
        required: ['filesChanged', 'summary'],
      }},
    )
    diffSummaryContext = `## Changes Since Last Iteration
${diffSummary?.summary || 'No changes since last iteration.'}
Files: ${(diffSummary?.filesChanged || []).join(', ') || 'none'}
Lines: +${diffSummary?.linesAdded || 0} / -${diffSummary?.linesRemoved || 0}
`
    iterationDiffSummaries.push(diffSummary)
  }

  // Include previous iteration's Diff Source verification results
  let previousDiffVerificationContext = ''
  if (allHistoricalRecords.length > 0) {
    const lastIter = allHistoricalRecords[allHistoricalRecords.length - 1]
    if (lastIter.filesChanged && lastIter.filesChanged.length > 0) {
      previousDiffVerificationContext = `\n## Previous Iteration Verified Changes
Files modified in iteration ${allHistoricalRecords.length}: ${lastIter.filesChanged.join(', ')}
Verdict: ${lastIter.verdict || 'unknown'}
This data was verified by git diff comparison — trust these as confirmed changes.\n`
    }
  }

  // ====================================================================
  // PHASE 4.6: Gap Re-verification (lightweight grep check)
  // ====================================================================
  // Before Reflect, verify whether previously identified gaps are still open
  // by checking if key patterns now exist in modified source files.

  let reverifiedGaps = [...gaps]
  let gapReverificationContext = ''
  if (gaps.length > 0 && iteration > 1) {
    log(`[${iteration}] Re-verifying ${gaps.length} gaps against current source...`)
    const reverifyResult = await agent(
      `Re-verify which gaps from the gap analysis are now closed by checking the current source state.
      For each gap below, grep for the key function/endpoint/pattern in the bun-app source.
      A gap is "closed" if the key functionality exists and is functional.

      Gaps to verify:
      ${JSON.stringify(gaps.map(g => ({ feature: g.feature, approach: g.approach?.slice(0, 200) })), null, 2)}

      For each gap, run a targeted grep in ${APP_DIR}/src/ to check if the feature exists:
      Bash("grep -rl 'buildNonCodeNodes\\|resolveTestEdges\\|tested_by' ${APP_DIR}/src/*.ts 2>/dev/null || echo 'not found'")
      Bash("grep -rl 'buildChatPrompt\\|buildExplainContext\\|buildDiffContext' ${APP_DIR}/src/*.ts 2>/dev/null || echo 'not found'")
      Bash("grep -rl 'addFileWithAnalysis\\|addCallEdge\\|addNonCodeFile' ${APP_DIR}/src/*.ts 2>/dev/null || echo 'not found'")

      Return: { closedGaps: [feature names that are now implemented], openGaps: [feature names still missing] }.
      Schema: { closedGaps: [string], openGaps: [string] }`,
      { label: `gap-reverify-${iteration}`, phase: 'Benchmark', model: 'haiku' },
    )

    const closedInReverify = reverifyResult?.closedGaps || []
    const openInReverify = reverifyResult?.openGaps || []

    if (closedInReverify.length > 0) {
      log(`[${iteration}] Gap re-verification: ${closedInReverify.length} gaps now closed: ${closedInReverify.join(', ')}`)
      reverifiedGaps = reverifiedGaps.filter(g => !closedInReverify.includes(g.feature))
      currentRemainingGaps = reverifiedGaps.length
      gapReverificationContext = `## GAP RE-VERIFICATION (pre-Reflect)
      The following gaps were confirmed CLOSED by source-level verification: ${closedInReverify.join(', ')}
      Remaining active gaps: ${reverifiedGaps.map(g => g.feature).join(', ') || '(none)'}
      Use ONLY the remaining active gaps for improvement planning. Do NOT plan improvements for already-closed gaps.`
    } else {
      log(`[${iteration}] Gap re-verification: All ${gaps.length} gaps remain open`)
    }
  }

  // ====================================================================
  // PHASE 5: Reflect (Opus)
  // ====================================================================
  phase('Reflect')

  log(`[${iteration}] Self-reflecting (Opus)...`)

  const reflection = await agent(
    `You are a senior web server architect performing deep self-reflection on the learning-anything-server app
    AND the development workflow that orchestrates it.

    ## Learned from Understand-Anything Dashboard
    ${LEARNED_CONTEXT}

    ## Feature Gap Analysis
    ${GAP_CONTEXT}

    ## Coverage: ${coverage.percentage}% (${coverage.bunAppCovered}/${coverage.uaTotalFeatures} UA features ported)

    ${diffSummaryContext}

    ${regressionContext}

    ${testStagnationContext}

    ${gapReverificationContext}

    ${previousDiffVerificationContext}

    ## Current Audit
    Features: ${featureCount}, Source files: ${srcFiles}, Code: ${codeLines} lines
    Bundle: ${buildBundleKB.toFixed(1)} KB

    ## Benchmark Results
    ${passedTests}/${totalTests} tests passed
    Feature inventory: ${JSON.stringify(benchmark?.featureInventory || [])}

    ## Previous Metrics
    ${previousMetrics ? JSON.stringify(previousMetrics, null, 2) : '(first iteration)'}

    ## Gap Closure History (last 3 iterations)
    ${[...allHistoricalRecords, ...runIterations].slice(-3).map(r => `  Iteration ${r.iteration}: ${r.remainingGaps ?? '?'} gaps remaining, ${r.gapsClosedThisIteration ?? '?'} closed, verdict: ${r.verdict}`).join('\n') || '(no history)'}
    Gap closure rate trend: ${[...allHistoricalRecords, ...runIterations].slice(-3).filter(r => r.gapsClosedThisIteration > 0).length}/3 iterations closed gaps

    ## App Architecture
    The bun-app is a Bun web server at ${APP_DIR}:
    - src/index.ts: HTTP server entry point (Bun.serve)
    - src/config.ts: DeepSeek model definitions, env vars, system prompts
    - src/graph.ts: Knowledge graph loader and query engine (GraphStore class)
    - src/agent.ts: LLM agent via Vercel AI SDK (chat, root cause analysis, architecture analysis, workflow design, explainNode, analyzeDiff)
    - src/routes.ts: API route handlers (REST endpoints for graph + agent)
    - src/context.ts: Rich context builder (port of UA context-builder.ts)
    - src/explain.ts: Node explanation builder (port of UA explain-builder.ts)
    - src/diff.ts: Change impact analysis (port of UA diff-analyzer.ts)
    - src/onboard.ts: Onboarding guide builder (port of UA onboard-builder.ts)
    - src/validate.ts: Graph validation layer with Zod schema and 4-tier pipeline
    - src/search.ts: Fuse.js fuzzy search engine (replaces naive text search)
    - src/__tests__/: Unit tests for graph store, builders, and validation

    The server uses:
    - Vercel AI SDK (ai, @ai-sdk/openai) for LLM calls
    - DeepSeek models (pro, flash) via OpenAI-compatible API
    - Bun native HTTP server (Bun.serve)
    - zod for structured output validation
    - fuse.js for fuzzy search

    ## CRITICAL: Read Actual Source Code

    MANDATORY: Read AT MOST 3 source files total. Reading more wastes context and degrades analysis quality.

    BEFORE planning improvements, you MUST read the actual source files of the modules targeted for improvement.
    This allows you to identify specific code smells, missing error handling, and exact locations.

    First, get a lightweight file manifest to understand what has changed:
    Bash("cd ${APP_DIR}/src && for f in *.ts; do echo \\"$f $(wc -l < $f)\\"; done")

    Then read ONLY the files that are relevant to the improvement priorities identified above.
    If the gap analysis identifies gaps related to fingerprinting/change-classification, read:
    Bash("cat ${APP_DIR}/src/fingerprint.ts")
    Bash("cat ${APP_DIR}/src/change-classifier.ts")

    If gaps relate to layer detection or language lessons, read:
    Bash("cat ${APP_DIR}/src/layer-detector.ts")
    Bash("cat ${APP_DIR}/src/language-lesson.ts")

    ${previousModifiedFiles.length > 0 ? `## FILES CHANGED IN PREVIOUS ITERATION
    The following files were modified in the previous iteration: ${previousModifiedFiles.join(', ')}.
    Read ONLY these files plus any files directly relevant to identified gaps.
    DO NOT re-read any file listed in previous iteration analysis UNLESS it appears in the gap targets or previousModifiedFiles list.
    If a file was analyzed in a previous iteration AND was not modified since, reference the previous analysis from the Previous Metrics section instead of re-reading it.` : `Always read the core modules that are likely targets for improvement:
    Bash("cat ${APP_DIR}/src/graph.ts")
    Bash("cat ${APP_DIR}/src/routes.ts")
    Bash("cat ${APP_DIR}/src/agent.ts")
    Bash("cat ${APP_DIR}/src/middleware.ts")
    Bash("cat ${APP_DIR}/src/index.ts")`}

    Read additional source files ONLY if they are directly relevant to identified gaps.
    Do NOT blindly read all 13+ source files -- this wastes context window.
    You have a limited context window. Reading 5+ full source files will exceed it. Prioritize reading ONLY the 2-3 files most relevant to the top-priority gap.

    If the gap analysis identifies UA features to port, also read the corresponding UA source files:
    Bash("cat ${UA_PLUGIN_SRC}/context-builder.ts 2>/dev/null || echo 'not found'")
    Bash("cat ${UA_PLUGIN_CORE}/schema.ts 2>/dev/null || echo 'not found'")
    Bash("cat ${UA_PLUGIN_CORE}/search.ts 2>/dev/null || echo 'not found'")

    Your improvement plans should reference SPECIFIC lines, functions, and patterns you observed in the source code,
    not just abstract descriptions. This makes the Reflect -> Improve handoff more effective.

    ## Your Task

    Produce THREE categories of improvements:

    1. **bunAppImprovements** (max 3): Improvements to the web server source code
       - PRIORITY: If there are gaps from the gap analysis (${gaps.length} found), focus on porting those first
       - Each must reference the UA source file to read: ${UA_PLUGIN_SRC}/*
       - Each must have concrete approach, filesToModify, effort/impact rating
       - Reference SPECIFIC code you read (function names, line patterns, exact issues)
       - Consider: better error handling, more endpoints, caching, middleware, logging
       - Consider adding real tests (test file currently may not exist)
       - Must not break existing functionality

    2. **workflowImprovements** (max 2): Improvements to THIS workflow .js at ${WORKFLOW_FILE}
       - Can the learning/gap analysis phases be improved?
       - Are there missing quality gates?
       - Can agent prompts be improved?
       - Should the workflow learn differently from the dashboard?

    3. **scriptImprovements** (max 2): Improvements to the bun-app's scripts
       - audit.ts, quality-check.ts, benchmark.ts
       - Better detection, more comprehensive checks

    Also provide strengths and weaknesses of the current state.`,
    { label: `reflect-${iteration}`, phase: 'Reflect', model: 'opus', schema: REFLECTION_SCHEMA },
  )

  const bunAppPlanCount = reflection?.bunAppImprovements?.length || 0
  const workflowPlanCount = reflection?.workflowImprovements?.length || 0
  const scriptPlanCount = reflection?.scriptImprovements?.length || 0
  log(`[${iteration}] Reflection: ${bunAppPlanCount} app + ${workflowPlanCount} workflow + ${scriptPlanCount} script improvements`)

  if (reflection?.bunAppImprovements?.length) {
    reflection.bunAppImprovements.slice(0, 3).forEach((item, i) => {
      log(`  ${i + 1}. [${item.category}] ${item.title} (${item.effort} effort, ${item.impact} impact)`)
    })
  }
  if (reflection?.workflowImprovements?.length) {
    log(`  Workflow: ${reflection.workflowImprovements.map(w => w.title).join(', ')}`)
  }

  // ─── Early-exit gate ─────────────────────────────────────────────────────
  const noImprovements = !reflection?.bunAppImprovements?.length
    && !reflection?.workflowImprovements?.length
    && !reflection?.scriptImprovements?.length

  if (noImprovements) {
    log(`[${iteration}] No improvements planned. Skipping Improve phase.`)
    phase('Report')

    const report = await agent(
      `Generate summary for iteration ${iteration} with no changes.
      Quality score: ${previousMetrics?.qualityScore || 0}/100
      Bundle: ${buildBundleKB.toFixed(1)} KB
      Tests: ${passedTests}/${totalTests}
      No improvements applied.
      Return: qualityScore delta 0, verdict "no-change", 3-5 next steps.`,
      { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
    )

    const iterationRecord = {
      iteration,
      qualityScore: report?.qualityScore?.after || 0,
      bundleSizeKB: buildBundleKB,
      testPassRate: totalTests > 0 ? passedTests / totalTests : 0,
      featureCount,
      testCount: totalTests,
      testPassed: passedTests,
      improvementsApplied: 0,
      regressionsDetected: 0,
      verdict: 'no-change',
      changesSummary: 'No improvements planned.',
      workflowImprovements: 0,
    }
    previousMetrics = iterationRecord
    runIterations.push(iterationRecord)
    continue
  }

  // ====================================================================
  // PHASE 6: Improve
  // ====================================================================
  phase('Improve')

  log(`[${iteration}] Implementing improvements...`)

  const improvements = await agent(
    `Implement improvements to BOTH the learning-anything-server bun-app AND the development workflow.

    ## DIRECTIVE: GAP CLOSURE (MANDATORY)
    You MUST close at least 1 gap from the gap analysis this iteration. Pick the highest-priority gap that has effort=small. After implementing, verify the gap is closed by checking the relevant source files contain the new functionality. If no small-effort gaps remain, pick a medium-effort gap.
    Current gaps: ${reverifiedGaps.map(g => g.feature).join(', ')}
    Small-effort gaps: ${reverifiedGaps.filter(g => g.effort === 'small').map(g => g.feature).join(', ') || '(none)'}

    ## STEP 0: READ CURRENT SOURCE FILES (MANDATORY)
    Before writing ANY code, you MUST read each file you plan to modify. This prevents conflicts with existing implementations.
    Do NOT re-read all source files. Only read files you are about to modify.
    Trust the reflection analysis for files that did not change since the reflect phase.

    Get a quick file manifest to verify state:
    Bash("cd ${APP_DIR}/src && for f in *.ts; do echo \\"$f $(wc -l < $f)\\"; done")

    Then read ONLY the files targeted by the improvement plan below.

    After ALL changes, verify TypeScript parses: Bash("cd ${APP_DIR} && bun build --no-bundle src/index.ts 2>&1")

    ## Bun-App Improvement Plan
    ${JSON.stringify(reflection?.bunAppImprovements || [], null, 2)}

    ## Workflow Improvement Plan
    ${JSON.stringify(reflection?.workflowImprovements || [], null, 2)}

    ## Script Improvement Plan
    ${JSON.stringify(reflection?.scriptImprovements || [], null, 2)}

    ## Feature Gap Analysis (DIRECTED PORTING)
    ${GAP_CONTEXT}

    ${gapReverificationContext ? `## RE-VERIFIED ACTIVE GAPS (use these, NOT the original gap list)
    ${gapReverificationContext}
    Only target these verified-open gaps. Already-closed gaps should NOT be re-implemented.` : ''}

    ## UA Reference Implementations
    When porting UA features, READ the UA source files FIRST to understand the implementation:
    - Context builder: ${UA_PLUGIN_SRC}/context-builder.ts
    - Explain builder: ${UA_PLUGIN_SRC}/explain-builder.ts
    - Diff analyzer: ${UA_PLUGIN_SRC}/diff-analyzer.ts
    - Onboarding: ${UA_PLUGIN_SRC}/onboard-builder.ts
    - Staleness: ${UA_PLUGIN_CORE}/staleness.ts

    ## Porting Rules
    1. Read the UA source FIRST before writing any bun-app code
    2. Port the LOGIC, not the imports (UA uses @understand-anything/core, bun-app uses graph.ts)
    3. Keep the bun-app self-contained — no dependency on UA
    4. Maintain pure Bun + Vercel AI SDK — no Express/Koa
    5. Each ported feature gets a new API endpoint in routes.ts
    6. Each ported feature's logic goes in the appropriate module

    ## Files
    Bun-app source:
    - ${APP_DIR}/src/index.ts (server entry)
    - ${APP_DIR}/src/config.ts (models, env, prompts)
    - ${APP_DIR}/src/graph.ts (knowledge graph store)
    - ${APP_DIR}/src/agent.ts (LLM agent via Vercel AI SDK)
    - ${APP_DIR}/src/routes.ts (API route handlers)
    - ${APP_DIR}/src/context.ts (rich context builder)
    - ${APP_DIR}/src/explain.ts (node explanation builder)
    - ${APP_DIR}/src/diff.ts (change impact analysis)
    - ${APP_DIR}/src/onboard.ts (onboarding guide builder)

    Bun-app scripts:
    - ${APP_DIR}/scripts/audit.ts
    - ${APP_DIR}/scripts/quality-check.ts
    - ${APP_DIR}/scripts/benchmark.ts

    Bun-app config:
    - ${APP_DIR}/package.json

    Workflow:
    - ${WORKFLOW_FILE}

    ## Implementation Rules

    ### For bun-app changes:
    1. Read the current source files FIRST
    2. Apply improvements incrementally
    3. After ALL changes, verify TypeScript parses: Bash("cd ${APP_DIR} && bun build --no-bundle src/index.ts 2>&1")
    4. If any test files exist, run them: Bash("cd ${APP_DIR} && bun test 2>&1")

    ### For workflow changes:
    1. Read ${WORKFLOW_FILE} FIRST
    2. Apply improvements carefully
    3. Do NOT break existing phase structure or schemas

    ### For script changes:
    1. Read the current script FIRST
    2. Apply improvements
    3. Test: Bash("cd ${APP_DIR} && bun run <script-name> 2>&1")

    ## SCOPE GUARD — CRITICAL
    You MUST ONLY modify files listed in the "Files" section above.
    NEVER modify files outside ${APP_DIR}/ or ${WORKFLOW_FILE}.
    Do NOT touch: bun_apps/deepseek-cli/*, bun_apps/demo-bun-image/*, scripts/*, docs/*, or any other file.

    Record all changes applied for bun-app, workflow, and scripts separately.`,
    { label: `improve-${iteration}`, phase: 'Improve', model: 'sonnet', schema: IMPROVEMENT_RESULT_SCHEMA },
  )

  const bunAppChanges = improvements?.bunAppChanges?.length || 0
  const workflowChanges = improvements?.workflowChanges?.length || 0
  const scriptChanges = improvements?.scriptChanges?.length || 0
  const filesChanged = improvements?.bunAppChanges?.filter(c => c.status === 'applied').map(c => c.file) || []
  log(`[${iteration}] Improvements: ${bunAppChanges} app + ${workflowChanges} workflow + ${scriptChanges} script changes`)
  log(`[${iteration}] Files changed: ${filesChanged.length > 0 ? filesChanged.join(', ') : '(none)'}`)

  // ====================================================================
  // PHASE 6.5: Diff Source (verify actual changes vs claimed changes)
  // ====================================================================
  phase('Diff Source')

  log(`[${iteration}] Verifying actual file changes...`)

  const diffVerification = await agent(
    `Verify that the Improve phase's claimed changes actually landed in the source files.

    Step 1: Get git diff to see what ACTUALLY changed in the bun-app:
    Bash("cd ${APP_DIR} && git diff --stat 2>&1")
    Bash("cd ${APP_DIR} && git diff --name-only 2>&1")

    Step 2: Check workflow file changes:
    Bash("cd ${PROJECT_ROOT} && git diff --name-only -- '${WORKFLOW_REL}' 2>&1")

    Step 3: For each claimed change, verify it exists in the source:
    Claimed bun-app changes: ${JSON.stringify(improvements?.bunAppChanges || [])}
    Claimed workflow changes: ${JSON.stringify(improvements?.workflowChanges || [])}
    Claimed script changes: ${JSON.stringify(improvements?.scriptChanges || [])}

    For each claimed file change with status 'applied', do a lightweight content check:
    - If graph.ts was claimed modified, check: Bash("grep -c 'computeFingerprints\\|analyzeChangesWithFingerprints\\|detectLayersHeuristic\\|detectAllConcepts\\|markDirty\\|_dirty' ${APP_DIR}/src/graph.ts")
    - If routes.ts was claimed modified, check: Bash("grep -c 'fingerprint\\|analyze-changes\\|layers/detect\\|language-lesson\\|language/concepts\\|checkResponseCache\\|storeResponseCache\\|invalidateResponseCache' ${APP_DIR}/src/routes.ts")
    - If agent.ts was claimed modified, check: Bash("grep -c 'detectLayersLLM\\|generateLanguageLesson\\|layer-detector\\|language-lesson' ${APP_DIR}/src/agent.ts")
    - If middleware.ts was claimed modified, check: Bash("grep -c 'generateETag\\|checkResponseCache\\|storeResponseCache\\|invalidateResponseCache\\|cleanup' ${APP_DIR}/src/middleware.ts")
    - If index.ts was claimed modified, check: Bash("grep -c 'cleanup\\|gracefulShutdown\\|dirty\\|fingerprints\\|layers/detect\\|language' ${APP_DIR}/src/index.ts")

    Step 4: Cross-reference verified changes against the gap list from Gap Analysis.
    The Improve phase was DIRECTED to close at least 1 gap. Check whether the claimed changes
    actually address a specific gap by grepping for the new function/endpoint/type in the modified files.
    If no gap was closed, flag this as a discrepancy.
    Current gap list (features that need addressing):
    ${JSON.stringify(reverifiedGaps.map(g => ({ feature: g.feature, priority: g.priority, filesToModify: g.filesToModify || [], approach: g.approach })))}

    For each verified change (confirmed file), check if it matches any gap's filesToModify or approach description.
    List which gap features were DIRECTLY targeted by verified changes.

    Return JSON with:
    - verifiedFiles: array of { file, claimedStatus, verifiedStatus: 'confirmed'|'discrepancy', evidence: string }
    - actualChangedFiles: array of file paths from git diff
    - discrepancyCount: number of claimed changes not verified
    - verifiedBunAppChanges: number of bun-app changes confirmed (use this for gapsClosedThisIteration instead of self-reported data)
    - gapsAddressed: array of gap feature names that were directly targeted by verified changes (only count changes that address specific gaps from the list above, NOT incidental changes like comments or renames)

    Schema: { verifiedFiles: [...], actualChangedFiles: [...], discrepancyCount: number, verifiedBunAppChanges: number, gapsAddressed: [string] }`,
    { label: `diff-source-${iteration}`, phase: 'Diff Source', model: 'haiku' },
  )

  const verifiedBunAppChanges = diffVerification?.verifiedBunAppChanges ?? bunAppChanges
  const actualChangedFiles = diffVerification?.actualChangedFiles || []
  const discrepancyCount = diffVerification?.discrepancyCount || 0
  const gapsAddressedNames = diffVerification?.gapsAddressed || []
  if (discrepancyCount > 0) {
    log(`[${iteration}] WARNING: ${discrepancyCount} claimed changes not verified by diff!`)
  }
  log(`[${iteration}] Diff verification: ${verifiedBunAppChanges} confirmed app changes, ${actualChangedFiles.length} files actually modified, ${gapsAddressedNames.length} gaps addressed: ${gapsAddressedNames.join(', ') || '(none)'}`)

  // ====================================================================
  // PHASE 7: Regression
  // ====================================================================
  phase('Regression')

  log(`[${iteration}] Running regression checks...`)

  const regression = await agent(
    `Run regression tests after improvements.

    ⚠ CRITICAL: cd into ${APP_DIR} before building.

    Step 1: Re-build
    Bash("cd ${APP_DIR} && bun run build 2>&1")

    Step 2: Quality check
    Bash("cd ${APP_DIR} && bun run quality-check --json 2>&1")

    Step 3: Benchmark
    Bash("cd ${APP_DIR} && bun run benchmark --json 2>&1")

    Step 4: Verify TypeScript parses for each modified file
    Bash("cd ${APP_DIR} && bun build --no-bundle src/index.ts 2>&1")

    Step 5: Compare to previous metrics
    Previous: Bundle ${buildBundleKB.toFixed(1)} KB, Tests ${passedTests}/${totalTests}
    Files changed in this iteration: ${filesChanged.join(', ') || '(none)'}

    Return JSON: { overallPassed, previousBundleSizeKB, newBundleSizeKB, bundleSizeDeltaKB, qualityScore, benchmarkPassed, benchmarkTotal, regressionCount, regressions: [], verdict, filesChecked: ${JSON.stringify(filesChanged)} }`,
    { label: `regression-${iteration}`, phase: 'Regression', model: 'sonnet', schema: REGRESSION_SCHEMA },
  )

  const regressionData = regression || {}

  const prevKB = regressionData.previousBundleSizeKB || buildBundleKB
  const newKB = regressionData.newBundleSizeKB || buildBundleKB
  const deltaKB = regressionData.bundleSizeDeltaKB || (newKB - prevKB)
  const regressionVerdict = regressionData.verdict || 'unknown'
  const regressionCount = regressionData.regressionCount || 0
  const qualityScoreAfter = regressionData.qualityScore || 0

  log(`[${iteration}] Regression: ${regressionVerdict} — ${prevKB.toFixed(1)} → ${newKB.toFixed(1)} KB (${deltaKB >= 0 ? '+' : ''}${deltaKB.toFixed(1)})`)

  if (regressionCount > 0) {
    log(`[${iteration}] WARNING: ${regressionCount} regressions!`)
  }

  // ====================================================================
  // PHASE 8: Report
  // ====================================================================
  phase('Report')

  // Count remaining high-priority gaps before building iteration record
  const remainingHighGaps = gaps.filter(g => g.priority === 'high').length

  log(`[${iteration}] Generating report...`)

  const report = await agent(
    `Generate summary report for iteration ${iteration}.

    Quality: ${buildQualityScore} → ${qualityScoreAfter}/100
    Bundle: ${prevKB.toFixed(1)} → ${newKB.toFixed(1)} KB
    Improvements: ${bunAppChanges} app + ${workflowChanges} workflow
    Regression verdict: ${regressionVerdict}, count: ${regressionCount}
    Tests: ${totalTests} total (${testCountDelta >= 0 ? '+' : ''}${testCountDelta} from previous ${previousMetrics?.testCount || 0})
    Previous: ${previousMetrics ? JSON.stringify(previousMetrics) : '(first)'}

    Return: qualityScore { before, after, delta }, testCountDelta, changesSummary, improvementsApplied, workflowImprovements, regressionsDetected, overallVerdict, nextSteps.`,
    { label: `report-${iteration}`, phase: 'Report', model: 'haiku', schema: REPORT_SCHEMA },
  )

  const iterationRecord = {
    iteration,
    qualityScore: report?.qualityScore?.after || qualityScoreAfter,
    bundleSizeKB: newKB || buildBundleKB,
    testPassRate: totalTests > 0 ? passedTests / totalTests : 0,
    featureCount,
    testCount: totalTests,
    testPassed: passedTests,
    testCountDelta,
    improvementsApplied: verifiedBunAppChanges,
    regressionsDetected: regressionCount,
    verdict: report?.overallVerdict || 'unknown',
    changesSummary: improvements?.summary || '',
    workflowImprovements: workflowChanges,
    remainingGaps: currentRemainingGaps,
    highPriorityGaps: remainingHighGaps,
    gapsClosedThisIteration,
    convergenceReason: converged ? convergenceReason : null,
    filesChanged,
  }
  previousMetrics = iterationRecord
  runIterations.push(iterationRecord)

  log(`\n${'─'.repeat(60)}`)
  log(`ITERATION ${iteration} COMPLETE`)
  log(`  Quality: ${report?.qualityScore?.before || '?'} → ${report?.qualityScore?.after || '?'} (Δ${report?.qualityScore?.delta >= 0 ? '+' : ''}${report?.qualityScore?.delta || '?'})`)
  log(`  Bundle:  ${report?.bundleSize?.beforeKB?.toFixed(1) || '?'} → ${report?.bundleSize?.afterKB?.toFixed(1) || '?'} KB`)
  log(`  App: ${bunAppChanges} changes, Workflow: ${workflowChanges} changes`)
  log(`  Files modified: ${filesChanged.length > 0 ? filesChanged.join(', ') : '(none)'}`)
  log(`  Verdict: ${report?.overallVerdict || 'unknown'}`)
  log(`${'─'.repeat(60)}\n`)

  // Track modified files for next iteration's Reflect optimization
  previousModifiedFiles = actualChangedFiles.length > 0 ? actualChangedFiles : filesChanged

  // ─── Convergence gate (with gap-closure-aware diminishing returns detection) ───
  // Use verified changes from Diff Source phase instead of self-reported data
  const totalChanges = verifiedBunAppChanges + workflowChanges + scriptChanges
  const qualityDelta = Math.abs(report?.qualityScore?.delta || 0)

  // remainingHighGaps is computed above, before the iteration record
  // Compute gap closure: use gapsRemainingAtStart snapshot (set before iteration loop)
  // and compare against current gaps remaining. Since gaps is set once by Gap Analysis,
  // track verified changes as the proxy for gap closure.
  const previousRemainingGaps = iteration === 1 ? gapsRemainingAtStart : (previousMetrics?.remainingGaps ?? gapsRemainingAtStart)
  // Use gapsAddressed from Diff Source phase (source-file-level cross-referencing)
  // instead of verifiedBunAppChanges as a proxy. This distinguishes targeted gap fixes
  // from incidental changes (comments, renames, etc.)
  const gapsAddressedCount = gapsAddressedNames.length
  gapsClosedThisIteration = gapsAddressedCount > 0 ? gapsAddressedCount : (verifiedBunAppChanges > 0 ? Math.min(1, verifiedBunAppChanges) : 0)

  // Decrement the running gap counter based on verified closures
  // This prevents the stale gaps.length from being used in convergence decisions
  if (gapsAddressedCount > 0) {
    currentRemainingGaps = Math.max(0, currentRemainingGaps - gapsAddressedCount)
    log(`[${iteration}] Gap counter updated: ${currentRemainingGaps} remaining (was ${currentRemainingGaps + gapsAddressedCount}, closed ${gapsAddressedCount})`)
  } else if (verifiedBunAppChanges > 0 && currentRemainingGaps > 0) {
    // If changes were made but not directly linked to gaps, assume at least 1 gap partially addressed
    currentRemainingGaps = Math.max(0, currentRemainingGaps - 1)
    log(`[${iteration}] Gap counter updated: ${currentRemainingGaps} remaining (1 indirect closure assumed from ${verifiedBunAppChanges} verified changes)`)
  }

  log(`[${iteration}] Gap closure: ${gapsClosedThisIteration} gaps addressed (${gapsAddressedCount} directly targeted via file-level cross-reference, ${verifiedBunAppChanges} total verified changes)`)
  if (testCountDelta > 0) {
    log(`[${iteration}] Tests added: +${testCountDelta} (${previousMetrics?.testCount || 0} → ${totalTests})`)
  }

  if (totalChanges === 0 && remainingHighGaps === 0 && testCountDelta <= 0) {
    consecutiveLowDelta++
    if (consecutiveLowDelta >= CONVERGENCE_MAX_LOW_DELTAS) {
      converged = true
      convergenceReason = `No changes and no high-priority gaps for ${consecutiveLowDelta} consecutive iterations`
    }
  } else if (qualityDelta < CONVERGENCE_DELTA_THRESHOLD && remainingHighGaps === 0 && testCountDelta <= 0) {
    consecutiveLowDelta++
    if (consecutiveLowDelta >= CONVERGENCE_MAX_LOW_DELTAS) {
      converged = true
      convergenceReason = `Quality delta < ${CONVERGENCE_DELTA_THRESHOLD} and no high-priority gaps for ${consecutiveLowDelta} iterations`
    }
  } else if (totalChanges === 0 && remainingHighGaps > 0) {
    // Still have high-priority gaps but no changes applied — increment stuck counter
    log(`[${iteration}] WARNING: ${remainingHighGaps} high-priority gaps remain but no changes were applied`)
    stuckCounter++
    if (stuckCounter >= STUCK_MAX) {
      converged = true
      convergenceReason = `Stuck: ${stuckCounter} consecutive iterations with high-priority gaps but no changes applied`
    }
  } else if (gapsClosedThisIteration === 0 && totalChanges > 0) {
    // Changes were made but no gaps closed — diminishing returns
    consecutiveZeroGapClosures++
    log(`[${iteration}] NOTE: Changes applied but 0 gaps closed (${consecutiveZeroGapClosures}/${CONVERGENCE_MAX_ZERO_GAP_CLOSURES} consecutive)`)
    if (consecutiveZeroGapClosures >= CONVERGENCE_MAX_ZERO_GAP_CLOSURES) {
      converged = true
      convergenceReason = `Diminishing returns: ${consecutiveZeroGapClosures} consecutive iterations with changes but no gap closures`
    }
  } else {
    consecutiveLowDelta = 0
    stuckCounter = 0
    if (gapsClosedThisIteration > 0) {
      consecutiveZeroGapClosures = 0 // reset when gaps are actually closing
    }
    if (testCountDelta > 0) {
      stuckCounter = 0 // reset stuck counter when tests are growing
      log(`[${iteration}] Test growth resets stuck counter (delta: +${testCountDelta})`)
    }
  }

  if (converged) {
    log(`\nCONVERGENCE — stopping at iteration ${iteration}`)
    log(`  Reason: ${convergenceReason}`)
    break
  }
}

// ─── Persist history ──────────────────────────────────────────────────────────

metricsHistory.runs.push({ runId: currentRunId, iterations: runIterations })

await agent(
  `Persist metrics history.
  Write to ${HISTORY_FILE}:
  ${JSON.stringify(metricsHistory, null, 2)}
  Use Write tool. Return "ok".`,
  { label: 'save-history', model: 'haiku' },
)

log(`History saved to ${HISTORY_FILE}`)

// ─── Final summary ────────────────────────────────────────────────────────────

log(`\n${'═'.repeat(60)}`)
log(`ALL ITERATIONS COMPLETE`)
log(`${'═'.repeat(60)}`)

if (previousMetrics) {
  log(`Final bundle: ${previousMetrics.bundleSizeKB?.toFixed(1) || '?'} KB`)
  log(`Final quality: ${previousMetrics.qualityScore || '?'}/100`)
  log(`Features: ${previousMetrics.featureCount || '?'}`)
}

// ─── History trend table ─────────────────────────────────────────────────────

const allRecords = metricsHistory.runs.flatMap(r =>
  r.iterations.map(it => ({ runId: r.runId, ...it }))
)

if (allRecords.length > 0) {
  log(`\nMETRICS HISTORY (${allRecords.length} data points)`)
  log(`${'─'.repeat(60)}`)

  for (const r of allRecords) {
    const bar = '█'.repeat(Math.round((r.qualityScore / 100) * 20)) + '░'.repeat(20 - Math.round((r.qualityScore / 100) * 20))
    log(`  ${r.runId} #${r.iteration}: ${bar} ${r.qualityScore} | ${r.bundleSizeKB?.toFixed(1)}KB | ${r.verdict}`)
  }
}

log(`\nWorkflow complete. Bundle: ${BUNDLE_PATH}`)
log(`Metrics: ${HISTORY_FILE}`)
