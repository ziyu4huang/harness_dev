/**
 * Tests for the ignore module — pattern matching, filter creation, starter generator.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  DEFAULT_IGNORE_PATTERNS,
  createIgnoreFilter,
  generateStarterIgnoreFile,
} from "../ignore.js";

// ─── DEFAULT_IGNORE_PATTERNS ──────────────────────────────────────────────────

describe("DEFAULT_IGNORE_PATTERNS", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(DEFAULT_IGNORE_PATTERNS.length).toBeGreaterThan(10);
  });

  test("contains expected entries", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("node_modules/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("dist/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("build/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("*.lock");
    expect(DEFAULT_IGNORE_PATTERNS).toContain(".git/**");
  });
});

// ─── createIgnoreFilter ──────────────────────────────────────────────────────

describe("createIgnoreFilter", () => {
  test("without projectRoot returns filter that rejects node_modules paths", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored("node_modules/foo/bar.ts")).toBe(true);
  });

  test("rejects dist/ paths", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored("dist/bundle.js")).toBe(true);
  });

  test("rejects .git/ paths", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored(".git/config")).toBe(true);
  });

  test("rejects lock files", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored("bun.lock")).toBe(true);
    expect(filter.isIgnored("yarn.lock")).toBe(true);
  });

  test("accepts normal source files", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored("src/index.ts")).toBe(false);
    expect(filter.isIgnored("lib/utils.js")).toBe(false);
  });

  test("handles Windows-style paths", () => {
    const filter = createIgnoreFilter();
    expect(filter.isIgnored("node_modules\\foo\\bar.ts")).toBe(true);
  });

  test("negation pattern overrides exclusion", () => {
    const tmpDir = join(process.cwd(), "__test_ignore_tmp__");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, ".understandignore"), "!dist/important.js\n");
      const filter = createIgnoreFilter(tmpDir);
      // dist/ files are excluded by default, but negation overrides
      expect(filter.isIgnored("dist/important.js")).toBe(false);
      // Other dist/ files still excluded
      expect(filter.isIgnored("dist/other.js")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loads patterns from .understand-anything/.understandignore", () => {
    const tmpDir = join(process.cwd(), "__test_ignore_ua_tmp__");
    try {
      mkdirSync(join(tmpDir, ".understand-anything"), { recursive: true });
      writeFileSync(join(tmpDir, ".understand-anything", ".understandignore"), "custom-output/**\n");
      const filter = createIgnoreFilter(tmpDir);
      expect(filter.isIgnored("custom-output/foo.ts")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── generateStarterIgnoreFile ───────────────────────────────────────────────

describe("generateStarterIgnoreFile", () => {
  const tmpDir = join(process.cwd(), "__test_ignore_gen_tmp__");

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns a non-empty string with header", () => {
    mkdirSync(tmpDir, { recursive: true });
    const content = generateStarterIgnoreFile(tmpDir);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(50);
    expect(content).toContain(".understandignore");
  });

  test("all suggestion lines are commented out with #", () => {
    mkdirSync(tmpDir, { recursive: true });
    const content = generateStarterIgnoreFile(tmpDir);
    const lines = content.split("\n").filter(l => l.trim().length > 0 && !l.startsWith("#"));
    // Only blank or comment lines — no active patterns
    expect(lines.length).toBe(0);
  });

  test("includes test file patterns section", () => {
    mkdirSync(tmpDir, { recursive: true });
    const content = generateStarterIgnoreFile(tmpDir);
    expect(content).toContain("Test file patterns");
    expect(content).toContain("# *.test.*");
    expect(content).toContain("# *.spec.*");
  });

  test("detects existing directories", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    mkdirSync(join(tmpDir, "scripts"), { recursive: true });
    const content = generateStarterIgnoreFile(tmpDir);
    expect(content).toContain("# docs/");
    expect(content).toContain("# scripts/");
    expect(content).toContain("Detected directories");
  });

  test("includes gitignore patterns not covered by defaults", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), "coverage/\n*.log\ncustom-build/\n");
    const content = generateStarterIgnoreFile(tmpDir);
    // *.log is in defaults, so it should NOT appear as a suggestion
    // custom-build/ is NOT in defaults, so it SHOULD appear
    expect(content).toContain("# custom-build/");
    expect(content).toContain("From .gitignore");
  });

  test("skips gitignore patterns already in defaults", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), "*.lock\ndist/\nnode_modules/\n");
    const content = generateStarterIgnoreFile(tmpDir);
    // These are all in defaults — the section should not appear
    // Check that these are not double-listed as suggestions
    const gitignoreSection = content.split("From .gitignore")[1];
    if (gitignoreSection) {
      // If the section exists, it should NOT contain the default patterns
      expect(gitignoreSection).not.toContain("# *.lock");
      expect(gitignoreSection).not.toContain("# dist/");
    }
  });
});
