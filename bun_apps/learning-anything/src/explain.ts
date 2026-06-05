/**
 * Explain: Deep-dive node explanation builder.
 *
 * Port of UA's explain-builder.ts, re-implemented against graph.ts types.
 * Finds a node by file path (or path:function format), collects children,
 * connections, and layer context for a structured explanation prompt.
 */

import type { GraphStore } from "./graph.js";
import type { GraphNode, GraphEdge, GraphLayer } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExplainContext {
  projectName: string;
  path: string;
  targetNode: GraphNode | null;
  childNodes: GraphNode[];
  connectedNodes: GraphNode[];
  relevantEdges: GraphEdge[];
  layer: GraphLayer | null;
}

// ─── Context Builder ────────────────────────────────────────────────────────

/**
 * Build an ExplainContext for a specific file or function.
 * Supports file paths ("src/auth.ts") and path:function ("src/auth.ts:login").
 */
export function buildExplainContext(
  graphStore: GraphStore,
  path: string,
): ExplainContext {
  const graph = graphStore.data;

  let targetNode: GraphNode | null = null;

  // Check for path:function format (e.g. "src/auth.ts:login")
  // But not for Windows drive letters or URLs (e.g. "C:/" or "http://")
  const colonIdx = path.lastIndexOf(":");
  if (colonIdx > 0 && !path.includes("://") && !(colonIdx === 1 && path.length > 2 && path[2] === "/")) {
    const filePath = path.slice(0, colonIdx);
    const funcName = path.slice(colonIdx + 1);
    targetNode = graphStore.getNodeByPath(filePath, funcName) ?? null;
  }

  // Fall back to file path match
  if (!targetNode) {
    targetNode = graphStore.getNodeByPath(path) ?? null;
  }

  // Fall back to exact node ID match (for nodes without file paths like domain, concept, etc.)
  if (!targetNode) {
    targetNode = graphStore.getNode(path) ?? null;
  }

  if (!targetNode) {
    return {
      projectName: graph.project.name,
      path,
      targetNode: null,
      childNodes: [],
      connectedNodes: [],
      relevantEdges: [],
      layer: null,
    };
  }

  // Find child nodes (contained by this node via "contains" edges)
  const childNodes = graphStore.getChildNodes(targetNode.id);

  const allRelatedIds = new Set([
    targetNode.id,
    ...childNodes.map(n => n.id),
  ]);

  // Find connected nodes (1-hop neighbors, excluding children and self)
  const connectedIds = new Set<string>();
  const relevantEdges: GraphEdge[] = [];

  for (const edge of graph.edges) {
    if (allRelatedIds.has(edge.source) || allRelatedIds.has(edge.target)) {
      relevantEdges.push(edge);
      if (allRelatedIds.has(edge.source) && !allRelatedIds.has(edge.target)) {
        connectedIds.add(edge.target);
      }
      if (allRelatedIds.has(edge.target) && !allRelatedIds.has(edge.source)) {
        connectedIds.add(edge.source);
      }
    }
  }

  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const connectedNodes = [...connectedIds]
    .map(id => nodeMap.get(id))
    .filter((n): n is GraphNode => !!n);

  const layer = graph.layers.find(l => l.nodeIds.includes(targetNode!.id)) ?? null;

  return {
    projectName: graph.project.name,
    path,
    targetNode,
    childNodes,
    connectedNodes,
    relevantEdges,
    layer,
  };
}

// ─── Formatter ──────────────────────────────────────────────────────────────

/**
 * Format the explain context as a structured prompt for LLM consumption.
 */
