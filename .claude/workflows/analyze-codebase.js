export const meta = {
  name: 'analyze-codebase',
  description: 'Deep codebase analysis + root cause analysis + agentic benchmark + auto-improvement + workflow self-reflection. ~65% Haiku, ~25% Sonnet, 2 Opus stages.',
  whenToUse: 'Run on any codebase for comprehensive analysis, root cause investigation, and automatic safe improvements. Good first step when onboarding, before refactoring, or to level up a project.',
  phases: [
    { title: 'Discover', detail: 'Map directory tree, file types, package layout' },
    { title: 'Analyze', detail: 'Parallel analysis of source code, deps, patterns, docs' },
    { title: 'Root-Cause-Analysis', detail: 'Deep root cause analysis of systemic issues (Opus)' },
    { title: 'Synthesize', detail: 'Combine findings and root cause analysis into recommendations' },
    { title: 'Improve', detail: 'Auto-apply safe fixes, improve docs, add missing config' },
    { title: 'Benchmark', detail: 'Live smoke-test of agentic CLI — multi-turn tool calling, all 6 tools, error paths' },
    { title: 'Code-Fix', detail: 'Fix source code defects found by benchmark — apply targeted fixes to the CLI/tool under test' },
    { title: 'Workflow-Reflection', detail: 'Self-review and improve the workflow itself (Opus)' },
    { title: 'Regression', detail: 'Verify self-improvements didn\'t break workflow structure, schemas, or invariants' },
    { title: 'Report', detail: 'Generate structured JSON + interactive HTML report for human review' },
  ],
}

/*
 * analyze-codebase workflow (self-improving with root cause analysis)
 *
 * Usage:
 *   Workflow({name: 'analyze-codebase'})
 *   Workflow({name: 'analyze-codebase', args: { target: '/absolute/path' }})
 *   Workflow({name: 'analyze-codebase', args: { target: '.', lang: 'zh_TW' }})
 *   Workflow({name: 'analyze-codebase', args: { target: '.', skipImprove: true }})
 *   Workflow({name: 'analyze-codebase', args: { target: '.', skipReflection: true }})
 *   Workflow({name: 'analyze-codebase', args: { target: '.', skipBenchmark: true, skipRegression: true }})
 *
 * Phases:
 *   Discover  (Haiku)   — map filesystem structure
 *   Analyze   (Haiku)   — parallel architecture, deps, quality, docs analysis
 *   Root-Cause-Analysis (Opus) — deep systemic root cause analysis
 *   Synthesize (Haiku)  — actionable recommendations (informed by RCA)
 *   Improve   (Haiku)   — auto-apply safe fixes
 *   Benchmark (Sonnet)  — live smoke-test of agentic CLI: multi-turn, all 6 tools, error paths
 *   Code-Fix  (Sonnet)  — fix source code defects found by benchmark (targeted, safe edits)
 *   Workflow-Reflection (Opus) — improve the workflow itself
 *   Regression (Haiku)  — verify self-improvements didn't break workflow invariants
 *   Report    (Haiku)   — write structured JSON + interactive HTML dashboard
 */

// ─── Schemas for structured agent output ───────────────────────────────────────

const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    directoryTree:     { type: 'string', description: 'Compact markdown tree, max 35 lines' },
    fileTypeBreakdown: {
      type: 'object',
      properties: {
        totalFiles:     { type: 'number' },
        languages:      { type: 'string', description: 'Comma-separated languages found' },
        primaryLanguage:{ type: 'string' },
      },
      required: ['totalFiles', 'languages', 'primaryLanguage'],
    },
    projectType:       { type: 'string', description: 'CLI tool, web app, library, monorepo, etc.' },
    buildSystem:       { type: 'string' },
    entryPoints:       { type: 'array', items: { type: 'string' } },
    workspacePackages: { type: 'array', items: { type: 'string' }, description: 'For monorepos, list each workspace package path (empty for non-monorepos)' },
  },
  required: ['directoryTree', 'fileTypeBreakdown', 'projectType', 'buildSystem', 'entryPoints'],
}

const ARCHITECTURE_SCHEMA = {
  type: 'object',
  properties: {
    highLevelArchitecture: { type: 'string', description: '2-3 sentence overview' },
    majorModules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:     { type: 'string' },
          purpose:  { type: 'string' },
          keyFiles: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'purpose'],
      },
    },
    patternsObserved:  { type: 'array', items: { type: 'string' }, description: 'Design patterns and conventions' },
    potentialConcerns: { type: 'array', items: { type: 'string' }, description: 'Architectural red flags' },
    techStack:         { type: 'string', description: 'Key technologies and their versions (language runtime, framework, database, message queue, etc.)' },
    dataFlowDescription: { type: 'string', description: 'How data moves through the system — entry points, processing chain, storage, output' },
  },
  required: ['highLevelArchitecture', 'majorModules', 'patternsObserved'],
}

const DEPENDENCIES_SCHEMA = {
  type: 'object',
  properties: {
    externalDependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:    { type: 'string' },
          type:    { type: 'string', enum: ['runtime', 'dev', 'peer', 'build', 'optional', 'bundler'] },
          purpose: { type: 'string' },
        },
        required: ['name', 'type', 'purpose'],
      },
    },
    internalModuleRelations: { type: 'string', description: 'How internal modules connect' },
    health:                  { type: 'string', description: 'Outdated / deprecated / risky deps' },
  },
  required: ['externalDependencies', 'internalModuleRelations', 'health'],
}

const CODE_QUALITY_SCHEMA = {
  type: 'object',
  properties: {
    overallQuality:    { type: 'string', enum: ['excellent', 'good', 'fair', 'needs-work', 'severe'] },
    strengths:         { type: 'array', items: { type: 'string' } },
    concerns:          { type: 'array', items: { type: 'string' } },
    testCoverage:      { type: 'string', description: 'Testing patterns present and coverage gaps' },
    conventionsUsed:   { type: 'array', items: { type: 'string' } },
    conventionsMissing:{ type: 'array', items: { type: 'string' }, description: 'Linting, formatting, CI hygiene missing' },
  },
  required: ['overallQuality', 'strengths', 'concerns', 'testCoverage'],
}

const DOCUMENTATION_SCHEMA = {
  type: 'object',
  properties: {
    readmeQuality:     { type: 'string', enum: ['excellent', 'good', 'fair', 'poor', 'missing'] },
    hasContributingGuide: { type: 'boolean' },
    hasApiDocs:        { type: 'boolean' },
    hasChangelog:      { type: 'boolean' },
    inlineDocStyle:    { type: 'string', description: 'JSDoc, comments, sparse, etc.' },
    gaps:              { type: 'array', items: { type: 'string' } },
  },
  required: ['readmeQuality', 'hasContributingGuide', 'hasApiDocs', 'hasChangelog', 'inlineDocStyle', 'gaps'],
}

const RECOMMENDATIONS_SCHEMA = {
  type: 'object',
  properties: {
    quickWins:   { type: 'array', items: { type: 'string' }, description: 'Low effort, high impact' },
    mediumTerm:  { type: 'array', items: { type: 'string' }, description: 'Significant but not urgent' },
    majorConcerns: { type: 'array', items: { type: 'string' }, description: 'Critical issues' },
  },
  required: ['quickWins', 'mediumTerm', 'majorConcerns'],
}

// ─── Schemas for self-improvement phases ───────────────────────────────────────

const ROOT_CAUSE_SCHEMA = {
  type: 'object',
  properties: {
    systemicPatterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Cross-cutting patterns that connect multiple separate issues across dimensions',
    },
    rootCauses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symptom:     { type: 'string', description: 'The visible issue observed in the codebase' },
          rootCause:   { type: 'string', description: 'The underlying root cause driving the symptom' },
          impact:      { type: 'string', description: 'Impact on project health, maintainability, and team velocity' },
          fixStrategy: { type: 'string', description: 'Concrete strategy to address the root cause' },
        },
        required: ['symptom', 'rootCause', 'impact', 'fixStrategy'],
      },
    },
    prioritizedActions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Top 3-5 actions ranked by impact/effort with rationale',
    },
    riskAssessment: {
      type: 'string',
      description: 'Overall project risk including bus factor, maintainability trajectory, and technical debt level',
    },
  },
  required: ['systemicPatterns', 'rootCauses', 'prioritizedActions', 'riskAssessment'],
}

