/**
 * Agent: LLM-powered agent using Vercel AI SDK + DeepSeek V4 models.
 *
 * Provides:
 * - Chat completion (streaming + non-streaming)
 * - Graph-contextual Q&A (auto-injects relevant graph context)
 * - Root cause analysis (structured output)
 * - Architecture analysis (structured output)
 * - Workflow design assistance (structured output)
 *
 * Model optimization:
 * - Pro (deepseek-v4-pro): Used for complex reasoning, structured output,
 *   multi-step analysis. Lower temp (0.2), higher maxTokens (8K).
 * - Flash (deepseek-v4-flash): Used for chat, quick Q&A, streaming.
 *   Slightly higher temp (0.3), lower maxTokens (4K).
 */

import { generateText, streamText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getEnv, resolveModelId, getModelParams, SYSTEM_PROMPTS, LIMITS } from "./config.js";
import type { GraphStore } from "./graph.js";
import type { GraphNode, GraphEdge } from "./graph.js";
import { buildChatContext, formatContextForPrompt } from "./context.js";
import { buildExplainContext, formatExplainPrompt } from "./explain.js";
import { buildDiffContext, formatDiffAnalysis } from "./diff.js";
import { buildOnboardingGuide } from "./onboard.js";
import {
  buildFileAnalysisPrompt,
  buildProjectSummaryPrompt,
  buildProjectContextFromGraph,
  type LLMFileAnalysis,
  type LLMProjectSummary,
} from "./analyzer.js";
import { z } from "zod";

// ─── Provider Setup ──────────────────────────────────────────────────────────

function createProvider() {
  const env = getEnv();
  return createOpenAI({
    apiKey: env.apiKey,
    baseURL: env.baseUrl,
  });
}

let _provider: ReturnType<typeof createOpenAI> | null = null;

function provider() {
  if (!_provider) _provider = createProvider();
  return _provider;
}

// ─── Context Builder ─────────────────────────────────────────────────────────

/** Build rich graph context from a query string using the context.ts module */
function getGraphContext(query: string, graphStore?: GraphStore): string {
  if (!graphStore?.loaded) return "";
  const ctx = buildChatContext(graphStore, query);
  if (ctx.relevantNodes.length === 0) return "";
  return formatContextForPrompt(ctx);
}

