/**
 * change-classifier.test.ts — Unit tests for the change classifier decision matrix.
 *
 * Tests classifyUpdate() for: SKIP, PARTIAL_UPDATE, ARCHITECTURE_UPDATE, FULL_UPDATE.
 */

import { describe, test, expect } from "bun:test";
import { classifyUpdate } from "../change-classifier.js";
import type { ChangeAnalysis } from "../fingerprint.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<ChangeAnalysis> = {}): ChangeAnalysis {
  return {
    fileChanges: [],
    newFiles: [],
    deletedFiles: [],
    structurallyChangedFiles: [],
    cosmeticOnlyFiles: [],
    unchangedFiles: [],
    ...overrides,
  };
}

// ─── SKIP decision ─────────────────────────────────────────────────────────────

describe("classifyUpdate — SKIP", () => {
  test("returns SKIP when no structural changes and no cosmetic changes", () => {
    const analysis = makeAnalysis();
    const result = classifyUpdate(analysis, 10);
    expect(result.action).toBe("SKIP");
    expect(result.filesToReanalyze).toEqual([]);
    expect(result.rerunArchitecture).toBe(false);
    expect(result.rerunTour).toBe(false);
  });

  test("returns SKIP when only cosmetic changes exist", () => {
    const analysis = makeAnalysis({ cosmeticOnlyFiles: ["a.ts", "b.ts"] });
    const result = classifyUpdate(analysis, 10);
    expect(result.action).toBe("SKIP");
    expect(result.reason).toContain("cosmetic-only");
  });

  test("returns SKIP with 0 structural changes", () => {
    const analysis = makeAnalysis({ unchangedFiles: ["x.ts"] });
    const result = classifyUpdate(analysis, 100);
    expect(result.action).toBe("SKIP");
  });
});

// ─── FULL_UPDATE decision ──────────────────────────────────────────────────────

describe("classifyUpdate — FULL_UPDATE", () => {
  test("returns FULL_UPDATE when >30 files changed structurally", () => {
    const files = Array.from({ length: 31 }, (_, i) => `file${i}.ts`);
    const analysis = makeAnalysis({ structurallyChangedFiles: files });
    const result = classifyUpdate(analysis, 100);
    expect(result.action).toBe("FULL_UPDATE");
    expect(result.rerunArchitecture).toBe(true);
    expect(result.rerunTour).toBe(true);
    expect(result.reason).toContain(">30");
  });

  test("returns FULL_UPDATE when >50% of total files changed", () => {
    const files = Array.from({ length: 6 }, (_, i) => `file${i}.ts`);
    const analysis = makeAnalysis({ structurallyChangedFiles: files });
    // 6 structural changes out of 10 total => 60% > 50%
    const result = classifyUpdate(analysis, 10);
    expect(result.action).toBe("FULL_UPDATE");
    expect(result.reason).toContain("50%");
  });

  test("does NOT return FULL_UPDATE for 30 or fewer files", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const analysis = makeAnalysis({ structurallyChangedFiles: files });
    const result = classifyUpdate(analysis, 100);
    expect(result.action).not.toBe("FULL_UPDATE");
  });
});

// ─── ARCHITECTURE_UPDATE decision ──────────────────────────────────────────────

describe("classifyUpdate — ARCHITECTURE_UPDATE", () => {
  test("returns ARCHITECTURE_UPDATE when directory structure changes (new directory)", () => {
    const analysis = makeAnalysis({
      newFiles: ["newdir/file.ts"],
    });
    const allKnownFiles = ["src/a.ts", "src/b.ts"];
    const result = classifyUpdate(analysis, 100, allKnownFiles);
    expect(result.action).toBe("ARCHITECTURE_UPDATE");
    expect(result.rerunArchitecture).toBe(true);
  });

  test("returns ARCHITECTURE_UPDATE when >10 structural files", () => {
    const files = Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`);
    const analysis = makeAnalysis({ structurallyChangedFiles: files });
    const result = classifyUpdate(analysis, 100, ["src/a.ts"]);
    expect(result.action).toBe("ARCHITECTURE_UPDATE");
    expect(result.reason).toContain("11");
  });

  test("does NOT return ARCHITECTURE_UPDATE for <=10 structural files in same dir", () => {
    const files = Array.from({ length: 5 }, (_, i) => `src/file${i}.ts`);
    const analysis = makeAnalysis({ structurallyChangedFiles: files });
    const result = classifyUpdate(analysis, 100, ["src/a.ts"]);
    expect(result.action).toBe("PARTIAL_UPDATE");
  });
});

// ─── PARTIAL_UPDATE decision ───────────────────────────────────────────────────

describe("classifyUpdate — PARTIAL_UPDATE", () => {
  test("returns PARTIAL_UPDATE for small number of structural changes", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/a.ts", "src/b.ts"],
    });
    const result = classifyUpdate(analysis, 100, ["src/a.ts"]);
    expect(result.action).toBe("PARTIAL_UPDATE");
    expect(result.filesToReanalyze).toContain("src/a.ts");
    expect(result.filesToReanalyze).toContain("src/b.ts");
    expect(result.rerunArchitecture).toBe(false);
    expect(result.rerunTour).toBe(false);
  });

  test("includes new files in filesToReanalyze", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/a.ts"],
      newFiles: ["src/new.ts"],
    });
    const result = classifyUpdate(analysis, 100, ["src/a.ts"]);
    expect(result.action).toBe("PARTIAL_UPDATE");
    expect(result.filesToReanalyze).toContain("src/a.ts");
    expect(result.filesToReanalyze).toContain("src/new.ts");
  });

  test("reason summarizes the changes", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["a.ts"],
      newFiles: ["b.ts"],
    });
    const result = classifyUpdate(analysis, 100);
    expect(result.reason).toContain("structural");
    expect(result.reason).toContain("1 new");
    expect(result.reason).toContain("1 modified");
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe("classifyUpdate — edge cases", () => {
  test("handles empty allKnownFiles array", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["a.ts"],
    });
    const result = classifyUpdate(analysis, 100, []);
    expect(result.action).toBe("PARTIAL_UPDATE");
  });

  test("counts new + deleted + structural together for thresholds", () => {
    // 5 new + 5 deleted + 1 structural = 11 total => ARCHITECTURE_UPDATE
    const analysis = makeAnalysis({
      newFiles: ["n1.ts", "n2.ts", "n3.ts", "n4.ts", "n5.ts"],
      deletedFiles: ["d1.ts", "d2.ts", "d3.ts", "d4.ts", "d5.ts"],
      structurallyChangedFiles: ["s1.ts"],
    });
    const result = classifyUpdate(analysis, 100, ["d1.ts"]);
    expect(result.action).toBe("ARCHITECTURE_UPDATE");
  });
});
