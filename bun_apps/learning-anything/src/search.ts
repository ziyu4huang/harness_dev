/**
 * Search: Fuzzy search engine using Fuse.js.
 *
 * Port of UA's search.ts SearchEngine, re-implemented for the bun-app.
 * Uses Fuse.js with weighted keys (name 0.4, tags 0.3, summary 0.2,
 * languageNotes 0.1), threshold 0.4, extended search mode, and type filtering.
 * Replaces the naive text search in graph.ts.
 */

import Fuse, { type IFuseOptions } from "fuse.js";
import type { GraphNode } from "./graph.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  nodeId: string;
  score: number; // 0 = perfect match, 1 = worst match
}

export interface SearchOptions {
  types?: string[];
  limit?: number;
}

// ─── Fuse.js Configuration ──────────────────────────────────────────────────

const FUSE_OPTIONS: IFuseOptions<GraphNode> = {
  keys: [
    { name: "name", weight: 0.4 },
    { name: "tags", weight: 0.3 },
    { name: "summary", weight: 0.2 },
    { name: "languageNotes", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

// ─── Search Engine ──────────────────────────────────────────────────────────

export class SearchEngine {
  private fuse: Fuse<GraphNode>;
  private nodes: GraphNode[];

  constructor(nodes: GraphNode[]) {
    this.nodes = nodes;
    this.fuse = new Fuse(nodes, FUSE_OPTIONS);
  }

  /**
   * Search the graph using Fuse.js fuzzy matching.
   * Space-separated tokens are joined with | for extended OR matching.
   * Optionally filter results by node type.
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = options?.limit ?? 50;

    // Use extended search: join space-separated tokens with | (OR)
    // so "auth controller" becomes "auth | controller"
    const extendedQuery = trimmed.split(/\s+/).join(" | ");
    const rawResults = this.fuse.search(extendedQuery);

    let filtered = rawResults;
    if (options?.types && options.types.length > 0) {
      const allowedTypes = new Set(options.types);
      filtered = filtered.filter((r) => allowedTypes.has(r.item.type));
    }

    return filtered.slice(0, limit).map((r) => ({
      nodeId: r.item.id,
      score: r.score ?? 0,
    }));
  }

  /**
   * Rebuild the search index with a new set of nodes.
   * Called after graph reload.
   */
  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    this.fuse = new Fuse(nodes, FUSE_OPTIONS);
  }
}
