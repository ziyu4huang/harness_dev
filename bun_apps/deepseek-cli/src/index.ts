#!/usr/bin/env bun
/**
 * deepseek-cli — DeepSeek AI in your terminal.
 *
 * Sends a prompt to the DeepSeek API via the Vercel AI SDK.
 * Use --agent mode for tool calling (read/write files, web fetch,
 * search, calculator, directory listing).
 *
 * Environment variables:
 *   DEEPSEEK_API_KEY   API key (required)
 *   DEEPSEEK_BASE_URL  API base URL (default: https://api.deepseek.com/v1)
 *
 * Usage:
 *   deepseek-cli [--model pro|flash] <prompt...>
 *   deepseek-cli --agent [--model pro|flash] <task...>
 */

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

/**
 * Lightweight math expression evaluator (replaces mathjs).
 * Uses Function constructor with a restricted scope — safe for CLI use.
 */
function mathEval(expr: string): string {
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

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/**
 * Normalize file paths for cross-platform compatibility.
 * On Windows, converts Unix-style /tmp/ paths to the system temp directory.
 */
function normalizePath(path: string): string {
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
  --model <name>  Model: pro | flash (default: pro)
  --agent, -a     Enable agent mode with tool calling
  -h, --help      Show this help message

Environment:
  DEEPSEEK_API_KEY         API key (required)
  DEEPSEEK_BASE_URL        API base URL (default: https://api.deepseek.com/v1)

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

/** DeepSeek API authentication key. Exits with error if not set. */
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  die("Error: DEEPSEEK_API_KEY env var not set.");
}

/**
 * Mapping from short CLI aliases to DeepSeek model IDs.
 * @see https://api-docs.deepseek.com
 */
const MODELS: Record<string, string> = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
};

/** OpenAI-compatible client configured for the DeepSeek API endpoint. */
const deepseek = createOpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  apiKey: API_KEY,
  name: "deepseek",
});

// ─── Tools (agent mode) ────────────────────────────────────────────────────

/**
 * Tool definitions for agent mode.
 * Each tool has a JSON Schema for parameters and an execute function.
 * The Vercel AI SDK handles tool call dispatch and multi-step reasoning.
 */
const TOOLS = {
  calculator: tool({
    description: "Evaluate a mathematical expression safely",
    parameters: z.object({
      expression: z.string().describe("The math expression to evaluate, e.g. '2 + 2 * 3'"),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        const result = mathEval(expression);
        return String(result);
      } catch {
        return `Error: invalid expression "${expression}"`;
      }
    },
  }),

  read_file: tool({
    description:
      "Read one or more files from the filesystem. Supports glob patterns (e.g. 'src/**/*.ts').",
    parameters: z.object({
      path: z.string().describe("Absolute or relative file path, or glob pattern"),
    }),
    execute: async ({ path }: { path: string }) => {
      try {
        const normalizedPath = normalizePath(path);
        if (normalizedPath.includes("*") || normalizedPath.includes("?")) {
          const { Glob } = await import("bun");
          const g = new Glob(normalizedPath);
          const results: string[] = [];
          let count = 0;
          for await (const file of g.scan()) {
            if (count++ >= 20) {
              results.push("... (truncated at 20 files)");
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
  }),

  write_file: tool({
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: z.object({
      path: z.string().describe("Path to the file to write"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path, content }: { path: string; content: string }) => {
      try {
        const normalizedPath = normalizePath(path);
        await Bun.write(normalizedPath, content);
        return `Successfully wrote ${content.length} bytes to ${normalizedPath}`;
      } catch (e) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  web_fetch: tool({
    description: "Fetch a URL and return its text/HTML content (max 10,000 chars)",
    parameters: z.object({
      url: z.string().describe("The URL to fetch (must be http or https)"),
    }),
    execute: async ({ url }: { url: string }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText}`;
        const text = await res.text();
        return text.length > 10_000
          ? text.slice(0, 10_000) + "\n... (truncated at 10,000 chars)"
          : text;
      } catch (e) {
        return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  list_directory: tool({
    description: "List files and directories in a given path",
    parameters: z.object({
      path: z.string().optional().describe("Directory path to list (default: current directory '.')"),
      depth: z.number().optional().describe("Recursion depth: 0 = flat list, 1 = one level deep, etc. (default: 0)"),
    }),
    execute: async ({ path = ".", depth = 0 }: { path?: string; depth?: number }) => {
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
  }),

  grep_search: tool({
    description:
      "Search file contents using a regular expression pattern. Returns matching lines with file paths and line numbers.",
    parameters: z.object({
      pattern: z.string().describe("The regex pattern to search for (case-sensitive)"),
      glob: z.string().optional().describe("File glob pattern to filter which files to search (default: '**/*')"),
      maxResults: z.number().optional().describe("Maximum matching lines to return (default: 50)"),
    }),
    execute: async ({
      pattern,
      glob = "**/*",
      maxResults = 50,
    }: {
      pattern: string;
      glob?: string;
      maxResults?: number;
    }) => {
      try {
        const g = new Bun.Glob(glob);
        const regex = new RegExp(pattern);
        const results: string[] = [];
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
                  return results.join("\n");
                }
              }
            }
          } catch {
            // Skip binary / unreadable files silently
          }
        }
        return results.length > 0
          ? results.join("\n")
          : `(no matches found for /${pattern}/ in ${glob})`;
      } catch (e) {
        return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
};

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let modelKey = "pro";
let agentMode = false;
const promptParts: string[] = [];
const KNOWN_FLAGS = new Set(["--model", "--agent", "-a", "-h", "--help"]);

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--model") {
    if (!args[i + 1] || args[i + 1].startsWith("-")) {
      die("Error: --model requires a value (e.g. --model pro)");
    }
    modelKey = args[++i];
  } else if (args[i] === "--agent" || args[i] === "-a") {
    agentMode = true;
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

// ─── Call DeepSeek ─────────────────────────────────────────────────────────

const model = deepseek.chat(MODELS[modelKey]);

try {
  if (agentMode) {
    // ── Agent mode: tools + multi-step reasoning ────────────────────────
    const result = await generateText({
      model,
      prompt,
      tools: TOOLS,
      maxSteps: 10,
    });

    // Print final response
    console.log(result.text);

    // Log tool usage to stderr (visible in terminal, doesn't pollute pipe)
    if (result.steps && result.steps.length > 1) {
      const toolCalls = result.steps.flatMap((s) => s.toolCalls || []);
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.error(`  → tool: ${tc.toolName}(${JSON.stringify(tc.args)})`);
        }
      }
    }
  } else {
    // ── Simple mode: single text generation ─────────────────────────────
    const result = await generateText({ model, prompt });
    console.log(result.text);
  }
} catch (error) {
  die(
    `Error: DeepSeek API call failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
