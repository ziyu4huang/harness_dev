/**
 * Diff: Change impact analysis for knowledge graph.
 *
 * Port of UA's diff-analyzer.ts, re-implemented against graph.ts types.
 * Maps changed files to graph nodes, identifies ripple effects, and
 * produces a structured risk assessment.
 */

import type { GraphStore } from "./graph.js";
import type { GraphNode, GraphEdge, GraphLayer } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiffContext {
  projectName: string;
  changedFiles: string[];
  changedNodes: GraphNode[];
  affectedNodes: GraphNode[];
  impactedEdges: GraphEdge[];
  affectedLayers: GraphLayer[];
  unmappedFiles: string[];
}

// ─── Context Builder ────────────────────────────────────────────────────────

/**
 * Map a list of changed file paths to knowledge graph nodes and
 * identify the ripple effect (affected nodes, layers, edges).
 */
export function buildDiffContext(
  graphStore: GraphStore,
  changedFiles: string[],
): DiffContext {
  const { nodes, edges, layers } = graphStore.data;

  const changedNodeIds = new Set<string>();
  const unmappedFiles: string[] = [];

  for (const file of changedFiles) {
    let mapped = false;
    for (const node of nodes) {
      if (node.filePath === file) {
        changedNodeIds.add(node.id);
        mapped = true;
      }
    }
    if (!mapped) {
      unmappedFiles.push(file);
    }
  }

  // Also include "contains" children of changed file nodes
  for (const edge of edges) {
    if (edge.type === "contains" && changedNodeIds.has(edge.source)) {
      changedNodeIds.add(edge.target);
    }
  }

  const changedNodes = nodes.filter(n => changedNodeIds.has(n.id));

  // Find affected nodes: 1-hop neighbors of changed nodes (excluding already changed)
  const affectedNodeIds = new Set<string>();
  const impactedEdges: GraphEdge[] = [];

  for (const edge of edges) {
    const sourceChanged = changedNodeIds.has(edge.source);
    const targetChanged = changedNodeIds.has(edge.target);

    if (sourceChanged || targetChanged) {
      impactedEdges.push(edge);
      if (sourceChanged && !changedNodeIds.has(edge.target)) {
        affectedNodeIds.add(edge.target);
      }
      if (targetChanged && !changedNodeIds.has(edge.source)) {
        affectedNodeIds.add(edge.source);
      }
    }
  }

  const affectedNodes = nodes.filter(n => affectedNodeIds.has(n.id));

  const allImpactedIds = new Set([...changedNodeIds, ...affectedNodeIds]);
  const affectedLayers = layers.filter(layer =>
    layer.nodeIds.some(id => allImpactedIds.has(id)),
  );

  return {
    projectName: graphStore.data.project.name,
    changedFiles,
    changedNodes,
    affectedNodes,
    impactedEdges,
    affectedLayers,
    unmappedFiles,
  };
}

// ─── Formatter ──────────────────────────────────────────────────────────────

/**
 * Format the diff analysis as structured markdown for LLM or human consumption.
 */
/** Format the risk assessment section. */
function formatRiskAssessment(ctx: DiffContext): string[] {
  const lines = ["## Risk Assessment", ""];
  const complexChanges = ctx.changedNodes.filter(n => n.complexity === "complex");
  const crossLayerCount = new Set(ctx.affectedLayers.map(l => l.id)).size;

  if (complexChanges.length > 0) lines.push(`- **High complexity**: ${complexChanges.length} complex component(s) changed: ${complexChanges.map(n => n.name).join(", ")}`);
  if (crossLayerCount > 1) lines.push(`- **Cross-layer impact**: Changes span ${crossLayerCount} architectural layers`);
  if (ctx.affectedNodes.length > 5) lines.push(`- **Wide blast radius**: ${ctx.affectedNodes.length} components affected downstream`);
  if (ctx.unmappedFiles.length > 0) lines.push(`- **New/unmapped files**: ${ctx.unmappedFiles.length} files not in the knowledge graph (may need re-analysis)`);
  if (complexChanges.length === 0 && crossLayerCount <= 1 && ctx.affectedNodes.length <= 5 && ctx.unmappedFiles.length === 0) {
    lines.push("- **Low risk**: Changes are localized with limited downstream impact.");
  }
  lines.push("");
  return lines;
}

export function formatDiffAnalysis(ctx: DiffContext): string {
  const lines: string[] = [];
  lines.push(`# Diff Analysis: ${ctx.projectName}`, "");

  // Changed components
  lines.push("## Changed Components", "");
  if (ctx.changedNodes.length === 0) { lines.push("No mapped components found for changed files."); }
  else { for (const n of ctx.changedNodes) { lines.push(`- **${n.name}** (${n.type}) — ${n.summary}`); if (n.filePath) lines.push(`  - File: \`${n.filePath}\``); if (n.complexity) lines.push(`  - Complexity: ${n.complexity}`); } }
  lines.push("");

  // Affected components
  lines.push("## Affected Components", "");
  if (ctx.affectedNodes.length === 0) { lines.push("No downstream impact detected."); }
  else { lines.push("These components are connected to changed code and may need attention:", ""); for (const n of ctx.affectedNodes) lines.push(`- **${n.name}** (${n.type}) — ${n.summary}`); }
  lines.push("");

  // Affected layers
  lines.push("## Affected Layers", "");
  if (ctx.affectedLayers.length === 0) { lines.push("No layers affected."); }
  else { for (const l of ctx.affectedLayers) lines.push(`- **${l.name}**: ${l.description}`); }
  lines.push("");

  // Impacted relationships
  if (ctx.impactedEdges.length > 0) { lines.push("## Impacted Relationships", ""); for (const e of ctx.impactedEdges) lines.push(`- ${e.source} --[${e.type}]--> ${e.target}`); lines.push(""); }

  // Unmapped files
  if (ctx.unmappedFiles.length > 0) { lines.push("## Unmapped Files", "", "These changed files are not yet in the knowledge graph:", ""); for (const f of ctx.unmappedFiles) lines.push(`- \`${f}\``); lines.push(""); }

  // Risk assessment
  lines.push(...formatRiskAssessment(ctx));
  return lines.join("\n");
}
