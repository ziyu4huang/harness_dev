/**
 * Parsers: Lightweight regex-based parsers for non-code files.
 *
 * Generates specialized GraphNode/GraphEdge objects from YAML, JSON, and
 * Markdown files without requiring AST-level parsing. This enables the
 * scan pipeline to produce richer graphs from config and documentation files.
 *
 * Each parser is a pure function: (filePath, content) => ParseResult
 */

import type { GraphNode, GraphEdge } from "./graph.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParseResult {
  nodes: Partial<GraphNode>[];
  edges: Partial<GraphEdge>[];
}

// ─── Shared Helpers ────────────────────────────────────────────────────────────

/** Extract top-level YAML keys (lines starting with key: at column 0). */
function extractTopLevelKeys(content: string): string[] {
  const keys: string[] = [];
  const re = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) keys.push(m[1]);
  return keys;
}

// ─── YAML Config Parser ──────────────────────────────────────────────────────

/**
 * Parse a YAML config file (e.g., docker-compose.yml, .github/workflows/*.yml).
 * Extracts top-level keys and detects service/endpoint/resource patterns.
 *
 * This is a lightweight regex-based parser -- it does not fully parse YAML.
 * It extracts top-level keys and nested structures to produce config nodes
 * and service/endpoint nodes where detectable.
 */
/** Extract YAML services into service nodes with configures edges. */
function extractYamlServices(configNodeId: string, filePath: string, content: string, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  const section = extractSection(content, "services");
  if (!section) return;
  for (const name of extractIndentedKeys(section)) {
    nodes.push({ id: `service:${name}`, type: "service", name, filePath, summary: `Service "${name}" defined in ${filePath}`, tags: ["service", "yaml"] });
    edges.push({ source: configNodeId, target: `service:${name}`, type: "configures", description: `${filePath} configures service ${name}` });
  }
}

/** Extract YAML paths into endpoint nodes with configures edges. */
function extractYamlEndpoints(configNodeId: string, filePath: string, content: string, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  const section = extractSection(content, "paths");
  if (!section) return;
  for (const pathName of extractIndentedKeys(section)) {
    nodes.push({ id: `endpoint:${pathName}`, type: "endpoint", name: pathName, filePath, summary: `API endpoint ${pathName} defined in ${filePath}`, tags: ["endpoint", "api"] });
    edges.push({ source: configNodeId, target: `endpoint:${pathName}`, type: "configures", description: `${filePath} defines endpoint ${pathName}` });
  }
}

/** Create generic section nodes for remaining top-level YAML keys. */
function extractYamlGenericSections(configNodeId: string, filePath: string, topLevelKeys: string[], nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  for (const key of topLevelKeys) {
    if (key === "services" || key === "paths") continue;
    const sectionNodeId = `config-section:${filePath}:${key}`;
    nodes.push({ id: sectionNodeId, type: "config", name: key, filePath, summary: `Configuration section "${key}" in ${filePath}`, tags: ["yaml", "config-section"] });
    edges.push({ source: configNodeId, target: sectionNodeId, type: "contains", description: `${filePath} contains section ${key}` });
  }
}

export function parseYamlConfig(filePath: string, content: string): ParseResult {
  const nodes: Partial<GraphNode>[] = [];
  const edges: Partial<GraphEdge>[] = [];

  const topLevelKeys = extractTopLevelKeys(content);
  const configNodeId = `config:${filePath}`;
  const fileName = filePath.split("/").pop() ?? filePath;
  nodes.push({ id: configNodeId, type: "config", name: fileName, filePath, summary: `YAML configuration file with ${topLevelKeys.length} top-level section(s): ${topLevelKeys.slice(0, 5).join(", ")}`, tags: ["yaml", "config"] });

  extractYamlServices(configNodeId, filePath, content, nodes, edges);
  extractYamlEndpoints(configNodeId, filePath, content, nodes, edges);
  extractYamlGenericSections(configNodeId, filePath, topLevelKeys, nodes, edges);

  return { nodes, edges };
}

// ─── JSON Config Parser ──────────────────────────────────────────────────────

/**
 * Parse a JSON config file. Detects:
 * - package.json: produces dependency/configures edges
 * - tsconfig.json: produces compiler options config nodes
 * - OpenAPI/swagger specs: produces endpoint nodes
 * - Generic JSON: produces a config node with top-level keys
 */
