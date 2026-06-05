/**
 * Graph: Knowledge graph loader and query engine.
 *
 * Reads knowledge-graph.json produced by Understand-Anything plugin
 * and provides efficient querying by node type, layer, search, etc.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

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

  constructor(graphPath: string) {
    this.filePath = graphPath;
  }

  /** Load (or reload) the graph from disk */
  load(): void {
    if (!existsSync(this.filePath)) {
      throw new Error(`Knowledge graph not found: ${this.filePath}`);
    }

    const raw = readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw) as KnowledgeGraph;
    this.graph = parsed;
    this.loadedAt = Date.now();

    // Build indexes
    this.nodeIndex.clear();
    this.edgesBySource.clear();
    this.edgesByTarget.clear();

    for (const node of parsed.nodes) {
      this.nodeIndex.set(node.id, node);
    }

    for (const edge of parsed.edges) {
      const src = this.edgesBySource.get(edge.source) ?? [];
      src.push(edge);
      this.edgesBySource.set(edge.source, src);

      const tgt = this.edgesByTarget.get(edge.target) ?? [];
      tgt.push(edge);
      this.edgesByTarget.set(edge.target, tgt);
    }
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

  /** Get 1-hop neighborhood: node + all connected nodes + edges */
  getNeighborhood(nodeId: string, maxNodes = 50): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const center = this.getNode(nodeId);
    if (!center) return { nodes: [], edges: [] };

    const edges = this.getEdgesForNode(nodeId);
    const neighborIds = new Set<string>();
    for (const e of edges) {
      neighborIds.add(e.source);
      neighborIds.add(e.target);
    }
    neighborIds.delete(nodeId);

    const neighbors: GraphNode[] = [];
    for (const id of neighborIds) {
      if (neighbors.length >= maxNodes - 1) break;
      const n = this.getNode(id);
      if (n) neighbors.push(n);
    }

    return { nodes: [center, ...neighbors], edges };
  }

  /** Text search across node names, summaries, and tags */
  search(query: string, limit = 50): GraphNode[] {
    this.ensureLoaded();
    const q = query.toLowerCase();
    const scored = this.graph!.nodes.map(node => {
      let score = 0;
      if (node.name.toLowerCase().includes(q)) score += 10;
      if (node.summary.toLowerCase().includes(q)) score += 5;
      if (node.tags.some(t => t.toLowerCase().includes(q))) score += 3;
      if (node.filePath?.toLowerCase().includes(q)) score += 2;
      return { node, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.node);
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

  /** Get dependency graph for a node (imports/depends_on chain) */
  getDependencyTree(nodeId: string, depth = 3): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const depEdgeTypes = ["imports", "depends_on", "calls"];

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

  /** Get 1-hop connected nodes excluding "contains" children */
  getConnectedNodes(nodeId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges = this.getEdgesForNode(nodeId).filter(e => e.type !== "contains");
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