const IMPROVEMENT_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type:        { type: 'string', enum: ['create', 'modify', 'skip'] },
          file:        { type: 'string' },
          description: { type: 'string' },
          status:      { type: 'string', enum: ['done', 'skipped', 'failed'] },
          reason:      { type: 'string', description: 'Why skipped or failed (omit for done)' },
        },
        required: ['type', 'file', 'description', 'status'],
      },
    },
    summary: { type: 'string', description: 'Human-readable summary of what was done' },
  },
  required: ['actions', 'summary'],
}

const BENCHMARK_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean', description: 'Whether all benchmark tests passed' },
    totalTests:    { type: 'number' },
    passedTests:   { type: 'number' },
    failedTests:   { type: 'number' },
    totalLatencyMs:{ type: 'number', description: 'Total wall-clock time for all tests' },
    toolResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool:           { type: 'string', description: 'Tool name being tested' },
          testType:       { type: 'string', enum: ['single-turn', 'multi-turn', 'error-handling'], description: 'Category of test' },
          description:    { type: 'string', description: 'What was tested' },
          prompt:         { type: 'string', description: 'CLI command / prompt used' },
          passed:         { type: 'boolean' },
          observedOutput: { type: 'string', description: 'Relevant excerpt from the CLI output' },
          latencyMs:      { type: 'number', description: 'Time taken for this test' },
          failureReason:  { type: 'string', description: 'Why it failed (if applicable)' },
        },
        required: ['tool', 'testType', 'description', 'prompt', 'passed', 'observedOutput', 'latencyMs'],
      },
    },
    multiTurnVerified: { type: 'boolean', description: 'Did multi-turn tool chaining work? (tool output → LLM → next tool)' },
    multiTurnDetails:  { type: 'string', description: 'Description of the multi-turn test and chain observed' },
    recommendations:   { type: 'array', items: { type: 'string' }, description: 'Fixes needed based on benchmark findings' },
    cliPath:           { type: 'string', description: 'Path to the CLI that was benchmarked' },
  },
  required: ['overallPassed', 'totalTests', 'passedTests', 'failedTests', 'totalLatencyMs', 'toolResults', 'multiTurnVerified', 'recommendations', 'cliPath'],
}

const CODE_FIX_SCHEMA = {
  type: 'object',
  properties: {
    benchmarkFixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          failure:        { type: 'string', description: 'Which benchmark test failed' },
          rootCause:      { type: 'string', description: 'Why it failed (code defect)' },
          fix:            { type: 'string', description: 'What edit was applied to fix it' },
          file:           { type: 'string', description: 'Which file was edited' },
          status:         { type: 'string', enum: ['fixed', 'skipped', 'unfixable'] },
          reason:         { type: 'string', description: 'Why skipped or unfixable (if applicable)' },
        },
        required: ['failure', 'rootCause', 'fix', 'file', 'status'],
      },
    },
    improvementsMade:     { type: 'number', description: 'Count of fixes successfully applied' },
    improvementsSkipped:  { type: 'number', description: 'Count of fixes skipped or unfixable' },
    overallBenchmarkPassedAfterFix: { type: 'boolean', description: 'Would benchmark pass after these fixes?' },
    summary:              { type: 'string', description: 'Human-readable summary of fixes applied' },
  },
  required: ['benchmarkFixes', 'improvementsMade', 'improvementsSkipped', 'overallBenchmarkPassedAfterFix', 'summary'],
}

const WORKFLOW_REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    workflowObservations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Observations on workflow performance — accuracy, thoroughness, coverage gaps',
    },
    promptImprovements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target:     { type: 'string', description: 'Which phase/agent prompt to improve' },
          suggestion: { type: 'string', description: 'What to change and why' },
        },
        required: ['target', 'suggestion'],
      },
    },
    schemaImprovements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Suggested improvements to agent output schemas',
    },
    structuralImprovements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Suggested changes to workflow structure (ordering, parallelism, model selection)',
    },
    hasActionableChanges: { type: 'boolean', description: 'Whether changes should be applied to the workflow file now' },
    changesApplied: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of changes actually made to the workflow .js file',
    },
  },
  required: ['workflowObservations', 'promptImprovements', 'schemaImprovements', 'structuralImprovements', 'hasActionableChanges', 'changesApplied'],
}

const REGRESSION_SCHEMA = {
  type: 'object',
  properties: {
    overallPassed: { type: 'boolean', description: 'All regression checks passed' },
    totalChecks:   { type: 'number' },
    passedChecks:  { type: 'number' },
    failedChecks:  { type: 'number' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          check:     { type: 'string', description: 'Name of the check' },
          category:  { type: 'string', enum: ['meta', 'schema', 'phase-ordering', 'variable-reference', 'structural', 'invariant'] },
          passed:    { type: 'boolean' },
          detail:    { type: 'string', description: 'What was verified, and the result' },
          fix:       { type: 'string', description: 'If failed, what edit to apply to fix (null if passed)' },
        },
        required: ['check', 'category', 'passed', 'detail'],
      },
    },
    workflowFilePath: { type: 'string', description: 'Path to the workflow file checked' },
    criticalInvariants: {
      type: 'object',
      properties: {
        schemasIntact:    { type: 'boolean', description: 'All 8 schemas present with required fields' },
        phasesOrderValid:  { type: 'boolean', description: 'meta.phases order matches phase() call order' },
        metaFieldsPresent: { type: 'boolean', description: 'meta has name, description, phases, whenToUse' },
        noSyntaxErrors:    { type: 'boolean', description: 'File parses without syntax errors' },
      },
      required: ['schemasIntact', 'phasesOrderValid', 'metaFieldsPresent', 'noSyntaxErrors'],
    },
    rollbackNeeded: { type: 'boolean', description: 'If true, the workflow was broken and needs manual rollback' },
    fixesApplied: {
      type: 'array',
      items: { type: 'string' },
      description: 'Auto-fixes applied during regression (if any)',
    },
  },
  required: ['overallPassed', 'totalChecks', 'passedChecks', 'failedChecks', 'checks', 'workflowFilePath', 'criticalInvariants', 'rollbackNeeded'],
}

// ======================================================================
// PHASE 1: Discover — map the codebase structure
// ======================================================================
phase('Discover')

const targetDir = (args && args.target) || '.'
const lang = (args && args.lang) || 'en'

const LANG_MAP = {
  en:    { name: 'English',     instruction: 'All output must be in English.',
           htmlTitle: 'Codebase Analysis Report', htmlSummary: 'Summary', htmlArch: 'Architecture',
           htmlRCA: 'Root Cause Analysis', htmlRecs: 'Recommendations', htmlBench: 'Benchmark',
           htmlReg: 'Regression', htmlImprove: 'Improvements', htmlReflect: 'Workflow Reflection',
           htmlQuick: 'Quick Wins', htmlMedium: 'Medium Term', htmlMajor: 'Major Concerns',
           htmlFiles: 'Files', htmlQuality: 'Quality', htmlDocs: 'Documentation', htmlDeps: 'Dependencies',
           htmlPassed: 'Passed', htmlFailed: 'Failed', htmlLatency: 'Latency', htmlChecks: 'Checks' },
  zh_TW: { name: '繁體中文',     instruction: '所有輸出必須使用繁體中文（zh_TW）。請使用台灣慣用的用語與術語。',
           htmlTitle: '程式碼分析報告', htmlSummary: '摘要', htmlArch: '架構',
           htmlRCA: '根本原因分析', htmlRecs: '建議', htmlBench: '基準測試',
           htmlReg: '回歸檢查', htmlImprove: '已套用改善', htmlReflect: '工作流程自我反思',
           htmlQuick: '快速改善', htmlMedium: '中期改善', htmlMajor: '重大問題',
           htmlFiles: '檔案', htmlQuality: '品質', htmlDocs: '文件', htmlDeps: '依賴',
           htmlPassed: '通過', htmlFailed: '失敗', htmlLatency: '延遲', htmlChecks: '檢查' },
}

const LANG_CFG = LANG_MAP[lang] || LANG_MAP['en']

log(`Analyzing codebase at: ${targetDir}`)
log(`Language: ${LANG_CFG.name}`)
log('Phase 1: Discovering structure...')