export function formatExplainPrompt(ctx: ExplainContext): string {
  if (!ctx.targetNode) {
    return [
      `# Component Not Found`,
      ``,
      `The path "${ctx.path}" was not found in the knowledge graph for ${ctx.projectName}.`,
      ``,
      `Possible reasons:`,
      `- The file hasn't been analyzed yet — try running /understand first`,
      `- The path may be different in the graph — check the exact file path`,
      `- The file may have been deleted or renamed since the last analysis`,
    ].join("\n");
  }

  const { targetNode, childNodes, connectedNodes, relevantEdges, layer } = ctx;
  const lines: string[] = [];

  lines.push(`# Deep Dive: ${targetNode.name}`);
  lines.push("");
  lines.push(`**Type:** ${targetNode.type} | **Complexity:** ${targetNode.complexity ?? "unknown"}`);
  if (targetNode.filePath) lines.push(`**File:** \`${targetNode.filePath}\``);
  if (targetNode.lineRange) lines.push(`**Lines:** ${targetNode.lineRange[0]}-${targetNode.lineRange[1]}`);
  lines.push("");
  lines.push(`**Summary:** ${targetNode.summary}`);
  lines.push("");

  if (layer) {
    lines.push(`## Architectural Layer: ${layer.name}`);
    lines.push(layer.description);
    lines.push("");
  }

  if (childNodes.length > 0) {
    lines.push("## Internal Components");
    for (const child of childNodes) {
      lines.push(`- **${child.name}** (${child.type}): ${child.summary}`);
    }
    lines.push("");
  }

  if (connectedNodes.length > 0) {
    lines.push("## Connected Components");
    for (const node of connectedNodes) {
      lines.push(`- **${node.name}** (${node.type}): ${node.summary}`);
    }
    lines.push("");
  }

  if (relevantEdges.length > 0) {
    const nodeMap = new Map(
      [targetNode, ...childNodes, ...connectedNodes].map(n => [n.id, n]),
    );
    lines.push("## Relationships");
    for (const edge of relevantEdges) {
      if (edge.type === "contains") continue;
      const src = nodeMap.get(edge.source)?.name ?? edge.source;
      const tgt = nodeMap.get(edge.target)?.name ?? edge.target;
      const desc = edge.description ? ` — ${edge.description}` : "";
      lines.push(`- ${src} --[${edge.type}]--> ${tgt}${desc}`);
    }
    lines.push("");
  }

  if (targetNode.languageNotes) {
    lines.push("## Language Notes");
    lines.push(targetNode.languageNotes);
    lines.push("");
  }

  if (targetNode.domainMeta) {
    const dm = targetNode.domainMeta;
    lines.push("## Domain Context");
    lines.push(`**Entities:** ${dm.entities.join(", ")}`);
    if (dm.businessRules?.length) {
      lines.push("**Business Rules:**");
      for (const rule of dm.businessRules) {
        lines.push(`- ${rule}`);
      }
    }
    if (dm.crossDomainInteractions?.length) {
      lines.push("**Cross-Domain Interactions:**");
      for (const interaction of dm.crossDomainInteractions) {
        lines.push(`- ${interaction}`);
      }
    }
    if (dm.entryPoints?.length) {
      lines.push(`**Entry Points:** ${dm.entryPoints.join(", ")}`);
    }
    lines.push("");
  }

  if (targetNode.knowledgeMeta) {
    const km = targetNode.knowledgeMeta;
    lines.push("## Knowledge Sources");
    if (km.authors?.length) lines.push(`**Authors:** ${km.authors.join(", ")}`);
    if (km.publishedDate) lines.push(`**Published:** ${km.publishedDate}`);
    if (km.source) lines.push(`**Source:** ${km.source}`);
    if (km.citations?.length) {
      lines.push("**Citations:**");
      for (const cite of km.citations) {
        lines.push(`- ${cite}`);
      }
    }
    if (km.relatedTopics?.length) lines.push(`**Related Topics:** ${km.relatedTopics.join(", ")}`);
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("Provide a thorough explanation of this component:");
  lines.push("1. What it does and why it exists in the project");
  lines.push("2. How data flows through it (inputs, processing, outputs)");
  lines.push("3. How it interacts with connected components");
  lines.push("4. Any patterns, idioms, or design decisions worth noting");
  lines.push("5. Potential gotchas or areas of complexity");
  lines.push("");

  return lines.join("\n");
}
