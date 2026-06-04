# deepseek-cli

A minimal CLI tool that sends prompts to DeepSeek's language models using the Vercel AI SDK.

## Prerequisites

- [Bun](https://bun.sh) v1.x or later
- A DeepSeek API key (set as `DEEPSEEK_API_KEY`)

## Setup

```bash
# Clone the repository and navigate to the package root
cd bun_apps/deepseek-cli

# Install dependencies (from monorepo root)
bun install

# Set your DeepSeek API key (required)
export DEEPSEEK_API_KEY="sk-..."
```

On Windows (PowerShell):

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
```

A `.env.example` file is provided in the package root. Copy it to `.env` and fill in your key:

```bash
cp .env.example .env
```

## Usage

```bash
# Run directly via Bun (from the package directory)
bun start --model pro "Write a haiku about deep learning"

# Or from the monorepo root
bun run bun_apps/deepseek-cli/src/index.ts --model pro "Your prompt here"

# Build a standalone binary
bun run build
```

### Options

| Flag           | Description                          |
|----------------|--------------------------------------|
| `--model`      | Model alias to use: `pro` or `flash` |
| `<prompt...>`  | The prompt text (all remaining args) |

### Model mappings

| Alias   | DeepSeek API model ID   |
|---------|-------------------------|
| `pro`   | `deepseek-v4-pro`       |
| `flash` | `deepseek-v4-flash`     |

If `--model` is not specified, `pro` is used by default.

### Examples

```bash
# Default model (pro)
bun start "What is the capital of France?"

# Explicitly select flash model
bun start --model flash "Summarize this article in one sentence"

# Multi-word prompt (everything after the flag is treated as the prompt)
bun start --model pro Explain the difference between HTTP and HTTPS
```

## API Endpoint

The CLI calls `https://api.deepseek.com/v1` using an OpenAI-compatible client (`@ai-sdk/openai`). The `DEEPSEEK_API_KEY` environment variable is used for authentication.

## Project structure

```
bun_apps/deepseek-cli/
  package.json      # Package metadata and scripts
  README.md         # This file
  src/index.ts      # CLI entry point
```

## Troubleshooting / FAQ

### "DEEPSEEK_API_KEY env var not set"

The CLI requires `DEEPSEEK_API_KEY` to be set in your environment. You can obtain an API key from the [DeepSeek platform](https://platform.deepseek.com).

- **macOS / Linux**: `export DEEPSEEK_API_KEY="sk-..."`
- **Windows (PowerShell)**: `$env:DEEPSEEK_API_KEY = "sk-..."`

For convenience, create a `.env` file in the package root:

```
DEEPSEEK_API_KEY="sk-your-key-here"
```

### "DeepSeek API call failed"

This usually means one of:

- **Network issue** — your machine cannot reach `https://api.deepseek.com/v1`. Check your internet connection and firewall settings.
- **Invalid API key** — verify your key is correct and has not expired. Use a different region/custom endpoint via `DEEPSEEK_BASE_URL`.
- **Rate limited** — DeepSeek may throttle requests. Wait a few seconds and retry.
- **Model unavailable** — the model IDs are hardcoded in the CLI. If DeepSeek deprecates or renames a model, the mapped ID in `src/index.ts` will need updating.

### "unknown model"

Available model aliases are `pro` and `flash`. Check the spelling of the `--model` flag value:

```bash
bun start --model flash "your prompt"
```

### No output from the CLI

If the command appears to hang, the API request may be timing out. The CLI does not currently implement a configurable timeout — the underlying fetch uses the Vercel AI SDK defaults. If you consistently see no output, check network connectivity and API key validity.

### Tests fail to run

```bash
bun test
```

Tests verify argument parsing and error handling (no API key required). If they fail, ensure you are running from the monorepo root (`bun install` must have been run there) or from the package directory after dependencies are installed.

## Related

- [claude-code-deepseek.ts](../../scripts/claude-code-deepseek.ts) — Provider wrapper that uses DeepSeek as a backend for Claude Code (separate from this CLI)
