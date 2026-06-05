/**
 * Middleware: Request logging, rate limiting, and error boundary for the server.
 *
 * Provides a lightweight middleware pipeline that runs before route dispatch.
 * Adds:
 *   - Request ID tracking (X-Request-Id header)
 *   - Response timing (X-Response-Time header)
 *   - Per-IP rate limiting with configurable window
 *   - LLM-specific error handling (API key missing, model overloaded, timeout)
 *   - Request logging controlled by UA_LOG_LEVEL env var
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  requestId: string;
  startTime: number;
  method: string;
  path: string;
  clientIp: string;
}

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

// ─── Request ID Generator ───────────────────────────────────────────────────

let requestCounter = 0;

function generateRequestId(): string {
  requestCounter++;
  const timestamp = Date.now().toString(36);
  const counter = requestCounter.toString(36);
  return `la-${timestamp}-${counter}`;
}

// ─── Log Level ───────────────────────────────────────────────────────────────

type LogLevel = "none" | "error" | "info" | "debug";

function getLogLevel(): LogLevel {
  const env = (process.env.UA_LOG_LEVEL ?? "info").toLowerCase();
  if (["none", "error", "info", "debug"].includes(env)) return env as LogLevel;
  return "info";
}

const LOG_LEVELS: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  info: 2,
  debug: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[getLogLevel()];
}

// ─── Request Logger ──────────────────────────────────────────────────────────

/**
 * Creates a middleware context and logs the incoming request.
 */
export function requestLogger(method: string, path: string, clientIp: string): MiddlewareContext {
  const ctx: MiddlewareContext = {
    requestId: generateRequestId(),
    startTime: Date.now(),
    method,
    path,
    clientIp,
  };

  if (shouldLog("debug")) {
    console.log(`[${ctx.requestId}] --> ${ctx.method} ${ctx.path} from ${ctx.clientIp}`);
  }

  return ctx;
}

/**
 * Logs the completed request with timing information.
 */
export function logResponse(ctx: MiddlewareContext, status: number): void {
  const elapsed = Date.now() - ctx.startTime;

  if (shouldLog("info")) {
    const level = status >= 500 ? "ERR" : status >= 400 ? "WARN" : "OK ";
    console.log(`[${ctx.requestId}] <-- ${ctx.method} ${ctx.path} ${status} ${elapsed}ms [${level}]`);
  }
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Creates a rate limiter middleware function.
 * Tracks per-IP request counts using a Map with TTL cleanup.
 */
export function rateLimiter(options?: Partial<RateLimiterOptions>): {
  check: (clientIp: string) => { allowed: boolean; remaining: number; resetAt: number };
  cleanup: () => void;
} {
  const maxRequests = options?.maxRequests ?? 100;
  const windowMs = options?.windowMs ?? 60_000; // 1 minute default

  return {
    check(clientIp: string): { allowed: boolean; remaining: number; resetAt: number } {
      const now = Date.now();
      let entry = rateLimitStore.get(clientIp);

      // Reset window if expired
      if (!entry || now - entry.windowStart > windowMs) {
        entry = { count: 0, windowStart: now };
        rateLimitStore.set(clientIp, entry);
      }

      entry.count++;
      const remaining = Math.max(0, maxRequests - entry.count);
      const resetAt = entry.windowStart + windowMs;

      return {
        allowed: entry.count <= maxRequests,
        remaining,
        resetAt,
      };
    },

    cleanup(): void {
      const now = Date.now();
      for (const [ip, entry] of rateLimitStore) {
        if (now - entry.windowStart > windowMs) {
          rateLimitStore.delete(ip);
        }
      }
    },
  };
}

// Periodic cleanup every 5 minutes
const cleanupInterval = setInterval(() => {
  for (const [ip, entry] of rateLimitStore) {
    if (Date.now() - entry.windowStart > 300_000) {
      rateLimitStore.delete(ip);
    }
  }
}, 300_000);

// Don't prevent process exit
if (cleanupInterval.unref) cleanupInterval.unref();

// ─── Error Boundary ──────────────────────────────────────────────────────────

export interface ErrorInfo {
  status: number;
  message: string;
  code?: string;
}

/**
 * Classifies an error and returns appropriate HTTP status code and message.
 * Handles LLM-specific errors (API key, model overloaded, timeout) and
 * general validation/auth/server errors.
 */
export function classifyError(err: unknown): ErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  // LLM Provider errors
  if (lowerMessage.includes("api key") || lowerMessage.includes("api_key") || lowerMessage.includes("unauthorized") || lowerMessage.includes("invalid_api_key")) {
    return { status: 401, message: "LLM provider authentication failed. Check DEEPSEEK_API_KEY.", code: "AUTH_ERROR" };
  }

  if (lowerMessage.includes("rate limit") || lowerMessage.includes("too many requests") || lowerMessage.includes("429")) {
    return { status: 503, message: "LLM provider rate limit exceeded. Please retry later.", code: "RATE_LIMITED" };
  }

  if (lowerMessage.includes("model") && (lowerMessage.includes("overloaded") || lowerMessage.includes("not found") || lowerMessage.includes("does not exist"))) {
    return { status: 503, message: "LLM model temporarily unavailable.", code: "MODEL_UNAVAILABLE" };
  }

  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out") || lowerMessage.includes("aborted")) {
    return { status: 408, message: "LLM request timed out.", code: "TIMEOUT" };
  }

  if (lowerMessage.includes("context length") || lowerMessage.includes("max_tokens") || lowerMessage.includes("token limit")) {
    return { status: 413, message: "Request exceeds LLM context length.", code: "CONTEXT_TOO_LONG" };
  }

  // Validation errors
  if (lowerMessage.includes("missing") || lowerMessage.includes("required") || lowerMessage.includes("invalid")) {
    return { status: 400, message, code: "VALIDATION_ERROR" };
  }

  // Graph-specific errors
  if (lowerMessage.includes("graph") && (lowerMessage.includes("not found") || lowerMessage.includes("not loaded"))) {
    return { status: 503, message: "Knowledge graph not available.", code: "GRAPH_UNAVAILABLE" };
  }

  // Default: internal server error
  return { status: 500, message: "Internal server error.", code: "INTERNAL_ERROR" };
}

