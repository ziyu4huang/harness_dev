#!/usr/bin/env bun

/**
 * demo-bun-image — demo and smoke-test for Bun's built-in Bun.Image API.
 *
 * Requires Bun >= 1.3.14 (when Bun.Image shipped as stable).
 *
 * Usage:
 *   bun start                  → run all demos
 *   bun start --demo metadata  → metadata only
 *   bun start --demo resize    → resize only
 *   bun start --demo convert   → format conversion only
 *   bun start --demo modulate  → brightness / saturation
 *   bun start --demo flip      → rotate / flip / flop
 *   bun start --demo encode    → JPEG / PNG / WebP encode options
 *   bun start --demo placeholder → blur placeholder (ThumbHash)
 *   bun start --demo base64    → base64 / data-URL output
 *   bun start --demo serve     → launch HTTP server with image endpoint
 *   bun start --demo clipboard → read image from clipboard
 *   bun start --demo all       → run all (default)
 *
 *   bun start --output ./out   → custom output directory
 *
 * All generated files are written to bun_apps/demo-bun-image/dist/ (or --output path).
 */

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, rmSync } from "node:fs";

// ── helpers ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureDist() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true });
  mkdirSync(DIST, { recursive: true });
}

function dist(...segments: string[]) {
  return join(DIST, ...segments);
}

