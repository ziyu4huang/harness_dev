/**
 * Tour: Heuristic tour generation using topological sort.
 *
 * Port of UA's tour-generator.ts heuristic mode, re-implemented for the bun-app.
 * Uses Kahn's topological sort on the dependency graph to produce an ordered
 * tour of code components, grouped by layer or in batches.
 *
 * Two grouping modes:
 *   - "layer": Group sorted nodes by their architectural layer
 *   - "batch": Group sorted nodes into batches of configurable size (default 3)
 *
 * Algorithm:
 *   1. Separate concept nodes from code nodes
 *   2. Find entry points (code nodes with 0 in-degree for dependency edge types)
 *   3. Run Kahn's topological sort
 *   4. Group sorted nodes by layer or batch
 *   5. Append concept nodes as a final step
 */

import type { GraphNode, GraphEdge, GraphLayer, GraphTour } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TourGroupingMode = "layer" | "batch";

export interface TourGenerationOptions {
  mode?: TourGroupingMode;
  batchSize?: number;
  /** Edge types to treat as dependencies for topological sort */
  dependencyEdgeTypes?: string[];
}

// ─── LLM Tour Generation Types ──────────────────────────────────────────────

export interface LLMTourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DEPENDENCY_EDGE_TYPES = ["imports", "depends_on", "calls"];

const CONCEPT_TYPES = new Set(["concept", "domain", "topic"]);

// ─── Heuristic Tour Generation ──────────────────────────────────────────────

/**
 * Generate a tour from a knowledge graph using Kahn's topological sort.
 *
 * @param nodes - All graph nodes
 * @param edges - All graph edges
 * @param layers - Graph layers (used for "layer" grouping mode)
 * @param options - Tour generation options
 * @returns Ordered array of TourStep objects
 */
/** Run Kahn's topological sort on code nodes, return ordered IDs. */
function topologicalSort(codeNodes: GraphNode[], depEdges: GraphEdge[]): string[] {
  const inDegree = new Map<string, number>();
  for (const n of codeNodes) inDegree.set(n.id, 0);
  for (const e of depEdges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);

  const adjacency = new Map<string, string[]>();
  for (const n of codeNodes) adjacency.set(n.id, []);
  for (const e of depEdges) { const list = adjacency.get(e.source) ?? []; list.push(e.target); adjacency.set(e.source, list); }

  const sorted: string[] = [];
  const queue: string[] = [];
  for (const [id, degree] of inDegree) { if (degree === 0) queue.push(id); }

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of (adjacency.get(current) ?? [])) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Handle cycles: append any unvisited nodes
  const visited = new Set(sorted);
  for (const n of codeNodes) { if (!visited.has(n.id)) sorted.push(n.id); }
  return sorted;
}

/** Group sorted IDs by layer membership, preserving topological order. */
function groupByLayer(sorted: string[], layers: GraphLayer[]): GraphTour[] {
  const layerMap = new Map<string, string>();
  for (const layer of layers) for (const nid of layer.nodeIds) layerMap.set(nid, layer.id);

  const layerGroups = new Map<string, string[]>();
  const layerOrder: string[] = [];
  for (const id of sorted) {
    const lid = layerMap.get(id) ?? "unassigned";
    if (!layerGroups.has(lid)) { layerGroups.set(lid, []); layerOrder.push(lid); }
    layerGroups.get(lid)!.push(id);
  }

  let order = 1;
  return layerOrder.map(lid => {
    const nodeIds = layerGroups.get(lid) ?? [];
    const layer = layers.find(l => l.id === lid);
    return {
      order: order++,
      title: layer ? `${layer.name} Layer` : "Unassigned Components",
      description: layer ? `${layer.description} — ${nodeIds.length} components.` : `${nodeIds.length} components not assigned to a layer.`,
      nodeIds,
    };
  }).filter(t => t.nodeIds.length > 0);
}

/** Group sorted IDs into batches of fixed size. */
function groupByBatch(sorted: string[], batchSize: number, nodeMap: Map<string, GraphNode>): GraphTour[] {
  const tour: GraphTour[] = [];
  for (let i = 0; i < sorted.length; i += batchSize) {
    const batch = sorted.slice(i, i + batchSize);
    const names = batch.map(id => nodeMap.get(id)?.name ?? id).join(", ");
    tour.push({ order: tour.length + 1, title: `Step ${tour.length + 1}: ${names}`, description: `Explore ${batch.length} components: ${names}.`, nodeIds: batch });
  }
  return tour;
}

