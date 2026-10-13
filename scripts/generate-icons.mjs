#!/usr/bin/env node
/**
 * Generates all raster icons for Beartasks with zero dependencies:
 *
 *   icons-src/app-icon.png        1024x1024 app icon source (feeds `tauri icon`)
 *   src-tauri/icons/tray-icon.png     44x44 tray glyph (macOS template / Linux)
 *   src-tauri/icons/tray-icon@2x.png  88x88 tray glyph, high-DPI variant
 *
 * The PNG encoder below writes 8-bit RGBA files using only node:zlib, so the
 * script runs on a bare Node installation.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- minimal PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- signed distance helpers ---------------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Distance from (px,py) to the edge of an axis-aligned rounded rectangle. */
function sdRoundRect(px, py, cx, cy, w, h, r) {
  const qx = Math.abs(px - cx) - w / 2 + r;
  const qy = Math.abs(py - cy) - h / 2 + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance from (px,py) to a line segment. */
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Analytic anti-aliasing: 1 outside → 0 inside, smooth across 1px. */
const coverage = (px, py, sd) => clamp(0.5 - sd, 0, 1);

/**
 * Canvas with a simple "source-over" painter API.
 * All coordinates are in canvas pixels.
 */
class Canvas {
  constructor(size) {
    this.size = size;
    this.buf = Buffer.alloc(size * size * 4);
  }

  /** Paint a rounded rect (fill when thickness null, else outline). */
  roundRect({ cx, cy, w, h, r, thickness = null, color, alpha = 1 }) {
    const { size } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sd =
          thickness === null
            ? sdRoundRect(x + 0.5, y + 0.5, cx, cy, w, h, r)
            : Math.abs(sdRoundRect(x + 0.5, y + 0.5, cx, cy, w, h, r)) - thickness / 2;
        const a = coverage(x + 0.5, y + 0.5, sd) * alpha;
        if (a > 0) this.blend(x, y, color, a);
      }
    }
  }

  /** Paint a stroked polyline. */
  polyline({ points, thickness, color, alpha = 1 }) {
    const { size } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sd = Infinity;
        // `points` is flat [x0,y0,x1,y1,...]; a segment needs i+3 in range.
        for (let i = 0; i + 3 < points.length; i += 2) {
          sd = Math.min(sd, sdSegment(x + 0.5, y + 0.5, points[i], points[i + 1], points[i + 2], points[i + 3]) - thickness / 2);
        }
        const a = coverage(x + 0.5, y + 0.5, sd) * alpha;
        if (a > 0) this.blend(x, y, color, a);
      }
    }
  }

  /** Vertical gradient rounded rect background. */
  gradientRoundRect({ cx, cy, w, h, r, from, to }) {
    const { size } = this;
    for (let y = 0; y < size; y++) {
      const t = clamp((y + 0.5 - (cy - h / 2)) / h, 0, 1);
      const color = [
        Math.round(from[0] + (to[0] - from[0]) * t),
        Math.round(from[1] + (to[1] - from[1]) * t),
        Math.round(from[2] + (to[2] - from[2]) * t),
      ];
      for (let x = 0; x < size; x++) {
        const sd = sdRoundRect(x + 0.5, y + 0.5, cx, cy, w, h, r);
        const a = coverage(x + 0.5, y + 0.5, sd);
        if (a > 0) this.blend(x, y, color, a);
      }
    }
  }

  blend(x, y, color, alpha) {
    const i = (y * this.size + x) * 4;
    const buf = this.buf;
    const da = buf[i + 3] / 255;
    const oa = alpha + da * (1 - alpha);
    if (oa <= 0) return;
    for (let c = 0; c < 3; c++) {
      buf[i + c] = Math.round((color[c] * alpha + buf[i + c] * da * (1 - alpha)) / oa);
    }
    buf[i + 3] = Math.round(oa * 255);
  }
}

/* ---------------- artwork ---------------- */

/**
 * Checklist glyph shared by the app icon and tray icon.
 * `u` is the unit scale; geometry is designed on a 100×100 grid,
 * then multiplied by `u` and offset to fit the target canvas.
 */
function drawChecklist(canvas, { u, ox, oy, boxColor, lineColor, checkColor, checked }) {
  const rows = [30, 55, 80]; // grid Y centres
  for (let i = 0; i < rows.length; i++) {
    const cy = rows[i];
    const isChecked = checked && i === 0;
    // Checkbox
    const color = isChecked ? boxColor : lineColor;
    const alpha = isChecked ? 1 : 0.85;
    canvas.roundRect({
      cx: ox + 15 * u,
      cy: oy + cy * u,
      w: 16 * u,
      h: 16 * u,
      r: 4 * u,
      thickness: 3.2 * u,
      color,
      alpha,
    });
    if (isChecked) {
      canvas.polyline({
        points: [
          ox + 11 * u, oy + (cy + 0.5) * u,
          ox + 14.5 * u, oy + (cy + 4.5) * u,
          ox + 21 * u, oy + (cy - 4.5) * u,
        ],
        thickness: 3.2 * u,
        color: checkColor,
        alpha: 1,
      });
    }
    // Title bar
    canvas.roundRect({
      cx: ox + 58 * u,
      cy: oy + cy * u,
      w: isChecked ? 50 * u : 58 * u,
      h: 5.5 * u,
      r: 2.75 * u,
      color,
      alpha: isChecked ? 0.55 : 0.7,
    });
  }
}

function buildAppIcon(size) {
  const canvas = new Canvas(size);
  const s = size / 1024;
  // Rounded-square background with a subtle vertical gradient.
  canvas.gradientRoundRect({
    cx: size / 2,
    cy: size / 2,
    w: size * 0.86,
    h: size * 0.86,
    r: size * 0.19,
    from: [48, 54, 64],
    to: [26, 29, 35],
  });
  // Checklist drawn on an inner 100-unit grid, ~62% of the canvas width.
  const u = size * 0.0062; // 0.62 * size / 100 per unit
  drawChecklist(canvas, {
    u,
    // Glyph content spans 7..93 / 22..88 on the grid (centre 47, 55);
    // offset so that centre lands on the canvas centre.
    ox: size / 2 - 47 * u,
    oy: size / 2 - 55 * u,
    boxColor: [255, 255, 255],
    lineColor: [163, 172, 184],
    checkColor: [255, 255, 255],
    checked: true,
  });
  return encodePng(size, size, canvas.buf);
}

function buildTrayIcon(size) {
  const canvas = new Canvas(size);
  const u = size / 100;
  // Monochrome grey glyph: rendered as a macOS template (alpha mask) and
  // readable on both light and dark Linux panels.
  drawChecklist(canvas, {
    u,
    ox: 50 * u - 47 * u, // centre the 7..93 grid horizontally
    oy: 50 * u - 55 * u, // centre the 22..88 grid vertically
    boxColor: [90, 90, 90],
    lineColor: [90, 90, 90],
    checkColor: [90, 90, 90],
    checked: true,
  });
  return encodePng(size, size, canvas.buf);
}

/* ---------------- emit files ---------------- */

function emit(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${path} (${data.length} bytes)`);
}

emit(join(root, "icons-src", "app-icon.png"), buildAppIcon(1024));
emit(join(root, "src-tauri", "icons", "tray-icon.png"), buildTrayIcon(44));
emit(join(root, "src-tauri", "icons", "tray-icon@2x.png"), buildTrayIcon(88));