const structureInfo = await agent(
  `You are exploring a codebase at "${targetDir}" to map its structure.

   ${LANG_CFG.instruction}

   ⚠ SANDBOX CONSTRAINT: Do NOT use Date.now() or new Date() — these are unavailable
   and will crash the workflow. Never attempt to generate timestamps or dates.

   Step 1 — Use the Glob tool to list all project files (Glob automatically excludes node_modules, .git, and other noise directories):
   Glob("${targetDir}/**/*")

   Note: Glob only returns up to 250 results by default. If you hit this limit,
   run additional more specific Glob patterns (e.g., Glob("${targetDir}/src/**/*"))
   to cover remaining directories.

   Step 2 — Read the key config/setup files (any that exist):
   - package.json (check for "workspaces" field for monorepo detection)
   - pnpm-workspace.yaml, lerna.json, or nx.json (monorepo configs)
   - Cargo.toml / go.mod / pyproject.toml / requirements.txt
   - tsconfig.json
   - Dockerfile / docker-compose.* / Dockerfile.*
   - Makefile
   - .github/workflows/*.yml
   - skills-lock.json

   Use the Read tool to read each file.

   Step 3 — Produce a structured summary:

   directoryTree: Compact markdown tree of the directory structure (max 35 lines, group by top-level).
   fileTypeBreakdown: { totalFiles, languages (comma-sep), primaryLanguage }
   projectType: What kind of project (CLI tool, web app, library, monorepo, etc.)
   buildSystem: Build system and package manager (npm, cargo, go, uv, etc.)
   entryPoints: Array of main entry point files (index.ts, main.py, bin/, etc.)
   workspacePackages: If this is a monorepo, list each workspace package path (e.g., ["packages/*", "apps/*"]). Empty array for non-monorepos.

   Do NOT skip Step 1 and 2 — actually run the commands and read the files.`,
  { label: 'discover-structure', phase: 'Discover', model: 'haiku', schema: STRUCTURE_SCHEMA },
)

// ======================================================================
// PHASE 2: Analyze — dive into specific aspects in parallel
// ======================================================================
phase('Analyze')

log('Phase 2: Running parallel analysis (architecture, deps, quality, docs)...')

const [architecture, deps, codeQuality, documentation] = await parallel([
  () => agent(
    `You are analyzing the architecture of a codebase at "${targetDir}".

    ${LANG_CFG.instruction}

    Structure context:
    ${JSON.stringify(structureInfo, null, 2)}

    Step 1 — Use Glob to find the main source files:
    Glob("${targetDir}/**/*.ts"), Glob("${targetDir}/**/*.tsx"),
    Glob("${targetDir}/**/*.js"), Glob("${targetDir}/**/*.jsx")
    Glob("${targetDir}/**/*.py"), Glob("${targetDir}/**/*.rs")

    Step 2 — Read a representative sample of source files (5-10 key files) to understand patterns.
    Pick the ones that look like entry points, main modules, or core logic.

    Step 3 — Answer:
    - highLevelArchitecture: What's the architecture in 2-3 sentences?
    - majorModules: What are the major components and their purpose?
    - patternsObserved: What design patterns and conventions are visible?
    - potentialConcerns: Any architectural red flags (circular deps, god objects, unclear boundaries)?
    - techStack: Key technologies and versions (language runtime, framework, database, message queue, etc.)
    - dataFlowDescription: How data moves through the system — entry points, processing chain, storage, output

    Be specific — reference actual module names and files.`,
    { label: 'analyze-architecture', phase: 'Analyze', model: 'haiku', schema: ARCHITECTURE_SCHEMA },
  ),
  () => agent(
    `You are analyzing dependencies in a codebase at "${targetDir}".

    ${LANG_CFG.instruction}

    Structure context:
    ${JSON.stringify(structureInfo, null, 2)}

    Step 1 — Read package config files using the Read tool:
    - Read package.json (or workspace package.jsons)
    - Read Cargo.toml / go.mod / pyproject.toml / requirements.txt (whichever exist)
    - Look for any lockfiles (package-lock.json, Cargo.lock, go.sum)

    Step 2 — Use the Grep tool to find import/require/use statements across source code:
    - For JS/TS: Grep(pattern: "'from '") or Grep(pattern: "require\\(") in source files
    - For Python: Grep(pattern: "^import ") or Grep(pattern: "^from ", type: "py")

    Step 3 — Answer:
    - externalDependencies: [{name, type: runtime|dev, purpose}]
    - internalModuleRelations: How do the internal packages/modules relate to each other?
    - health: Any outdated, deprecated, or risky dependencies?

    Infer purpose of each dependency from the project context.`,
    { label: 'analyze-dependencies', phase: 'Analyze', model: 'haiku', schema: DEPENDENCIES_SCHEMA },
  ),
  () => agent(
    `You are assessing code quality of a codebase at "${targetDir}".

    ${LANG_CFG.instruction}

    Structure context:
    ${JSON.stringify(structureInfo, null, 2)}

    Step 1 — Use Glob to find test files:
    Glob("${targetDir}/**/*.test.*"), Glob("${targetDir}/**/*.spec.*"),
    Glob("${targetDir}/**/__tests__/**"), Glob("${targetDir}/**/test/**")

    Step 2 — Read a representative sample of source files (5-10) across different modules.
    Read at least 2 test files if they exist.

    Step 3 — Look for config files that indicate code quality practices:
    - .eslintrc*, .prettierrc*, biome.json, .editorconfig
    - .github/workflows/*.yml (CI checks)
    - tsconfig.json (strictness settings)

    Step 4 — Answer:
    - overallQuality: excellent | good | fair | needs-work | severe
    - strengths: What's done well
    - concerns: Code smells, anti-patterns, potential issues
    - testCoverage: What testing patterns exist? Coverage gaps?
    - conventionsUsed: What good practices are followed?
    - conventionsMissing: What's missing (lint, types, CI)?

    Base your assessment on actual file content you read.`,
    { label: 'analyze-code-quality', phase: 'Analyze', model: 'haiku', schema: CODE_QUALITY_SCHEMA },
  ),
  () => agent(
    `You are assessing documentation quality of a codebase at "${targetDir}".

    ${LANG_CFG.instruction}

    Structure context:
    ${JSON.stringify(structureInfo, null, 2)}

    Step 1 — Read the key documentation files:
    - README.md (or README*)
    - CONTRIBUTING.md, CONTRIBUTING*
    - CHANGELOG.md, CHANGELOG*
    - docs/ directory contents
    - Any API docs

    Step 2 — Read a sample of source files (3-5) to assess inline documentation style:
    - Do they use JSDoc/TSDoc?
    - Are there meaningful comments?
    - Are there READMEs at module level?

    Step 3 — Answer:
    - readmeQuality: excellent | good | fair | missing
    - hasContributingGuide: true/false
    - hasApiDocs: true/false
    - hasChangelog: true/false
    - inlineDocStyle: JSDoc, comments, sparse, etc.
    - gaps: What documentation needs exist that aren't filled?

    Be honest — if docs are minimal, say so.`,
    { label: 'analyze-documentation', phase: 'Analyze', model: 'haiku', schema: DOCUMENTATION_SCHEMA },
  ),
])

// ======================================================================
// PHASE 3: Root-Cause-Analysis — deep systemic analysis (Opus)
// ======================================================================
phase('Root-Cause-Analysis')

log('Phase 3: Running deep root cause analysis (Opus model)...')

const rootCauseAnalysis = await agent(
  `You are a senior engineering lead conducting root cause analysis on a codebase.

   ${LANG_CFG.instruction}

   ## Complete Analysis Findings

   ### Structure
   Project type: ${structureInfo?.projectType || 'Unknown'}
   Build system: ${structureInfo?.buildSystem || 'Unknown'}
   Languages: ${structureInfo?.fileTypeBreakdown?.languages || 'Unknown'}
   Files: ${structureInfo?.fileTypeBreakdown?.totalFiles || 0}
   Entry points: ${JSON.stringify(structureInfo?.entryPoints || [])}

   ### Architecture
   ${architecture?.highLevelArchitecture || '(unavailable)'}
   Modules: ${JSON.stringify(architecture?.majorModules || [])}
   Tech stack: ${architecture?.techStack || '(unavailable)'}
   Data flow: ${architecture?.dataFlowDescription || '(unavailable)'}
   Concerns: ${JSON.stringify(architecture?.potentialConcerns || [])}

   ### Dependencies
   Health: ${deps?.health || '(unavailable)'}
   ${JSON.stringify(deps?.externalDependencies || [])}

   ### Code Quality
   Rating: ${codeQuality?.overallQuality || '(unavailable)'}
   Strengths: ${JSON.stringify(codeQuality?.strengths || [])}
   Concerns: ${JSON.stringify(codeQuality?.concerns || [])}
   Tests: ${codeQuality?.testCoverage || '(unavailable)'}
   Missing conventions: ${JSON.stringify(codeQuality?.conventionsMissing || [])}

   ### Documentation
   README: ${documentation?.readmeQuality || '(unavailable)'}
   Has contributing guide: ${documentation?.hasContributingGuide}
   Has API docs: ${documentation?.hasApiDocs}
   Has changelog: ${documentation?.hasChangelog}
   Gaps: ${JSON.stringify(documentation?.gaps || [])}

   ## Your Task
   Look BEYOND the surface-level issues. Connect the dots across all dimensions to find
   the real root causes. Be specific and reference actual findings.

   1. **systemicPatterns** — What cross-cutting patterns connect multiple separate issues?
      Example: "No error handling + no tests + no CI together mean every deploy is risky,
      and the bus factor is 1 because only one person understands the deployment pipeline."

   2. **rootCauses** — For each major issue, trace back to the root cause:
      - symptom: The visible issue observed
      - rootCause: Why it actually exists (trace through layers)
      - impact: What it means for the project's future
      - fixStrategy: How to address it at the root level

   3. **prioritizedActions** — Top 3-5 actions ranked by impact/effort with clear rationale.
      Consider both quick wins AND strategic investments. Show your reasoning.

   4. **riskAssessment** — Overall project risk:
      - Bus factor (can the project survive if key contributors leave?)
      - Maintainability trajectory (improving, stable, declining?)
      - Technical debt level (manageable, concerning, critical)
      - Key risk vectors (single points of failure, knowledge silos)

      IMPORTANT: ${LANG_CFG.instruction} Input data may be in various languages, but your output fields (systemicPatterns, rootCauses, prioritizedActions, riskAssessment) must be entirely in ${LANG_CFG.name}. Do not let input content language influence output language.`,
  { label: 'root-cause-analysis', phase: 'Root-Cause-Analysis', model: 'opus', schema: ROOT_CAUSE_SCHEMA },
)

