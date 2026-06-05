/**
 * Ignore: 3-layer ignore filter for excluding noise from analysis.
 *
 * Port of UA's ignore-filter.ts, re-implemented without the 'ignore' npm dependency.
 * Uses Bun-native path matching with glob-to-regexp conversion.
 *
 * Layers:
 *   1. Hardcoded defaults (60+ patterns for node_modules, dist, lock files, etc.)
 *   2. .understand-anything/.understandignore (if exists)
 *   3. .understandignore at project root (if exists)
 *
 * Usage:
 *   const filter = createIgnoreFilter(projectRoot);
 *   if (!filter.isIgnored('src/index.ts')) { ... }
 */

import { readFileSync, existsSync } from "fs";
import { join, sep, normalize } from "path";

// ─── Default Ignore Patterns ────────────────────────────────────────────────

/**
 * Hardcoded default ignore patterns matching the project-scanner agent's
 * exclusion rules. Covers dependency dirs, build output, lock files,
 * binary/asset files, generated files, and IDE dirs.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  // Dependency directories
  "node_modules/**",
  ".git/**",
  "vendor/**",
  "venv/**",
  ".venv/**",
  "__pycache__/**",

  // Build output
  "dist/**",
  "build/**",
  "out/**",
  "coverage/**",
  ".next/**",
  ".cache/**",
  ".turbo/**",
  "target/**",
  "obj/**",

  // Lock files
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",

  // Binary/asset files
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",
  "*.wasm",

  // Generated files
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",

  // IDE/editor
  ".idea/**",
  ".vscode/**",
  ".claude/**",

  // Misc
  "LICENSE",
  ".gitignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log",
];

// ─── Interface ──────────────────────────────────────────────────────────────

export interface IgnoreFilter {
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

// ─── Pattern Matching ───────────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports:
 *   - ** (match any path segments)
 *   - * (match anything except /)
 *   - ? (single char)
 *   - negation with ! prefix
 */
function globToRegExp(pattern: string): RegExp {
  let positive = true;
  let p = pattern;

  // Handle negation
  if (p.startsWith("!")) {
    positive = false;
    p = p.slice(1);
  }

  // Normalize separators
  p = p.replace(/\\/g, "/");

  // Remove leading ./
  if (p.startsWith("./")) {
    p = p.slice(2);
  }

  // Build regex
  let regex = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // ** — match any path segments
        if (p[i + 2] === "/") {
          regex += "(?:.+/)?";
          i += 3;
        } else {
          regex += ".*";
          i += 2;
        }
      } else {
        // * — match anything except /
        regex += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i += 1;
    } else if (".+^${}()|[]".includes(ch)) {
      regex += `\\${ch}`;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }

  return new RegExp(`^(?:.+/)?${regex}$`, "i");
}

interface PatternRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

/**
 * Parse a list of glob patterns into matching rules.
 */
function parsePatterns(patterns: string[]): PatternRule[] {
  const rules: PatternRule[] = [];

  for (let raw of patterns) {
    // Strip comments and empty lines
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    let pattern = negated ? line.slice(1) : line;

    // Remove leading /
    if (pattern.startsWith("/")) {
      pattern = pattern.slice(1);
    }

    // Normalize separators
    pattern = pattern.replace(/\\/g, "/");

    const directoryOnly = pattern.endsWith("/");

    rules.push({
      regex: globToRegExp(directoryOnly ? pattern.slice(0, -1) : pattern),
      negated,
      directoryOnly,
    });
  }

  return rules;
}

// ─── Filter Creation ────────────────────────────────────────────────────────

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .understandignore files.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .understand-anything/.understandignore (if exists)
 * 3. .understandignore at project root (if exists)
 */
export function createIgnoreFilter(projectRoot?: string): IgnoreFilter {
  const allPatterns = [...DEFAULT_IGNORE_PATTERNS];

  if (projectRoot) {
    // Layer 2: .understand-anything/.understandignore
    const projectIgnorePath = join(projectRoot, ".understand-anything", ".understandignore");
    if (existsSync(projectIgnorePath)) {
      try {
        const content = readFileSync(projectIgnorePath, "utf-8");
        allPatterns.push(...content.split("\n"));
      } catch {
        // Skip unreadable files
      }
    }

    // Layer 3: .understandignore at project root
    const rootIgnorePath = join(projectRoot, ".understandignore");
    if (existsSync(rootIgnorePath)) {
      try {
        const content = readFileSync(rootIgnorePath, "utf-8");
        allPatterns.push(...content.split("\n"));
      } catch {
        // Skip unreadable files
      }
    }
  }

  const rules = parsePatterns(allPatterns);

  return {
    isIgnored(relativePath: string): boolean {
      // Normalize path separators
      const normalized = relativePath.replace(/\\/g, "/");

      let ignored = false;
      for (const rule of rules) {
        const matches = rule.regex.test(normalized) || rule.regex.test(normalized.replace(/^.*\//, ""));
        if (matches) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    },
  };
}