/** Format nodes + edges as context string for LLM (legacy, used by architecture analysis) */
function formatGraphContext(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nodeStrs = nodes.slice(0, LIMITS.maxContextNodes).map(n => {
    const loc = n.filePath ? ` (${n.filePath}${n.lineRange ? `:${n.lineRange[0]}-${n.lineRange[1]}` : ""})` : "";
    return `  [${n.type}] ${n.name}${loc}: ${n.summary}`;
  });

  const edgeStrs = edges.slice(0, 100).map(e => {
    const src = e.source.split(":").slice(-1)[0];
    const tgt = e.target.split(":").slice(-1)[0];
    return `  ${src} --[${e.type}]--> ${tgt}`;
  });

  return `## Graph Nodes\n${nodeStrs.join("\n")}\n\n## Graph Edges\n${edgeStrs.join("\n")}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentResponse {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Chat completion with graph context.
 * Defaults to flash for speed; use pro for complex analysis.
 */
export async function chat(
  messages: AgentMessage[],
  modelKey: string = "flash",
  graphStore?: GraphStore,
): Promise<AgentResponse> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  let systemPrompt = SYSTEM_PROMPTS.graphAnalyst;

  // Auto-inject relevant graph context based on last user message
  const lastUserMsg = messages.filter(m => m.role === "user").pop()?.content ?? "";
  const graphContext = getGraphContext(lastUserMsg, graphStore);
  if (graphContext) {
    systemPrompt += `\n\nYou have access to the following knowledge graph context from the project being analyzed:\n\n${graphContext}`;
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    topP: params.topP,
  });

  return {
    text: result.text,
    model: modelId,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    } : undefined,
  };
}

/**
 * Streaming chat completion.
 * Uses flash by default for real-time responsiveness.
 */
export async function chatStream(
  messages: AgentMessage[],
  modelKey: string = "flash",
  graphStore?: GraphStore,
): Promise<ReadableStream> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  let systemPrompt = SYSTEM_PROMPTS.graphAnalyst;

  const lastUserMsg = messages.filter(m => m.role === "user").pop()?.content ?? "";
  const graphContext = getGraphContext(lastUserMsg, graphStore);
  if (graphContext) {
    systemPrompt += `\n\n${graphContext}`;
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    topP: params.topP,
  });

  return result.toTextStream();
}

/**
 * Root cause analysis — uses pro model for deep reasoning.
 * Returns structured output with confidence, affected nodes, and fix.
 */
export async function rootCauseAnalysis(
  problem: string,
  graphStore?: GraphStore,
  modelKey: string = "pro",
): Promise<{
  rootCause: string;
  confidence: number;
  affectedNodes: string[];
  suggestedFix: string;
  stepsToVerify: string[];
}> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const graphContext = getGraphContext(problem, graphStore);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.rootCauseAnalyst,
    prompt: `Analyze this problem and identify the root cause.

## Problem
${problem}

${graphContext ? `## Project Context (Knowledge Graph)\n${graphContext}` : ""}

Provide a root cause analysis with confidence level (0-1), affected graph nodes, a suggested fix, and steps to verify.`,
    schema: z.object({
      rootCause: z.string().describe("The identified root cause"),
      confidence: z.number().min(0).max(1).describe("Confidence level 0-1"),
      affectedNodes: z.array(z.string()).describe("Graph node IDs affected by this issue"),
      suggestedFix: z.string().describe("Suggested fix with code changes"),
      stepsToVerify: z.array(z.string()).describe("Steps to verify the fix"),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature, 0.2), // Cap temperature for structured outputs
  });

  return result.object;
}

/**
 * Architecture analysis — uses pro model.
 * Analyzes layers, node distributions, and relationships.
 */
export async function analyzeArchitecture(
  graphStore: GraphStore,
  modelKey: string = "pro",
): Promise<{
  summary: string;
  strengths: string[];
  weaknesses: string[];
  layerHealth: Record<string, { score: number; issues: string[] }>;
  recommendations: string[];
}> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const stats = graphStore.getStats();
  const layers = graphStore.data.layers.map(l => ({
    name: l.name,
    description: l.description,
    nodeCount: l.nodeIds.length,
  }));

  const sampleNodes = graphStore.getNodes().slice(0, 60);
  const sampleEdges: GraphEdge[] = [];
  for (const n of sampleNodes.slice(0, 20)) {
    sampleEdges.push(...graphStore.getEdgesForNode(n.id));
  }

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.graphAnalyst,
    prompt: `Analyze the architecture of this project based on its knowledge graph.

## Project Stats
${JSON.stringify(stats, null, 2)}

## Layers
${JSON.stringify(layers, null, 2)}

## Sample Nodes
${formatGraphContext(sampleNodes, sampleEdges)}

Provide an architecture analysis with layer health scores (0-100) and recommendations.`,
    schema: z.object({
      summary: z.string(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      layerHealth: z.record(z.object({
        score: z.number().min(0).max(100),
        issues: z.array(z.string()),
      })),
      recommendations: z.array(z.string()),
    }),
    maxTokens: params.maxTokens,
    temperature: params.temperature,
  });

  return result.object;
}

/**
 * Workflow design assistance — uses pro model for planning.
 * Suggests phases, quality gates, and risk mitigations.
 */
export async function designWorkflow(
  goal: string,
  graphStore?: GraphStore,
  modelKey: string = "pro",
): Promise<{
  phases: Array<{ name: string; description: string; agentType: string }>;
  qualityGates: string[];
  risks: string[];
}> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const graphContext = getGraphContext(goal, graphStore);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.workflowDesigner,
    prompt: `Design a Claude Code dynamic workflow to achieve this goal:

## Goal
${goal}

${graphContext ? `## Project Context\n${graphContext}` : ""}

Design the workflow with phases, agent types, quality gates, and risk mitigation.`,
    schema: z.object({
      phases: z.array(z.object({
        name: z.string(),
        description: z.string(),
        agentType: z.string(),
      })),
      qualityGates: z.array(z.string()),
      risks: z.array(z.string()),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature + 0.1, 0.5), // Slightly higher for creativity in design
  });

  return result.object;
}

/**
 * Explain a specific node (file or function) — uses pro model for depth.
 * Returns structured output with explanation, patterns, and gotchas.
 */
export async function explainNode(
  path: string,
  graphStore: GraphStore,
  modelKey: string = "pro",
): Promise<{
  path: string;
  found: boolean;
  explanation: string;
  componentType: string;
  layerName: string | null;
  childCount: number;
  connectionCount: number;
}> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const ctx = buildExplainContext(graphStore, path);
  const prompt = formatExplainPrompt(ctx);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.explainAnalyst,
    prompt,
    schema: z.object({
      path: z.string(),
      found: z.boolean(),
      explanation: z.string().describe("Thorough explanation of the component"),
      componentType: z.string().describe("Type of the component (function, class, file, etc.)"),
      layerName: z.string().nullable().describe("Architectural layer this belongs to"),
      childCount: z.number().describe("Number of child/internal components"),
      connectionCount: z.number().describe("Number of connected external components"),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature, 0.2),
  });

  return result.object;
}

/**
 * Analyze the impact of changed files — uses pro model.
 * Returns structured output with risk assessment and recommendations.
 */
export async function analyzeDiff(
  changedFiles: string[],
  graphStore: GraphStore,
  modelKey: string = "pro",
): Promise<{
  changedComponents: string[];
  affectedComponents: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendations: string[];
  testFocus: string[];
  summary: string;
}> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const ctx = buildDiffContext(graphStore, changedFiles);
  const analysis = formatDiffAnalysis(ctx);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.diffAnalyst,
    prompt: `Analyze the following change impact report and provide actionable recommendations.\n\n${analysis}`,
    schema: z.object({
      changedComponents: z.array(z.string()).describe("Names of directly changed components"),
      affectedComponents: z.array(z.string()).describe("Names of potentially affected downstream components"),
      riskLevel: z.enum(["low", "medium", "high", "critical"]).describe("Overall risk level"),
      recommendations: z.array(z.string()).describe("Actionable recommendations for reviewers"),
      testFocus: z.array(z.string()).describe("Areas that need focused testing"),
      summary: z.string().describe("One-paragraph summary of the change impact"),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature, 0.2),
  });

  return result.object;
}

/**
 * Generate an onboarding guide from the knowledge graph.
 * Returns the markdown guide string directly (no LLM call — pure graph data).
 */
export function generateOnboardingGuide(graphStore: GraphStore): string {
  return buildOnboardingGuide(graphStore);
}

/**
 * Analyze a single file using LLM — uses pro model for depth.
 * Returns structured analysis with summary, tags, complexity, function/class summaries.
 */
export async function analyzeFile(
  filePath: string,
  content: string,
  graphStore?: GraphStore,
  modelKey: string = "pro",
): Promise<LLMFileAnalysis & { model: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  // Build project context from graph if available
  let projectContext = "No project context available.";
  if (graphStore?.loaded) {
    const graph = graphStore.data;
    projectContext = buildProjectContextFromGraph(
      graph.nodes, graph.edges, graph.project.name,
    );
  }

  const prompt = buildFileAnalysisPrompt(filePath, content, projectContext);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.fileAnalyst,
    prompt,
    schema: z.object({
      fileSummary: z.string().describe("Concise summary of the file"),
      tags: z.array(z.string()).describe("Relevant tags"),
      complexity: z.enum(["simple", "moderate", "complex"]).describe("Complexity assessment"),
      functionSummaries: z.record(z.string(), z.string()).describe("Function name to summary map"),
      classSummaries: z.record(z.string(), z.string()).describe("Class name to summary map"),
      languageNotes: z.string().optional().describe("Language-specific notes"),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature, 0.2),
  });

  return {
    ...result.object,
    model: modelId,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    } : undefined,
  };
}

/**
 * Generate a project-level summary using LLM — uses pro model.
 * Analyzes the project structure from the knowledge graph and produces
 * a comprehensive description, framework detection, and layer mapping.
 */
export async function summarizeProject(
  graphStore: GraphStore,
  modelKey: string = "pro",
): Promise<LLMProjectSummary & { model: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const modelId = resolveModelId(modelKey);
  const model = provider()(modelId);
  const params = getModelParams(modelKey);

  const graph = graphStore.data;

  // Build file list from graph nodes
  const fileList = graph.nodes
    .filter(n => n.filePath)
    .map(n => n.filePath!)
    .sort();

  // Build sample files from nodes that have file paths
  const sampleFiles: Array<{ path: string; content: string }> = [];
  // Use node summaries as stand-ins for actual file content
  const fileNodes = graph.nodes.filter(n => n.filePath).slice(0, 10);
  for (const node of fileNodes) {
    sampleFiles.push({
      path: node.filePath!,
      content: `// ${node.summary}\n// Type: ${node.type}, Complexity: ${node.complexity ?? "unknown"}\n// Tags: ${node.tags.join(", ")}`,
    });
  }

  const prompt = buildProjectSummaryPrompt(fileList, sampleFiles);

  const result = await generateObject({
    model,
    system: SYSTEM_PROMPTS.projectSummarizer,
    prompt,
    schema: z.object({
      description: z.string().describe("Project description (2-3 sentences)"),
      frameworks: z.array(z.string()).describe("Detected frameworks and libraries"),
      layers: z.array(z.object({
        name: z.string().describe("Layer name"),
        description: z.string().describe("Layer responsibility"),
        filePatterns: z.array(z.string()).describe("File patterns for this layer"),
      })).describe("Architectural layers"),
    }),
    maxTokens: params.maxTokens,
    temperature: Math.min(params.temperature, 0.2),
  });

  return {
    ...result.object,
    model: modelId,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    } : undefined,
  };
}

