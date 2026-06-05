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

// Re-export for backward compatibility (tests import from "./index.ts")
export { CONFIG, MODELS, die, getVersion, printUsage, listModels } from "./config.ts";
export { mathEval, normalizePath, toolExecutors, TOOL_DEFINITIONS } from "./tools.ts";
export { retryFetch, streamChatCompletion, runAgentLoop } from "./stream.ts";
export type { ChatMessage, ToolCallResult } from "./stream.ts";

// ─── CLI entry point (only runs when executed directly, not when imported) ─

import { CONFIG, MODELS, die, getVersion, printUsage, listModels } from "./config.ts";
import { streamChatCompletion, runAgentLoop } from "./stream.ts";
import type { ChatMessage } from "./stream.ts";

if (import.meta.main) {
  const args = process.argv.slice(2);
  let modelKey = "pro";
  let agentMode = false;
  let systemPrompt: string | undefined;
  let historyPath: string | undefined;
  let outputHistoryPath: string | undefined;
  let jsonOutput = false;
  let listModelsFlag = false;
  const promptParts: string[] = [];
  const KNOWN_FLAGS = new Set(["--model", "--max-steps", "--timeout", "--system-prompt", "--agent", "-a", "-v", "--version", "-h", "--help", "--history", "-f", "--output-history", "--json-output", "--list-models"]);

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
    } else if (args[i] === "--system-prompt") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --system-prompt requires a value (e.g. --system-prompt \"You are a code reviewer\")");
      }
      systemPrompt = args[++i];
    } else if (args[i] === "--history" || args[i] === "-f") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --history requires a file path (e.g. --history ./conv.json)");
      }
      historyPath = args[++i];
    } else if (args[i] === "--output-history") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) {
        die("Error: --output-history requires a file path (e.g. --output-history ./conv.json)");
      }
      outputHistoryPath = args[++i];
    } else if (args[i] === "--json-output") {
      jsonOutput = true;
    } else if (args[i] === "--list-models") {
      listModelsFlag = true;
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

  // --list-models: fetch models from API and exit
  if (listModelsFlag) {
    const API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!API_KEY) {
      die("Error: DEEPSEEK_API_KEY env var not set (required for --list-models).");
    }
    const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    try {
      const models = await listModels(BASE_URL, API_KEY);
      if (jsonOutput) {
        console.log(JSON.stringify({ models }, null, 2));
      } else {
        console.log("Available models:");
        for (const m of models) {
          console.log(`  ${m.id}${m.owned_by ? ` (${m.owned_by})` : ""}`);
        }
      }
    } catch (e) {
      die(`Error fetching models: ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(0);
  }

  if (!MODELS[modelKey]) {
    die(`Error: unknown model "${modelKey}". Available: ${Object.keys(MODELS).join(", ")}`);
  }

  const prompt = promptParts.join(" ");
  if (!prompt.trim()) {
    printUsage();
    process.exit(1);
  }

  // ─── Validate history file early (before API key check) ────────────────

  let loadedHistory: ChatMessage[] = [];
  if (historyPath) {
    try {
      const historyContent = await Bun.file(historyPath).text();
      const parsed = JSON.parse(historyContent);
      if (Array.isArray(parsed)) {
        loadedHistory = parsed;
      } else {
        die(`Error: --history file must contain a JSON array of ChatMessage objects.`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        die(`Error: --history file contains invalid JSON: ${e.message}`);
      }
      // File not found is ok — start with empty history
      loadedHistory = [];
    }
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

  // Graceful shutdown: abort in-flight requests on interrupt/terminate signals
  const handleSignal = () => {
    abortController.abort();
    process.exit(130); // 128 + SIGINT(2)
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    let finalMessages: ChatMessage[];

    if (agentMode) {
      const result = await runAgentLoop(
        BASE_URL, API_KEY, modelId, prompt, abortController.signal, systemPrompt, jsonOutput,
      );
      finalMessages = result.messages;

      if (jsonOutput) {
        console.log(JSON.stringify({
          text: result.text,
          toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
          model: modelId,
        }));
      }
    } else {
      // Simple mode: build messages from history + current prompt
      const messages: ChatMessage[] = [
        { role: "system" as const, content: systemPrompt || "You are a helpful CLI assistant. Respond concisely." },
        ...loadedHistory,
        { role: "user" as const, content: prompt },
      ];

      const result = await streamChatCompletion(
        BASE_URL, API_KEY, modelId,
        messages,
        undefined,
        abortController.signal,
        jsonOutput,
      );

      // Build final messages for history output
      finalMessages = [
        ...messages,
        { role: "assistant" as const, content: result.text },
      ];

      if (jsonOutput) {
        console.log(JSON.stringify({
          text: result.text,
          toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
          model: modelId,
        }));
      }
    }

    // Write conversation history if requested
    if (outputHistoryPath) {
      const { mkdir } = await import("fs/promises");
      const { dirname } = await import("path");
      const dir = dirname(outputHistoryPath);
      await mkdir(dir, { recursive: true });
      await Bun.write(outputHistoryPath, JSON.stringify(finalMessages, null, 2));
      console.error(`Conversation history written to ${outputHistoryPath}`);
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
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}