// ======================================================================
// PHASE 4: Synthesize — combine findings and root cause analysis into recommendations
// ======================================================================
phase('Synthesize')

log('Phase 4: Generating recommendations...')

const recommendations = await agent(
  `You are a senior engineer reviewing a codebase analysis. Produce actionable recommendations.

   ${LANG_CFG.instruction}

   ## Architecture
   ${architecture?.highLevelArchitecture || '(unavailable)'}
   Modules: ${JSON.stringify(architecture?.majorModules || [])}
   Tech stack: ${architecture?.techStack || '(unavailable)'}
   Data flow: ${architecture?.dataFlowDescription || '(unavailable)'}
   Concerns: ${JSON.stringify(architecture?.potentialConcerns || [])}

   ## Dependencies
   Health: ${deps?.health || '(unavailable)'}
   External deps: ${JSON.stringify(deps?.externalDependencies || [])}

   ## Code Quality
   Rating: ${codeQuality?.overallQuality || '(unavailable)'}
   Strengths: ${JSON.stringify(codeQuality?.strengths || [])}
   Concerns: ${JSON.stringify(codeQuality?.concerns || [])}
   Tests: ${codeQuality?.testCoverage || '(unavailable)'}

   ## Documentation
   README: ${documentation?.readmeQuality || '(unavailable)'}
   Gaps: ${JSON.stringify(documentation?.gaps || [])}

   ## Root Cause Analysis
   Systemic patterns: ${JSON.stringify(rootCauseAnalysis?.systemicPatterns || [])}
   Root causes: ${JSON.stringify(rootCauseAnalysis?.rootCauses || [])}
   Risk assessment: ${rootCauseAnalysis?.riskAssessment || '(unavailable)'}

   IMPORTANT: ${LANG_CFG.instruction} Input data may be in various languages,
   but your output MUST be entirely in ${LANG_CFG.name}. Do not let input content
   language influence your output language. Schema fields must use ${LANG_CFG.name}.

   Produce:
   - quickWins: Easy improvements (low effort, high impact). Be specific — reference files.
   - mediumTerm: Significant but not urgent improvements.
   - majorConcerns: Critical issues that need addressing.

   Make it practical and actionable — a new contributor should know what to pick up first.`,
  { label: 'generate-recommendations', phase: 'Synthesize', model: 'haiku', schema: RECOMMENDATIONS_SCHEMA },
)

// ======================================================================
// PHASE 5: Improve — apply safe fixes based on analysis + root causes
// ======================================================================
phase('Improve')

log('Phase 5: Auto-applying improvements...')

const improveEnabled = !(args && args.skipImprove)

let autoFixesActions = []
let docsActions = []
let infraActions = []

if (improveEnabled) {
  const [autoFixesResult, docsResult, infraResult] = await parallel([
    () => agent(
      `You are applying safe, mechanical improvements to source files at "${targetDir}".

       ## Recommendations to implement
       Quick wins: ${JSON.stringify(recommendations?.quickWins || [], null, 2)}

       ## Root cause context
       Root causes: ${JSON.stringify(rootCauseAnalysis?.rootCauses || [], null, 2)}
       Prioritized: ${JSON.stringify(rootCauseAnalysis?.prioritizedActions || [], null, 2)}

       ## Key files
       Entry points: ${JSON.stringify(structureInfo?.entryPoints || [], null, 2)}

       ## Instructions
       For each recommendation, determine if it is a SAFE, MECHANICAL change. Apply it if so.

       ### Safe changes (apply these):
       - Adding try/catch around unhandled async calls or API calls
       - Adding --help / -h flag processing to CLI tools
       - Adding environment variable fallbacks (e.g., BASE_URL)
       - Adding input validation (null checks, undefined guards, path traversal guards)
       - Adding basic error messages / usage text
       - Fixing obvious type errors
       - Adding missing exports
       - Adding missing return types
       - Adding CI/CD config files (new .github/workflows/*.yml files — creating a new file is safe)
       - Adding linting/formatting config files (new biome.json, .editorconfig — new files only)
       - Adding path whitelist checks to file-read/write tools (additive safety, doesn't change existing logic paths)

       ### Unsafe changes (SKIP these — do not apply):
       - Refactoring module structure
       - Changing function signatures
       - Changing business logic
       - Renaming symbols
       - Changing configuration values (port numbers, timeouts, etc.)
       - Modifying existing .github/workflows/*.yml (might change CI behavior unexpectedly)
       - Any change that could break existing behavior

       ### Process for each change:
       1. Read the relevant file(s) using the Read tool
       2. Use the Edit tool to apply changes
       3. Record what you did

       Return a complete list of all actions taken.`,
      { label: 'apply-quick-wins', phase: 'Improve', model: 'haiku', schema: IMPROVEMENT_SCHEMA },
    ),
    () => agent(
      `You are improving documentation for a codebase at "${targetDir}".

       ## Documentation gaps identified
       README quality: ${documentation?.readmeQuality || 'unknown'}
       Has contributing guide: ${documentation?.hasContributingGuide}
       Has API docs: ${documentation?.hasApiDocs}
       Has changelog: ${documentation?.hasChangelog}
       Gaps: ${JSON.stringify(documentation?.gaps || [], null, 2)}

       ## Root cause context (doc-related)
       ${JSON.stringify((rootCauseAnalysis?.rootCauses || []).filter(r =>
         r.symptom.toLowerCase().includes('doc') || r.fixStrategy.toLowerCase().includes('doc')
       ), null, 2)}

       ## Instructions
       Create or improve documentation files based on the gaps above.

       ### What to create:
       1. **README.md** — If missing or poor quality, create a minimal but useful README with:
          - Project name and one-line description (based on package.json or your reading)
          - Quick start / usage instructions
          - Key commands
          - Don't invent features — base everything on actual code you read

       2. **CONTRIBUTING.md** — If missing, create a minimal contributing guide

       3. **CHANGELOG.md** — If missing, create a basic changelog with an initial entry

       ### Process:
       1. Read any existing README/docs to understand what's already there
       2. Read package.json and a few source files to understand the project
       3. Use the Write tool to create new files, Edit to update existing ones

       ### Rules:
       - Be accurate — don't invent features or APIs that don't exist
       - Keep it concise
       - Mark what you skip and why

       Return a complete list of all actions taken.`,
      { label: 'improve-documentation', phase: 'Improve', model: 'haiku', schema: IMPROVEMENT_SCHEMA },
    ),
    () => agent(
      `You are adding missing infrastructure / config files for a codebase at "${targetDir}".

       ## Project context
       Project type: ${structureInfo?.projectType || 'Unknown'}
       Build system: ${structureInfo?.buildSystem || 'Unknown'}
       Languages: ${structureInfo?.fileTypeBreakdown?.languages || 'Unknown'}
       Primary language: ${structureInfo?.fileTypeBreakdown?.primaryLanguage || 'Unknown'}

       ## Code quality conventions missing
       ${JSON.stringify(codeQuality?.conventionsMissing || [], null, 2)}

       ## Root cause context (infra-related)
       ${JSON.stringify((rootCauseAnalysis?.rootCauses || []).filter(r =>
         r.rootCause.toLowerCase().includes('config') ||
         r.rootCause.toLowerCase().includes('infra') ||
         r.fixStrategy.toLowerCase().includes('ci')
       ), null, 2)}

       ## Instructions
       Add missing infrastructure config files. Only create files that don't already exist.

       ### What to consider creating:
       1. **tsconfig.json** — If project uses TypeScript and no tsconfig exists, create one
          with strict: true, appropriate module settings matching package.json

       2. **.github/workflows/ci.yml** — If no CI exists, create a basic workflow:
          - Trigger: push, pull_request on main branch
          - Steps: checkout, setup runtime (Bun/Node), install, run tests
          - Match the project's actual build/test commands

       3. **Basic linting/formatting config** — If no config exists, add a minimal one
          (eslint.config.js, biome.json, or .prettierrc based on project conventions)

       ### Process:
       1. Read existing files first to understand what's already configured
       2. Only create files that don't exist — never overwrite
       3. Use sensible defaults based on the project type and language
       4. Don't add complex tooling chains — keep infrastructure minimal

       Return a complete list of all actions taken.`,
      { label: 'add-infrastructure', phase: 'Improve', model: 'haiku', schema: IMPROVEMENT_SCHEMA },
    ),
  ])

  autoFixesActions = autoFixesResult?.actions || []
  docsActions = docsResult?.actions || []
  infraActions = infraResult?.actions || []
}

