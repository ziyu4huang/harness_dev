# PRD: OpenCode Config Reproducibility & E2E Smoke Tests

## Problem Statement

Setting up OpenCode on a new machine is error-prone and unverifiable. Configuration errors — wrong `{env:}` syntax, incorrect `baseURL`, missing API keys, malformed MCP server entries — fail silently or produce cryptic `ProviderModelNotFoundError` / `ProviderInitError` messages. There is no standard way to confirm "did my setup actually work?" after following the documentation.

Additionally, the project's `.opencode` configuration is split across two files with different concerns (global secrets vs. git-tracked agents), but this split was not documented, and no new-machine reproduction guide existed. The documentation improvements made in the previous session (self-contained `opencode.json.md` with embedded config templates) address the "how to set up" question, but not the "how to verify" question.

## Solution

Provide a `scripts/opencode-smoke-test.sh` script that uses `opencode run` (non-interactive mode) to verify each provider, each MCP server, and key agents respond correctly. The script exits non-zero on any failure, making it usable in CI or as a post-setup checklist. Combined with the updated `opencode.json.md` setup guide, a developer on a new machine can go from zero to confirmed-working in a single session.

## User Stories

1. As a developer setting up OpenCode on a new machine, I want to run a single command that verifies all providers are reachable, so that I know my API keys and baseURLs are correct before I start working.
2. As a developer, I want to verify that the GLM (my-zai) provider responds to a simple prompt, so that I know the Z.AI API key and endpoint are configured correctly.
3. As a developer, I want to verify that the DeepSeek (my-ds) provider responds to a simple prompt, so that I know the DeepSeek API key and endpoint are configured correctly.
4. As a developer, I want to verify that the `web-search-prime` MCP tool is reachable and returns results, so that I know ZAI_API_KEY is valid and the remote MCP endpoint is accessible.
5. As a developer, I want to verify that the `web-reader` MCP tool can fetch a URL, so that I know remote MCP connectivity is working end-to-end.
6. As a developer, I want to verify that the `zread` MCP tool can list repo structure, so that I know git-based code tools are operational.
7. As a developer, I want to verify that the `zai-mcp-server` local stdio tool starts correctly, so that I know `bunx` can launch the MCP package.
8. As a developer, I want to verify the `build` agent (default) processes a prompt and produces output, so that I know the default agent config is valid.
9. As a developer, I want to verify the `explore` agent processes a prompt, so that I know the read-only exploration agent is operational.
10. As a developer, I want to verify at least one `office-*` agent responds, so that I know agent prompt files (`{file:./agents/...}`) are being loaded correctly.
11. As a developer, I want to verify the `gcc-coordinator` agent responds, so that I know the GCC content creation multi-agent setup is wired correctly.
12. As a developer, I want each smoke test to produce a clear PASS/FAIL line in terminal output, so that I can quickly identify which component failed without reading verbose logs.
13. As a developer, I want the smoke test to accept a `--provider <name>` flag so I can test a single provider in isolation, without running the full suite.
14. As a developer, I want the smoke test to accept a `--mcp` flag that tests only MCP servers, so that I can debug connectivity issues separately from model issues.
15. As a developer, I want failed tests to print the raw `opencode run` stderr output (or suggest `--log-level DEBUG`), so that I have actionable debug information without re-running manually.
16. As a developer, I want the smoke test to use `opencode run --format json` where possible, so that I can programmatically parse success/failure rather than grepping raw text.
17. As a developer reading the setup docs, I want a "Verify" section in `opencode.json.md` that points to the smoke test script, so that the docs and the test are cross-referenced.
18. As a CI system, I want the smoke test script to be runnable in headless environments where `ZAI_API_KEY` and `DEEPSEEK_API_KEY` are set as environment variables, so that setup correctness can be verified automatically on provisioning.
19. As a developer who just hit `ProviderModelNotFoundError`, I want the smoke test output to include the exact `--model` string being tested (e.g., `my-zai/glm-5.1`), so that I can immediately tell if the model ID format is wrong.
20. As a developer, I want the smoke test to verify that `{env:ZAI_API_KEY}` is actually interpolated (i.e., not passed as the literal string), so that I can catch the common Claude Code → OpenCode syntax migration mistake.

## Implementation Decisions

### Module: `scripts/opencode-smoke-test.sh`

