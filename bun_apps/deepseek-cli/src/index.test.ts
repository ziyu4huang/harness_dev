import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import { mkdir, rm, writeFile } from "fs/promises";

const SRC_DIR = import.meta.dir; // e.g. .../deepseek-cli/src
const CLI_SCRIPT = path.resolve(SRC_DIR, "index.ts");
const CLI = ["bun", CLI_SCRIPT];
/** Always pipe all three stdio channels so we can read stderr on Windows. */
const STDIO = { stdio: ["pipe", "pipe", "pipe"] as const };

/** Collect both stdout and stderr from a spawned process. */
async function readOutput(
  proc: Bun.Subprocess,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// ─── Tool executor imports ─────────────────────────────────────────────────

import {
  mathEval,
  normalizePath,
  toolExecutors,
  CONFIG,
} from "./index.ts";

// ─── Temp directory helpers ────────────────────────────────────────────────

const TEMP_ROOT = path.join(import.meta.dir, "__test_tmp__");

beforeEach(async () => {
  await mkdir(TEMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

// ─── CLI flag tests ────────────────────────────────────────────────────────

describe("deepseek-cli", () => {
  it("--help prints usage info and exits 0", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--model");
    expect(stdout).toContain("DEEPSEEK_API_KEY");
    expect(stdout).toContain("DEEPSEEK_BASE_URL");
    expect(exitCode).toBe(0);
  });

  it("-h prints usage info and exits 0", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "-h"], STDIO),
    );
    expect(stdout).toContain("Usage:");
    expect(exitCode).toBe(0);
  });

  it("unknown model exits 1 with error message", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--model", "bogus", "hello"], STDIO),
    );
    expect(stderr).toContain("unknown model");
    expect(stderr).toContain("bogus");
    expect(exitCode).toBe(1);
  });

  it("no prompt prints usage and exits 1", async () => {
    const { stdout, stderr, exitCode } = await readOutput(
      Bun.spawn(CLI, STDIO),
    );
    // printUsage() writes to stdout; check both streams
    expect(stdout + stderr).toContain("Usage:");
    expect(exitCode).toBe(1);
  });

  it("exits 1 when DEEPSEEK_API_KEY is not set", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });

  it("--max-steps requires a value", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--max-steps", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--max-steps requires");
    expect(exitCode).toBe(1);
  });

  it("--max-steps rejects non-positive values", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--max-steps", "0", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("positive integer");
    expect(exitCode).toBe(1);
  });

  it("--max-steps accepts valid values", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--max-steps", "25", "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    // Will fail on missing API key, but NOT on --max-steps parsing
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });

  it("--version prints version and exits 0", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--version"], STDIO),
    );
    expect(stdout).toMatch(/deepseek-cli v\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  it("-v prints version and exits 0", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "-v"], STDIO),
    );
    expect(stdout).toMatch(/deepseek-cli v\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });
});

// ─── mathEval tests ────────────────────────────────────────────────────────

describe("mathEval", () => {
  it("evaluates simple addition", () => {
    expect(mathEval("2 + 2")).toBe("4");
  });

  it("evaluates multiplication with precedence", () => {
    expect(mathEval("2 + 3 * 4")).toBe("14");
  });

  it("evaluates with parentheses", () => {
    expect(mathEval("(2 + 3) * 4")).toBe("20");
  });

  it("evaluates Math.sqrt", () => {
    expect(mathEval("Math.sqrt(16)")).toBe("4");
  });

  it("throws on invalid expression", () => {
    expect(() => mathEval("hello world")).toThrow();
  });
});

// ─── normalizePath tests ───────────────────────────────────────────────────

describe("normalizePath", () => {
  it("returns path unchanged on non-Windows or non-tmp paths", () => {
    // On Windows, non-tmp paths pass through unchanged
    expect(normalizePath("/home/user/file.txt")).toBe("/home/user/file.txt");
    expect(normalizePath("relative/path.txt")).toBe("relative/path.txt");
  });
});

