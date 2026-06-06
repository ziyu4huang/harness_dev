/**
 * Onboard: Project onboarding guide builder.
 *
 * Port of UA's onboard-builder.ts, re-implemented against graph.ts types.
 * Generates a structured onboarding markdown from the knowledge graph:
 * project overview → architecture → key concepts → tour → file map → hotspots.
 */

import type { GraphStore } from "./graph.js";
import type { GraphNode, GraphLayer, GraphTour as TourStep } from "./graph.js";

// ─── Section Formatters ────────────────────────────────────────────────────

function formatOverview(name: string, description: string, languages: string[], frameworks: string[], nodeCount: number, edgeCount: number, analyzedAt: string): string[] {
  return [
    `# ${name}`, "",
    `> ${description}`, "",
    "| | |", "|---|---|",
    `| **Languages** | ${languages.join(", ")} |`,
    `| **Frameworks** | ${frameworks.join(", ")} |`,
    `| **Components** | ${nodeCount} nodes, ${edgeCount} relationships |`,
    `| **Last Analyzed** | ${analyzedAt} |`, "",
  ];
}

function formatArchitecture(layers: GraphLayer[], nodes: GraphNode[]): string[] {
  if (layers.length === 0) return [];
  const lines = ["## Architecture", "", "The project is organized into the following layers:", ""];
  for (const layer of layers) {
    const memberNames = layer.nodeIds.map(id => nodes.find(n => n.id === id)?.name).filter(Boolean);
    lines.push(`### ${layer.name}`, "", layer.description, "");
    if (memberNames.length > 0) lines.push(`Key components: ${memberNames.join(", ")}`, "");
  }
  return lines;
}

function formatKeyConcepts(nodes: GraphNode[]): string[] {
  const conceptNodes = nodes.filter(n => n.type === "concept");
  if (conceptNodes.length === 0) return [];
  const lines = ["## Key Concepts", "", "Important architectural and domain concepts to understand:", ""];
  for (const concept of conceptNodes) lines.push(`### ${concept.name}`, "", concept.summary, "");
  return lines;
}

function formatTour(tour: TourStep[], nodes: GraphNode[]): string[] {
  if (tour.length === 0) return [];
  const lines = ["## Getting Started", "", "Follow this guided tour to understand the codebase:", ""];
  for (const step of tour) {
    const stepNodes = step.nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);
    lines.push(`### ${step.order}. ${step.title}`, "", step.description, "");
    if (stepNodes.length > 0) {
      lines.push("**Files to look at:**");
      for (const node of stepNodes) { if (node!.filePath) lines.push(`- \`${node!.filePath}\` — ${node!.summary}`); }
      lines.push("");
    }
    if (step.languageLesson) lines.push(`> **Language Tip:** ${step.languageLesson}`, "");
  }
  return lines;
}

function formatFileMap(nodes: GraphNode[]): string[] {
  const fileNodes = nodes.filter(n => n.type === "file" && n.filePath);
  if (fileNodes.length === 0) return [];
  const lines = ["## File Map", "", "| File | Purpose | Complexity |", "|------|---------|------------|"];
  for (const node of fileNodes) lines.push(`| \`${node.filePath}\` | ${node.summary} | ${node.complexity ?? "—"} |`);
  lines.push("");
  return lines;
}

function formatHotspots(nodes: GraphNode[]): string[] {
  const complexNodes = nodes.filter(n => n.complexity === "complex");
  if (complexNodes.length === 0) return [];
  const lines = ["## Complexity Hotspots", "", "These components are the most complex and deserve extra attention:", ""];
  for (const node of complexNodes) lines.push(`- **${node.name}** (${node.type}): ${node.summary}`);
  lines.push("");
  return lines;
}

function formatDomainEntities(nodes: GraphNode[]): string[] {
  const domainNodes = nodes.filter(n => n.domainMeta);
  if (domainNodes.length === 0) return [];
  const lines = ["## Domain Entities", ""];
  for (const node of domainNodes) {
    const dm = node.domainMeta!;
    lines.push(`### ${node.name}`, "", node.summary, "", `**Entities:** ${dm.entities.join(", ")}`);
    if (dm.businessRules?.length) { lines.push("", "**Business Rules:**"); for (const rule of dm.businessRules) lines.push(`- ${rule}`); }
    if (dm.crossDomainInteractions?.length) lines.push("", `**Cross-Domain Interactions:** ${dm.crossDomainInteractions.join("; ")}`);
    if (dm.entryPoints?.length) lines.push("", `**Entry Points:** ${dm.entryPoints.join(", ")}`);
    lines.push("");
  }
  return lines;
}

function formatKnowledgeSources(nodes: GraphNode[]): string[] {
  const knowledgeNodes = nodes.filter(n => n.knowledgeMeta);
  if (knowledgeNodes.length === 0) return [];
  const lines = ["## Knowledge Sources", "", "Key references and knowledge artifacts:", ""];
  for (const node of knowledgeNodes) {
    const km = node.knowledgeMeta!;
    lines.push(`- **${node.name}** (${node.type}): ${node.summary}`);
    if (km.authors?.length) lines.push(`  - Authors: ${km.authors.join(", ")}`);
    if (km.source) lines.push(`  - Source: ${km.source}`);
    if (km.publishedDate) lines.push(`  - Published: ${km.publishedDate}`);
  }
  lines.push("");
  return lines;
}

// ─── Guide Builder ──────────────────────────────────────────────────────────

/**
 * Generate a structured onboarding guide from the knowledge graph.
 * Output is standalone markdown suitable for a README, wiki, or docs.
 */
export function buildOnboardingGuide(graphStore: GraphStore): string {
  const graph = graphStore.data;
  const { project, nodes, edges, layers, tour } = graph;

  const lines: string[] = [
    ...formatOverview(project.name, project.description, project.languages, project.frameworks, nodes.length, edges.length, project.analyzedAt),
    ...formatArchitecture(layers, nodes),
    ...formatKeyConcepts(nodes),
    ...formatTour(tour, nodes),
    ...formatFileMap(nodes),
    ...formatHotspots(nodes),
    ...formatDomainEntities(nodes),
    ...formatKnowledgeSources(nodes),
    "---", "",
    `*Generated by learning-anything from knowledge graph v${graph.version}*`,
    "",
  ];

  return lines.join("\n");
}