/** Minimal 2×2 PNG generator (no deps) — creates a small red/blue gradient PNG. */
function createTestPng(): Uint8Array {
  // Build a valid 2×2 RGBA PNG manually
  const width = 2, height = 2;

  // Raw RGBA pixels: top-left red, top-right blue, bottom-left green, bottom-right yellow
  const raw = new Uint8Array([
    0xFF, 0x00, 0x00, 0xFF,  // red
    0x00, 0x00, 0xFF, 0xFF,  // blue
    0x00, 0xFF, 0x00, 0xFF,  // green
    0xFF, 0xFF, 0x00, 0xFF,  // yellow
  ]);

  // PNG uses filter byte 0 (None) per row
  const filtered = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + width * 4)] = 0; // filter byte
    filtered.set(raw.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  // Deflate with zlib (Bun has zlib built-in)
  const compressed = Bun.gzipSync(filtered); // gzip adds header; use deflateSync if available
  // Actually PNG needs raw deflate (zlib stream). Let's use a different approach:
  // Write an uncompressed (store-only) PNG to avoid zlib complexity.

  // Use the pako-free approach: just store with zlib stored blocks
  const zlibData = createZlibStored(filtered);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = createChunk("IHDR", (() => {
    const d = new Uint8Array(13);
    const v = new DataView(d.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    d[8] = 8;  // bit depth
    d[9] = 6;  // color type: RGBA
    d[10] = 0; // compression
    d[11] = 0; // filter
    d[12] = 0; // interlace
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

/** Create a zlib "stored" (uncompressed) stream for small data. */
function createZlibStored(data: Uint8Array): Uint8Array {
  // zlib header (CMF=0x78, FLG=0x01 for no-compression, level 0)
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  // Each stored block: 5 byte header + block data
  const blocksSize = Array.from({ length: numBlocks }, (_, i) => {
    const start = i * maxBlock;
    const len = Math.min(maxBlock, data.length - start);
    return 5 + len;
  }).reduce((a, b) => a + b, 0);

  const out = new Uint8Array(2 + blocksSize + 4); // 2 header + blocks + 4 adler32
  out[0] = 0x78; // CMF
  out[1] = 0x01; // FLG (check bits for CMF*256+FLG must be multiple of 31: 0x78*256+0x01=30721; 30721%31=0 ✓)

  let offset = 2;
  for (let i = 0; i < numBlocks; i++) {
    const start = i * maxBlock;
    const len = Math.min(maxBlock, data.length - start);
    const isLast = (i === numBlocks - 1) ? 1 : 0;
    out[offset++] = isLast; // BFINAL + BTYPE=00 (stored)
    out[offset++] = len & 0xFF;
    out[offset++] = (len >> 8) & 0xFF;
    out[offset++] = ~len & 0xFF;
    out[offset++] = (~len >> 8) & 0xFF;
    out.set(data.subarray(start, start + len), offset);
    offset += len;
  }

  // Adler-32 checksum
  const adler = adler32(data);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(offset, adler, false); // big-endian
  offset += 4;

  return out.subarray(0, offset);
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const dv = new DataView(chunk.buffer);

  // Length
  dv.setUint32(0, data.length, false);
  // Type
  chunk.set(typeBytes, 4);
  // Data
  chunk.set(data, 8);
  // CRC (type + data)
  const crc = crc32(new Uint8Array([...typeBytes, ...data]));
  dv.setUint32(8 + data.length, crc, false);

  return chunk;
}

/** CRC-32 lookup table */
const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const demo = typeof args.demo === "string" ? args.demo : "all";
const OUTPUT_FLAG = typeof args.output === "string" ? args.output : null;
const DIST = OUTPUT_FLAG
  ? resolve(OUTPUT_FLAG)
  : join(__dirname, "..", "dist");

// ── API availability check ───────────────────────────────────────────────────

function checkImageAPI(): boolean {
  if (typeof Bun !== "undefined" && "Image" in Bun) {
    return true;
  }
  console.error("❌ Bun.Image is not available.");
  console.error("   Requires Bun >= 1.3.14. Current Bun version:", Bun.version);
  console.error("   Run: bun upgrade");
  return false;
}

// ── demos ────────────────────────────────────────────────────────────────────

async function demoMetadata(sourcePng: string) {
  console.log("\n📷 Demo: Metadata");
  console.log("─".repeat(40));

  const img = new Bun.Image(sourcePng);
  const meta = await img.metadata();
  console.log("  metadata():", meta);
  console.log("  width:", img.width, " height:", img.height);

  // Also from buffer
  const buf = await Bun.file(sourcePng).arrayBuffer();
  const meta2 = await new Bun.Image(new Uint8Array(buf)).metadata();
  console.log("  from buffer:", meta2);

  // Also from Bun.file shorthand
  const meta3 = await Bun.file(sourcePng).image().metadata();
  console.log("  from Bun.file().image():", meta3);

  console.log("  ✅ metadata OK");
}

async function demoResize(sourcePng: string) {
  console.log("\n📐 Demo: Resize");
  console.log("─".repeat(40));

  // Resize with width only (keep aspect ratio)
  const out1 = dist("resized-4w.png");
  await new Bun.Image(sourcePng).resize(4).png().write(out1);
  const m1 = await new Bun.Image(out1).metadata();
  console.log("  resize(4):", m1.width, "x", m1.height);

  // Resize to exact dimensions (stretch)
  const out2 = dist("resized-8x6.png");
  await new Bun.Image(sourcePng).resize(8, 6).png().write(out2);
  const m2 = await new Bun.Image(out2).metadata();
  console.log("  resize(8, 6):", m2.width, "x", m2.height);

  // Resize with fit: "inside"
  const out3 = dist("resized-inside.png");
  await new Bun.Image(sourcePng).resize(8, 8, { fit: "inside" }).png().write(out3);
  const m3 = await new Bun.Image(out3).metadata();
  console.log("  resize(8, 8, {fit:'inside'}):", m3.width, "x", m3.height);

  // Resize with nearest filter (pixel art)
  const out4 = dist("resized-nearest.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).png().write(out4);
  const m4 = await new Bun.Image(out4).metadata();
  console.log("  resize(64, 64, {filter:'nearest'}):", m4.width, "x", m4.height);

  console.log("  ✅ resize OK");
}

async function demoConvert(sourcePng: string) {
  console.log("\n🔄 Demo: Format Conversion");
  console.log("─".repeat(40));

  // PNG → JPEG
  const jpeg = dist("converted.jpeg");
  await new Bun.Image(sourcePng).jpeg({ quality: 90 }).write(jpeg);
  const mJpeg = await new Bun.Image(jpeg).metadata();
  console.log("  PNG → JPEG:", mJpeg.format, mJpeg.width, "x", mJpeg.height);

  // PNG → WebP
  const webp = dist("converted.webp");
  await new Bun.Image(sourcePng).webp({ quality: 80 }).write(webp);
  const mWebp = await new Bun.Image(webp).metadata();
  console.log("  PNG → WebP:", mWebp.format, mWebp.width, "x", mWebp.height);

  // PNG → JPEG (progressive)
  const progressive = dist("progressive.jpeg");
  await new Bun.Image(sourcePng).jpeg({ quality: 85, progressive: true }).write(progressive);
  console.log("  PNG → progressive JPEG: written");

  // PNG → Indexed PNG
  const indexed = dist("indexed.png");
  await new Bun.Image(sourcePng).png({ palette: true, colors: 16, dither: true }).write(indexed);
  console.log("  PNG → indexed PNG: written");

  // Check file sizes
  const sizes = {
    "source.png": (await Bun.file(sourcePng).stat()).size,
    "jpeg": (await Bun.file(jpeg).stat()).size,
    "webp": (await Bun.file(webp).stat()).size,
    "progressive.jpeg": (await Bun.file(progressive).stat()).size,
    "indexed.png": (await Bun.file(indexed).stat()).size,
  };
  for (const [name, size] of Object.entries(sizes)) {
    console.log(`  ${name}: ${size} bytes`);
  }

  console.log("  ✅ conversion OK");
}

async function demoModulate(sourcePng: string) {
  console.log("\n🎨 Demo: Modulate (brightness / saturation)");
  console.log("─".repeat(40));

  // Brightness boost
  const bright = dist("modulate-bright.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ brightness: 1.5 }).png().write(bright);
  console.log("  brightness 1.5 → written");

  // Greyscale (saturation 0)
  const grey = dist("modulate-greyscale.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ saturation: 0 }).png().write(grey);
  console.log("  saturation 0 (greyscale) → written");

  // High saturation
  const vivid = dist("modulate-vivid.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ saturation: 2.0 }).png().write(vivid);
  console.log("  saturation 2.0 → written");

  console.log("  ✅ modulate OK");
}

async function demoFlip(sourcePng: string) {
  console.log("\n↔️  Demo: Rotate / Flip / Flop");
  console.log("─".repeat(40));

  const upscaled = new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" });

  // Rotate 90°
  await upscaled.rotate(90).png().write(dist("rotated-90.png"));
  const m90 = await new Bun.Image(dist("rotated-90.png")).metadata();
  console.log("  rotate(90):", m90.width, "x", m90.height);

  // Rotate 180°
  await upscaled.rotate(180).png().write(dist("rotated-180.png"));
  console.log("  rotate(180) → written");

  // Flip (vertical mirror)
  await upscaled.flip().png().write(dist("flipped.png"));
  console.log("  flip() → written");

  // Flop (horizontal mirror)
  await upscaled.flop().png().write(dist("flopped.png"));
  console.log("  flop() → written");

  // Chain: rotate + flip
  await upscaled.rotate(90).flip().png().write(dist("rotated-flipped.png"));
  console.log("  rotate(90).flip() → written");

  console.log("  ✅ flip OK");
}

async function demoEncode(sourcePng: string) {
  console.log("\n🔧 Demo: Encode Options");
  console.log("─".repeat(40));

  const upscaled = new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" });

  // JPEG at various quality levels
  for (const q of [10, 50, 80, 100]) {
    const path = dist(`jpeg-q${q}.jpeg`);
    await upscaled.jpeg({ quality: q }).write(path);
    const size = (await Bun.file(path).stat()).size;
    console.log(`  JPEG quality=${q}: ${size} bytes`);
  }

  // WebP lossy vs lossless
  const webpLossy = dist("webp-lossy.webp");
  await upscaled.webp({ quality: 50 }).write(webpLossy);
  console.log(`  WebP lossy q=50: ${(await Bun.file(webpLossy).stat()).size} bytes`);

  const webpLossless = dist("webp-lossless.webp");
  await upscaled.webp({ lossless: true }).write(webpLossless);
  console.log(`  WebP lossless: ${(await Bun.file(webpLossless).stat()).size} bytes`);

  // PNG compression levels
  for (const level of [0, 6, 9]) {
    const path = dist(`png-compress-${level}.png`);
    await upscaled.png({ compressionLevel: level }).write(path);
    const size = (await Bun.file(path).stat()).size;
    console.log(`  PNG compressionLevel=${level}: ${size} bytes`);
  }

  console.log("  ✅ encode OK");
}

async function demoPlaceholder(sourcePng: string) {
  console.log("\n🌫️  Demo: Placeholder (ThumbHash LQIP)");
  console.log("─".repeat(40));

  const placeholder = await new Bun.Image(sourcePng).placeholder();
  console.log("  placeholder data URL length:", placeholder.length);
  console.log("  placeholder starts with:", placeholder.substring(0, 50) + "...");
  console.log("  (use as <img src> for blur-up loading)");

  console.log("  ✅ placeholder OK");
}

async function demoBase64(sourcePng: string) {
  console.log("\n📝 Demo: Base64 / Data URL Output");
  console.log("─".repeat(40));

  const img = new Bun.Image(sourcePng).resize(8, 8).png();

  const b64 = await img.toBase64();
  console.log("  toBase64() length:", b64.length);
  console.log("  first 40 chars:", b64.substring(0, 40) + "...");

  const dataUrl = await new Bun.Image(sourcePng).resize(8, 8).png().dataurl();
  console.log("  dataurl():", dataUrl.substring(0, 60) + "...");
  console.log("  contains base64 marker:", dataUrl.includes(";base64,"));

  const bytes = await new Bun.Image(sourcePng).resize(8, 8).png().bytes();
  console.log("  bytes(): Uint8Array length =", bytes.length);

  const blob = await new Bun.Image(sourcePng).resize(8, 8).png().blob();
  console.log("  blob(): type =", blob.type, "size =", blob.size);

  console.log("  ✅ base64 OK");
}

async function demoServe(sourcePng: string) {
  console.log("\n🌐 Demo: Bun.serve Integration");
  console.log("─".repeat(40));

  const port = 3456;

  const server = Bun.serve({
    port,
    routes: {
      "/": () => new Response("Demo Bun.Image server — try /image, /image?w=128, /image?format=webp"),
      "/image": async (req) => {
        const url = new URL(req.url);
        const w = parseInt(url.searchParams.get("w") || "64", 10);
        const format = url.searchParams.get("format") || "jpeg";

        const pipeline = new Bun.Image(sourcePng)
          .resize(w, w, { fit: "inside" });

        const encoded = format === "webp"
          ? pipeline.webp({ quality: 80 })
          : format === "png"
            ? pipeline.png()
            : pipeline.jpeg({ quality: 85 });

        const blob = await encoded.blob();
        return new Response(blob);
      },
    },
  });

  console.log(`  Server listening on http://localhost:${port}`);
  console.log("  Routes:");
  console.log(`    GET /             → info page`);
  console.log(`    GET /image        → 64x64 JPEG`);
  console.log(`    GET /image?w=128  → 128x128 JPEG`);
  console.log(`    GET /image?format=webp   → WebP output`);
  console.log(`    GET /image?format=png    → PNG output`);

  // Auto-test the endpoint
  const resp = await fetch(`http://localhost:${port}/image?w=32`);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`\n  Fetched /image?w=32: ${resp.status} ${resp.headers.get("content-type")} ${buf.length} bytes`);

  server.stop(true);
  console.log("  Server stopped.");
  console.log("  ✅ serve OK");
}

async function demoClipboard() {
  console.log("\n📋 Demo: Clipboard Image");
  console.log("─".repeat(40));

  if (!("fromClipboard" in Bun.Image)) {
    console.log("  ⚠️  Bun.Image.fromClipboard() not available in this Bun version");
    return;
  }

  const img = Bun.Image.fromClipboard();
  if (img) {
    const meta = await img.metadata();
    console.log("  Clipboard image:", meta);
    await img.resize(256, 256, { fit: "inside" }).png().write(dist("clipboard.png"));
    console.log("  Saved to dist/clipboard.png");
  } else {
    console.log("  No image on clipboard (this is normal)");
  }

  console.log("  ✅ clipboard OK");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!checkImageAPI()) {
    process.exit(1);
  }

  console.log("Bun.Image API Demo");
  console.log("═".repeat(50));
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Demo: ${demo}`);
  console.log(`Output dir: ${DIST}`);

  ensureDist();

  // Create test source image
  const sourcePng = dist("source.png");
  await Bun.write(sourcePng, createTestPng());
  console.log(`Test image: ${sourcePng} (${(await Bun.file(sourcePng).stat()).size} bytes)`);

  const runAll = demo === "all";
  const run = (name: string, fn: () => Promise<void>) =>
    (runAll || demo === name) ? fn() : Promise.resolve();

  try {
    await run("metadata", () => demoMetadata(sourcePng));
    await run("resize", () => demoResize(sourcePng));
    await run("convert", () => demoConvert(sourcePng));
    await run("modulate", () => demoModulate(sourcePng));
    await run("flip", () => demoFlip(sourcePng));
    await run("encode", () => demoEncode(sourcePng));
    await run("placeholder", () => demoPlaceholder(sourcePng));
    await run("base64", () => demoBase64(sourcePng));
    await run("serve", () => demoServe(sourcePng));
    await run("clipboard", () => demoClipboard());

    console.log("\n" + "═".repeat(50));
    console.log("✅ All demos completed. Generated files in dist/:");
    const dir = Array.from(new Bun.Glob("*").scanSync(DIST)).sort();
    for (const f of dir) {
      const stat = await Bun.file(dist(f)).stat();
      console.log(`  ${f}  (${stat.size} bytes)`);
    }
  } catch (err: any) {
    console.error("\n❌ Demo failed:", err);
    if (err.code) console.error("   error code:", err.code);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
