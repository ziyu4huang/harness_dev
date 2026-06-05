/**
 * Config: models, env vars, constants for the learning-anything server.
 *
 * Uses DeepSeek V4 models via OpenAI-compatible API (Vercel AI SDK).
 * - pro:  deepseek-v4-pro  — complex reasoning, multi-step agents, 1M ctx
 * - flash: deepseek-v4-flash — short-form, classification, high-volume, lower cost
 */

// ─── DeepSeek V4 Models ─────────────────────────────────────────────────────
//
// DeepSeek V4 (released April 2026) uses hybrid attention (CSA + HCA) with
// Manifold-Constrained Hyper-Connections. Two tiers:
//   - Pro:  1M context, complex reasoning, agentic workflows, tool use
//   - Flash: same generation, optimized for throughput and cost on shorter tasks
//
// Model IDs match the DeepSeek API and Vercel AI Gateway slugs.

export const MODELS = {
  pro: "deepseek-v4-pro",         // Complex reasoning, multi-step agents, tool orchestration
  flash: "deepseek-v4-flash",     // Short-form, classification, high-volume routing
} as const;

export type ModelKey = keyof typeof MODELS;

export function resolveModelId(key: string): string {
  return MODELS[key as ModelKey] ?? MODELS.flash;
}

/** Check if a model key resolves to pro tier */
export function isProModel(key: string): boolean {
  return key === "pro";
}

/** Check if a model key resolves to flash tier */
export function isFlashModel(key: string): boolean {
  return key === "flash" || !Object.keys(MODELS).includes(key);
}

// ─── Per-model tuning ────────────────────────────────────────────────────────
//
// Pro and Flash have different optimal parameter ranges:
//   - Pro: lower temp for precision, higher maxTokens for reasoning chains
//   - Flash: slightly higher temp for variety, lower maxTokens for speed

export const MODEL_PARAMS = {
  pro: {
    temperature: 0.2,
    maxTokens: 8192,
    topP: 0.95,
  },
  flash: {
    temperature: 0.3,
    maxTokens: 4096,
    topP: 0.9,
  },
} as const;

export function getModelParams(key: string) {
  return MODEL_PARAMS[key as ModelKey] ?? MODEL_PARAMS.flash;
}

// ─── Environment ─────────────────────────────────────────────────────────────

export function getEnv() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    port: parseInt(process.env.UA_PORT ?? "3100", 10),
    host: process.env.UA_HOST ?? "127.0.0.1",
    graphPath: process.env.UA_GRAPH_PATH ?? "",
    dashboardUrl: process.env.UA_DASHBOARD_URL ?? "http://127.0.0.1:5174",
  };
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export const LIMITS = {
  maxGraphSizeMB: 50,
  maxQueryResults: 200,
  maxAgentSteps: 15,
  agentTimeoutMs: 120_000,
  requestTimeoutMs: 30_000,
  maxContextNodes: 50,
} as const;

// ─── System Prompts ──────────────────────────────────────────────────────────

export const SYSTEM_PROMPTS = {
  graphAnalyst: `You are a code architecture analyst. You analyze knowledge graphs of codebases to answer questions about structure, dependencies, and design patterns. Provide concise, actionable insights.`,

  rootCauseAnalyst: `You are a root-cause analysis expert. Given a problem description and relevant code context from a knowledge graph, identify the most likely root cause and suggest a fix. Think step by step.`,

  codeReviewer: `You are a senior code reviewer. Given code snippets and their graph context (imports, callers, tests), provide focused review comments on correctness, performance, and maintainability.`,

  workflowDesigner: `You are a workflow automation designer. You help design Claude Code dynamic workflows by analyzing project structure and suggesting phase sequences, agent prompts, and quality gates.`,

  explainAnalyst: `You are a code explanation expert. Given a deep-dive context for a specific component (its children, connections, layer, relationships), provide a thorough, clear explanation. Cover: what it does, how data flows, how it interacts with neighbors, design patterns, and potential gotchas. Write for a developer joining the project.`,

  diffAnalyst: `You are a change impact analyst. Given a diff analysis showing changed components, affected downstream components, and impacted layers, assess the risk and provide actionable recommendations. Focus on: which changes need careful review, what tests to run, and which areas might have hidden side effects.`,

  onboardingGuide: `You are a technical onboarding assistant. You help new team members understand a codebase by providing structured onboarding guides. Given a knowledge graph with architecture layers, key concepts, and guided tours, create clear, progressive documentation that builds understanding from high-level architecture to specific implementation details.`,
} as const;
