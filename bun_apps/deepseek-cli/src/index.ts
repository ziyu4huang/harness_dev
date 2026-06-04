#!/usr/bin/env bun
/**
 * deepseek-cli — DeepSeek AI in your terminal.
 *
 * Sends a prompt to the DeepSeek API via direct HTTP calls
 * with SSE streaming for responsive output.
 * Use --agent mode for tool calling (read/write files, web fetch,
 * search, calculator, directory listing).
 *
 * Environment variables:
 *   DEEPSEEK_API_KEY   API key (required)
 *   DEEPSEEK_BASE_URL  API base URL (default: https://api.deepseek.com/v1)
 *   DEEPSEEK_TIMEOUT   API call timeout in ms (default: 60000)
 *
 * Usage:
 *   deepseek-cli [--model pro|flash] <prompt...>
 *   deepseek-cli --agent [--model pro|flash] <task...>
 */

import { mkdir } from "fs/promises";
import { dirname } from "path";
import { readFileSync } from "fs";

let _version: string | undefined;
function getVersion(): string {
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

// ─── Math evaluator ────────────────────────────────────────────────────────

/**
 * Lightweight math expression evaluator (replaces mathjs).
 * Uses Function constructor with a restricted scope — safe for CLI use.
 */
export function mathEval(expr: string): string {
  try {
    const fn = new Function(
      "Math",
      `"use strict"; return (${expr})`,
    );
    const result = fn(Math);
    return typeof result === "number" && Number.isFinite(result)
      ? String(result)
      : String(result);
  } catch {
    throw new Error(`Invalid expression: ${expr}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/**
 * Normalize file paths for cross-platform compatibility.
 * On Windows, converts Unix-style /tmp/ paths to the system temp directory.
 */
export function normalizePath(path: string): string {
  if (process.platform === "win32") {
    if (path.startsWith("/tmp/") || path === "/tmp") {
      const tempDir = process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp";
      return path === "/tmp" ? tempDir : tempDir + path.slice(4);
    }
  }
  return path;
}

function printUsage(): void {
  console.log(`deepseek-cli — DeepSeek AI in your terminal

Usage:
  deepseek-cli [options] <prompt...>
  deepseek-cli --agent [options] <task...>

Options:
  --model <name>    Model: pro | flash (default: pro)
  --max-steps <n>   Max agent loop steps (default: 10, env: DEEPSEEK_MAX_STEPS)
  --timeout <ms>    API call timeout in ms (default: 60000, env: DEEPSEEK_TIMEOUT)
  --agent, -a       Enable agent mode with tool calling
  -v, --version     Print version and exit
  -h, --help        Show this help message

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
const MODELS: Record<string, string> = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
};

// ─── Tool execute functions (exported for testing) ─────────────────────────

export const toolExecutors = {
  calculator: async ({ expression }: { expression: string }) => {
    try {
      const result = mathEval(expression);
      return String(result);
    } catch {
      return `Error: invalid expression "${expression}"`;
    }
  },

  read_file: async ({ path }: { path: string }) => {
    try {
      const normalizedPath = normalizePath(path);
      if (normalizedPath.includes("*") || normalizedPath.includes("?")) {
        const { Glob } = await import("bun");
        const g = new Glob(normalizedPath);
        const results: string[] = [];
        let count = 0;
        for await (const file of g.scan()) {
          if (count++ >= CONFIG.GLOB_FILE_LIMIT) {
            results.push(`... (truncated at ${CONFIG.GLOB_FILE_LIMIT} files)`);
            break;
          }
          const content = await Bun.file(file).text();
          results.push(`=== ${file} ===\n${content}`);
        }
        return results.join("\n\n") || `No files matching: ${normalizedPath}`;
      }
      const file = Bun.file(normalizedPath);
      const exists = await file.exists();
      if (!exists) return `Error: file not found: ${normalizedPath}`;
      return await file.text();
    } catch (e) {
      return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  write_file: async ({ path, content }: { path: string; content: string }) => {
    try {
      const normalizedPath = normalizePath(path);
      const dir = dirname(normalizedPath);
      await mkdir(dir, { recursive: true });
      await Bun.write(normalizedPath, content);
      return `Successfully wrote ${content.length} bytes to ${normalizedPath}`;
    } catch (e) {
      return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  web_fetch: async ({ url }: { url: string }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.WEB_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText}`;
      const text = await res.text();
      return text.length > CONFIG.WEB_FETCH_CHAR_LIMIT
        ? text.slice(0, CONFIG.WEB_FETCH_CHAR_LIMIT) + `\n... (truncated at ${CONFIG.WEB_FETCH_CHAR_LIMIT} chars)`
        : text;
    } catch (e) {
      return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  list_directory: async ({ path = ".", depth = 0 }: { path?: string; depth?: number }) => {
    try {
      const normalizedPath = normalizePath(path);
      const { readdir } = await import("fs/promises");
      const { join, relative } = await import("path");

      async function readDir(dirPath: string, remaining: number): Promise<string[]> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);
          const relPath = relative(normalizedPath, fullPath);
          result.push(entry.isDirectory() ? `${relPath}/` : relPath);
          if (entry.isDirectory() && remaining > 0) {
            result.push(...(await readDir(fullPath, remaining - 1)));
          }
        }
        return result.sort();
      }

      const items = await readDir(normalizedPath, depth);
      return items.join("\n") || "(empty directory)";
    } catch (e) {
      return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  grep_search: async ({
    pattern,
    glob = "**/*",
    maxResults = CONFIG.GREP_MAX_RESULTS,
  }: {
    pattern: string;
    glob?: string;
    maxResults?: number;
  }) => {
    try {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return `Error: invalid regex pattern "${pattern}"`;
      }
      const g = new Bun.Glob(glob);
      const results: string[] = [];
      let skippedFiles = 0;
      for await (const file of g.scan({ absolute: true })) {
        try {
          const text = await Bun.file(file).text();
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const match = `${file}:${i + 1}: ${lines[i].trim().slice(0, 200)}`;
              results.push(match);
              if (results.length >= maxResults) {
                results.push(`... (truncated at ${maxResults} matches)`);
                if (skippedFiles > 0) results.push(`(skipped ${skippedFiles} unreadable file${skippedFiles > 1 ? "s" : ""})`);
                return results.join("\n");
              }
            }
          }
        } catch {
          skippedFiles++;
        }
      }
      let output = results.length > 0
        ? results.join("\n")
        : `(no matches found for /${pattern}/ in ${glob})`;
      if (skippedFiles > 0) output += `\n(skipped ${skippedFiles} unreadable file${skippedFiles > 1 ? "s" : ""})`;
      return output;
    } catch (e) {
      return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// ─── Tool JSON Schema definitions (compressed for token efficiency) ────────

const TOOL_DEFINITIONS: Record<string, {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = {
  calculator: {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate math expression",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression, e.g. 2+2*3" },
        },
        required: ["expression"],
      },
    },
  },
  read_file: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file or glob",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path or glob pattern" },
        },
        required: ["path"],
      },
    },
  },
  write_file: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write file (auto-mkdir)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  web_fetch: {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch URL (max 10K chars)",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
  list_directory: {
    type: "function",
    function: {
      name: "list_directory",
      description: "List directory tree",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Dir path" },
          depth: { type: "number", description: "Recursion depth" },
        },
        required: [],
      },
    },
  },
  grep_search: {
    type: "function",
    function: {
      name: "grep_search",
      description: "Grep files by regex",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern" },
          glob: { type: "string", description: "File glob filter" },
          maxResults: { type: "number", description: "Max matches" },
        },
        required: ["pattern"],
      },
    },
  },
};

// ─── Direct HTTP client (replaces Vercel AI SDK) ───────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Parse SSE stream, printing text deltas and collecting tool calls. */
async function streamChatCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  tools: typeof TOOL_DEFINITIONS | undefined,
  signal: AbortSignal,
): Promise<{ text: string; toolCalls: ToolCallResult[] }> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
  };
  if (tools && Object.keys(tools).length > 0) {
    body.tools = Object.values(tools);
  }

  const url = `${baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }

  if (!res.body) {
    throw new Error("No response body for streaming request");
  }

  let fullText = "";
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            fullText += delta.content;
            process.stdout.write(delta.content);
          }

          // Tool calls — buffer them incrementally
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  args: tc.function?.arguments || "",
                });
              } else {
                const existing = toolCallMap.get(idx)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Final newline after streaming text
  if (fullText) process.stdout.write("\n");

  // Parse tool call arguments
  const toolCalls: ToolCallResult[] = [];
  for (const [, tc] of toolCallMap) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.args);
    } catch {
      args = {
        error: `Failed to parse tool call arguments for "${tc.name}"`,
        _raw: tc.args,
      };
    }
    toolCalls.push({ id: tc.id, name: tc.name, args });
  }

  return { text: fullText, toolCalls };
}

/** Execute a tool call and return the result string. */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const executor = toolExecutors[name as keyof typeof toolExecutors];
  if (!executor) return `Error: unknown tool "${name}"`;
  return await executor(args as never);
}

