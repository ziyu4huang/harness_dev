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
  retryFetch,
  listModels,
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

  it("--timeout requires a value", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--timeout", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--timeout requires");
    expect(exitCode).toBe(1);
  });

  it("--timeout rejects non-positive values", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--timeout", "0", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("positive integer");
    expect(exitCode).toBe(1);
  });

  it("--timeout accepts valid values", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--timeout", "120000", "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    // Will fail on missing API key, but NOT on --timeout parsing
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

  it("--system-prompt requires a value", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--system-prompt", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--system-prompt requires");
    expect(exitCode).toBe(1);
  });

  it("--system-prompt accepts a value and proceeds", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--system-prompt", "You are a code reviewer", "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    // Will fail on missing API key, but NOT on --system-prompt parsing
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });

  it("--system-prompt appears in usage output", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("--system-prompt");
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

  it("blocks while loop", () => {
    expect(() => mathEval("while(true){}")).toThrow(/Blocked pattern/);
  });

  it("blocks for loop", () => {
    expect(() => mathEval("for(;;){}")).toThrow(/Blocked pattern/);
  });

  it("blocks function keyword", () => {
    expect(() => mathEval("function x(){return 1}")).toThrow(/Blocked pattern/);
  });

  it("blocks arrow function", () => {
    expect(() => mathEval("(()=>1)()")).toThrow(/Blocked pattern/);
  });

  it("blocks process access", () => {
    expect(() => mathEval("process.exit(1)")).toThrow(/Blocked pattern/);
  });

  it("blocks require call", () => {
    expect(() => mathEval("require('fs')")).toThrow(/Blocked pattern/);
  });

  it("blocks eval call", () => {
    expect(() => mathEval("eval('1+1')")).toThrow(/Blocked pattern/);
  });

  it("blocks constructor access", () => {
    expect(() => mathEval("constructor")).toThrow(/Blocked pattern/);
  });

  it("still allows Math methods", () => {
    expect(mathEval("Math.PI * 2")).toBe(String(Math.PI * 2));
    expect(mathEval("Math.abs(-5)")).toBe("5");
  });
});

// ─── normalizePath tests ───────────────────────────────────────────────────

describe("normalizePath", () => {
  it("returns relative paths unchanged", () => {
    expect(normalizePath("relative/path.txt")).toBe("relative/path.txt");
    expect(normalizePath("/var/log/app.log")).toBe("/var/log/app.log");
    expect(normalizePath("C:\\Users\\test\\file.txt")).toBe("C:\\Users\\test\\file.txt");
  });

  it("maps ~/ to USERPROFILE on Windows", () => {
    if (process.platform !== "win32") return;
    const expected = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\Default";
    expect(normalizePath("~/docs")).toBe(expected + "docs");
  });

  it("maps /home/ prefix to USERPROFILE on Windows", () => {
    if (process.platform !== "win32") return;
    const expected = process.env.USERPROFILE || "C:\\Users\\Default";
    expect(normalizePath("/home/user/file.txt")).toBe(expected + "user/file.txt");
  });

  it("maps /home exactly to USERPROFILE on Windows", () => {
    if (process.platform !== "win32") return;
    const expected = process.env.USERPROFILE || "C:\\Users\\Default";
    expect(normalizePath("/home")).toBe(expected);
  });

  it("maps /tmp/ prefix to TEMP on Windows", () => {
    if (process.platform !== "win32") return;
    const expected = process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp";
    expect(normalizePath("/tmp/test.txt")).toBe(expected + "test.txt");
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

  it("returns specific error for invalid regex pattern", async () => {
    await writeFile(path.join(TEMP_ROOT, "regex_test.txt"), "some text");
    const result = await toolExecutors.grep_search({
      pattern: "[invalid",
      glob: path.join(TEMP_ROOT, "*.txt"),
    });
    expect(result).toContain("invalid regex pattern");
  });
});

// ─── retryFetch tests ──────────────────────────────────────────────────────

describe("retryFetch", () => {
  it("returns response immediately on 200", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        return new Response("ok", { status: 200 });
      },
    });
    try {
      const res = await retryFetch(`http://localhost:${server.port}/`, {}, 3);
      expect(res.status).toBe(200);
      expect(callCount).toBe(1);
    } finally {
      server.stop();
    }
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        if (callCount === 1) {
          return new Response("rate limited", { status: 429 });
        }
        return new Response("ok", { status: 200 });
      },
    });
    try {
      const res = await retryFetch(`http://localhost:${server.port}/`, {}, 3);
      expect(res.status).toBe(200);
      expect(callCount).toBe(2);
    } finally {
      server.stop();
    }
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        if (callCount < 3) {
          return new Response("server error", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    });
    try {
      const res = await retryFetch(`http://localhost:${server.port}/`, {}, 3);
      expect(res.status).toBe(200);
      expect(callCount).toBe(3);
    } finally {
      server.stop();
    }
  });

  it("does not retry on 4xx client errors (e.g. 400)", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        return new Response("bad request", { status: 400 });
      },
    });
    try {
      const res = await retryFetch(`http://localhost:${server.port}/`, {}, 3);
      expect(res.status).toBe(400);
      expect(callCount).toBe(1);
    } finally {
      server.stop();
    }
  });

  it("returns last error response after exhausting retries", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        return new Response("server error", { status: 503 });
      },
    });
    try {
      const res = await retryFetch(`http://localhost:${server.port}/`, {}, 3);
      expect(res.status).toBe(503);
      expect(callCount).toBe(3);
    } finally {
      server.stop();
    }
  });
});

