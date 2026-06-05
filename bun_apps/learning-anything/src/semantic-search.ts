/**
 * Semantic Search: Cosine similarity search over pre-computed vector embeddings.
 *
 * Port of UA's embedding-search.ts, re-implemented against graph.ts types.
 * Stores pre-computed embeddings for graph nodes and performs cosine similarity
 * search against query embeddings with type filtering and threshold support.
 *
 * Enables "find similar code" queries that text search misses.
 * Embeddings can be pre-computed via LLM API at graph build time and stored
 * in the graph JSON alongside nodes.
 */

import type { GraphNode } from "./graph.js";
import type { SearchResult } from "./search.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
}

// ─── Cosine Similarity ──────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  if (a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

// ─── Semantic Search Engine ─────────────────────────────────────────────────

/**
 * Semantic search engine using vector embeddings.
 * Stores pre-computed embeddings for graph nodes and performs
 * cosine similarity search against query embeddings.
 */
export class SemanticSearchEngine {
  private nodes: GraphNode[];
  private embeddings: Map<string, number[]>;

  constructor(nodes: GraphNode[], embeddings?: Record<string, number[]>) {
    this.nodes = nodes;
    this.embeddings = new Map(embeddings ? Object.entries(embeddings) : []);

    // Also collect embeddings from node.embedding fields
    for (const node of nodes) {
      if (node.embedding && node.embedding.length > 0) {
        this.embeddings.set(node.id, node.embedding);
      }
    }
  }

  /** Check if any embeddings are available */
  hasEmbeddings(): boolean {
    return this.embeddings.size > 0;
  }

  /** Get the number of nodes with embeddings */
  get embeddingCount(): number {
    return this.embeddings.size;
  }

  /** Add or update an embedding for a node */
  addEmbedding(nodeId: string, embedding: number[]): void {
    this.embeddings.set(nodeId, embedding);
  }

  /** Get the embedding for a node, if available */
  getEmbedding(nodeId: string): number[] | undefined {
    return this.embeddings.get(nodeId);
  }

  /**
   * Search for nodes similar to the query embedding.
   * Returns results sorted by similarity (best first).
   * Score is 1 - similarity (0 = perfect match, 1 = worst match),
   * consistent with the SearchResult interface used by text search.
   */
  search(
    queryEmbedding: number[],
    options?: SemanticSearchOptions,
  ): SearchResult[] {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0;
    const typeFilter = options?.types;

    const scored: SearchResult[] = [];

    for (const node of this.nodes) {
      if (typeFilter && !typeFilter.includes(node.type)) continue;

      const embedding = this.embeddings.get(node.id);
      if (!embedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity >= threshold) {
        scored.push({ nodeId: node.id, score: 1 - similarity });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit);
  }

  /**
   * Rebuild the node list (e.g., after graph reload).
   * Embeddings are preserved unless cleared.
   */
  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    // Re-collect embeddings from node.embedding fields
    for (const node of nodes) {
      if (node.embedding && node.embedding.length > 0) {
        this.embeddings.set(node.id, node.embedding);
      }
    }
  }
}
