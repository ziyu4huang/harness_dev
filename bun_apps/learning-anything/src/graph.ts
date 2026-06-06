/**
 * Graph: Knowledge graph loader and query engine.
 *
 * Reads knowledge-graph.json produced by Understand-Anything plugin
 * and provides efficient querying by node type, layer, search, etc.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { validateGraph, type GraphIssue } from "./validate.js";
import { SearchEngine, type SearchOptions } from "./search.js";
import { SemanticSearchEngine, type SemanticSearchOptions } from "./semantic-search.js";
import {
  buildFingerprintStore,
  analyzeChanges,
  loadFingerprintStore,
  saveFingerprintStore,
  type FingerprintStore,
  type ChangeAnalysis,
} from "./fingerprint.js";
import { classifyUpdate, type UpdateDecision } from "./change-classifier.js";
import { detectLayers as detectLayersHeuristic, applyLLMLayers, type LLMLayerResponse } from "./layer-detector.js";
import { detectLanguageConcepts, detectAllConcepts } from "./language-lesson.js";
import { normalizeBatchOutput } from "./normalize.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KnowledgeMeta {
  authors?: string[];
  publishedDate?: string;
  source?: string;
  citations?: string[];
  relatedTopics?: string[];
}

export interface DomainMeta {
  entities: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoints?: string[];
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity?: string;
  languageNotes?: string;
  embedding?: number[];
  knowledgeMeta?: KnowledgeMeta;
  domainMeta?: DomainMeta;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction?: string;
  description?: string;
  weight?: number;
}

export interface GraphLayer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

export interface GraphTour {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

export interface KnowledgeGraph {
  version: string;
  kind: string;
  project: {
    name: string;
    languages: string[];
    frameworks: string[];
    description: string;
    analyzedAt: string;
    gitCommitHash: string;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: GraphLayer[];
  tour: GraphTour[];
}

// ─── GraphStore ──────────────────────────────────────────────────────────────

export class GraphStore {
  private graph: KnowledgeGraph | null = null;
  private nodeIndex: Map<string, GraphNode> = new Map();
  private edgesBySource: Map<string, GraphEdge[]> = new Map();
  private edgesByTarget: Map<string, GraphEdge[]> = new Map();
  private filePath: string;
  private loadedAt = 0;
  private searchEngine: SearchEngine | null = null;
  private semanticSearchEngine: SemanticSearchEngine | null = null;

  constructor(graphPath: string) {
    this.filePath = graphPath;
  }

  /** Validation issues from the last load */
  validationIssues: GraphIssue[] = [];

  /** Load (or reload) the graph from disk */
  load(): void {
    if (!existsSync(this.filePath)) {
      throw new Error(`Knowledge graph not found: ${this.filePath}`);
    }

    const raw = readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const validation = validateGraph(parsed);

    if (!validation.success) {
      throw new Error(`Graph validation failed: ${validation.fatal ?? "unknown error"}`);
    }

    // Log any auto-corrected or dropped issues
    if (validation.issues.length > 0) {
      this.validationIssues = validation.issues;
      for (const issue of validation.issues) {
        const prefix = issue.level === "auto-corrected" ? "WARN" : "DROP";
        console.warn(`[validate] ${prefix}: ${issue.message}`);
      }
    } else {
      this.validationIssues = [];
    }

    const validated = validation.data!;
    this.graph = validated;
    this.loadedAt = Date.now();

    // Build indexes
    this.nodeIndex.clear();
    this.edgesBySource.clear();
    this.edgesByTarget.clear();

    for (const node of validated.nodes) {
      this.nodeIndex.set(node.id, node);
    }

    for (const edge of validated.edges) {
      const src = this.edgesBySource.get(edge.source) ?? [];
      src.push(edge);
      this.edgesBySource.set(edge.source, src);

      const tgt = this.edgesByTarget.get(edge.target) ?? [];
      tgt.push(edge);
      this.edgesByTarget.set(edge.target, tgt);
    }

    // Rebuild search engine index
    this.searchEngine = new SearchEngine(validated.nodes);

    // Rebuild semantic search engine
    this.semanticSearchEngine = new SemanticSearchEngine(validated.nodes);
  }

  /**
   * Save the current in-memory graph back to disk.
   * Converts absolute file paths to relative paths before writing (port of UA persistence).
   * Returns the number of bytes written.
   */
  save(): number {
    if (!this.graph) {
      throw new Error("Cannot save: no graph loaded");
    }

    // Sanitize file paths to relative before writing
    const sanitized = this.sanitizeForSave(this.graph);
    const json = JSON.stringify(sanitized, null, 2);

    // Ensure parent directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.filePath, json, "utf-8");
    return json.length;
  }

  /**
   * Sanitize graph data for persistence: convert absolute file paths to relative
   * using the graph file's parent directories as the base.
   * Port of UA's saveGraph path sanitization from persistence/index.ts.
   */
  private sanitizeForSave(graph: KnowledgeGraph): KnowledgeGraph {
    // Compute base directory: the project root is two levels up from
    // .understand-anything/knowledge-graph.json, or use graph file's dir
    let baseDir = "";
    if (this.filePath.includes(".understand-anything")) {
      baseDir = resolve(this.filePath, "../..");
    } else {
      baseDir = resolve(this.filePath, "..");
    }

    const relativize = (fp: string | undefined): string | undefined => {
      if (!fp) return fp;
      if (!fp.includes("/") && !fp.includes("\\")) return fp; // already relative
      try {
        const abs = resolve(fp);
        if (abs.startsWith(baseDir)) {
          return abs.slice(baseDir.length + 1).replace(/\\/g, "/");
        }
      } catch {
        // leave as-is
      }
      return fp;
    };

    return {
      ...graph,
      nodes: graph.nodes.map(n => ({
        ...n,
        filePath: relativize(n.filePath),
      })),
    };
  }

  /**
   * Merge incremental analysis results into the graph.
   * Port of UA's mergeGraphUpdate from staleness.ts.
   * Removes stale nodes/edges for changed files, adds new ones.
   * Returns counts of removed and added items.
   */
  mergeGraphUpdate(
    changedFiles: string[],
    newNodes: GraphNode[],
    newEdges: GraphEdge[],
  ): { removedNodes: number; removedEdges: number; addedNodes: number; addedEdges: number } {
    if (!this.graph) {
      throw new Error("Cannot merge: no graph loaded");
    }

    const changedFileSet = new Set(changedFiles.map(f => f.replace(/\\/g, "/")));

    // Store original edge count before mutation for accurate removedEdges count
    const originalEdgeCount = this.graph.edges.length;

    // Remove nodes whose filePath matches a changed file
    const removedNodeIds = new Set<string>();
    const keptNodes = this.graph.nodes.filter(n => {
      const fp = n.filePath?.replace(/\\/g, "/");
      if (fp && changedFileSet.has(fp)) {
        removedNodeIds.add(n.id);
        return false;
      }
      return true;
    });

    // Remove edges connected to removed nodes
    const keptEdges = this.graph.edges.filter(e =>
      !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target)
    );

    // Normalize incoming nodes (fix IDs, complexity) but handle edges separately
    // to avoid dropping edges whose targets exist in the existing graph but not
    // in the new batch (normalizeBatchOutput's dangling-edge check is too aggressive
    // for the merge case — it only sees the new nodes, not the full graph).
    const normalized = normalizeBatchOutput({ nodes: newNodes, edges: [] });
    const normalizedNewNodes = normalized.nodes;
    const idMap = normalized.idMap; // maps old IDs → normalized IDs

    // Rewrite edge references using the idMap from normalization, then validate
    // against the FULL graph (existing + new), not just the new batch.
    const allValidIds = new Set([
      ...keptNodes.map(n => n.id),
      ...normalizedNewNodes.map(n => n.id),
    ]);
    const normalizedNewEdges = newEdges
      .map(e => ({
        ...e,
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      }))
      .filter(e => allValidIds.has(e.source) && allValidIds.has(e.target));

    // Deduplicate new nodes (by id)
    const existingIds = new Set(keptNodes.map(n => n.id));
    const uniqueNewNodes = normalizedNewNodes.filter(n => !existingIds.has(n.id));

    // Deduplicate new edges (by source+target+type)
    const existingEdgeKeys = new Set(
      keptEdges.map(e => `${e.source}|${e.target}|${e.type}`)
    );
    const uniqueNewEdges = normalizedNewEdges.filter(e => {
      const key = `${e.source}|${e.target}|${e.type}`;
      if (existingEdgeKeys.has(key)) return false;
      existingEdgeKeys.add(key); // prevent duplicates within normalizedNewEdges too
      return true;
    });

    // Merge and update graph
    this.graph = {
      ...this.graph,
      nodes: [...keptNodes, ...uniqueNewNodes],
      edges: [...keptEdges, ...uniqueNewEdges],
    };

    // Incrementally update indexes instead of full rebuild
    // Remove stale entries for removed nodes
    for (const id of removedNodeIds) {
      this.nodeIndex.delete(id);
      // Remove edges by source/target that reference removed nodes
      const srcEdges = this.edgesBySource.get(id);
      if (srcEdges) {
        this.edgesBySource.delete(id);
      }
      const tgtEdges = this.edgesByTarget.get(id);
      if (tgtEdges) {
        this.edgesByTarget.delete(id);
      }
    }

    // Rebuild edge indexes from kept edges (edges may have been removed)
    this.edgesBySource.clear();
    this.edgesByTarget.clear();
    for (const edge of this.graph.edges) {
      const src = this.edgesBySource.get(edge.source) ?? [];
      src.push(edge);
      this.edgesBySource.set(edge.source, src);
      const tgt = this.edgesByTarget.get(edge.target) ?? [];
      tgt.push(edge);
      this.edgesByTarget.set(edge.target, tgt);
    }

    // Add new node entries
    for (const node of uniqueNewNodes) {
      this.nodeIndex.set(node.id, node);
    }

    // Rebuild search engine only if nodes actually changed
    if (uniqueNewNodes.length > 0 || removedNodeIds.size > 0) {
      this.searchEngine = new SearchEngine(this.graph.nodes);
      this.semanticSearchEngine = new SemanticSearchEngine(this.graph.nodes);
    }

    this._dirty = true;

    return {
      removedNodes: removedNodeIds.size,
      removedEdges: originalEdgeCount - keptEdges.length,
      addedNodes: uniqueNewNodes.length,
      addedEdges: uniqueNewEdges.length,
    };
  }

  /** Reload if stale (older than cacheTtlMs) */
  ensureLoaded(cacheTtlMs = 60_000): void {
    if (!this.graph || Date.now() - this.loadedAt > cacheTtlMs) {
      this.load();
    }
  }

  get loaded(): boolean {
    return this.graph !== null;
  }

  get data(): KnowledgeGraph {
    this.ensureLoaded();
    return this.graph!;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /** Get node by ID */
  getNode(id: string): GraphNode | undefined {
    return this.nodeIndex.get(id);
  }

  /** Get all nodes, optionally filtered by type */
  getNodes(type?: string): GraphNode[] {
    this.ensureLoaded();
    if (type) return this.graph!.nodes.filter(n => n.type === type);
    return this.graph!.nodes;
  }

  /** Get edges connected to a node (either direction) */
  getEdgesForNode(nodeId: string): GraphEdge[] {
    const outgoing = this.edgesBySource.get(nodeId) ?? [];
    const incoming = this.edgesByTarget.get(nodeId) ?? [];
    return [...outgoing, ...incoming];
  }

  /** Get neighborhood: node + connected nodes + edges. Supports configurable depth. */
  getNeighborhood(nodeId: string, maxNodes = 50, maxDepth = 1): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const center = this.getNode(nodeId);
    if (!center) return { nodes: [], edges: [] };

    const visited = new Set<string>([nodeId]);
    const allEdges: GraphEdge[] = [];
    let frontier = new Set<string>([nodeId]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      for (const id of frontier) {
        const edges = this.getEdgesForNode(id);
        for (const e of edges) {
          if (!allEdges.some(ae => ae.source === e.source && ae.target === e.target && ae.type === e.type)) {
            allEdges.push(e);
          }
          const neighbor = e.source === id ? e.target : e.source;
          if (!visited.has(neighbor)) {
            nextFrontier.add(neighbor);
          }
        }
      }
      for (const id of nextFrontier) {
        visited.add(id);
      }
      frontier = nextFrontier;
    }

    visited.delete(nodeId);
    const neighbors: GraphNode[] = [];
    for (const id of visited) {
      if (neighbors.length >= maxNodes - 1) break;
      const n = this.getNode(id);
      if (n) neighbors.push(n);
    }

    return { nodes: [center, ...neighbors], edges: allEdges };
  }

  /** Fuzzy search across node names, summaries, tags, and language notes using Fuse.js */
  search(query: string, limit = 50, options?: Omit<SearchOptions, "limit">): GraphNode[] {
    this.ensureLoaded();
    if (!this.searchEngine) return [];

    const results = this.searchEngine.search(query, { ...options, limit });
    const nodes: GraphNode[] = [];
    for (const r of results) {
      const node = this.nodeIndex.get(r.nodeId);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Semantic search using pre-computed vector embeddings and cosine similarity */
  semanticSearch(queryEmbedding: number[], options?: Omit<SemanticSearchOptions, "limit"> & { limit?: number }): GraphNode[] {
    this.ensureLoaded();
    if (!this.semanticSearchEngine || !this.semanticSearchEngine.hasEmbeddings()) return [];

    const limit = options?.limit ?? 50;
    const results = this.semanticSearchEngine.search(queryEmbedding, { ...options, limit });
    const nodes: GraphNode[] = [];
    for (const r of results) {
      const node = this.nodeIndex.get(r.nodeId);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Get the semantic search engine for direct access (e.g., adding embeddings) */
  getSemanticSearchEngine(): SemanticSearchEngine | null {
    return this.semanticSearchEngine;
  }

  /** Get nodes by layer */
  getLayerNodes(layerId: string): GraphNode[] {
    this.ensureLoaded();
    const layer = this.graph!.layers.find(l => l.id === layerId);
    if (!layer) return [];
    return layer.nodeIds
      .map(id => this.nodeIndex.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /** Get dependency graph for a node (imports/depends_on chain). Optional edgeTypes override. */
  getDependencyTree(nodeId: string, depth = 3, edgeTypes?: string[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const depEdgeTypes = edgeTypes ?? ["imports", "depends_on", "calls"];

    const walk = (id: string, d: number) => {
      if (d <= 0 || visited.has(id)) return;
      visited.add(id);
      const node = this.getNode(id);
      if (node) nodes.push(node);

      const outEdges = (this.edgesBySource.get(id) ?? [])
        .filter(e => depEdgeTypes.includes(e.type));
      for (const e of outEdges) {
        edges.push(e);
        walk(e.target, d - 1);
      }
    };

    walk(nodeId, depth);
    return { nodes, edges };
  }

  /** Find node by file path, optionally matching a function/class name */
  getNodeByPath(filePath: string, name?: string): GraphNode | undefined {
    this.ensureLoaded();
    if (name) {
      return this.graph!.nodes.find(n => n.filePath === filePath && n.name === name);
    }
    return this.graph!.nodes.find(n => n.filePath === filePath);
  }

  /** Get child nodes (connected via "contains" edges from parent) */
  getChildNodes(nodeId: string): GraphNode[] {
    this.ensureLoaded();
    const childIds = new Set<string>();
    for (const edge of this.graph!.edges) {
      if (edge.source === nodeId && edge.type === "contains") {
        childIds.add(edge.target);
      }
    }
    return [...childIds]
      .map(id => this.nodeIndex.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /** Get 1-hop connected nodes, optionally filtering by edge types. Excludes "contains" children by default. */
  getConnectedNodes(nodeId: string, edgeTypes?: string[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const excludeTypes = edgeTypes ? [] : ["contains"];
    const includeTypes = edgeTypes ? new Set(edgeTypes) : null;
    const edges = this.getEdgesForNode(nodeId).filter(e => {
      if (excludeTypes.includes(e.type)) return false;
      if (includeTypes && !includeTypes.has(e.type)) return false;
      return true;
    });
    const connectedIds = new Set<string>();
    for (const e of edges) {
      if (e.source === nodeId) connectedIds.add(e.target);
      else connectedIds.add(e.source);
    }
    const nodes = [...connectedIds]
      .map(id => this.nodeIndex.get(id))
      .filter((n): n is GraphNode => n !== undefined);
    return { nodes, edges };
  }

  /** BFS path finding between two nodes */
  getPathBetween(sourceId: string, targetId: string, maxDepth = 6): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.ensureLoaded();
    if (sourceId === targetId) {
      const node = this.getNode(sourceId);
      return node ? { nodes: [node], edges: [] } : { nodes: [], edges: [] };
    }

    const visited = new Set<string>([sourceId]);
    const queue: Array<{ id: string; path: string[]; edgePath: GraphEdge[] }> = [
      { id: sourceId, path: [sourceId], edgePath: [] },
    ];

    while (queue.length > 0) {
      const { id, path, edgePath } = queue.shift()!;
      if (path.length > maxDepth) continue;

      for (const edge of this.getEdgesForNode(id)) {
        const nextId = edge.source === id ? edge.target : edge.source;
        if (visited.has(nextId)) continue;
        visited.add(nextId);

        const newPath = [...path, nextId];
        const newEdgePath = [...edgePath, edge];

        if (nextId === targetId) {
          return {
            nodes: newPath.map(nid => this.nodeIndex.get(nid)).filter((n): n is GraphNode => !!n),
            edges: newEdgePath,
          };
        }
        queue.push({ id: nextId, path: newPath, edgePath: newEdgePath });
      }
    }
    return { nodes: [], edges: [] }; // no path found
  }

  /** Get per-layer health metrics */
  getLayerHealth(): Array<{
    id: string; name: string; description: string;
    nodeCount: number; edgeDensity: number;
    complexNodes: number; avgConnections: number;
  }> {
    this.ensureLoaded();
    return this.graph!.layers.map(layer => {
      const nodes = layer.nodeIds.map(id => this.nodeIndex.get(id)).filter(Boolean) as GraphNode[];
      const nodeSet = new Set(layer.nodeIds);
      const layerEdges = this.graph!.edges.filter(e =>
        (nodeSet.has(e.source) || nodeSet.has(e.target))
      );
      const complexCount = nodes.filter(n => n.complexity === "complex").length;
      const totalConns = nodes.reduce((sum, n) => sum + this.getEdgesForNode(n.id).length, 0);

      return {
        id: layer.id,
        name: layer.name,
        description: layer.description,
        nodeCount: nodes.length,
        edgeDensity: nodes.length > 0 ? layerEdges.length / nodes.length : 0,
        complexNodes: complexCount,
        avgConnections: nodes.length > 0 ? Math.round(totalConns / nodes.length * 10) / 10 : 0,
      };
    });
  }

  /** Get high-complexity nodes (hotspots) */
  getHotspots(): GraphNode[] {
    this.ensureLoaded();
    return this.graph!.nodes.filter(n => n.complexity === "complex");
  }

  /** Check staleness: compare graph commit hash to current git HEAD */
  checkStaleness(projectDir?: string): { stale: boolean; changedFiles: string[]; graphCommitHash: string } {
    this.ensureLoaded();
    const graphCommitHash = this.graph!.project.gitCommitHash;
    if (!projectDir) {
      // Try to detect project dir from graph file path
      projectDir = this.filePath.includes(".understand-anything")
        ? resolve(this.filePath, "../..")
        : process.cwd();
    }
    try {
      const proc = Bun.spawnSync(
        ["git", "diff", `${graphCommitHash}..HEAD`, "--name-only"],
        { cwd: projectDir, encoding: "utf-8" },
      );
      const changedFiles = (proc.stdout ?? "")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
      return { stale: changedFiles.length > 0, changedFiles, graphCommitHash };
    } catch {
      return { stale: false, changedFiles: [], graphCommitHash };
    }
  }

  /** Compute fingerprints for all file nodes in the graph. */
  computeFingerprints(projectDir?: string): FingerprintStore {
    this.ensureLoaded();
    if (!projectDir) {
      projectDir = this.filePath.includes(".understand-anything")
        ? resolve(this.filePath, "../..")
        : process.cwd();
    }
    const gitCommitHash = this.graph!.project.gitCommitHash;
    return buildFingerprintStore(projectDir, this.graph!.nodes, gitCommitHash);
  }

  /** Analyze changes using fingerprints. Returns change analysis and update decision. */
  analyzeChangesWithFingerprints(
    changedFiles: string[],
    projectDir?: string,
  ): { analysis: ChangeAnalysis; decision: UpdateDecision } {
    this.ensureLoaded();
    if (!projectDir) {
      projectDir = this.filePath.includes(".understand-anything")
        ? resolve(this.filePath, "../..")
        : process.cwd();
    }

    // Try to load existing fingerprint store
    const fpPath = join(dirname(this.filePath), "fingerprints.json");
    const existingStore = loadFingerprintStore(fpPath);

    // If no existing store, build one now
    const store = existingStore ?? this.computeFingerprints(projectDir);

    const analysis = analyzeChanges(projectDir, changedFiles, store);

    // Get all known file paths for directory change detection
    const allKnownFiles = this.graph!.nodes
      .filter(n => n.filePath)
      .map(n => n.filePath!);

    const decision = classifyUpdate(analysis, this.graph!.nodes.length, allKnownFiles);

    return { analysis, decision };
  }

  /** Save fingerprint store to disk alongside the graph. */
  saveFingerprints(store: FingerprintStore): void {
    const fpPath = join(dirname(this.filePath), "fingerprints.json");
    saveFingerprintStore(store, fpPath);
  }

  /** Load fingerprint store from disk. Returns null if not found. */
  loadFingerprints(): FingerprintStore | null {
    const fpPath = join(dirname(this.filePath), "fingerprints.json");
    return loadFingerprintStore(fpPath);
  }

  /** Detect layers using heuristic directory patterns. Returns new layer array. */
  detectLayersHeuristic(): import("./graph.js").GraphLayer[] {
    this.ensureLoaded();
    return detectLayersHeuristic(this.graph!.nodes);
  }

  /** Apply LLM-detected layers to graph nodes. Returns new layer array. */
  applyDetectedLLMLayers(llmLayers: LLMLayerResponse[]): import("./graph.js").GraphLayer[] {
    this.ensureLoaded();
    return applyLLMLayers(this.graph!.nodes, llmLayers);
  }

  /** Detect language concepts for a specific node. */
  detectNodeConcepts(nodeId: string): string[] {
    const node = this.getNode(nodeId);
    if (!node) return [];
    return detectLanguageConcepts(node);
  }

  /** Detect language concepts across all nodes. Returns concept -> nodeIds map. */
  detectAllConcepts(): Record<string, string[]> {
    this.ensureLoaded();
    return detectAllConcepts(this.graph!.nodes);
  }

  /** Track dirty state for graceful shutdown persistence. */
  private _dirty = false;

  /** Mark the graph as modified since last save. */
  markDirty(): void {
    this._dirty = true;
  }

  /** Check if the graph has been modified since last save. */
  get dirty(): boolean {
    return this._dirty;
  }

  /** Stats summary */
  getStats(): Record<string, unknown> {
    this.ensureLoaded();
    const g = this.graph!;
    const nodeTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};
    for (const n of g.nodes) nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1;
    for (const e of g.edges) edgeTypes[e.type] = (edgeTypes[e.type] ?? 0) + 1;

    return {
      project: g.project.name,
      version: g.version,
      totalNodes: g.nodes.length,
      totalEdges: g.edges.length,
      layers: g.layers.length,
      tourSteps: g.tour.length,
      nodeTypes,
      edgeTypes,
    };
  }
}
