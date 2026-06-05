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
export function generateHeuristicTour(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layers: GraphLayer[],
  options?: TourGenerationOptions,
): GraphTour[] {
  const depEdgeTypes = options?.dependencyEdgeTypes ?? DEFAULT_DEPENDENCY_EDGE_TYPES;
  const groupingMode = options?.mode ?? "batch";
  const batchSize = options?.batchSize ?? 3;

  // 1. Separate concept nodes from code nodes
  const conceptNodes = nodes.filter(n => CONCEPT_TYPES.has(n.type));
  const codeNodes = nodes.filter(n => !CONCEPT_TYPES.has(n.type));

  if (codeNodes.length === 0) {
    // Only concepts -- just return them as a single step
    if (conceptNodes.length === 0) return [];
    return [{
      order: 1,
      title: "Key Concepts",
      description: "Core concepts and domain knowledge for this project.",
      nodeIds: conceptNodes.map(n => n.id),
    }];
  }

  // 2. Build in-degree map for code nodes using dependency edges only
  const codeNodeIds = new Set(codeNodes.map(n => n.id));
  const depEdges = edges.filter(
    e => depEdgeTypes.includes(e.type) && codeNodeIds.has(e.source) && codeNodeIds.has(e.target)
  );

  const inDegree = new Map<string, number>();
  for (const n of codeNodes) {
    inDegree.set(n.id, 0);
  }
  for (const e of depEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // 3. Kahn's topological sort
  const sorted: string[] = [];
  const queue: string[] = [];

  // Find entry points (0 in-degree)
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  // Build adjacency list for efficient traversal
  const adjacency = new Map<string, string[]>();
  for (const n of codeNodes) {
    adjacency.set(n.id, []);
  }
  for (const e of depEdges) {
    const list = adjacency.get(e.source) ?? [];
    list.push(e.target);
    adjacency.set(e.source, list);
  }

  // Process queue
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Handle cycles: add any remaining unvisited nodes at the end
  const visited = new Set(sorted);
  for (const n of codeNodes) {
    if (!visited.has(n.id)) {
      sorted.push(n.id);
    }
  }

  // 4. Group sorted nodes
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const layerMap = new Map<string, string>(); // nodeId -> layerId
  for (const layer of layers) {
    for (const nid of layer.nodeIds) {
      layerMap.set(nid, layer.id);
    }
  }

  const tour: GraphTour[] = [];
  let order = 1;

  if (groupingMode === "layer") {
    // Group by layer membership, preserving topological order within each layer
    const layerGroups = new Map<string, string[]>();

    // First, establish layer order based on first occurrence in sorted order
    const layerOrder: string[] = [];
    for (const id of sorted) {
      const lid = layerMap.get(id);
      if (lid) {
        if (!layerGroups.has(lid)) {
          layerGroups.set(lid, []);
          layerOrder.push(lid);
        }
        layerGroups.get(lid)!.push(id);
      } else {
        // Nodes not in any layer -- put in an "unassigned" group
        const unassigned = "unassigned";
        if (!layerGroups.has(unassigned)) {
          layerGroups.set(unassigned, []);
          layerOrder.push(unassigned);
        }
        layerGroups.get(unassigned)!.push(id);
      }
    }

    for (const lid of layerOrder) {
      const nodeIds = layerGroups.get(lid) ?? [];
      if (nodeIds.length === 0) continue;

      const layer = layers.find(l => l.id === lid);
      const title = layer
        ? `${layer.name} Layer`
        : "Unassigned Components";
      const description = layer
        ? `${layer.description} — ${nodeIds.length} components.`
        : `${nodeIds.length} components not assigned to a layer.`;

      tour.push({ order: order++, title, description, nodeIds });
    }
  } else {
    // Batch mode: group by batch size
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      const names = batch
        .map(id => nodeMap.get(id)?.name ?? id)
        .join(", ");
      tour.push({
        order: order++,
        title: `Step ${order - 1}: ${names}`,
        description: `Explore ${batch.length} components: ${names}.`,
        nodeIds: batch,
      });
    }
  }

  // 5. Append concept nodes as final step(s)
  if (conceptNodes.length > 0) {
    // Group concepts in batches too
    for (let i = 0; i < conceptNodes.length; i += batchSize) {
      const batch = conceptNodes.slice(i, i + batchSize);
      const names = batch.map(n => n.name).join(", ");
      tour.push({
        order: order++,
        title: `Key Concepts: ${names}`,
        description: `Core concepts and domain knowledge: ${names}.`,
        nodeIds: batch.map(n => n.id),
      });
    }
  }

  return tour;
}
