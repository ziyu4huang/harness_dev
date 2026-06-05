/**
 * Context: Rich context builder for LLM chat queries.
 *
 * Port of UA's context-builder.ts, re-implemented against graph.ts types.
 * Builds context by: search → 1-hop expansion → layer collection → markdown.
 * Replaces the simpler buildGraphContext() in agent.ts.
 */

import type { GraphStore } from "./graph.js";
import type { GraphNode, GraphEdge, GraphLayer, KnowledgeMeta, DomainMeta } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatContext {
  projectName: string;
  projectDescription: string;
  languages: string[];
  frameworks: string[];
  relevantNodes: GraphNode[];
  relevantEdges: GraphEdge[];
  relevantLayers: GraphLayer[];
  query: string;
}

// ─── Context Builder ────────────────────────────────────────────────────────

/**
 * Build a ChatContext by searching the knowledge graph for nodes relevant
 * to the user's query, expanding 1 hop via edges, and collecting the
 * associated layers.
 */
export function buildChatContext(
  graphStore: GraphStore,
  query: string,
  maxNodes?: number,
): ChatContext {
  const limit = maxNodes ?? 15;
  const graph = graphStore.data;

  // 1. Search for relevant nodes
  const searchResults = graphStore.search(query, limit);
  const matchedIds = new Set(searchResults.map(n => n.id));

  // 2. Expand to connected nodes (1 hop via edges)
  const expandedIds = new Set(matchedIds);
  for (const edge of graph.edges) {
    if (matchedIds.has(edge.source)) expandedIds.add(edge.target);
    if (matchedIds.has(edge.target)) expandedIds.add(edge.source);
  }

  // Collect the actual node objects
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const relevantNodes: GraphNode[] = [];
  for (const id of expandedIds) {
    const node = nodeMap.get(id);
    if (node) relevantNodes.push(node);
  }

  // 3. Collect edges where both endpoints are in the relevant set
  const relevantEdges = graph.edges.filter(
    e => expandedIds.has(e.source) && expandedIds.has(e.target),
  );

  // 4. Find layers containing any relevant node
  const relevantLayers = graph.layers.filter(layer =>
    layer.nodeIds.some(id => expandedIds.has(id)),
  );

  return {
    projectName: graph.project.name,
    projectDescription: graph.project.description,
    languages: graph.project.languages,
    frameworks: graph.project.frameworks,
    relevantNodes,
    relevantEdges,
    relevantLayers,
    query,
  };
}

// ─── Formatter ──────────────────────────────────────────────────────────────

/**
 * Format the ChatContext as a readable markdown string for LLM consumption.
 */
export function formatContextForPrompt(context: ChatContext): string {
  const lines: string[] = [];

  // Project header
  lines.push(`# Project: ${context.projectName}`);
  lines.push("");
  lines.push(context.projectDescription);
  lines.push("");
  lines.push(`**Languages:** ${context.languages.join(", ")}`);
  lines.push(`**Frameworks:** ${context.frameworks.join(", ")}`);
  lines.push("");

  // Layers section
  if (context.relevantLayers.length > 0) {
    lines.push("## Relevant Layers");
    lines.push("");
    for (const layer of context.relevantLayers) {
      lines.push(`### ${layer.name}`);
      lines.push(layer.description);
      lines.push("");
    }
  }

  // Nodes section
  if (context.relevantNodes.length > 0) {
    lines.push("## Code Components");
    lines.push("");
    for (const node of context.relevantNodes) {
      lines.push(`### ${node.name} (${node.type})`);
      if (node.filePath) lines.push(`- **File:** ${node.filePath}`);
      if (node.complexity) lines.push(`- **Complexity:** ${node.complexity}`);
      lines.push(`- **Summary:** ${node.summary}`);
      if (node.tags.length > 0) lines.push(`- **Tags:** ${node.tags.join(", ")}`);
      if (node.languageNotes) lines.push(`- **Language Notes:** ${node.languageNotes}`);
      if (node.knowledgeMeta) {
        const km = node.knowledgeMeta;
        lines.push(`- **Knowledge:**`);
        if (km.authors?.length) lines.push(`  - Authors: ${km.authors.join(", ")}`);
        if (km.publishedDate) lines.push(`  - Published: ${km.publishedDate}`);
        if (km.source) lines.push(`  - Source: ${km.source}`);
        if (km.citations?.length) lines.push(`  - Citations: ${km.citations.join(", ")}`);
        if (km.relatedTopics?.length) lines.push(`  - Related Topics: ${km.relatedTopics.join(", ")}`);
      }
      if (node.domainMeta) {
        const dm = node.domainMeta;
        lines.push(`- **Domain:**`);
        lines.push(`  - Entities: ${dm.entities.join(", ")}`);
        if (dm.businessRules?.length) lines.push(`  - Business Rules: ${dm.businessRules.join("; ")}`);
        if (dm.crossDomainInteractions?.length) lines.push(`  - Cross-Domain Interactions: ${dm.crossDomainInteractions.join("; ")}`);
        if (dm.entryPoints?.length) lines.push(`  - Entry Points: ${dm.entryPoints.join(", ")}`);
      }
      lines.push("");
    }
  }

  // Edges/relationships section
  if (context.relevantEdges.length > 0) {
    const nodeMap = new Map(context.relevantNodes.map(n => [n.id, n]));
    lines.push("## Relationships");
    lines.push("");
    for (const edge of context.relevantEdges) {
      const sourceName = nodeMap.get(edge.source)?.name ?? edge.source;
      const targetName = nodeMap.get(edge.target)?.name ?? edge.target;
      let line = `- ${sourceName} --[${edge.type}]--> ${targetName}`;
      if (edge.description) line += `: ${edge.description}`;
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}