- Shell script (bash); no external dependencies beyond `opencode` CLI and `jq`
- Uses `opencode run --format json "..."` for each check; parses the JSON event stream to detect a completion event with non-empty content
- Test structure: each check is a function `check_<name>()` that prints `[PASS] <name>` or `[FAIL] <name>: <reason>`
- Global exit code: non-zero if any check fails
- Flags:
  - `--provider <my-zai|my-ds>` — run only provider checks for that provider
  - `--mcp` — run only MCP checks
  - `--agent <name>` — run only the specified agent check
  - `--all` (default) — run everything
  - `--verbose` — append `--log-level DEBUG --print-logs` to each opencode call
- Provider checks: send `"Reply with exactly: OPENCODE_SMOKE_OK"` and verify the response contains that string
- MCP checks: send a minimal prompt that invokes each tool (`"Use web_search_prime to search for 'opencode cli'"`, etc.) and verify tool use appears in the JSON event stream
- Agent checks: send `"Reply with exactly: OPENCODE_SMOKE_OK"` with `--agent <name>` flag
- Env var sanity: at script start, warn if `ZAI_API_KEY` or `DEEPSEEK_API_KEY` is unset or is the literal string `{env:ZAI_API_KEY}` (catches interpolation failure)

### Module: `.opencode/opencode.json.md` (already updated)

- "Reproduce on a New Machine" section already added
- Add a new "Step 7: Verify" subsection pointing to `scripts/opencode-smoke-test.sh`
- Document `opencode run` non-interactive syntax and `--format json` flag

### Module: `.opencode/opencode.json` (no changes needed)

- The existing config is correct; smoke tests exercise it as-is
- No schema changes required

### Technical constraints

- `opencode run` is non-interactive and exits after processing the prompt — suitable for scripting
- `opencode run --attach <server-url>` can be used for faster repeated runs (avoids cold boot per test); the smoke test may optionally start a server with `opencode serve` and reuse it
- `opencode run --dangerously-skip-permissions` must be used when the agent config requires tool confirmations during smoke tests
- MCP server `zai-mcp-server` is a local stdio server launched via `bunx`; verify `bunx` is available before running its check
- The `{file:./agents/...}` prompt references in agent configs are relative to the `.opencode/` directory; smoke tests must be run from the project root

### Known failure modes to handle

- `ProviderModelNotFoundError` — model ID format wrong (`my-zai/glm-5.1` not `glm-5.1`)
- `ProviderInitError` — API key missing or invalid; interpolation `{env:}` not expanded
- Remote MCP timeout — Z.AI MCP endpoints are external; allow 30s timeout per check
- `bunx` not found — zai-mcp-server check must skip gracefully with a warning

## Testing Decisions

A good smoke test verifies **external behavior** (does the provider respond? does the MCP tool return data?), not internal implementation (config file parsing, JSON schema validation). Tests should be runnable by a human in 5 minutes and by CI in 10 minutes.

### Tests to write

- **Provider reachability**: `my-zai/glm-5.1`, `my-ds/deepseek-v4-pro` each get a round-trip prompt and must return the expected token
- **MCP tool invocation**: `web-search-prime`, `web-reader`, `zread` each receive a minimal prompt that forces tool use; verify tool-use event appears in JSON output
- **Agent prompt loading**: `office-ops` and `gcc-coordinator` agents receive a prompt; verify non-empty response (confirms `{file:}` reference resolved)
- **Env var interpolation sanity**: script-level check that `$ZAI_API_KEY` is not empty and not the literal `{env:ZAI_API_KEY}`

### Prior art

- `python_app/generate_image/benchmark.sh` — example of a shell-based E2E test in this repo
- Issue #61 `[remotion_studio] E2E integration test` — precedent for agent-level E2E testing

## Out of Scope

- Testing all 20+ agents — only a representative sample (1 office agent, 1 GCC agent, build, explore)
- Load testing or concurrency testing
- Windows / PowerShell support (this project targets macOS/Linux)
- Automated provider credential rotation or `opencode connect` automation
- Testing the TUI (interactive mode) — `tui.json` keybinds are not testable headlessly
- OpenCode version pinning or upgrade testing

## Further Notes

- `opencode run` non-interactive docs: https://opencode.ai/docs/cli/
- Key flags: `--model`, `--agent`, `--format json`, `--attach`, `--dangerously-skip-permissions`, `--log-level DEBUG`
- Known upstream issues (2025): custom provider `options` (baseURL, apiKey) occasionally not passed to API calls when using `@ai-sdk/openai-compatible` — if smoke tests fail with auth errors despite correct keys, check GitHub issue #5674 at anomalyco/opencode
- Config precedence: global (`~/.config/opencode/opencode.json`) is merged with project (`.opencode/opencode.json`); providers and MCP live in global, agents live in project
- Syntax difference memo: OpenCode `{env:VAR}` vs Claude Code `${VAR}` — mixing them silently passes validation but substitution never occurs