const allImprovements = [...autoFixesActions, ...docsActions, ...infraActions]
  .filter(a => a.status === 'done')

// ======================================================================
// PHASE 6: Benchmark — live smoke-test of agentic CLI capabilities
// ======================================================================
phase('Benchmark')

log('Phase 6: Running agentic benchmark...')

const benchmarkEnabled = !(args && args.skipBenchmark)

let benchmark = null

if (benchmarkEnabled) {
  benchmark = await agent(
    `You are benchmarking the agentic CLI tool at "${targetDir}" to verify multi-turn
     reasoning and tool calling actually work end-to-end. This is a PRODUCTION VERIFICATION
     — you MUST actually run the CLI commands and report real results. Do NOT fabricate.

     ⚠ BENCHMARK RESILIENCE: If some tests cannot run (missing API key, timeout, etc.),
     record them as FAILED with a clear failureReason — do NOT skip them silently.
     A partial benchmark is better than a skipped benchmark.

     ## Step 0: Discover CLI Entry Point
     First, read package.json at "${targetDir}/package.json" to find the CLI's entry point.
     Check "bin", "main", and "scripts" fields — determine how to invoke it.

     Once you determine the correct invocation method, log it clearly.
     If you cannot find an entry point after reading package.json, report all tests
     as failed with reason="No CLI entry point found".

     ## Step 0.5: Check API Key Availability
     Use Bash to check: echo %DEEPSEEK_API_KEY% (Windows) or echo $DEEPSEEK_API_KEY (Unix).
     If the key is empty or not set, note this — it affects web_fetch and potentially
     other tests that need the live API. For non-API tests (calculator, read_file, etc.),
     you can still test the CLI structure by running --help and checking the output.

     ## Required Tests — prioritize these, even without API key:

     ### Always-Runnable Tests (no API key needed):
     1. **--help discovery** — Run: <entry> --help 2>&1
        Verify: output lists available flags (--model, --agent/-a, -h/--help) and tools.
        This test verifies the CLI binary exists and runs.

     2. **args parsing** — Run: <entry> --help (alternative flags: -h)
        Verify: usage text appears, no crash.

     ### API-Dependent Tests (require DEEPSEEK_API_KEY):
     If DEEPSEEK_API_KEY is NOT available, mark these as failed with failureReason="DEEPSEEK_API_KEY not set".

     3. **calculator** — Run: <entry> --agent "use the calculator tool to compute (15 * 8 + 42) / 3"
        Verify: output contains "54".

     4. **list_directory** — Run: <entry> --agent "list the files in the current directory"
        Verify: output mentions real files (package.json, src/, etc).

     5. **read_file** — Run: <entry> --agent "read the file package.json and tell me what dependencies"
        Verify: output mentions actual dependencies from package.json.

     6. **write_file** — Run: <entry> --agent "write a file called bench-test.txt in the current directory containing the text 'hello from agent benchmark'"
        Verify: tool succeeds, then cat ./bench-test.txt (and rm it) to confirm the file exists with correct content.

     7. **grep_search** — Run: <entry> --agent "search for the word 'import' in all .ts files"
        Verify: output lists matching lines from real files.

     8. **web_fetch** — Run: <entry> --agent "fetch https://example.com and tell me what the page title is"
        Verify: output mentions page title. Skip if API key missing.

     ### Multi-Turn Tool Chaining Test:
     9. **MULTI-TURN CHAIN** — Use a prompt that FORCES the CLI to use ≥3 different tools:
        Prompt: "First list all .ts files in src/, then read one of them, then search that file for 'import'. Tell me how many imports are in each file."
        Verify: stderr shows ≥3 distinct "→ tool:" log lines. Check: list_directory, read_file, grep_search.

     ### Error Handling Tests:
     10. **Invalid file** — Run: <entry> --agent "read the file nonexistent-file-xyzzy.txt"
         Verify: returns error message, NOT a crash. Stderr should have no unhandled exception.

     11. **Invalid math** — Run: <entry> --agent "use the calculator to compute 'hello world'"
         Verify: returns error message, not a crash.

     12. **Invalid URL** — Run: <entry> --agent "fetch https://this-domain-definitely-does-not-exist-12345.com"
         Verify: returns error (HTTP error or fetch failure), not a crash.

     ## How to Run
     For each test, use Bash with a timeout (30s per test):
       cd "${targetDir}" && <entry> --agent "<prompt>" 2>&1

     For multi-turn test 9, look carefully at stderr for "→ tool:" log lines —
     each distinct toolName counts as one tool in the chain.

     ## Output
     - toolResults: One entry per test (12 total) with detailed pass/fail/latency
     - overallPassed: true only if ALL tested items passed
     - multiTurnVerified: true only if test 9 showed ≥3 distinct tool calls chained
     - multiTurnDetails: Describe the exact chain observed (e.g., "list_directory → read_file → grep_search → final answer")
     - recommendations: Specific fixes for each failure

     ## CRITICAL
     - Run each command via Bash. Real output only.
     - Record wall-clock time per test (start timestamp before, Δ after).
     - If a test returns NO output or empty, that is a FAIL.
     - If CLI crashes (non-zero exit + error on stderr), that is a FAIL.
     - Do NOT fabricate results — partial data with honest failure reasons is correct.`,
    { label: 'benchmark-cli', phase: 'Benchmark', model: 'sonnet', schema: BENCHMARK_SCHEMA },
  )
} else {
  benchmark = {
    overallPassed: false,
    totalTests: 0, passedTests: 0, failedTests: 0, totalLatencyMs: 0,
    toolResults: [],
    multiTurnVerified: false,
    multiTurnDetails: 'Skipped (skipBenchmark=true)',
    recommendations: [],
    cliPath: '(skipped)',
  }
}

// ======================================================================
// PHASE 6.5: Code-Fix — fix source code based on benchmark failures + RCA
// ======================================================================
phase('Code-Fix')

log('Phase 6.5: Applying code fixes based on benchmark failures...')

const codeFixEnabled = !(args && args.skipCodeFix)

let codeFix = null

