/**
 * Normalize: Graph normalization pipeline for LLM-generated analysis output.
 *
 * Port of UA's normalize-graph.ts (packages/core/src/analyzer/normalize-graph.ts).
 * Provides:
 * - normalizeNodeId: canonical `type:path` format from potentially malformed IDs
 * - normalizeComplexity: map aliases to canonical values
 * - normalizeBatchOutput: full batch normalization with dedup, ID fix, edge rewrite
 *
 * This runs BEFORE the validate.ts pipeline, handling concerns that pipeline
 * does not cover: malformed IDs, numeric complexity, edge reference rewriting,
 * and edge deduplication.
 */

import type { GraphNode, GraphEdge } from "./graph.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_PREFIXES = new Set([
  "file", "func", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
  "domain", "flow", "step",
  "article", "entity", "topic", "claim", "source",
]);

const TYPE_TO_PREFIX: Record<string, string> = {
  file: "file",
  function: "func",
  class: "class",
  module: "module",
  concept: "concept",
  config: "config",
  document: "document",
  service: "service",
  table: "table",
  endpoint: "endpoint",
  pipeline: "pipeline",
  schema: "schema",
  resource: "resource",
  domain: "domain",
  flow: "flow",
  step: "step",
  article: "article",
  entity: "entity",
  topic: "topic",
  claim: "claim",
  source: "source",
};

const PREFIX_TO_TYPE: Record<string, string> = {
  file: "file", func: "function", class: "class", module: "module",
  concept: "concept", config: "config", document: "document",
  service: "service", table: "table", endpoint: "endpoint",
  pipeline: "pipeline", schema: "schema", resource: "resource",
  domain: "domain", flow: "flow", step: "step",
  article: "article", entity: "entity", topic: "topic",
  claim: "claim", source: "source",
};

const VALID_COMPLEXITIES = new Set(["simple", "moderate", "complex"]);

const COMPLEXITY_STRING_MAP: Record<string, string> = {
  low: "simple",
  easy: "simple",
  trivial: "simple",
  basic: "simple",
  medium: "moderate",
  intermediate: "moderate",
  mid: "moderate",
  average: "moderate",
  high: "complex",
  hard: "complex",
  difficult: "complex",
  advanced: "complex",
};

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Strips all non-valid prefixes from an ID, returning the bare path
 * and the first valid prefix found (if any).
 */
function stripToValidPrefix(id: string): { prefix: string | null; path: string } {
  let remaining = id;

  while (true) {
    const colonIdx = remaining.indexOf(":");
    if (colonIdx <= 0) break;

    const segment = remaining.slice(0, colonIdx);
    if (VALID_PREFIXES.has(segment)) {
      // Check for double valid prefix (e.g., "file:file:src/foo.ts")
      const rest = remaining.slice(colonIdx + 1);
      const innerColonIdx = rest.indexOf(":");
      if (innerColonIdx > 0 && VALID_PREFIXES.has(rest.slice(0, innerColonIdx))) {
        remaining = rest;
        continue;
      }
      return { prefix: segment, path: rest };
    }

    remaining = remaining.slice(colonIdx + 1);
  }

  return { prefix: null, path: remaining };
}

/** Infer node type from an ID's prefix (e.g. "step:foo" -> "step"). Falls back to "file". */
function inferTypeFromId(id: string): string {
  const colonIdx = id.indexOf(":");
  if (colonIdx > 0) {
    const prefix = id.slice(0, colonIdx);
    if (prefix in PREFIX_TO_TYPE) return PREFIX_TO_TYPE[prefix];
  }
  return "file";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface NormalizeNodeInput {
  id: string;
  type: string;
  filePath?: string;
  name?: string;
  parentFlowSlug?: string;
}

/**
 * Normalizes a node ID to the canonical `type:path` format.
 * Handles: double-prefixed IDs, project-name-prefixed IDs, bare paths.
 * Idempotent -- correct IDs pass through unchanged.
 */
export function normalizeNodeId(id: string, node: NormalizeNodeInput): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;

  const expectedPrefix = TYPE_TO_PREFIX[node.type];
  const { prefix, path } = stripToValidPrefix(trimmed);

  if (prefix) {
    // For step nodes with filePath, reconstruct as step:flowSlug:filePath:stepSlug
    if (node.type === "step" && node.filePath) {
      const segments = path.split(":");
      const stepSlug = segments.length > 0 ? segments[segments.length - 1] : path;
      const flowSlug = segments.length > 1 ? segments[segments.length - 2] : "";
      return flowSlug
        ? `${prefix}:${flowSlug}:${node.filePath}:${stepSlug}`
        : `${prefix}:${node.filePath}:${stepSlug}`;
    }
    return `${prefix}:${path}`;
  }

  // No valid prefix found -- bare path
  if (expectedPrefix) {
    if (
      (node.type === "function" || node.type === "class") &&
      node.filePath &&
      node.name
    ) {
      return `${expectedPrefix}:${node.filePath}:${node.name}`;
    }
    if (node.type === "step" && node.filePath) {
      const slug = path.toLowerCase().replace(/\s+/g, "-");
      return node.parentFlowSlug
        ? `${expectedPrefix}:${node.parentFlowSlug}:${node.filePath}:${slug}`
        : `${expectedPrefix}:${node.filePath}:${slug}`;
    }
    return `${expectedPrefix}:${path}`;
  }

  return trimmed;
}

/**
 * Normalizes a complexity value to one of "simple" | "moderate" | "complex".
 * Handles both string aliases and numeric scales -- defaults to "moderate".
 */
