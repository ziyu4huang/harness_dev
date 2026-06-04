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
 *   bun start --demo error     → error handling for invalid inputs
 *   bun start --demo all       → run all (default)
 *
 *   bun start --output ./out   → custom output directory
 *
 * All generated files are written to bun_apps/demo-bun-image/dist/ (or --output path).
 */

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { createTestPng } from "./test-png.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureDist(distDir: string) {
  if (existsSync(distDir)) rmSync(distDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });
}

function dist(distDir: string, ...segments: string[]) {
  return join(distDir, ...segments);
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

/** Resolve the output directory from CLI args or default. */
function resolveDist(outputFlag: string | null): string {
  return outputFlag ? resolve(outputFlag) : join(__dirname, "..", "dist");
}

// ── API availability check ───────────────────────────────────────────────────

function checkImageAPI(): boolean {
  if (typeof Bun !== "undefined" && "Image" in Bun) {
    return true;
  }
  console.error("Bun.Image is not available.");
  console.error("   Requires Bun >= 1.3.14. Current Bun version:", Bun.version);
  console.error("   Run: bun upgrade");
  return false;
}

// ── demos ────────────────────────────────────────────────────────────────────

async function demoMetadata(sourcePng: string) {
  console.log("\n[Demo] Metadata");
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

  console.log("  OK metadata");
}

async function demoResize(sourcePng: string, distDir: string) {
  console.log("\n[Demo] Resize");
  console.log("─".repeat(40));

  // Resize with width only (keep aspect ratio)
  const out1 = dist(distDir, "resized-4w.png");
  await new Bun.Image(sourcePng).resize(4).png().write(out1);
  const m1 = await new Bun.Image(out1).metadata();
  console.log("  resize(4):", m1.width, "x", m1.height);

  // Resize to exact dimensions (stretch)
  const out2 = dist(distDir, "resized-8x6.png");
  await new Bun.Image(sourcePng).resize(8, 6).png().write(out2);
  const m2 = await new Bun.Image(out2).metadata();
  console.log("  resize(8, 6):", m2.width, "x", m2.height);

  // Resize with fit: "inside"
  const out3 = dist(distDir, "resized-inside.png");
  await new Bun.Image(sourcePng).resize(8, 8, { fit: "inside" }).png().write(out3);
  const m3 = await new Bun.Image(out3).metadata();
  console.log("  resize(8, 8, {fit:'inside'}):", m3.width, "x", m3.height);

  // Resize with nearest filter (pixel art)
  const out4 = dist(distDir, "resized-nearest.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).png().write(out4);
  const m4 = await new Bun.Image(out4).metadata();
  console.log("  resize(64, 64, {filter:'nearest'}):", m4.width, "x", m4.height);

  console.log("  OK resize");
}

async function demoConvert(sourcePng: string, distDir: string) {
  console.log("\n[Demo] Format Conversion");
  console.log("─".repeat(40));

  // PNG -> JPEG
  const jpeg = dist(distDir, "converted.jpeg");
  await new Bun.Image(sourcePng).jpeg({ quality: 90 }).write(jpeg);
  const mJpeg = await new Bun.Image(jpeg).metadata();
  console.log("  PNG -> JPEG:", mJpeg.format, mJpeg.width, "x", mJpeg.height);

  // PNG -> WebP
  const webp = dist(distDir, "converted.webp");
  await new Bun.Image(sourcePng).webp({ quality: 80 }).write(webp);
  const mWebp = await new Bun.Image(webp).metadata();
  console.log("  PNG -> WebP:", mWebp.format, mWebp.width, "x", mWebp.height);

  // PNG -> JPEG (progressive)
  const progressive = dist(distDir, "progressive.jpeg");
  await new Bun.Image(sourcePng).jpeg({ quality: 85, progressive: true }).write(progressive);
  console.log("  PNG -> progressive JPEG: written");

  // PNG -> Indexed PNG
  const indexed = dist(distDir, "indexed.png");
  await new Bun.Image(sourcePng).png({ palette: true, colors: 16, dither: true }).write(indexed);
  console.log("  PNG -> indexed PNG: written");

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

  console.log("  OK conversion");
}

async function demoModulate(sourcePng: string, distDir: string) {
  console.log("\n[Demo] Modulate (brightness / saturation)");
  console.log("─".repeat(40));

  // Brightness boost
  const bright = dist(distDir, "modulate-bright.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ brightness: 1.5 }).png().write(bright);
  console.log("  brightness 1.5 -> written");

  // Greyscale (saturation 0)
  const grey = dist(distDir, "modulate-greyscale.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ saturation: 0 }).png().write(grey);
  console.log("  saturation 0 (greyscale) -> written");

  // High saturation
  const vivid = dist(distDir, "modulate-vivid.png");
  await new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" }).modulate({ saturation: 2.0 }).png().write(vivid);
  console.log("  saturation 2.0 -> written");

  console.log("  OK modulate");
}

async function demoFlip(sourcePng: string, distDir: string) {
  console.log("\n[Demo] Rotate / Flip / Flop");
  console.log("─".repeat(40));

  const upscaled = new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" });

  // Rotate 90
  await upscaled.rotate(90).png().write(dist(distDir, "rotated-90.png"));
  const m90 = await new Bun.Image(dist(distDir, "rotated-90.png")).metadata();
  console.log("  rotate(90):", m90.width, "x", m90.height);

  // Rotate 180
  await upscaled.rotate(180).png().write(dist(distDir, "rotated-180.png"));
  console.log("  rotate(180) -> written");

  // Flip (vertical mirror)
  await upscaled.flip().png().write(dist(distDir, "flipped.png"));
  console.log("  flip() -> written");

  // Flop (horizontal mirror)
  await upscaled.flop().png().write(dist(distDir, "flopped.png"));
  console.log("  flop() -> written");

  // Chain: rotate + flip
  await upscaled.rotate(90).flip().png().write(dist(distDir, "rotated-flipped.png"));
  console.log("  rotate(90).flip() -> written");

  console.log("  OK flip");
}

async function demoEncode(sourcePng: string, distDir: string) {
  console.log("\n[Demo] Encode Options");
  console.log("─".repeat(40));

  const upscaled = new Bun.Image(sourcePng).resize(64, 64, { filter: "nearest" });

  // JPEG at various quality levels
  for (const q of [10, 50, 80, 100]) {
    const path = dist(distDir, `jpeg-q${q}.jpeg`);
    await upscaled.jpeg({ quality: q }).write(path);
    const size = (await Bun.file(path).stat()).size;
    console.log(`  JPEG quality=${q}: ${size} bytes`);
  }

  // WebP lossy vs lossless
  const webpLossy = dist(distDir, "webp-lossy.webp");
  await upscaled.webp({ quality: 50 }).write(webpLossy);
  console.log(`  WebP lossy q=50: ${(await Bun.file(webpLossy).stat()).size} bytes`);

  const webpLossless = dist(distDir, "webp-lossless.webp");
  await upscaled.webp({ lossless: true }).write(webpLossless);
  console.log(`  WebP lossless: ${(await Bun.file(webpLossless).stat()).size} bytes`);

  // PNG compression levels
  for (const level of [0, 6, 9]) {
    const path = dist(distDir, `png-compress-${level}.png`);
    await upscaled.png({ compressionLevel: level }).write(path);
    const size = (await Bun.file(path).stat()).size;
    console.log(`  PNG compressionLevel=${level}: ${size} bytes`);
  }

  console.log("  OK encode");
}

async function demoPlaceholder(sourcePng: string) {
  console.log("\n[Demo] Placeholder (ThumbHash LQIP)");
  console.log("─".repeat(40));

  const placeholder = await new Bun.Image(sourcePng).placeholder();
  console.log("  placeholder data URL length:", placeholder.length);
  console.log("  placeholder starts with:", placeholder.substring(0, 50) + "...");
  console.log("  (use as <img src> for blur-up loading)");

  console.log("  OK placeholder");
}

async function demoBase64(sourcePng: string) {
  console.log("\n[Demo] Base64 / Data URL Output");
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

  console.log("  OK base64");
}

async function demoServe(sourcePng: string) {
  console.log("\n[Demo] Bun.serve Integration");
  console.log("─".repeat(40));

  const port = 3456;

  const server = Bun.serve({
    port,
    routes: {
      "/": () => new Response("Demo Bun.Image server -- try /image, /image?w=128, /image?format=webp"),
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
  console.log(`    GET /             -> info page`);
  console.log(`    GET /image        -> 64x64 JPEG`);
  console.log(`    GET /image?w=128  -> 128x128 JPEG`);
  console.log(`    GET /image?format=webp   -> WebP output`);
  console.log(`    GET /image?format=png    -> PNG output`);

  // Auto-test the endpoint
  const resp = await fetch(`http://localhost:${port}/image?w=32`);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`\n  Fetched /image?w=32: ${resp.status} ${resp.headers.get("content-type")} ${buf.length} bytes`);

  server.stop(true);
  console.log("  Server stopped.");
  console.log("  OK serve");
}

async function demoClipboard(distDir: string) {
  console.log("\n[Demo] Clipboard Image");
  console.log("─".repeat(40));

  if (!("fromClipboard" in Bun.Image)) {
    console.log("  Bun.Image.fromClipboard() not available in this Bun version");
    return;
  }

  const img = Bun.Image.fromClipboard();
  if (img) {
    const meta = await img.metadata();
    console.log("  Clipboard image:", meta);
    await img.resize(256, 256, { fit: "inside" }).png().write(dist(distDir, "clipboard.png"));
    console.log("  Saved to dist/clipboard.png");
  } else {
    console.log("  No image on clipboard (this is normal)");
  }

  console.log("  OK clipboard");
}

/** Demo error handling for invalid inputs. */
async function demoError(sourcePng: string) {
  console.log("\n[Demo] Error Handling");
  console.log("─".repeat(40));

  // 1. Constructing from a non-image buffer should fail
  try {
    const badBuf = Buffer.from("not an image");
    await new Bun.Image(badBuf).metadata();
    console.log("  non-image buffer: no error thrown (unexpected)");
  } catch (err: any) {
    console.log("  non-image buffer:", err.code || err.message?.substring(0, 80) || "unknown error");
  }

  // 2. Writing to an invalid path
  try {
    await new Bun.Image(sourcePng).resize(4).png().write("/nonexistent/deep/path/img.png");
    console.log("  invalid write path: no error thrown (unexpected)");
  } catch (err: any) {
    console.log("  invalid write path:", err.code || err.message?.substring(0, 80) || "unknown error");
  }

  // 3. Constructing from an empty Uint8Array
  try {
    await new Bun.Image(new Uint8Array(0)).metadata();
    console.log("  empty buffer: no error thrown (unexpected)");
  } catch (err: any) {
    console.log("  empty buffer:", err.code || err.message?.substring(0, 80) || "unknown error");
  }

  console.log("  OK error");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(distDir: string, demoName: string) {
  if (!checkImageAPI()) {
    process.exit(1);
  }

  console.log("Bun.Image API Demo");
  console.log("=".repeat(50));
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Demo: ${demoName}`);
  console.log(`Output dir: ${distDir}`);

  ensureDist(distDir);

  // Create test source image
  const sourcePng = dist(distDir, "source.png");
  await Bun.write(sourcePng, createTestPng());
  console.log(`Test image: ${sourcePng} (${(await Bun.file(sourcePng).stat()).size} bytes)`);

  const runAll = demoName === "all";
  const run = (name: string, fn: () => Promise<void>) =>
    (runAll || demoName === name) ? fn() : Promise.resolve();

  try {
    await run("metadata", () => demoMetadata(sourcePng));
    await run("resize", () => demoResize(sourcePng, distDir));
    await run("convert", () => demoConvert(sourcePng, distDir));
    await run("modulate", () => demoModulate(sourcePng, distDir));
    await run("flip", () => demoFlip(sourcePng, distDir));
    await run("encode", () => demoEncode(sourcePng, distDir));
    await run("placeholder", () => demoPlaceholder(sourcePng));
    await run("base64", () => demoBase64(sourcePng));
    await run("serve", () => demoServe(sourcePng));
    await run("clipboard", () => demoClipboard(distDir));
    await run("error", () => demoError(sourcePng));

    console.log("\n" + "=".repeat(50));
    console.log("All demos completed. Generated files in dist/:");
    const dir = Array.from(new Bun.Glob("*").scanSync(distDir)).sort();
    for (const f of dir) {
      const stat = await Bun.file(dist(distDir, f)).stat();
      console.log(`  ${f}  (${stat.size} bytes)`);
    }
  } catch (err: any) {
    console.error("\nDemo failed:", err);
    if (err.code) console.error("   error code:", err.code);
    process.exit(1);
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv);
  const demo = typeof args.demo === "string" ? args.demo : "all";
  const OUTPUT_FLAG = typeof args.output === "string" ? args.output : null;
  const distDir = resolveDist(OUTPUT_FLAG);
  main(distDir, demo);
}