/** Agent loop: stream responses, dispatch tool calls, repeat until done. */
async function runAgentLoop(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a helpful CLI assistant. Use the provided tools to complete the task. Respond concisely." },
    { role: "user", content: prompt },
  ];

  for (let step = 0; step < CONFIG.AGENT_MAX_STEPS; step++) {
    const { text, toolCalls } = await streamChatCompletion(
      baseUrl, apiKey, modelId, messages, TOOL_DEFINITIONS, signal,
    );

    if (toolCalls.length === 0) {
      // No more tool calls — agent is done
      return;
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    // Execute each tool call and add results
    for (const tc of toolCalls) {
      console.error(`  -> tool: ${tc.name}(${JSON.stringify(tc.args)})`);
      const result = await executeTool(tc.name, tc.args);
      console.error(`  <- ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  console.error(`Warning: agent reached max steps (${CONFIG.AGENT_MAX_STEPS})`);
}

// ─── CLI entry point (only runs when executed directly, not when imported) ─

if (import.meta.main) {
  const args = process.argv.slice(2);
  let modelKey = "pro";
  let agentMode = false;
  const promptParts: string[] = [];
  const KNOWN_FLAGS = new Set(["--model", "--max-steps", "--timeout", "--agent", "-a", "-v", "--version", "-h", "--help"]);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --model requires a value (e.g. --model pro)");
      }
      modelKey = args[++i];
    } else if (args[i] === "--max-steps") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --max-steps requires a numeric value (e.g. --max-steps 20)");
      }
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1) {
        die("Error: --max-steps must be a positive integer");
      }
      (CONFIG as { AGENT_MAX_STEPS: number }).AGENT_MAX_STEPS = n;
    } else if (args[i] === "--timeout") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --timeout requires a numeric value (e.g. --timeout 120000)");
      }
      const t = Number(args[++i]);
      if (!Number.isInteger(t) || t < 1) {
        die("Error: --timeout must be a positive integer");
      }
      (CONFIG as { API_TIMEOUT_MS: number }).API_TIMEOUT_MS = t;
    } else if (args[i] === "--agent" || args[i] === "-a") {
      agentMode = true;
    } else if (args[i] === "-v" || args[i] === "--version") {
      console.log(`deepseek-cli v${getVersion()}`);
      process.exit(0);
    } else if (args[i] === "-h" || args[i] === "--help") {
      printUsage();
      process.exit(0);
    } else if (args[i].startsWith("-") && !KNOWN_FLAGS.has(args[i])) {
      console.error(`Warning: unknown flag "${args[i]}" will be treated as part of the prompt`);
      promptParts.push(args[i]);
    } else {
      promptParts.push(args[i]);
    }
  }

  if (!MODELS[modelKey]) {
    die(`Error: unknown model "${modelKey}". Available: ${Object.keys(MODELS).join(", ")}`);
  }

  const prompt = promptParts.join(" ");
  if (!prompt.trim()) {
    printUsage();
    process.exit(1);
  }

  /** Check API key lazily so --help and usage errors surface first. */
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    die("Error: DEEPSEEK_API_KEY env var not set.");
  }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const modelId = MODELS[modelKey];

  const abortController = new AbortController();
  const apiTimeout = setTimeout(() => abortController.abort(), CONFIG.API_TIMEOUT_MS);

  try {
    if (agentMode) {
      await runAgentLoop(BASE_URL, API_KEY, modelId, prompt, abortController.signal);
    } else {
      // Simple mode: single streaming request
      await streamChatCompletion(
        BASE_URL, API_KEY, modelId,
        [{ role: "user", content: prompt }],
        undefined,
        abortController.signal,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      die(`Error: DeepSeek API call timed out after ${CONFIG.API_TIMEOUT_MS / 1000}s. Set DEEPSEEK_TIMEOUT to increase.`);
    }
    die(
      `Error: DeepSeek API call failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(apiTimeout);
  }
}