/** Extract package.json dependencies into a dependency node. */
function extractPackageDeps(configNodeId: string, filePath: string, parsed: Record<string, unknown>, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  const deps = parsed.dependencies as Record<string, string> | undefined;
  const devDeps = parsed.devDependencies as Record<string, string> | undefined;
  const allDeps = { ...(deps ?? {}), ...(devDeps ?? {}) };
  const depNames = Object.keys(allDeps);
  if (depNames.length === 0) return;
  const depNodeId = `config:${filePath}:dependencies`;
  nodes.push({ id: depNodeId, type: "config", name: "dependencies", filePath, summary: `${depNames.length} dependencies: ${depNames.slice(0, 10).join(", ")}`, tags: ["json", "dependencies"] });
  edges.push({ source: configNodeId, target: depNodeId, type: "contains", description: "package.json dependencies" });
}

/** Extract tsconfig.json compilerOptions into a config node. */
function extractTsConfigOptions(configNodeId: string, filePath: string, parsed: Record<string, unknown>, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object") return;
  const compilerOpts = parsed.compilerOptions as Record<string, unknown>;
  const optKeys = Object.keys(compilerOpts);
  const schemaNodeId = `config:${filePath}:compilerOptions`;
  nodes.push({ id: schemaNodeId, type: "config", name: "compilerOptions", filePath, summary: `TypeScript compiler options: ${optKeys.slice(0, 10).join(", ")}`, tags: ["json", "typescript", "compiler-options"] });
  edges.push({ source: configNodeId, target: schemaNodeId, type: "configures", description: "tsconfig compilerOptions" });
}

/** Extract OpenAPI/Swagger paths into endpoint nodes. */
function extractOpenApiPaths(configNodeId: string, filePath: string, parsed: Record<string, unknown>, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  if (!parsed.paths || typeof parsed.paths !== "object") return;
  const paths = parsed.paths as Record<string, unknown>;
  for (const pathName of Object.keys(paths)) {
    nodes.push({ id: `endpoint:${pathName}`, type: "endpoint", name: pathName, filePath, summary: `API endpoint ${pathName}`, tags: ["endpoint", "api", "openapi"] });
    edges.push({ source: configNodeId, target: `endpoint:${pathName}`, type: "configures", description: `OpenAPI spec defines ${pathName}` });
  }
}

export function parseJsonConfig(filePath: string, content: string): ParseResult {
  const nodes: Partial<GraphNode>[] = [];
  const edges: Partial<GraphEdge>[] = [];

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(content); } catch {
    nodes.push({ id: `config:${filePath}`, type: "config", name: filePath.split("/").pop() ?? filePath, filePath, summary: "JSON configuration file (parse error)", tags: ["json", "config"] });
    return { nodes, edges };
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const configNodeId = `config:${filePath}`;
  const topKeys = Object.keys(parsed);
  nodes.push({ id: configNodeId, type: "config", name: fileName, filePath, summary: `JSON configuration: ${fileName} with keys: ${topKeys.slice(0, 8).join(", ")}`, tags: ["json", "config"] });

  if (fileName === "package.json") extractPackageDeps(configNodeId, filePath, parsed, nodes, edges);
  if (fileName === "tsconfig.json") extractTsConfigOptions(configNodeId, filePath, parsed, nodes, edges);
  extractOpenApiPaths(configNodeId, filePath, parsed, nodes, edges);

  return { nodes, edges };
}

// ─── Markdown Parser ─────────────────────────────────────────────────────────

/**
 * Parse a Markdown file into document nodes.
 * Splits by headings (## and deeper) and creates section nodes
 * with "documents" edges. Extracts code blocks as child nodes.
 */
/** Extract headings from markdown content into structured section descriptors. */
function extractMarkdownSections(content: string): { level: number; title: string; start: number }[] {
  const sections: { level: number; title: string; start: number }[] = [];
  const re = /^(#{2,})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) sections.push({ level: m[1].length, title: m[2].trim(), start: m.index });
  return sections;
}

/** Extract code blocks from a section of markdown text. */
function extractCodeBlocks(sectionContent: string): string[] {
  const blocks: string[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sectionContent)) !== null) blocks.push(m[2].trim().slice(0, 100));
  return blocks;
}

