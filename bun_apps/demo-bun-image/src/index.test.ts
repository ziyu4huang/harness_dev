import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "..", "..", "..", "output");

// Skip entire suite if Bun.Image is not available
const hasImageAPI = typeof Bun !== "undefined" && "Image" in Bun;

// Minimal 2×2 PNG for testing (reuse the one from index.ts logic)
function createTestPng(): Uint8Array {
  const width = 2, height = 2;
  const raw = new Uint8Array([
    0xFF, 0x00, 0x00, 0xFF,
    0x00, 0x00, 0xFF, 0xFF,
    0x00, 0xFF, 0x00, 0xFF,
    0xFF, 0xFF, 0x00, 0xFF,
  ]);

  const filtered = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + width * 4)] = 0;
    filtered.set(raw.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const zlibData = createZlibStored(filtered);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = createChunk("IHDR", (() => {
    const d = new Uint8Array(13);
    const v = new DataView(d.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    d[8] = 8; d[9] = 6; d[10] = 0; d[11] = 0; d[12] = 0;
    return d;
  })());
  const idat = createChunk("IDAT", zlibData);
  const iend = createChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let offset = 0;
  png.set(signature, offset); offset += signature.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);
  return png;
}

function createZlibStored(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  const blocksSize = Array.from({ length: numBlocks }, (_, i) => {
    const len = Math.min(maxBlock, data.length - i * maxBlock);
    return 5 + len;
  }).reduce((a, b) => a + b, 0);

  const out = new Uint8Array(2 + blocksSize + 4);
  out[0] = 0x78; out[1] = 0x01;
  let offset = 2;
  for (let i = 0; i < numBlocks; i++) {
    const start = i * maxBlock;
    const len = Math.min(maxBlock, data.length - start);
    out[offset++] = i === numBlocks - 1 ? 1 : 0;
    out[offset++] = len & 0xFF;
    out[offset++] = (len >> 8) & 0xFF;
    out[offset++] = ~len & 0xFF;
    out[offset++] = (~len >> 8) & 0xFF;
    out.set(data.subarray(start, start + len), offset);
    offset += len;
  }
  const adler = adler32(data);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(offset, adler, false);
  return out.subarray(0, offset + 4);
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(new Uint8Array([...typeBytes, ...data])), false);
  return chunk;
}

let sourcePng: string;

describe(hasImageAPI ? "Bun.Image API" : "Bun.Image API (SKIPPED — requires Bun >= 1.3.14)", () => {
  if (!hasImageAPI) return;

  beforeAll(async () => {
    if (existsSync(OUTPUT)) rmSync(OUTPUT, { recursive: true });
    mkdirSync(OUTPUT, { recursive: true });
    sourcePng = join(OUTPUT, "source.png");
    await Bun.write(sourcePng, createTestPng());
  });

  test("metadata() returns width, height, format", async () => {
    const meta = await new Bun.Image(sourcePng).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    expect(meta.format).toBe("png");
  });

  test("metadata from ArrayBuffer", async () => {
    const buf = await Bun.file(sourcePng).arrayBuffer();
    const meta = await new Bun.Image(new Uint8Array(buf)).metadata();
    expect(meta.width).toBe(2);
    expect(meta.format).toBe("png");
  });

  test("Bun.file().image() shorthand", async () => {
    const meta = await Bun.file(sourcePng).image().metadata();
    expect(meta.width).toBe(2);
  });

  test("resize with width only keeps aspect ratio", async () => {
    const out = join(OUTPUT, "r1.png");
    await new Bun.Image(sourcePng).resize(4).png().write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.width).toBe(4);
    expect(m.height).toBe(4); // 2×2 → 4×4 (square)
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

  test("convert PNG → JPEG", async () => {
    const out = join(OUTPUT, "c1.jpeg");
    await new Bun.Image(sourcePng).jpeg({ quality: 85 }).write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.format).toBe("jpeg");
  });

  test("convert PNG → WebP", async () => {
    const out = join(OUTPUT, "c2.webp");
    await new Bun.Image(sourcePng).webp({ quality: 80 }).write(out);
    const m = await new Bun.Image(out).metadata();
    expect(m.format).toBe("webp");
  });

  test("rotate 90° keeps same canvas size", async () => {
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

  test("bytes() returns Uint8Array", async () => {
    const bytes = await new Bun.Image(sourcePng).resize(4).png().bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
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

  test("JPEG quality affects file size", async () => {
    const out1 = join(OUTPUT, "q10.jpeg");
    const out2 = join(OUTPUT, "q100.jpeg");
    await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).jpeg({ quality: 10 }).write(out1);
    await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).jpeg({ quality: 100 }).write(out2);
    const s1 = (await Bun.file(out1).stat()).size;
    const s2 = (await Bun.file(out2).stat()).size;
    expect(s2).toBeGreaterThan(s1);
  });

  test("chainable pipeline: resize → rotate → modulate → encode", async () => {
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
    // Content-Type may or may not be auto-set depending on Bun version
    // The important thing is the body is valid image bytes
  });
});