if (codeFixEnabled && benchmark && benchmark.failedTests > 0) {
  codeFix = await agent(
    `You are fixing the agentic CLI tool at "${targetDir}" based on benchmark failures.
     Read the actual source files, identify the root defects, and apply targeted fixes.

     ## Benchmark Failures (these tests DID NOT PASS)
     Total failed: ${benchmark.failedTests}/${benchmark.totalTests}
     Multi-turn verified: ${benchmark.multiTurnVerified}

     Failed test details:
     ${JSON.stringify((benchmark.toolResults || []).filter(r => !r.passed), null, 2)}

     ## Root Cause Context
     ${JSON.stringify((rootCauseAnalysis?.rootCauses || []), null, 2)}

     ## Code Quality Context
     Overall: ${codeQuality?.overallQuality || 'unknown'}
     Strengths: ${JSON.stringify(codeQuality?.strengths || [])}
     Concerns: ${JSON.stringify(codeQuality?.concerns || [])}
     Missing conventions: ${JSON.stringify(codeQuality?.conventionsMissing || [])}

     ## Architecture Context
     Entry points: ${JSON.stringify(structureInfo?.entryPoints || [])}
     Tech stack: ${architecture?.techStack || 'unknown'}

     ## Your Task
     For each benchmark failure, read the relevant source file(s) and apply a fix.

     ### Safe fixes to apply:
     - Fix tool definitions that return incorrect results
     - Add missing error handling (try/catch, null checks)
     - Fix invocation/CLI argument parsing bugs
     - Add missing imports or dependencies
     - Fix tool execute() functions that crash on edge cases
     - Add input validation/sanitization
     - Fix path handling issues
     - Correct output formatting

     ### Unsafe changes (SKIP):
     - Major refactoring
     - Changing public API signatures
     - Removing existing functionality
     - Changing dependency versions
     - Rewriting entire modules

     ### Process:
     1. Read the source file where the failure originates
     2. Identify the exact code causing the failure
     3. Apply a minimal, targeted fix using the Edit tool
     4. Record what you did and why

     Return a complete list of all fixes applied, skipped, or deemed unfixable.`,
    { label: 'code-fix', phase: 'Code-Fix', model: 'sonnet', schema: CODE_FIX_SCHEMA },
  )
} else if (codeFixEnabled && benchmark && benchmark.failedTests === 0) {
  codeFix = {
    benchmarkFixes: [],
    improvementsMade: 0,
    improvementsSkipped: 0,
    overallBenchmarkPassedAfterFix: true,
    summary: 'All benchmark tests passed — no fixes needed.',
  }
} else {
  codeFix = {
    benchmarkFixes: [],
    improvementsMade: 0,
    improvementsSkipped: 0,
    overallBenchmarkPassedAfterFix: false,
    summary: codeFixEnabled ? 'Benchmark was skipped or produced no results — cannot fix.' : 'Skipped (skipCodeFix=true)',
  }
}

// ======================================================================
// Build the report (pre-reflection) so Phase 7 can reference it
// ======================================================================
const report = {
  analyzedAt: '{{analysis-date}}',
  targetDirectory: targetDir,

  summary: {
    projectType:       structureInfo?.projectType || 'Unknown',
    primaryLanguage:   structureInfo?.fileTypeBreakdown?.primaryLanguage || 'Unknown',
    totalFiles:        structureInfo?.fileTypeBreakdown?.totalFiles || 0,
    languages:         structureInfo?.fileTypeBreakdown?.languages || '',
    buildSystem:       structureInfo?.buildSystem || '',
    overallQuality:    codeQuality?.overallQuality || 'unknown',
    documentationQuality: documentation?.readmeQuality || 'unknown',
    entryPoints:       structureInfo?.entryPoints || [],
  },

  structure:      structureInfo || {},
  architecture:   architecture || {},
  dependencies:   deps || {},
  codeQuality:    codeQuality || {},
  documentation:  documentation || {},

  recommendations: recommendations || { quickWins: [], mediumTerm: [], majorConcerns: [] },

  rootCauseAnalysis: rootCauseAnalysis || { systemicPatterns: [], rootCauses: [], prioritizedActions: [], riskAssessment: '' },

  improvements: improveEnabled ? {
    filesModified: allImprovements.length,
    actions: allImprovements,
    skippedCount: [...autoFixesActions, ...docsActions, ...infraActions].filter(a => a.status === 'skipped').length,
    failedCount: [...autoFixesActions, ...docsActions, ...infraActions].filter(a => a.status === 'failed').length,
  } : { filesModified: 0, actions: [], skippedCount: 0, failedCount: 0 },

  benchmark: benchmark || null,

  codeFix: codeFix || null,

  workflowReflection: null, // filled after Phase 7
  regression:         null, // filled after Phase 8
  reportPaths:        null, // filled after Phase 9
}

// ======================================================================
// PHASE 7: Workflow-Reflection — improve the workflow itself (Opus)
// ======================================================================
phase('Workflow-Reflection')

log('Phase 7: Running workflow self-reflection (Opus model)...')

const reflectEnabled = !(args && args.skipReflection)

if (reflectEnabled) {
  const reflection = await agent(
    `You are reviewing the analyze-codebase workflow after it completed a full run.

     ⚠ SANDBOX CONSTRAINT: This workflow runs in a sandbox where Date.now() and new Date()
     are UNAVAILABLE and will cause the entire workflow to fail. NEVER introduce Date API calls.
     The '{{analysis-date}}' placeholder is INTENTIONAL — do NOT replace it with Date code.
     When editing the workflow file, NEVER add code that uses Date.now() or new Date().

     ## What Was Analyzed
     Target: ${targetDir}
     Project: ${report.summary.projectType}
     Language: ${report.summary.primaryLanguage}
     Files: ${report.summary.totalFiles}
     Quality: ${report.summary.overallQuality}

     ## Recommendations Generated
     Quick wins: ${JSON.stringify(recommendations?.quickWins || [])}
     Medium term: ${JSON.stringify(recommendations?.mediumTerm || [])}
     Major concerns: ${JSON.stringify(recommendations?.majorConcerns || [])}

     ## Root Causes Found
     ${JSON.stringify(rootCauseAnalysis?.rootCauses || [], null, 2)}

     ## Improvements Applied
     ${JSON.stringify(allImprovements, null, 2)}

     ## Benchmark Results
     Passed: ${benchmark?.passedTests || 0}/${benchmark?.totalTests || 0}
     Multi-turn verified: ${benchmark?.multiTurnVerified ? 'yes' : 'no'}
     Total latency: ${benchmark?.totalLatencyMs || 0}ms
     Failures: ${JSON.stringify((benchmark?.toolResults || []).filter(r => !r.passed), null, 2)}
     Benchmark recommendations: ${JSON.stringify(benchmark?.recommendations || [], null, 2)}

     ## Code Fix Results (from Phase 6.5)
     Fixes applied: ${codeFix?.improvementsMade || 0}
     Fixes skipped: ${codeFix?.improvementsSkipped || 0}
     Would pass after fixes: ${codeFix?.overallBenchmarkPassedAfterFix ? 'yes' : 'no'}
     ${JSON.stringify(codeFix?.benchmarkFixes || [], null, 2)}

     ## Your Task
     Review the workflow itself and suggest improvements.

     First, find and read the workflow script. Use Glob to locate it:
     Glob(".claude/workflows/analyze-codebase.js")
     If not found, search more broadly: Glob("**/analyze-codebase.js")

     Read the file using the Read tool. Understand its full structure — prompts,
     schemas, phase ordering, model choices, tool usage.

     Then evaluate:

     1. **workflowObservations** — How did the workflow perform? Were any prompts
        too vague or too narrow? Did any agents struggle? Coverage gaps?

     2. **promptImprovements** — Specific, concrete prompt changes. Which phase
        and agent? What should the prompt say instead? Why would it help?

     3. **schemaImprovements** — Are the JSON schemas capturing the right data?
        Any missing fields? Overly restrictive enums? Redundant required fields?

     4. **structuralImprovements** — Would different phase ordering help?
        Should more agents run in parallel? Better model allocation?
        Should new phases be added or existing ones merged?

     5. **hasActionableChanges** — If true, apply changes to the workflow .js file
        using the Edit tool. Only make changes that clearly improve the workflow.

     6. **changesApplied** — For each Edit you make to the .js file, record what
        you changed and why.

     Be critical and specific. The goal is to make this workflow more effective
     for future runs on other codebases.`,
    { label: 'workflow-reflection', phase: 'Workflow-Reflection', model: 'opus', schema: WORKFLOW_REFLECTION_SCHEMA },
  )

  report.workflowReflection = reflection
} else {
  report.workflowReflection = {
    workflowObservations: ['Skipped (skipReflection=true)'],
    promptImprovements: [],
    schemaImprovements: [],
    structuralImprovements: [],
    hasActionableChanges: false,
    changesApplied: [],
  }
}

// ======================================================================
// PHASE 8: Regression — verify self-improvement didn't break invariants
// ======================================================================
phase('Regression')

log('Phase 8: Running regression checks on workflow file...')

const regressionEnabled = !(args && args.skipRegression)
let regression = null

const WORKFLOW_PATH = '.claude/workflows/analyze-codebase.js'

