# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential commands

```bash
# Run tests
bun test

# Verify installed agent skills (static checks)
bun scripts/verify-skills.ts
bun scripts/verify-skills.ts --live          # + live smoke test via wrapper
bun scripts/verify-skills.ts --skill <name>  # single skill

# Validate OpenCode config
./scripts/opencode-smoke-test.sh

# Validate DrawThings image generation configs
bun run scripts/drawthings-bench.ts benchmark

# DeepSeek CLI
bun run bun_apps/deepseek-cli/src/index.ts --model pro <prompt>

# Learning-Anything server (knowledge graph + LLM agent backend)
UA_GRAPH_PATH=../Understand-Anything/.understand-anything/knowledge-graph.json bun run bun_apps/learning-anything/src/index.ts
# Or set UA_PORT, UA_HOST, UA_DASHBOARD_URL as env vars

# Launch Claude Code via alternative backends (source these, don't exec)
source scripts/claude-code-deepseek.sh       # via DeepSeek API
source scripts/claude-code-glm.sh            # via GLM/Z.AI API
source scripts/claude-code-origin.sh         # clean Anthropic env

# Project analysis workflow (Claude Code agent invocations)
# Workflow({ name: 'analyze-codebase' })

# DeepSeek CLI self-improvement workflow
# Workflow({ name: 'deepseek-cli-self-improve' })
# Workflow({ name: 'deepseek-cli-self-improve', args: { iterations: 3 } })
# Metrics history persisted at: dist/deepseek-cli-metrics-history.json

# demo-bun-image self-improvement workflow
# Workflow({ name: 'demo-bun-image-self-improve' })
# Workflow({ name: 'demo-bun-image-self-improve', args: { iterations: 3 } })
# Metrics history persisted at: dist/demo-bun-image-metrics-history.json

# Understand-Anything development workflow (learns from UA dashboard, self-improves)
# Workflow({ name: 'learning-anything-develop-flow' })
# Workflow({ name: 'learning-anything-develop-flow', args: { iterations: 3 } })
# Metrics history persisted at: dist/understand-anything-metrics-history.json

# Start SurrealDB
./scripts/run_surreal.sh
```

## High-level architecture

This is a **personal dev tooling harness** — a monorepo (npm workspaces, Bun runtime) that:
- **Wraps Claude Code** to use alternative LLM backends (DeepSeek, GLM/Z.AI) via env var injection
- **Hosts ~13 agent skills** mirrored from [mattpocock/skills](https://github.com/mattpocock/skills) with lockfile-verified content hashes
- **Provides CLI tools** (DeepSeek CLI via Vercel AI SDK, DrawThings config benchmarker, SurrealDB launcher)
- **Configures an OpenCode multi-agent workspace** (`.opencode/`) with 25+ agents across coding, office, and content domains

### Monorepo workspace layout

The root `package.json` declares `"workspaces": ["bun_apps/*"]`. Bun hoists all dependencies to a single root `node_modules/` — individual `bun_apps/*/node_modules` directories should **not** exist. Key implications:

- **One install for all apps** — run `bun install` at root only. All workspace packages share the same dependency tree.
- **No per-app `node_modules`** — if you see `bun_apps/<app>/node_modules`, delete it; it means something ran a nested install by mistake.
- **Adding a new app** — create `bun_apps/<name>/package.json` (with `"private": true`), add dependencies there, then `bun install` at root.
- **Cross-app imports** — workspace packages can reference each other by name if listed as dependencies, but currently each app is standalone.

Current workspace packages:
- `bun_apps/deepseek-cli` — DeepSeek LLM CLI via Vercel AI SDK (`@ai-sdk/openai`, `ai`, `mathjs`, `zod`)
- `bun_apps/learning-anything` — Bun web server backend for Claude Code workflows (Vercel AI SDK + DeepSeek models, knowledge graph API, LLM agent endpoints)
- `bun_apps/hello-bun` — Minimal hello-world CLI (no dependencies)

### Provider abstraction pattern

The central architectural pattern is **provider injection via environment variables**. Instead of directly calling model APIs, the scripts wrap `claude` CLI by setting `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and model-selection env vars before spawning it. Each provider has three variants:

```
scripts/
  claude-code-{backend}.ts      # Bun executable (hardcoded defaults)
  claude-code-{backend}.sh      # Shell script (sources env files)
  claude-code-{backend}.ps1     # PowerShell for Windows
```

The `.ts` and `.sh` variants diverge in behavior (hardcoded defaults vs. sourced env files) — canonical form is not yet settled.

### Skill system

Skills live in `.agents/skills/<name>/SKILL.md` and are symlinked into `.claude/skills/<name>`. `skills-lock.json` pins content hashes against a GitHub source repo. Key conventions:
- Every SKILL.md has YAML frontmatter with `name`, `description`, `tags`
- `description` is ≤ 150 chars and includes trigger keywords ("Use when...")
- Two verification scripts: `verify-skills.ts` (static + live) and `audit-skill-descriptions.ts` (standalone audit)
- `verify-skills.ts` also validates symlink integrity between `.agents` and `.claude`

### Multi-platform design

Non-trivial scripts are provided in all three forms: Unix shell, PowerShell, and Bun/TypeScript. The Bun variants use `import.meta.main` guards to act as both importable modules and CLI entry points. `process.argv` parsing follows a consistent `--flag value` pattern.

### Known gaps (intentional)

- **No tsconfig.json** — zero TypeScript strictness enforcement
- **No linting/formatting** — no eslint, prettier, or biome config
- **No CI/CD** — no `.github/workflows/`; tests run manually
- **`bun.lock` excluded from git** — installs are non-reproducible
- **4 test files import missing modules** — these are dead until modules are restored or imports removed

### Domain docs

See `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, and `docs/agents/triage-labels.md` for agent-facing conventions. Issues are tracked on GitHub Issues via `gh` CLI.
