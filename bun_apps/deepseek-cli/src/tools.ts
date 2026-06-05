import { mkdir } from "fs/promises";
import { dirname } from "path";
import { CONFIG } from "./config.ts";

// ─── Math evaluator ────────────────────────────────────────────────────────

/**
 * Patterns that must never appear in a math expression.
 * Blocks loops, closures, module access, and other unsafe constructs.
 */
const MATH_BLOCKLIST = [
  /\bwhile\b/,
  /\bfor\s*\(/,
  /\bfunction\b/,
  /=>/,
  /\bimport\b/,
  /\brequire\b/,
  /\bprocess\b/,
  /\bconstructor\b/,
  /\bglobalThis\b/,
  /\beval\b/,
  /\bthis\b/,
];

/**
 * Lightweight math expression evaluator (replaces mathjs).
 * Uses Function constructor with a restricted scope — safe for CLI use.
 */
export function mathEval(expr: string): string {
  for (const pattern of MATH_BLOCKLIST) {
    if (pattern.test(expr)) {
      throw new Error(`Blocked pattern in expression: ${expr}`);
    }
  }
  try {
    const fn = new Function(
      "Math",
      `"use strict"; return (${expr})`,
    );
    const result = fn(Math);
    return typeof result === "number" && Number.isFinite(result)
      ? String(result)
      : String(result);
  } catch {
    throw new Error(`Invalid expression: ${expr}`);
  }
}

// ─── Path normalization ────────────────────────────────────────────────────

/**
 * Normalize file paths for cross-platform compatibility.
 * On Windows, converts common Unix-style paths to Windows equivalents.
 */
const WIN_PATH_MAPPINGS: Array<{ prefix: string; envVars: string[]; fallback: string }> = [
  { prefix: "/tmp/", envVars: ["TEMP", "TMP"], fallback: "C:\\Windows\\Temp" },
  { prefix: "/tmp", envVars: ["TEMP", "TMP"], fallback: "C:\\Windows\\Temp" },
  { prefix: "/home/", envVars: ["USERPROFILE"], fallback: "C:\\Users\\Default" },
  { prefix: "/home", envVars: ["USERPROFILE"], fallback: "C:\\Users\\Default" },
  { prefix: "~/", envVars: ["USERPROFILE", "HOME"], fallback: "C:\\Users\\Default" },
];

export function normalizePath(filePath: string): string {
  if (process.platform === "win32") {
    for (const mapping of WIN_PATH_MAPPINGS) {
      if (filePath.startsWith(mapping.prefix)) {
        const resolved = mapping.envVars.reduce(
          (acc, v) => acc || process.env[v] || "",
          "",
        ) || mapping.fallback;
        const isExactMatch = filePath === mapping.prefix;
        if (isExactMatch) return resolved;
        // For "/tmp/foo" -> "C:\Windows\Temp\foo", strip the prefix and append
        return resolved + filePath.slice(mapping.prefix.length);
      }
    }
  }
  return filePath;
}

// ─── Tool execute functions (exported for testing) ─────────────────────────

export const toolExecutors = {
  calculator: async ({ expression }: { expression: string }) => {
    try {
      const result = mathEval(expression);
      return String(result);
    } catch {
      return `Error: invalid expression "${expression}"`;
    }
  },

  read_file: async ({ path }: { path: string }) => {
    try {
      const normalizedPath = normalizePath(path);
      if (normalizedPath.includes("*") || normalizedPath.includes("?")) {
        const { Glob } = await import("bun");
        const g = new Glob(normalizedPath);
        const results: string[] = [];
        let count = 0;
        for await (const file of g.scan()) {
          if (count++ >= CONFIG.GLOB_FILE_LIMIT) {
            results.push(`... (truncated at ${CONFIG.GLOB_FILE_LIMIT} files)`);
            break;
          }
          const content = await Bun.file(file).text();
          results.push(`=== ${file} ===\n${content}`);
        }
        return results.join("\n\n") || `No files matching: ${normalizedPath}`;
      }
      const file = Bun.file(normalizedPath);
      const exists = await file.exists();
      if (!exists) return `Error: file not found: ${normalizedPath}`;
      return await file.text();
    } catch (e) {
      return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  write_file: async ({ path, content }: { path: string; content: string }) => {
    try {
      const normalizedPath = normalizePath(path);
      const dir = dirname(normalizedPath);
      await mkdir(dir, { recursive: true });
      await Bun.write(normalizedPath, content);
      return `Successfully wrote ${content.length} bytes to ${normalizedPath}`;
    } catch (e) {
      return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  web_fetch: async ({ url }: { url: string }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.WEB_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText}`;
      const text = await res.text();
      return text.length > CONFIG.WEB_FETCH_CHAR_LIMIT
        ? text.slice(0, CONFIG.WEB_FETCH_CHAR_LIMIT) + `\n... (truncated at ${CONFIG.WEB_FETCH_CHAR_LIMIT} chars)`
        : text;
    } catch (e) {
      return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  list_directory: async ({ path = ".", depth = 0 }: { path?: string; depth?: number }) => {
    try {
      const normalizedPath = normalizePath(path);
      const { readdir } = await import("fs/promises");
      const { join, relative } = await import("path");

      async function readDir(dirPath: string, remaining: number): Promise<string[]> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);
          const relPath = relative(normalizedPath, fullPath);
          result.push(entry.isDirectory() ? `${relPath}/` : relPath);
          if (entry.isDirectory() && remaining > 0) {
            result.push(...(await readDir(fullPath, remaining - 1)));
          }
        }
        return result.sort();
      }

      const items = await readDir(normalizedPath, depth);
      return items.join("\n") || "(empty directory)";
    } catch (e) {
      return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
    }
  },

  grep_search: async ({
    pattern,
    glob = "**/*",
    maxResults = CONFIG.GREP_MAX_RESULTS,
  }: {
    pattern: string;
    glob?: string;
    maxResults?: number;
  }) => {
    try {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return `Error: invalid regex pattern "${pattern}"`;
      }
      const g = new Bun.Glob(glob);
      const results: string[] = [];
      let skippedFiles = 0;
      for await (const file of g.scan({ absolute: true })) {
        try {
          const text = await Bun.file(file).text();
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const match = `${file}:${i + 1}: ${lines[i].trim().slice(0, 200)}`;
              results.push(match);
              if (results.length >= maxResults) {
                results.push(`... (truncated at ${maxResults} matches)`);
                if (skippedFiles > 0) results.push(`(skipped ${skippedFiles} unreadable file${skippedFiles > 1 ? "s" : ""})`);
                return results.join("\n");
              }
            }
          }
        } catch {
          skippedFiles++;
        }
      }
      let output = results.length > 0
        ? results.join("\n")
        : `(no matches found for /${pattern}/ in ${glob})`;
      if (skippedFiles > 0) output += `\n(skipped ${skippedFiles} unreadable file${skippedFiles > 1 ? "s" : ""})`;
      return output;
    } catch (e) {
      return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// ─── Tool JSON Schema definitions (compressed for token efficiency) ────────

export const TOOL_DEFINITIONS: Record<string, {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = {
  calculator: {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, %, **), Math methods (Math.sqrt, Math.PI, Math.abs, Math.round, etc.), and parentheses. Cannot use loops, functions, closures, import/require, process, or eval. Example: 'Math.sqrt(144) + 2 * 3'",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression to evaluate, e.g. '2+2*3' or 'Math.sqrt(16)'" },
        },
        required: ["expression"],
      },
    },
  },
  read_file: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file. Supports glob patterns (e.g. 'src/*.ts') to read multiple files at once, limited to 20 files. Returns file content or error message. For a single file, returns the full text content. For glob matches, returns each file separated by headers.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path or glob pattern (e.g. '/home/user/project/*.ts')" },
        },
        required: ["path"],
      },
    },
  },
  write_file: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, creating parent directories if they do not exist. Overwrites any existing file at the path. Returns confirmation with byte count.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path to write to" },
          content: { type: "string", description: "Text content to write to the file" },
        },
        required: ["path", "content"],
      },
    },
  },
  web_fetch: {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch content from a URL via HTTP GET. Returns the response body as text, truncated at 10,000 characters. Has a 15-second timeout. Returns error message on HTTP errors, network failures, or timeouts.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL to fetch (e.g. 'https://example.com/api')" },
        },
        required: ["url"],
      },
    },
  },
  list_directory: {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and subdirectories in a directory. Returns relative paths with trailing / for directories. Use the depth parameter to recursively list nested contents (0 = flat, 1 = one level deep, etc.). Defaults to current directory if path not specified.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list (default: current directory)" },
          depth: { type: "number", description: "Recursion depth (0 = flat listing, 1 = include one level of subdirectories)" },
        },
        required: [],
      },
    },
  },
  grep_search: {
    type: "function",
    function: {
      name: "grep_search",
      description: "Search file contents using a regular expression pattern. Returns matching lines in 'file:line: content' format. Use the glob parameter to filter which files to search (default: '**/*'). Pattern must be a valid JavaScript regex. Results limited to 50 matches by default.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regular expression pattern (e.g. 'TODO|FIXME', 'function\\s+\\w+')" },
          glob: { type: "string", description: "Glob pattern to filter files to search (default: '**/*', e.g. '*.ts', 'src/**')" },
          maxResults: { type: "number", description: "Maximum number of matches to return (default: 50)" },
        },
        required: ["pattern"],
      },
    },
  },
};
