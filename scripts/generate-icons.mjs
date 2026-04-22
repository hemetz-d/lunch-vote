// Generates placeholder Teams app icons using only Node built-ins.
//
//   teams/icons/color.png   — 192×192, brand red (#b83a3a) with a white plate + fork glyph
//   teams/icons/outline.png — 32×32, white silhouette on transparent (required by Teams)
//
// Overwrite these with real designs before distributing beyond a test install.
// Run with:  node scripts/generate-icons.mjs
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAMS_ICONS_DIR = join(__dirname, "..", "teams", "icons");
const PAGES_ICONS_DIR = join(__dirname, "..", "pages", "icons");
mkdirSync(TEAMS_ICONS_DIR, { recursive: true });
mkdirSync(PAGES_ICONS_DIR, { recursive: true });

// -- Minimal PNG encoder ----------------------------------------------------
// RGBA pixels → PNG buffer. Pure zlib + CRC32, no external dependencies.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Each scanline is prefixed with a filter byte (0 = None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -- Glyph drawing ---------------------------------------------------------

function makeRgba(width, height, fill) {
  const buf = Buffer.alloc(width * height * 4);
  const [r, g, b, a] = fill;
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  }
  return buf;
}

function putPixel(buf, w, x, y, color) {
  const i = (y * w + x) * 4;
  buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = color[3];
}

function fillCircle(buf, w, h, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) putPixel(buf, w, x, y, color);
    }
  }
}

function fillRect(buf, w, h, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      putPixel(buf, w, x, y, color);
    }
  }
}

// Draw the plate-on-red "color" design at an arbitrary size.
function renderColor(W, H) {
  const bg = [0xb8, 0x3a, 0x3a, 0xff];
  const white = [0xff, 0xff, 0xff, 0xff];
  const buf = makeRgba(W, H, bg);
  const cx = W / 2, cy = H / 2;
  const scale = Math.min(W, H) / 192;
  const R_outer = Math.round(66 * scale);
  const R_inner = Math.round(52 * scale);
  const halfW = Math.round(26 * scale);
  const tineW = Math.round(4 * scale);
  const tineTop = Math.round(cy - 8 * scale);
  const tineBottom = Math.round(cy + 30 * scale);
  const handleTop = Math.round(cy - 16 * scale);

  fillCircle(buf, W, H, cx, cy, R_outer, white);
  fillCircle(buf, W, H, cx, cy, R_inner, bg);
  fillRect(buf, W, H, Math.round(cx - halfW), tineTop,       Math.round(cx - halfW + tineW * 2), tineBottom, white);
  fillRect(buf, W, H, Math.round(cx - tineW), tineTop,       Math.round(cx + tineW),             tineBottom, white);
  fillRect(buf, W, H, Math.round(cx + halfW - tineW * 2), tineTop, Math.round(cx + halfW),       tineBottom, white);
  fillRect(buf, W, H, Math.round(cx - halfW), handleTop,     Math.round(cx + halfW),             tineTop, white);
  return buf;
}

// -- Teams color icon (192×192) + outline (32×32) --------------------------
writeFileSync(join(TEAMS_ICONS_DIR, "color.png"), encodePng(192, 192, renderColor(192, 192)));
console.log("wrote teams/icons/color.png   192×192");

{
  const W = 32, H = 32;
  const white = [0xff, 0xff, 0xff, 0xff];
  const buf = makeRgba(W, H, [0, 0, 0, 0]);
  fillCircle(buf, W, H, W / 2, H / 2, 12, white);
  fillCircle(buf, W, H, W / 2, H / 2, 8, [0, 0, 0, 0]);
  writeFileSync(join(TEAMS_ICONS_DIR, "outline.png"), encodePng(W, H, buf));
  console.log("wrote teams/icons/outline.png 32×32");
}

// -- PWA icons in pages/icons/ --------------------------------------------
// 192 and 512 cover Android home-screen / splash, Chrome, iOS. The 512
// maskable variant uses the same design; safe-zone cropping is handled by
// the launcher (the design already has enough padding around the glyph).
for (const size of [192, 512]) {
  writeFileSync(join(PAGES_ICONS_DIR, `icon-${size}.png`), encodePng(size, size, renderColor(size, size)));
  console.log(`wrote pages/icons/icon-${size}.png ${size}×${size}`);
}
writeFileSync(join(PAGES_ICONS_DIR, "icon-maskable-512.png"), encodePng(512, 512, renderColor(512, 512)));
console.log("wrote pages/icons/icon-maskable-512.png 512×512 (maskable)");