/**
 * Wraps a handler function with error boundary logic.
 * Catches errors and returns appropriate HTTP responses.
 */
export function errorBoundary<T>(
  handler: () => T | Promise<T>,
  onError?: (err: unknown, info: ErrorInfo) => void,
): Promise<T> {
  return (async () => {
    try {
      return await handler();
    } catch (err) {
      const info = classifyError(err);
      if (onError) onError(err, info);
      throw err; // Re-throw for the outer handler to respond
    }
  })();
}

// ─── Response Cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  body: string;
  headers: Record<string, string>;
  etag: string;
  cachedAt: number;
}

let responseCache = new Map<string, CacheEntry>();

/** Default cache TTL for GET responses (30 seconds). */
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Generate an ETag from a response body.
 */
export function generateETag(body: string): string {
  // Simple hash-based ETag
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `W/"${Math.abs(hash).toString(36)}"`;
}

/**
 * Check the response cache for a GET request.
 * Returns a cached Response if a valid entry exists and the client's
 * If-None-Match header matches, returns 304 Not Modified.
 * Returns null if no valid cache entry exists.
 */
export function checkResponseCache(
  method: string,
  path: string,
  query: string,
  ifNoneMatch?: string | null,
): Response | null {
  if (method !== "GET") return null;

  const cacheKey = `${method}:${path}?${query}`;
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.cachedAt > DEFAULT_CACHE_TTL_MS) {
    responseCache.delete(cacheKey);
    return null;
  }

  // Check If-None-Match for 304
  if (ifNoneMatch && ifNoneMatch === entry.etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...entry.headers,
        "ETag": entry.etag,
      },
    });
  }

  // Return cached response
  return new Response(entry.body, {
    status: 200,
    headers: {
      ...entry.headers,
      "ETag": entry.etag,
    },
  });
}

/**
 * Store a response in the cache (GET requests only).
 */
export function storeResponseCache(
  method: string,
  path: string,
  query: string,
  body: string,
  headers: Record<string, string>,
): void {
  if (method !== "GET") return;
  const cacheKey = `${method}:${path}?${query}`;
  responseCache.set(cacheKey, {
    body,
    headers: { ...headers },
    etag: generateETag(body),
    cachedAt: Date.now(),
  });
}

/**
 * Invalidate the entire response cache.
 * Call when the graph is modified (merge, reload, save).
 */
export function invalidateResponseCache(): void {
  responseCache.clear();
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Clean up all resources: rate limiter interval and response cache.
 * Call this on graceful shutdown.
 */
export function cleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  responseCache.clear();
  rateLimitStore.clear();
}