/** Build nodes/edges for a single markdown section and its code blocks. */
function buildSectionNodes(docNodeId: string, filePath: string, title: string, section: { level: number; title: string; start: number }, sectionContent: string, nodes: Partial<GraphNode>[], edges: Partial<GraphEdge>[]): void {
  const sectionNodeId = `doc:${filePath}#${slugify(section.title)}`;
  const codeBlocks = extractCodeBlocks(sectionContent);
  const summaryParts = [`Section: ${section.title}`];
  if (codeBlocks.length > 0) summaryParts.push(`contains ${codeBlocks.length} code block(s)`);

  nodes.push({ id: sectionNodeId, type: "document", name: section.title, filePath, summary: summaryParts.join(" — "), tags: ["markdown", "section", `h${section.level}`] });
  edges.push({ source: docNodeId, target: sectionNodeId, type: "documents", description: `${title} contains section "${section.title}"` });

  if (codeBlocks.length > 0) {
    const codeNodeId = `doc:${filePath}#${slugify(section.title)}:code`;
    nodes.push({ id: codeNodeId, type: "document", name: `${section.title} (code)`, filePath, summary: `${codeBlocks.length} code block(s) in "${section.title}"`, tags: ["markdown", "code-block"] });
    edges.push({ source: sectionNodeId, target: codeNodeId, type: "contains", description: `Code blocks in section "${section.title}"` });
  }
}

export function parseMarkdown(filePath: string, content: string): ParseResult {
  const nodes: Partial<GraphNode>[] = [];
  const edges: Partial<GraphEdge>[] = [];

  const fileName = filePath.split("/").pop() ?? filePath;
  const docNodeId = `doc:${filePath}`;
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : fileName;
  nodes.push({ id: docNodeId, type: "document", name: title, filePath, summary: `Markdown document: ${title}`, tags: ["markdown", "document"] });

  const sections = extractMarkdownSections(content);
  for (let i = 0; i < sections.length; i++) {
    const end = i + 1 < sections.length ? sections[i + 1].start : content.length;
    buildSectionNodes(docNodeId, filePath, title, sections[i], content.slice(sections[i].start, end), nodes, edges);
  }

  return { nodes, edges };
}

// ─── Auto-detect parser ──────────────────────────────────────────────────────

/**
 * Auto-detect the file type and parse with the appropriate parser.
 * Returns an empty result for unsupported file types.
 */
export function autoParse(filePath: string, content: string): ParseResult {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;

  // YAML files
  if (["yml", "yaml"].includes(ext)) {
    return parseYamlConfig(filePath, content);
  }

  // JSON files
  if (ext === "json") {
    return parseJsonConfig(filePath, content);
  }

  // Markdown files
  if (["md", "mdx", "markdown"].includes(ext)) {
    return parseMarkdown(filePath, content);
  }

  // Files with YAML-like names
  if (fileName === "Dockerfile" || fileName.startsWith("docker-compose")) {
    return parseYamlConfig(filePath, content);
  }

  return { nodes: [], edges: [] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a named top-level section from YAML content (between two top-level keys). */
function extractSection(content: string, sectionName: string): string | null {
  const sectionRegex = new RegExp(`^${sectionName}:\\s*\\n`, "m");
  const match = sectionRegex.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;

  // Find the next top-level key (line starting with non-space key: pattern)
  const nextKeyRegex = /\n([a-zA-Z_][a-zA-Z0-9_-]*:)/g;
  nextKeyRegex.lastIndex = start;
  const nextMatch = nextKeyRegex.exec(content);
  const end = nextMatch ? nextMatch.index : content.length;

  return content.slice(start, end);
}

/** Extract indented sub-keys from a YAML section. */
function extractIndentedKeys(section: string): string[] {
  const keys: string[] = [];
  const lines = section.split("\n");
  for (const line of lines) {
    // Match lines indented by exactly 2 spaces with a key:
    // Supports standard keys (key:) and path-style keys (/path:)
    const match = line.match(/^  ([a-zA-Z_\/][a-zA-Z0-9_.\/-]*):\s*$/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

/** Convert a heading title to a URL-safe slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
