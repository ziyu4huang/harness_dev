import { CONFIG } from "./config.ts";
import { toolExecutors, TOOL_DEFINITIONS } from "./tools.ts";

// ─── Retry fetch ───────────────────────────────────────────────────────────

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Fetch with automatic retry on transient errors (429 / 5xx).
 * Uses exponential backoff: 1s, 2s, 4s.
 * Fails immediately on 4xx client errors.
 */
export async function retryFetch(
  url: string,
  init: RequestInit,
  maxAttempts: number = RETRY_MAX_ATTEMPTS,
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);

    if (res.ok) return res;

    // Only retry on 429 (rate limit) and 5xx (server errors)
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const errPreview = await res.clone().text().catch(() => "");
      console.error(
        `  retry: attempt ${attempt}/${maxAttempts} failed (HTTP ${res.status}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    // Non-retryable or final attempt — return the response as-is
    return res;
  }

  // Should be unreachable, but satisfy TypeScript
  throw new Error("retryFetch exhausted all attempts");
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// ─── Streaming client ──────────────────────────────────────────────────────

/** Parse SSE stream, printing text deltas and collecting tool calls. */
export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  tools: typeof TOOL_DEFINITIONS | undefined,
  signal: AbortSignal,
  jsonOutput?: boolean,
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
  const res = await retryFetch(url, {
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
            if (!jsonOutput) {
              process.stdout.write(delta.content);
            }
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
  if (fullText && !jsonOutput) process.stdout.write("\n");

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
export async function runAgentLoop(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  signal: AbortSignal,
  systemPrompt?: string,
  jsonOutput?: boolean,
): Promise<{ messages: ChatMessage[]; text: string; toolCalls: ToolCallResult[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt || "You are a helpful CLI assistant. Use the provided tools to complete the task. Respond concisely." },
    { role: "user", content: prompt },
  ];

  let lastText = "";
  let lastToolCalls: ToolCallResult[] = [];

  for (let step = 0; step < CONFIG.AGENT_MAX_STEPS; step++) {
    const { text, toolCalls } = await streamChatCompletion(
      baseUrl, apiKey, modelId, messages, TOOL_DEFINITIONS, signal, jsonOutput,
    );

    lastText = text;
    lastToolCalls = toolCalls;

    if (toolCalls.length === 0) {
      // No more tool calls — agent is done
      return { messages, text: lastText, toolCalls: lastToolCalls };
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
  return { messages, text: lastText, toolCalls: lastToolCalls };
}