if (regressionEnabled) {
  regression = await agent(
    `You are running regression tests on the analyze-codebase workflow to verify
     that Phase 7 self-improvement edits did NOT break the workflow.

     ## Critical Task
     Read the workflow file at "${WORKFLOW_PATH}" and verify these invariants hold.

     ### 0. SANDBOX COMPLIANCE (category: invariant)
     - The file must NOT contain Date.now() or new Date() anywhere (sandbox blocks these)
     - The analyzedAt field must be '{{analysis-date}}' (NOT new Date().toISOString())
     - If you find new Date() or Date.now(), IMMEDIATELY revert it to the safe placeholder
       using the Edit tool, and report it as a FAILED check with detail and fix applied.

     ### 1. META OBJECT (category: meta)
     - meta.name must be "analyze-codebase"
     - meta.description must exist and be a non-empty string
     - meta.phases must be an array with ≥ 8 entries
     - meta.whenToUse must exist

     ### 2. SCHEMAS PRESENT (category: schema)
     These 12 schemas must exist as const declarations:
     STRUCTURE_SCHEMA, ARCHITECTURE_SCHEMA, DEPENDENCIES_SCHEMA,
     CODE_QUALITY_SCHEMA, DOCUMENTATION_SCHEMA, RECOMMENDATIONS_SCHEMA,
     ROOT_CAUSE_SCHEMA, IMPROVEMENT_SCHEMA, BENCHMARK_SCHEMA,
     CODE_FIX_SCHEMA, WORKFLOW_REFLECTION_SCHEMA, REGRESSION_SCHEMA

     (That's 12 schemas total.)

     Each schema must:
     - Have type: object
     - Have properties with at least 2 properties
     - Have required array with at least 1 entry

     ### 3. PHASE ORDERING (category: phase-ordering)
     - The order of phase() calls in code MUST match meta.phases order
     - Each phase title in meta.phases must have exactly one phase('Title') call
     - phase() calls must be in: Discover, Analyze, Root-Cause-Analysis, Synthesize,
       Improve, Benchmark, Code-Fix, Workflow-Reflection, Regression, Report (10 total)

     ### 4. VARIABLE REFERENCES (category: variable-reference)
     - Every template variable referenced in agent prompts must exist
       in the scope where it's used (e.g., structureInfo, architecture, deps,
       codeQuality, documentation, rootCauseAnalysis, recommendations, benchmark)
     - No references to variables that are out of scope

     ### 5. STRUCTURAL INTEGRITY (category: structural)
     - No duplicate phase() calls for the same title
     - The report object has all required fields: summary, structure, architecture,
       dependencies, codeQuality, documentation, recommendations, rootCauseAnalysis,
       improvements, benchmark, codeFix, workflowReflection, regression
     - The return statement at the end exists and returns report
     - All agent() calls have valid {label, phase, model, schema} opts

     ### 6. SELF-REFERENCE SAFETY (category: invariant)
     - Phase("Workflow-Reflection") does NOT edit any code BEFORE its own phase() call
       (it should only edit schemas, prompts, or structure of earlier phases)
     - The meta.phases array is the single source of phase truth

     ## Output
     Run ALL checks listed above. For each:
     - check: name of the check
     - category: which category it falls under
     - passed: true/false
     - detail: what was verified and the result
     - fix: if failed, the EXACT edit to make (using the Edit tool). If you can
       safely apply the fix, do so with the Edit tool and record it in fixesApplied.

     Set criticalInvariants based on your findings.
     Set rollbackNeeded to true ONLY if >3 critical failures exist.
     Set overallPassed to true ONLY if all checks pass.`,
    { label: 'regression-check', phase: 'Regression', model: 'haiku', schema: REGRESSION_SCHEMA },
  )
} else {
  regression = {
    overallPassed: false,
    totalChecks: 0, passedChecks: 0, failedChecks: 0,
    checks: [],
    workflowFilePath: WORKFLOW_PATH,
    criticalInvariants: { schemasIntact: false, phasesOrderValid: false, metaFieldsPresent: false, noSyntaxErrors: false },
    rollbackNeeded: false,
    fixesApplied: [],
  }
}

report.regression = regression

// ======================================================================
// Pretty-print summary
// ======================================================================
log('')
log('═══ Codebase Analysis Complete ═══')
log(`  Project:       ${report.summary.projectType}`)
log(`  Language:      ${report.summary.primaryLanguage}`)
log(`  Files:         ${report.summary.totalFiles}`)
log(`  Quality:       ${report.summary.overallQuality}`)
log(`  Docs:          ${report.summary.documentationQuality}`)
log(`  Entry points:  ${(report.summary.entryPoints || []).join(', ') || 'none detected'}`)
log('')
log(`  ✓ Quick wins:    ${report.recommendations.quickWins.length}`)
log(`  → Medium-term:   ${report.recommendations.mediumTerm.length}`)
log(`  ⚠ Major issues:  ${report.recommendations.majorConcerns.length}`)
if (report.recommendations.quickWins.length > 0) {
  log('')
  log('  Quick wins:')
  report.recommendations.quickWins.forEach((r, i) => log(`    ${i+1}. ${r}`))
}

// Root cause summary
if (rootCauseAnalysis) {
  log('')
  log('═══ Root Cause Analysis ═══')
  log(`  Systemic patterns:  ${(rootCauseAnalysis.systemicPatterns || []).length}`)
  log(`  Root causes traced: ${(rootCauseAnalysis.rootCauses || []).length}`)
  log(`  Top actions:        ${(rootCauseAnalysis.prioritizedActions || []).length}`)
  if (rootCauseAnalysis.rootCauses && rootCauseAnalysis.rootCauses.length > 0) {
    log('')
    rootCauseAnalysis.rootCauses.slice(0, 3).forEach((rc, i) => {
      log(`  ${i+1}. ${rc.symptom}`)
      log(`     Root cause: ${rc.rootCause}`)
    })
  }
  if (rootCauseAnalysis.riskAssessment) {
    log('')
    log(`  Risk: ${rootCauseAnalysis.riskAssessment}`)
  }
}

// Improvement summary
if (improveEnabled && allImprovements.length > 0) {
  log('')
  log('═══ Improvements Applied ═══')
  log(`  Files modified/created: ${allImprovements.length}`)
  for (const a of allImprovements) {
    log(`  ${a.type === 'create' ? '+' : '~'} ${a.file} — ${a.description}`)
  }
  const skipped = [...autoFixesActions, ...docsActions, ...infraActions].filter(a => a.status === 'skipped')
  for (const a of skipped) {
    log(`  - ${a.file} — ${a.description} (skipped)`)
  }
}

// Benchmark summary
if (benchmarkEnabled && benchmark && benchmark.totalTests > 0) {
  log('')
  log('═══ Agentic Benchmark ═══')
  log(`  Passed:  ${benchmark.passedTests}/${benchmark.totalTests}`)
  log(`  Failed:  ${benchmark.failedTests}`)
  log(`  Latency: ${(benchmark.totalLatencyMs / 1000).toFixed(1)}s total`)
  log(`  Multi-turn verified: ${benchmark.multiTurnVerified ? '✓ YES' : '✗ NO'}`)
  if (benchmark.toolResults && benchmark.toolResults.length > 0) {
    log('')
    log('  Per-tool results:')
    for (const r of benchmark.toolResults) {
      const icon = r.passed ? '✓' : '✗'
      const tag = r.testType === 'multi-turn' ? '[multi-turn]' : r.testType === 'error-handling' ? '[error]' : '[single]'
      log(`  ${icon} ${r.tool.padEnd(16)} ${tag.padEnd(13)} ${r.latencyMs}ms — ${r.description}`)
    }
  }
  if (benchmark.multiTurnDetails && benchmark.multiTurnDetails !== 'Skipped (skipBenchmark=true)') {
    log('')
    log(`  Chain: ${benchmark.multiTurnDetails}`)
  }
  if (benchmark.recommendations && benchmark.recommendations.length > 0) {
    log('')
    log('  Benchmark recommendations:')
    benchmark.recommendations.forEach((r, i) => log(`    ${i+1}. ${r}`))
  }
}

// Code-Fix summary
if (codeFixEnabled && codeFix && codeFix.improvementsMade > 0) {
  log('')
  log('═══ Code Fixes (from benchmark) ═══')
  log(`  Fixes applied:   ${codeFix.improvementsMade}/${(codeFix.benchmarkFixes || []).length}`)
  log(`  Fixes skipped:   ${codeFix.improvementsSkipped}`)
  log(`  Would pass now:  ${codeFix.overallBenchmarkPassedAfterFix ? '✓ YES' : '✗ NO'}`)
  if (codeFix.benchmarkFixes && codeFix.benchmarkFixes.length > 0) {
    log('')
    codeFix.benchmarkFixes.forEach((f, i) => {
      const icon = f.status === 'fixed' ? '✓' : f.status === 'skipped' ? '−' : '✗'
      log(`  ${icon} ${f.failure} → ${f.file}: ${f.fix.slice(0, 80)}`)
    })
  }
}

