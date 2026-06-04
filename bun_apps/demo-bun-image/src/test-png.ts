/**
 * Shared minimal 2x2 PNG generator (zero dependencies).
 *
 * Used by both index.ts (demo source image) and index.test.ts (test fixture).
 * Creates a valid 2x2 RGBA PNG with a red/blue/green/yellow pixel pattern.
 */

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

/** Compute CRC-32 checksum. */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Compute Adler-32 checksum. */
function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

/** Create a PNG chunk with length, type, data, and CRC. */
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

/** Create a zlib "stored" (uncompressed) stream for small data. */
function createZlibStored(data: Uint8Array): Uint8Array {
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
  out[1] = 0x01; // FLG (check bits for CMF*256+FLG must be multiple of 31)

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

/** Create a minimal 2x2 RGBA PNG (red, blue, green, yellow pixels). */
export function createTestPng(): Uint8Array {
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
