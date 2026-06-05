import { readFileSync } from "fs";

// ─── Version ───────────────────────────────────────────────────────────────

let _version: string | undefined;
export function getVersion(): string {
  if (!_version) {
    try {
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      _version = pkg.version || "0.0.0";
    } catch {
      _version = "0.0.0";
    }
  }
  return _version;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ─── Config ────────────────────────────────────────────────────────────────

/** Tunable limits for tools and API calls. Override via DEEPSEEK_TIMEOUT / DEEPSEEK_MAX_STEPS env. */
export const CONFIG = {
  GLOB_FILE_LIMIT: 20,
  WEB_FETCH_CHAR_LIMIT: 10_000,
  WEB_FETCH_TIMEOUT_MS: 15_000,
  GREP_MAX_RESULTS: 50,
  AGENT_MAX_STEPS: Number(process.env.DEEPSEEK_MAX_STEPS) || 10,
  API_TIMEOUT_MS: Number(process.env.DEEPSEEK_TIMEOUT) || 60_000,
};

/**
 * Mapping from short CLI aliases to DeepSeek model IDs.
 * @see https://api-docs.deepseek.com
 */
export const MODELS: Record<string, string> = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
};

// ─── Dynamic model listing ──────────────────────────────────────────────────

export async function listModels(baseUrl: string, apiKey: string): Promise<{ id: string; owned_by?: string }[]> {
  const url = `${baseUrl}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }
  const json = await res.json() as { data?: { id: string; owned_by?: string }[] };
  return (json.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by }));
}

// ─── Usage ─────────────────────────────────────────────────────────────────

export function printUsage(): void {
  console.log(`deepseek-cli — DeepSeek AI in your terminal

Usage:
  deepseek-cli [options] <prompt...>
  deepseek-cli --agent [options] <task...>

Options:
  --model <name>      Model: pro | flash (default: pro)
  --max-steps <n>     Max agent loop steps (default: 10, env: DEEPSEEK_MAX_STEPS)
  --timeout <ms>      API call timeout in ms (default: 60000, env: DEEPSEEK_TIMEOUT)
  --system-prompt <s> Custom system prompt (default: "You are a helpful CLI assistant...")
  --agent, -a         Enable agent mode with tool calling
  --history <path>    Load conversation history from a JSON file (ChatMessage[])
  --output-history <path>  Write conversation history to a JSON file after completion
  --json-output       Output structured JSON { text, toolCalls, model } instead of streaming text
  --list-models       List available models from the API and exit
  -v, --version       Print version and exit
  -h, --help          Show this help message

Environment:
  DEEPSEEK_API_KEY         API key (required)
  DEEPSEEK_BASE_URL        API base URL (default: https://api.deepseek.com/v1)
  DEEPSEEK_TIMEOUT         API call timeout in ms (default: 60000)

Models:
  pro      deepseek-v4-pro
  flash    deepseek-v4-flash

Agent tools:
  calculator       Evaluate math expressions
  read_file        Read files (supports glob patterns)
  write_file       Write content to files
  web_fetch        Fetch URL content
  list_directory   List directory contents
  grep_search      Search file contents with regex`);
}
