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

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
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

// ─── Starter Ignore File Generator ────────────────────────────────────────────
//
// Port of UA's ignore-generator.ts. Scans a project directory for common
// patterns and reads .gitignore to produce a commented-out starter
// .understandignore that the user can customize.

const IGNORE_FILE_HEADER = `# .understandignore — patterns for files/dirs to exclude from analysis
# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)
# Lines below are suggestions — uncomment to activate.
# Use ! prefix to force-include something excluded by defaults.
#
# Built-in defaults (always excluded unless negated):
#   node_modules/, .git/, dist/, build/, obj/, *.lock, *.min.js, etc.
#
`;

const DETECTABLE_DIRS = [
  { dir: "__tests__", pattern: "__tests__/" },
  { dir: "test", pattern: "test/" },
  { dir: "tests", pattern: "tests/" },
  { dir: "fixtures", pattern: "fixtures/" },
  { dir: "testdata", pattern: "testdata/" },
  { dir: "docs", pattern: "docs/" },
  { dir: "examples", pattern: "examples/" },
  { dir: "scripts", pattern: "scripts/" },
  { dir: "migrations", pattern: "migrations/" },
  { dir: ".storybook", pattern: ".storybook/" },
] as const;

const GENERIC_SUGGESTIONS = [
  "*.test.*",
  "*.spec.*",
  "*.snap",
] as const;

/**
 * Parse a .gitignore file and return active patterns (no comments, no blanks).
 */
function parseGitignorePatterns(gitignorePath: string): string[] {
  if (!existsSync(gitignorePath)) return [];
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Check whether a pattern is already covered by the hardcoded defaults.
 * Normalizes trailing slashes for comparison.
 */
function isCoveredByDefaults(pattern: string): boolean {
  // Normalize: strip trailing /, leading ./, trailing /**, and all * wildcards
  const normalizePattern = (p: string) => p.replace(/\/+$/, "").replace(/^\.\//, "").replace(/\/\*\*$/, "").replace(/\*/g, "");
  const normalized = normalizePattern(pattern);
  return DEFAULT_IGNORE_PATTERNS.some(d => {
    const normalizedDefault = normalizePattern(d);
    // Exact match, or one is a prefix of the other (e.g. "dist" matches "dist")
    return normalizedDefault === normalized
      || (normalized.length > 0 && normalizedDefault.startsWith(normalized))
      || (normalizedDefault.length > 0 && normalized.startsWith(normalizedDefault));
  });
}

/**
 * Generates a starter .understandignore file content by scanning the project
 * for common directories and reading .gitignore patterns.
 * All suggestions are commented out — this is a one-time generation aid.
 *
 * @param projectRoot Absolute path to the project root directory.
 * @returns The content of a starter .understandignore file (all lines commented out).
 */
export function generateStarterIgnoreFile(projectRoot: string): string {
  const sections: string[] = [IGNORE_FILE_HEADER];

  // Section 1: patterns from .gitignore not already in defaults
  const gitignorePath = join(projectRoot, ".gitignore");
  const gitignorePatterns = parseGitignorePatterns(gitignorePath).filter(
    p => !isCoveredByDefaults(p),
  );

  if (gitignorePatterns.length > 0) {
    sections.push("# --- From .gitignore (uncomment to exclude) ---\n");
    for (const pattern of gitignorePatterns) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Section 2: detected directories
  const detected: string[] = [];
  for (const { dir, pattern } of DETECTABLE_DIRS) {
    const fullPath = join(projectRoot, dir);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          detected.push(pattern);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  if (detected.length > 0) {
    sections.push("# --- Detected directories (uncomment to exclude) ---\n");
    for (const pattern of detected) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Section 3: generic test file patterns
  sections.push("# --- Test file patterns (uncomment to exclude) ---\n");
  for (const pattern of GENERIC_SUGGESTIONS) {
    sections.push(`# ${pattern}`);
  }
  sections.push("");

  return sections.join("\n");
}