// ─── listModels tests ──────────────────────────────────────────────────────────

describe("listModels", () => {
  it("fetches and returns model list from API", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({
          data: [
            { id: "deepseek-v4-pro", owned_by: "deepseek" },
            { id: "deepseek-v4-flash", owned_by: "deepseek" },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    try {
      const models = await listModels(`http://localhost:${server.port}`, "test-key");
      expect(models.length).toBe(2);
      expect(models[0].id).toBe("deepseek-v4-pro");
      expect(models[1].id).toBe("deepseek-v4-flash");
    } finally {
      server.stop();
    }
  });

  it("throws on API error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("unauthorized", { status: 401 });
      },
    });
    try {
      expect(listModels(`http://localhost:${server.port}`, "bad-key")).rejects.toThrow("API 401");
    } finally {
      server.stop();
    }
  });

  it("returns empty array when data is missing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    try {
      const models = await listModels(`http://localhost:${server.port}`, "test-key");
      expect(models).toEqual([]);
    } finally {
      server.stop();
    }
  });
});

// ─── --history flag tests ─────────────────────────────────────────────────────

describe("--history flag", () => {
  it("--history requires a value", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--history", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--history requires");
    expect(exitCode).toBe(1);
  });

  it("--history appears in usage output", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("--history");
    expect(exitCode).toBe(0);
  });

  it("loads valid history file and proceeds", async () => {
    const historyFile = path.join(TEMP_ROOT, "history.json");
    const history = [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ];
    await writeFile(historyFile, JSON.stringify(history));
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--history", historyFile, "--model", "pro", "follow-up"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    // Should fail on API key, not on history parsing
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });

  it("errors on invalid JSON history file", async () => {
    const historyFile = path.join(TEMP_ROOT, "bad-history.json");
    await writeFile(historyFile, "not valid json!!!");
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--history", historyFile, "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    expect(stderr).toContain("invalid JSON");
    expect(exitCode).toBe(1);
  });

  it("errors on history file that is not an array", async () => {
    const historyFile = path.join(TEMP_ROOT, "obj-history.json");
    await writeFile(historyFile, JSON.stringify({ role: "user", content: "hi" }));
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--history", historyFile, "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    expect(stderr).toContain("JSON array");
    expect(exitCode).toBe(1);
  });

  it("-f shorthand works the same as --history", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "-f", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--history requires");
    expect(exitCode).toBe(1);
  });
});

// ─── --output-history flag tests ──────────────────────────────────────────────

describe("--output-history flag", () => {
  it("--output-history requires a value", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--output-history", "--model", "pro", "hello"], STDIO),
    );
    expect(stderr).toContain("--output-history requires");
    expect(exitCode).toBe(1);
  });

  it("--output-history appears in usage output", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("--output-history");
    expect(exitCode).toBe(0);
  });
});

// ─── --json-output flag tests ──────────────────────────────────────────────────

describe("--json-output flag", () => {
  it("--json-output appears in usage output", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("--json-output");
    expect(exitCode).toBe(0);
  });

  it("--json-output does not require a value (is a boolean flag)", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--json-output", "--model", "pro", "hello"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    // Should fail on API key, not on --json-output parsing
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });
});

// ─── --list-models flag tests ──────────────────────────────────────────────────

describe("--list-models flag", () => {
  it("--list-models appears in usage output", async () => {
    const { stdout, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--help"], STDIO),
    );
    expect(stdout).toContain("--list-models");
    expect(exitCode).toBe(0);
  });

  it("--list-models requires DEEPSEEK_API_KEY", async () => {
    const { stderr, exitCode } = await readOutput(
      Bun.spawn([...CLI, "--list-models"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "" },
      }),
    );
    expect(stderr).toContain("DEEPSEEK_API_KEY");
    expect(exitCode).toBe(1);
  });

  it("--list-models with API key fetches models", async () => {
    // We test this through the listModels function directly (above).
    // The CLI integration test would require a live server, which is covered
    // by the listModels unit tests.
    const { exitCode } = await readOutput(
      Bun.spawn([...CLI, "--list-models"], {
        ...STDIO,
        env: { ...process.env, DEEPSEEK_API_KEY: "fake-key", DEEPSEEK_BASE_URL: "http://localhost:1" },
      }),
    );
    // Will fail because the fake server is not running, but should not fail on flag parsing
    expect(exitCode).toBe(1);
  });
});