export function normalizeComplexity(
  value: unknown,
): "simple" | "moderate" | "complex" {
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (VALID_COMPLEXITIES.has(lower)) return lower as "simple" | "moderate" | "complex";
    const aliased = COMPLEXITY_STRING_MAP[lower];
    if (aliased) return aliased as "simple" | "moderate" | "complex";
    return "moderate";
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    if (value <= 3) return "simple";
    if (value <= 6) return "moderate";
    return "complex";
  }

  return "moderate";
}

// ─── Batch Normalization ─────────────────────────────────────────────────────

export interface DroppedEdge {
  source: string;
  target: string;
  type: string;
  reason: "missing-source" | "missing-target" | "missing-both";
}

export interface NormalizationStats {
  idsFixed: number;
  complexityFixed: number;
  edgesRewritten: number;
  danglingEdgesDropped: number;
  droppedEdges: DroppedEdge[];
}

export interface NormalizeBatchResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  idMap: Map<string, string>;
  stats: NormalizationStats;
}

/** Build step→flow-slug mapping from flow_step edges and flow node names */
function buildStepToFlowSlug(
  nodes: GraphNode[], edges: GraphEdge[],
): Map<string, string> {
  const flowNodeNames = new Map<string, string>();
  for (const raw of nodes) {
    if (raw.type === "flow" && raw.id && raw.name) {
      flowNodeNames.set(raw.id, raw.name.toLowerCase().replace(/\s+/g, "-"));
    }
  }
  const stepToFlowSlug = new Map<string, string>();
  for (const raw of edges) {
    if (raw.type === "flow_step" && raw.source && raw.target) {
      const flowSlug = flowNodeNames.get(raw.source);
      if (flowSlug) stepToFlowSlug.set(raw.target, flowSlug);
    }
  }
  return stepToFlowSlug;
}

/** Pass 1: Normalize node IDs and complexity, returning updated nodes and idMap */
function normalizeNodes(
  nodes: GraphNode[],
  stepToFlowSlug: Map<string, string>,
  stats: NormalizationStats,
): { deduped: GraphNode[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const normalized = nodes.map((raw) => {
    const oldId = raw.id;
    const newId = normalizeNodeId(oldId, {
      type: raw.type,
      filePath: raw.filePath,
      name: raw.name,
      parentFlowSlug: raw.type === "step" ? stepToFlowSlug.get(oldId) : undefined,
    });
    if (newId !== oldId) stats.idsFixed++;
    idMap.set(oldId, newId);

    const result: GraphNode = { ...raw, id: newId };
    if (raw.complexity !== undefined) {
      const nc = normalizeComplexity(raw.complexity);
      if (nc !== raw.complexity) { result.complexity = nc; stats.complexityFixed++; }
    }
    return result;
  });

  // Deduplicate (keep last occurrence)
  const seenIds = new Map<string, number>();
  for (let i = 0; i < normalized.length; i++) seenIds.set(normalized[i].id, i);
  return { deduped: normalized.filter((_, i) => seenIds.get(normalized[i].id) === i), idMap };
}

/** Pass 2: Rewrite edge references, drop dangling, deduplicate */
function normalizeEdges(
  edges: GraphEdge[],
  idMap: Map<string, string>,
  validNodeIds: Set<string>,
  stats: NormalizationStats,
): GraphEdge[] {
  const result: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const raw of edges) {
    const oldSource = raw.source;
    const oldTarget = raw.target;
    let newSource = idMap.get(oldSource) ?? oldSource;
    let newTarget = idMap.get(oldTarget) ?? oldTarget;

    // Fallback: try direct normalization if idMap miss
    if (!validNodeIds.has(newSource)) {
      const n = normalizeNodeId(newSource, { type: inferTypeFromId(newSource) });
      if (validNodeIds.has(n)) newSource = n;
    }
    if (!validNodeIds.has(newTarget)) {
      const n = normalizeNodeId(newTarget, { type: inferTypeFromId(newTarget) });
      if (validNodeIds.has(n)) newTarget = n;
    }

    if (newSource !== oldSource || newTarget !== oldTarget) stats.edgesRewritten++;

    if (!validNodeIds.has(newSource) || !validNodeIds.has(newTarget)) {
      const ms = !validNodeIds.has(newSource);
      const mt = !validNodeIds.has(newTarget);
      stats.danglingEdgesDropped++;
      stats.droppedEdges.push({
        source: newSource, target: newTarget, type: raw.type,
        reason: ms && mt ? "missing-both" : ms ? "missing-source" : "missing-target",
      });
      continue;
    }

    const key = `${newSource}|${newTarget}|${raw.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...raw, source: newSource, target: newTarget });
  }
  return result;
}

/**
 * Normalizes a merged batch output: fixes node IDs and numeric complexity,
 * rewrites edge references, deduplicates nodes and edges, and drops dangling edges.
 */
export function normalizeBatchOutput(data: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}): NormalizeBatchResult {
  const stats: NormalizationStats = {
    idsFixed: 0,
    complexityFixed: 0,
    edgesRewritten: 0,
    danglingEdgesDropped: 0,
    droppedEdges: [],
  };

  const stepToFlowSlug = buildStepToFlowSlug(data.nodes, data.edges);
  const { deduped, idMap } = normalizeNodes(data.nodes, stepToFlowSlug, stats);
  const validNodeIds = new Set(deduped.map(n => n.id));
  const edges = normalizeEdges(data.edges, idMap, validNodeIds, stats);

  return { nodes: deduped, edges, idMap, stats };
}
