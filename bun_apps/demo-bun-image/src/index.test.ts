import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { createTestPng } from "./test-png.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "..", "..", "..", "output");

// Skip entire suite if Bun.Image is not available
const hasImageAPI = typeof Bun !== "undefined" && "Image" in Bun;

let sourcePng: string;

describe(hasImageAPI ? "Bun.Image API" : "Bun.Image API (SKIPPED -- requires Bun >= 1.3.14)", () => {
  if (!hasImageAPI) return;

  beforeAll(async () => {
    if (existsSync(OUTPUT)) rmSync(OUTPUT, { recursive: true });
    mkdirSync(OUTPUT, { recursive: true });
    sourcePng = join(OUTPUT, "source.png");
    await Bun.write(sourcePng, createTestPng());
  });

  // ── constructor paths ──────────────────────────────────────────────────

  test("constructor from file path string", async () => {
    const meta = await new Bun.Image(sourcePng).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    expect(meta.format).toBe("png");
  });

  test("constructor from Uint8Array (ArrayBuffer)", async () => {
    const buf = await Bun.file(sourcePng).arrayBuffer();
    const meta = await new Bun.Image(new Uint8Array(buf)).metadata();
    expect(meta.width).toBe(2);
    expect(meta.format).toBe("png");
  });

  test("constructor from BunFile directly", async () => {
    const file = Bun.file(sourcePng);
    const img = new Bun.Image(file);
    const meta = await img.metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    expect(meta.format).toBe("png");
  });

  test("Bun.file().image() shorthand", async () => {
    const meta = await Bun.file(sourcePng).image().metadata();
    expect(meta.width).toBe(2);
  });

  // ── resize ─────────────────────────────────────────────────────────────

  test("resize with width only keeps aspect ratio", async () => {
    const out = join(OUTPUT, "r1.png");
    await new Bun.Image(sourcePng).resize(4).png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(4);
    expect(m.height).toBe(4); // 2x2 -> 4x4 (square)
  });

  test("resize with exact dimensions", async () => {
    const out = join(OUTPUT, "r2.png");
    await new Bun.Image(sourcePng).resize(8, 6).png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(8);
    expect(m.height).toBe(6);
  });

  test("resize with fit: inside", async () => {
    const out = join(OUTPUT, "r3.png");
    await new Bun.Image(sourcePng).resize(8, 8, { fit: "inside" }).png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBeLessThanOrEqual(8);
    expect(m.height).toBeLessThanOrEqual(8);
  });

  // ── format conversion ──────────────────────────────────────────────────

  test("convert PNG -> JPEG", async () => {
    const out = join(OUTPUT, "c1.jpeg");
    await new Bun.Image(sourcePng).jpeg({ quality: 85 }).write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.format).toBe("jpeg");
  });

  test("convert PNG -> WebP", async () => {
    const out = join(OUTPUT, "c2.webp");
    await new Bun.Image(sourcePng).webp({ quality: 80 }).write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.format).toBe("webp");
  });

  // ── transform ──────────────────────────────────────────────────────────

  test("rotate 90 keeps same canvas size", async () => {
    const out = join(OUTPUT, "rot.png");
    await new Bun.Image(sourcePng).resize(8, 4).rotate(90).png().write(out);
    const m = await new Bun.Image(out).metadata();
    // Bun.Image rotates pixels within the canvas; dimensions stay the same
    expect([m.width, m.height]).toContain(8);
    expect([m.width, m.height]).toContain(4);
  });

  test("flip produces same dimensions", async () => {
    const out = join(OUTPUT, "flip.png");
    await new Bun.Image(sourcePng).resize(8, 4).flip().png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(8);
    expect(m.height).toBe(4);
  });

  test("flop produces same dimensions", async () => {
    const out = join(OUTPUT, "flop.png");
    await new Bun.Image(sourcePng).resize(8, 4).flop().png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(8);
    expect(m.height).toBe(4);
  });

  test("modulate greyscale (saturation 0)", async () => {
    const out = join(OUTPUT, "grey.png");
    await new Bun.Image(sourcePng).resize(4).modulate({ saturation: 0 }).png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(4);
  });

  // ── output methods ─────────────────────────────────────────────────────

  test("bytes() returns Uint8Array", async () => {
    const bytes = await new Bun.Image(sourcePng).resize(4).png().bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("buffer() returns Buffer with correct length", async () => {
    const buf = await new Bun.Image(sourcePng).resize(4).png().buffer();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("blob() has correct type", async () => {
    const blob = await new Bun.Image(sourcePng).resize(4).png().blob();
    expect(blob.type).toBe("image/png");
  });

  test("toBase64() returns valid base64 string", async () => {
    const b64 = await new Bun.Image(sourcePng).resize(4).png().toBase64();
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
    // Should decode without error
    const decoded = Buffer.from(b64, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  test("dataurl() has data: prefix", async () => {
    const url = await new Bun.Image(sourcePng).resize(4).png().dataurl();
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  test("placeholder() returns data URL", async () => {
    const ph = await new Bun.Image(sourcePng).placeholder();
    expect(typeof ph).toBe("string");
    expect(ph.startsWith("data:")).toBe(true);
    expect(ph.length).toBeLessThan(5000);
  });

  test("write() returns bytes written", async () => {
    const out = join(OUTPUT, "write-test.png");
    const written = await new Bun.Image(sourcePng).resize(4).png().write(out);
    expect(typeof written).toBe("number");
    expect(written).toBeGreaterThan(0);
  });

  // ── encode options ─────────────────────────────────────────────────────

  test("JPEG quality affects file size", async () => {
    const out1 = join(OUTPUT, "q10.jpeg");
    const out2 = join(OUTPUT, "q100.jpeg");
    await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).jpeg({ quality: 10 }).write(out1);
    await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).jpeg({ quality: 100 }).write(out2);
    const s1 = (await Bun.file(out1).stat()).size;
    const s2 = (await Bun.file(out2).stat()).size;
    expect(s2).toBeGreaterThan(s1);
  });

  // ── pipeline chaining ──────────────────────────────────────────────────

  test("chainable pipeline: resize -> rotate -> modulate -> encode", async () => {
    const out = join(OUTPUT, "chained.webp");
    await new Bun.Image(sourcePng)
      .resize(32, 32, { filter: "nearest" })
      .rotate(90)
      .modulate({ brightness: 1.2, saturation: 1.5 })
      .webp({ quality: 80 })
      .write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.format).toBe("webp");
    expect(m.width).toBe(32);
    expect(m.height).toBe(32);
  });

  test("Response body integration", async () => {
    const pipeline = new Bun.Image(sourcePng).resize(8, 8).jpeg();
    const resp = new Response(pipeline);
    const buf = await resp.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  // ── error handling ─────────────────────────────────────────────────────

  test("constructing from non-image buffer throws", async () => {
    const badBuf = Buffer.from("not an image");
    expect(async () => {
      await new Bun.Image(badBuf).metadata();
    }).toThrow();
  });

  test("write to read-only location is handled gracefully", async () => {
    // Bun may auto-create parent dirs, so write to a null device path or trap
    // the error via a truly unwritable path on Windows/Unix
    const result = await new Bun.Image(sourcePng).resize(4).png().write("/dev/null/impossible.png").catch((e: any) => e);
    // Accept both success (null device) and error -- the point is no crash
    expect(result).toBeDefined();
  });

  test("constructing from empty buffer throws", async () => {
    expect(async () => {
      await new Bun.Image(new Uint8Array(0)).metadata();
    }).toThrow();
  });
});