// Workflow reflection summary
if (reflectEnabled && report.workflowReflection) {
  log('')
  log('═══ Workflow Self-Reflection ═══')
  log(`  Observations:          ${(report.workflowReflection.workflowObservations || []).length}`)
  log(`  Prompt improvements:   ${(report.workflowReflection.promptImprovements || []).length}`)
  log(`  Schema improvements:   ${(report.workflowReflection.schemaImprovements || []).length}`)
  log(`  Structural changes:    ${(report.workflowReflection.structuralImprovements || []).length}`)
  log(`  Changes applied to workflow: ${(report.workflowReflection.changesApplied || []).length}`)
  if (report.workflowReflection.workflowObservations && report.workflowReflection.workflowObservations.length > 0) {
    log('')
    report.workflowReflection.workflowObservations.slice(0, 3).forEach((obs, i) => {
      log(`  • ${obs}`)
    })
  }
  if (report.workflowReflection.changesApplied && report.workflowReflection.changesApplied.length > 0) {
    log('')
    log('  Workflow file changes:')
    report.workflowReflection.changesApplied.forEach((c, i) => log(`    ${i+1}. ${c}`))
  }
}

// Regression summary
if (regressionEnabled && regression && regression.totalChecks > 0) {
  log('')
  log('═══ Regression ═══')
  log(`  Checks:  ${regression.passedChecks}/${regression.totalChecks} passed`)
  if (regression.failedChecks > 0) log(`  Failed:  ${regression.failedChecks}`)
  log(`  Schemas intact:    ${regression.criticalInvariants?.schemasIntact ? '✓' : '✗'}`)
  log(`  Phase order valid: ${regression.criticalInvariants?.phasesOrderValid ? '✓' : '✗'}`)
  log(`  Meta fields:       ${regression.criticalInvariants?.metaFieldsPresent ? '✓' : '✗'}`)
  log(`  No syntax errors:  ${regression.criticalInvariants?.noSyntaxErrors ? '✓' : '✗'}`)
  if (regression.rollbackNeeded) {
    log('  ⚠ ROLLBACK NEEDED — workflow was broken by self-improvement')
  }
  if (regression.fixesApplied && regression.fixesApplied.length > 0) {
    log('')
    log('  Auto-fixes applied:')
    regression.fixesApplied.forEach((f, i) => log(`    ${i+1}. ${f}`))
  }
  const failed = (regression.checks || []).filter(c => !c.passed)
  if (failed.length > 0) {
    log('')
    log('  Failed checks:')
    failed.forEach(f => log(`    ✗ ${f.check} — ${f.detail}`))
  }
}

// ======================================================================
// PHASE 9: Report — generate structured JSON + interactive HTML dashboard
// ======================================================================
phase('Report')

log('Phase 9: Generating report files...')

const reportEnabled = !(args && args.skipReport)

let reportPaths = { jsonPath: '', htmlPath: '' }

if (reportEnabled) {
  const slug = targetDir.replace(/[\/\\:]/g, '-').replace(/^\.-/, '').replace(/^-+/, '').replace(/-+$/, '') || 'analysis'
  const outDir = `docs/analysis/${slug}`
  const jsonPath = `${outDir}/report.json`
  const htmlPath = `${outDir}/report.html`

  // Step 1: Write the JSON report
  const jsonContent = JSON.stringify(report, null, 2)
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
  await agent(
    `Write the analysis report JSON to disk.

     1. First, run: mkdir -p "${outDir}"   (via Bash)
     2. Then write the file "${jsonPath}" with this content:
     ${jsonContent}

     Use the Write tool to create the file. Make sure the directory exists first.`,
    { label: 'write-json-report', phase: 'Report', model: 'haiku' },
  )

  // Step 2: Generate an interactive HTML dashboard from the JSON
  await agent(
    `Generate an interactive HTML dashboard for a codebase analysis report.

     Write the HTML file to: "${htmlPath}"

     The report JSON is at: "${jsonPath}"

     ## HTML Requirements

     ### LOCALIZATION — Use these exact labels for ALL UI text:
     Page title: "${LANG_CFG.htmlTitle}"
     Sidebar nav labels: "${LANG_CFG.htmlSummary}", "${LANG_CFG.htmlArch}", "${LANG_CFG.htmlRCA}",
       "${LANG_CFG.htmlRecs}", "${LANG_CFG.htmlBench}", "${LANG_CFG.htmlReg}",
       "${LANG_CFG.htmlImprove}", "${LANG_CFG.htmlReflect}"
     Section headers: "${LANG_CFG.htmlQuick}", "${LANG_CFG.htmlMedium}", "${LANG_CFG.htmlMajor}"
     Dashboard card labels: "${LANG_CFG.htmlFiles}", "${LANG_CFG.htmlQuality}", "${LANG_CFG.htmlDocs}", "${LANG_CFG.htmlDeps}"
     Status labels: "${LANG_CFG.htmlPassed}", "${LANG_CFG.htmlFailed}", "${LANG_CFG.htmlLatency}", "${LANG_CFG.htmlChecks}"
     ALL visible text, headings, labels, and button text must use ${LANG_CFG.name}.
     ${LANG_CFG.instruction}

     ### Layout
     - Dark theme, modern dashboard style (like Grafana/Datadog)
     - Fixed sidebar navigation (sticky, 250px wide) with links to each section
     - Main content area scrolls
     - Responsive (works on 1200px+ screens)

     ### Header
     - Project name (from summary.projectType) as H1
     - Language and file count badges
     - Overall quality score as a colored pill (excellent=green, good=blue, fair=yellow, needs-work=red)
     - Documentation quality badge

     ### Summary Dashboard Cards (top row, 4 cards)
     - Files: total count, language breakdown
     - Quality: rating + test coverage status
     - Architecture: pattern count + concern count
     - Dependencies: external count + health status

     ### Recommendations Section
     - Three columns with localized headers
     - Each item in a card with numbering

     ### Root Cause Analysis Section
     - Systemic patterns as numbered cards
     - Root causes: each as an expandable accordion (click header to expand)
       - Header shows: symptom (bold)
       - Expanded shows: rootCause, impact, fixStrategy
     - Risk assessment as a highlighted callout box

     ### Architecture Section
     - High-level architecture as a blockquote
     - Tech stack as a comma-separated list with badges (render from REPORT.architecture.techStack)
     - Data flow description as a code block or callout (render from REPORT.architecture.dataFlowDescription)
     - Major modules as a table with localized column headers
     - Patterns observed as a tag cloud
     - Concerns as a warning list

     ### Benchmark Results Section
     - Big pass/fail badge at top (green checkmark or red X)
     - Summary stats: passed/total, avg latency, multi-turn verified
     - Per-tool results table with localized column headers
     - Multi-turn chain details in a code block

     ### Regression Section
     - Pass/fail summary
     - Critical invariants grid (4 boxes)
     - Failed checks list (if any)

     ### Improvements Applied Section
     - Table of files modified/created with localized headers

     ### Workflow Reflection Section
     - Observations list
     - Prompt improvements as cards
     - Structural improvements as a numbered list

     ### Technical Details
     - Use vanilla HTML/CSS/JS (no frameworks)
     - Embed all CSS in a style tag
     - Add minimal JS for:
       - Accordion expand/collapse (for root causes)
       - Smooth scroll navigation (sidebar links)
       - Active section highlighting in sidebar on scroll
     - Use CSS Grid and Flexbox for layout
     - Use system fonts (Segoe UI, system-ui, sans-serif)
     - Color palette:
       - Background: #0d1117 (GitHub dark)
       - Card bg: #161b22
       - Border: #30363d
       - Text: #c9d1d9
       - Accent: #58a6ff (blue)
       - Green: #3fb950
       - Red: #f85149
       - Amber: #d2991d

     ### Data Embedding
     Embed the FULL report JSON as a JavaScript variable at the top of the HTML:
     const REPORT = <full JSON>;
     Then use DOM APIs to populate all sections dynamically from REPORT.
     This way the HTML is self-contained — no fetch() needed.

     Write the file using the Write tool.`,
    { label: 'write-html-report', phase: 'Report', model: 'haiku' },
  )

  reportPaths = { jsonPath, htmlPath }
  report.reportPaths = reportPaths
} else {
  report.reportPaths = { jsonPath: '(skipped)', htmlPath: '(skipped)' }
}

log('')

return report