export function generateHeuristicTour(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layers: GraphLayer[],
  options?: TourGenerationOptions,
): GraphTour[] {
  const depEdgeTypes = options?.dependencyEdgeTypes ?? DEFAULT_DEPENDENCY_EDGE_TYPES;
  const groupingMode = options?.mode ?? "batch";
  const batchSize = options?.batchSize ?? 3;

  const conceptNodes = nodes.filter(n => CONCEPT_TYPES.has(n.type));
  const codeNodes = nodes.filter(n => !CONCEPT_TYPES.has(n.type));

  if (codeNodes.length === 0) {
    if (conceptNodes.length === 0) return [];
    return [{ order: 1, title: "Key Concepts", description: "Core concepts and domain knowledge for this project.", nodeIds: conceptNodes.map(n => n.id) }];
  }

  const codeNodeIds = new Set(codeNodes.map(n => n.id));
  const depEdges = edges.filter(e => depEdgeTypes.includes(e.type) && codeNodeIds.has(e.source) && codeNodeIds.has(e.target));
  const sorted = topologicalSort(codeNodes, depEdges);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  let order = 1;
  const tour: GraphTour[] = groupingMode === "layer"
    ? groupByLayer(sorted, layers)
    : groupByBatch(sorted, batchSize, nodeMap);

  // Renumber and append concept nodes
  for (const t of tour) t.order = order++;
  for (let i = 0; i < conceptNodes.length; i += batchSize) {
    const batch = conceptNodes.slice(i, i + batchSize);
    const names = batch.map(n => n.name).join(", ");
    tour.push({ order: order++, title: `Key Concepts: ${names}`, description: `Core concepts and domain knowledge: ${names}.`, nodeIds: batch.map(n => n.id) });
  }
  return tour;
}

// ─── LLM Tour Generation ──────────────────────────────────────────────────────

/**
 * Builds an LLM prompt asking for a guided tour of the project.
 * Includes project metadata, node summaries, edges, and layer info.
 */
export function buildTourGenerationPrompt(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layers: GraphLayer[],
  projectName: string,
  projectDescription: string = "",
  languages: string[] = [],
  frameworks: string[] = [],
): string {
  const nodeList = nodes
    .slice(0, 60)
    .map(n => `  - [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`)
    .join("\n");

  const edgeList = edges
    .slice(0, 50)
    .map(e => `  - ${e.source} --${e.type}--> ${e.target}`)
    .join("\n");

  const layerList = layers.length > 0
    ? layers.map(l => `  - ${l.name}: ${l.description} (nodes: ${l.nodeIds.join(", ")})`).join("\n")
    : "  (no layers detected)";

  return `You are a software architecture educator. Generate a guided tour of the following project that helps a newcomer understand the codebase step by step.

Project: ${projectName}
Description: ${projectDescription}
Languages: ${languages.join(", ")}
Frameworks: ${frameworks.join(", ")}

Nodes:
${nodeList}

Edges (dependencies/relationships):
${edgeList}

Layers:
${layerList}

Create a logical tour that:
1. Starts with entry points or high-level overview files
2. Follows the natural dependency flow
3. Groups related files together
4. Ends with supporting utilities or concepts

Return a JSON object with a "steps" array. Each step must have:
- "order": sequential number starting from 1
- "title": a short descriptive title for this tour stop
- "description": 2-3 sentences explaining what the reader will learn at this step
- "nodeIds": array of node IDs to highlight for this step
- "languageLesson" (optional): a brief note about language-specific patterns seen in these files

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Parses an LLM response for tour generation.
 * Handles raw JSON and JSON wrapped in markdown code fences.
 * Filters out steps missing required fields.
 * Returns empty array if parsing fails.
 */
export function parseTourGenerationResponse(response: string): LLMTourStep[] {
  if (!response || response.trim().length === 0) {
    return [];
  }

  try {
    // Try to extract from markdown code fences
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : response.trim();

    // Try to find a JSON object with steps
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return [];
    }

    const parsed = JSON.parse(objectMatch[0]);

    if (!parsed || !Array.isArray(parsed.steps)) {
      return [];
    }

    // Filter and validate each step
    const steps: LLMTourStep[] = [];
    for (const item of parsed.steps) {
      if (typeof item !== "object" || item === null) continue;
      if (typeof item.order !== "number") continue;
      if (typeof item.title !== "string" || item.title.length === 0) continue;
      if (typeof item.description !== "string" || item.description.length === 0) continue;
      if (!Array.isArray(item.nodeIds) || item.nodeIds.length === 0) continue;

      const step: LLMTourStep = {
        order: item.order,
        title: item.title,
        description: item.description,
        nodeIds: item.nodeIds.filter((id: unknown) => typeof id === "string"),
      };

      if (typeof item.languageLesson === "string") {
        step.languageLesson = item.languageLesson;
      }

      steps.push(step);
    }

    return steps;
  } catch {
    return [];
  }
}
