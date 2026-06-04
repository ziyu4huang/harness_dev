import { describe, it, expect } from "bun:test";
import path from "path";

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
});