// ─── calculator tool tests ─────────────────────────────────────────────────

describe("calculator tool", () => {
  it("evaluates a basic expression", async () => {
    const result = await toolExecutors.calculator({ expression: "2+2" });
    expect(result).toBe("4");
  });

  it("evaluates a complex expression", async () => {
    const result = await toolExecutors.calculator({ expression: "Math.PI * 2" });
    expect(Number(result)).toBeCloseTo(Math.PI * 2, 10);
  });

  it("returns error string for invalid expression", async () => {
    const result = await toolExecutors.calculator({ expression: "not valid!!" });
    expect(result).toContain("Error");
  });
});

// ─── read_file tool tests ──────────────────────────────────────────────────

describe("read_file tool", () => {
  it("reads an existing file", async () => {
    const filePath = path.join(TEMP_ROOT, "read_test.txt");
    await writeFile(filePath, "hello world");
    const result = await toolExecutors.read_file({ path: filePath });
    expect(result).toBe("hello world");
  });

  it("returns error for non-existent file", async () => {
    const result = await toolExecutors.read_file({ path: path.join(TEMP_ROOT, "nope.txt") });
    expect(result).toContain("Error");
    expect(result).toContain("file not found");
  });

  it("reads files matching a glob pattern", async () => {
    await writeFile(path.join(TEMP_ROOT, "a.txt"), "aaa");
    await writeFile(path.join(TEMP_ROOT, "b.txt"), "bbb");
    const result = await toolExecutors.read_file({ path: path.join(TEMP_ROOT, "*.txt") });
    expect(result).toContain("aaa");
    expect(result).toContain("bbb");
  });
});

// ─── write_file tool tests ─────────────────────────────────────────────────

describe("write_file tool", () => {
  it("writes content to a file", async () => {
    const filePath = path.join(TEMP_ROOT, "write_test.txt");
    const result = await toolExecutors.write_file({ path: filePath, content: "test content" });
    expect(result).toContain("Successfully wrote");
    const written = await Bun.file(filePath).text();
    expect(written).toBe("test content");
  });

  it("creates parent directories if they do not exist", async () => {
    const filePath = path.join(TEMP_ROOT, "nested", "deep", "file.txt");
    const result = await toolExecutors.write_file({ path: filePath, content: "nested content" });
    expect(result).toContain("Successfully wrote");
    const written = await Bun.file(filePath).text();
    expect(written).toBe("nested content");
  });

  it("overwrites an existing file", async () => {
    const filePath = path.join(TEMP_ROOT, "overwrite.txt");
    await writeFile(filePath, "old");
    await toolExecutors.write_file({ path: filePath, content: "new" });
    const written = await Bun.file(filePath).text();
    expect(written).toBe("new");
  });
});

// ─── web_fetch tool tests ──────────────────────────────────────────────────

describe("web_fetch tool", () => {
  it("returns error for invalid URL", async () => {
    const result = await toolExecutors.web_fetch({ url: "not-a-url" });
    expect(result).toContain("Error");
  });

  it("returns error for HTTP error status codes", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("not found", { status: 404, statusText: "Not Found" });
      },
    });
    try {
      const result = await toolExecutors.web_fetch({ url: `http://localhost:${server.port}/missing` });
      expect(result).toContain("Error");
      expect(result).toContain("404");
    } finally {
      server.stop();
    }
  });

  it("returns error for HTTP 500", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("internal error", { status: 500, statusText: "Internal Server Error" });
      },
    });
    try {
      const result = await toolExecutors.web_fetch({ url: `http://localhost:${server.port}/fail` });
      expect(result).toContain("Error");
      expect(result).toContain("500");
    } finally {
      server.stop();
    }
  });

  it("truncates responses exceeding WEB_FETCH_CHAR_LIMIT", async () => {
    const longBody = "A".repeat(CONFIG.WEB_FETCH_CHAR_LIMIT + 500);
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(longBody, { status: 200 });
      },
    });
    try {
      const result = await toolExecutors.web_fetch({ url: `http://localhost:${server.port}/big` });
      expect(result).toContain("truncated");
      expect(result.length).toBeLessThan(longBody.length);
    } finally {
      server.stop();
    }
  });

  it("returns full response under char limit", async () => {
    const shortBody = "Hello, world!";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(shortBody, { status: 200 });
      },
    });
    try {
      const result = await toolExecutors.web_fetch({ url: `http://localhost:${server.port}/small` });
      expect(result).toBe(shortBody);
    } finally {
      server.stop();
    }
  });

  it("returns error on timeout", async () => {
    // Create a server that never responds, forcing a timeout.
    // We use a short timeout by temporarily monkey-patching CONFIG.
    const originalTimeout = CONFIG.WEB_FETCH_TIMEOUT_MS;
    (CONFIG as { WEB_FETCH_TIMEOUT_MS: number }).WEB_FETCH_TIMEOUT_MS = 100;
    const server = Bun.serve({
      port: 0,
      async fetch() {
        // Delay much longer than the timeout
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return new Response("too late", { status: 200 });
      },
    });
    try {
      const result = await toolExecutors.web_fetch({ url: `http://localhost:${server.port}/slow` });
      expect(result).toContain("Error");
    } finally {
      server.stop();
      (CONFIG as { WEB_FETCH_TIMEOUT_MS: number }).WEB_FETCH_TIMEOUT_MS = originalTimeout;
    }
  });
});

// ─── list_directory tool tests ─────────────────────────────────────────────

describe("list_directory tool", () => {
  it("lists files in a directory", async () => {
    await writeFile(path.join(TEMP_ROOT, "x.txt"), "x");
    await writeFile(path.join(TEMP_ROOT, "y.txt"), "y");
    const result = await toolExecutors.list_directory({ path: TEMP_ROOT });
    expect(result).toContain("x.txt");
    expect(result).toContain("y.txt");
  });

  it("lists subdirectories with depth=1", async () => {
    await mkdir(path.join(TEMP_ROOT, "subdir"), { recursive: true });
    await writeFile(path.join(TEMP_ROOT, "subdir", "nested.txt"), "nested");
    const result = await toolExecutors.list_directory({ path: TEMP_ROOT, depth: 1 });
    expect(result).toContain("subdir/");
    expect(result).toContain("nested.txt");
  });

  it("returns empty directory message for empty dir", async () => {
    const emptyDir = path.join(TEMP_ROOT, "empty");
    await mkdir(emptyDir, { recursive: true });
    const result = await toolExecutors.list_directory({ path: emptyDir });
    expect(result).toContain("empty directory");
  });
});

// ─── grep_search tool tests ────────────────────────────────────────────────

describe("grep_search tool", () => {
  it("finds matching lines in files", async () => {
    await writeFile(path.join(TEMP_ROOT, "search.txt"), "hello world\nfoo bar\nhello again");
    const result = await toolExecutors.grep_search({
      pattern: "hello",
      glob: path.join(TEMP_ROOT, "*.txt"),
    });
    expect(result).toContain("hello world");
    expect(result).toContain("hello again");
  });

  it("returns no matches message when pattern not found", async () => {
    await writeFile(path.join(TEMP_ROOT, "search2.txt"), "no match here");
    const result = await toolExecutors.grep_search({
      pattern: "ZZZ_NOT_FOUND",
      glob: path.join(TEMP_ROOT, "*.txt"),
    });
    expect(result).toContain("no matches found");
  });

  it("respects maxResults parameter", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`);
    await writeFile(path.join(TEMP_ROOT, "many.txt"), lines.join("\n"));
    const result = await toolExecutors.grep_search({
      pattern: "match line",
      glob: path.join(TEMP_ROOT, "*.txt"),
      maxResults: 5,
    });
    // Should have 5 matches + truncation message
    const matchLines = result.split("\n").filter((l: string) => l.includes("match line"));
    expect(matchLines.length).toBe(5);
    expect(result).toContain("truncated");
  });
});
