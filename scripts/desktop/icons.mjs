#!/usr/bin/env node
// Draws the app icon (the Noodle stroke on a cream rounded square) with Node
// built-ins only, and writes PNG and ICO files under apps/desktop/assets/icons.
//
//   node scripts/desktop/icons.mjs        regenerate the committed icons
//
// Arithmetic uses only + - * / and sqrt, so the pixels are identical on every
// platform. Compressed bytes may differ between zlib builds; tests compare pixels.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

// Same path as NOODLE_PATH in packages/ui/glyphs.ts (24-unit view box).
export const NOODLE_PATH = 'M8.5 3v13.5c0 2.6 1.7 4 4 4 2.6 0 4.5-1.9 4.5-4.6 0-2.6-1.8-4.4-4.2-4.4-2 0-3.5 1.2-4.3 2.6M8.5 18.5 5 21.5';
export const ICON_SIZES = Object.freeze([16, 32, 48, 64, 128, 256]);
export const ICO_SIZES = Object.freeze([16, 32, 48, 256]);
const EMBER = [0xFF, 0x8A, 0x7A];
const CREAM = [0xFF, 0xF9, 0xF5];
const EDGE = [0xF0, 0xDC, 0xD2];

// Polylines for M/L/H/V/C (absolute and relative), with implicit repeats.
export function flattenPath(d, steps = 24) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/gu) ?? [];
  const lines = [];
  let index = 0, command = '', x = 0, y = 0, startX = 0, startY = 0, line = null;
  const number = () => {
    const token = tokens[index++];
    const value = Number(token);
    if (token === undefined || !Number.isFinite(value)) throw new Error('Invalid path');
    return value;
  };
  while (index < tokens.length) {
    if (/^[A-Za-z]$/u.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + number(); y = oy + number(); startX = x; startY = y;
        line = [[x, y]]; lines.push(line);
        command = relative ? 'l' : 'L';
        break;
      case 'L': x = ox + number(); y = oy + number(); line.push([x, y]); break;
      case 'H': x = ox + number(); line.push([x, y]); break;
      case 'V': y = oy + number(); line.push([x, y]); break;
      case 'C': {
        const x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number(), x3 = ox + number(), y3 = oy + number();
        for (let step = 1; step <= steps; step++) {
          const t = step / steps, u = 1 - t;
          const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
          line.push([a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3]);
        }
        x = x3; y = y3;
        break;
      }
      case 'Z': x = startX; y = startY; line.push([x, y]); break;
      default: throw new Error('Unsupported path command');
    }
  }
  return lines;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  let t = length === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / length;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
  return Math.sqrt(ex * ex + ey * ey);
}

// Signed distance to a rounded square centred at c with half size h and radius r.
function roundedSquare(px, py, c, h, r) {
  const qx = Math.abs(px - c) - (h - r), qy = Math.abs(py - c) - (h - r);
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
  const inner = qx > qy ? qx : qy;
  return Math.sqrt(mx * mx + my * my) + (inner < 0 ? inner : 0) - r;
}

// Straight-alpha RGBA, row-major.
export function renderIcon(size) {
  if (!Number.isInteger(size) || size < 16 || size > 1024) throw new Error('Invalid icon size');
  const scale = size * (size <= 32 ? 0.82 : 0.74) / 24;
  const stroke = Math.max(2.4 * scale, 1.7) / 2;
  // Visual centre of the glyph's bounds (x 5-17, y 3-21.5) to the canvas centre.
  const offsetX = size / 2 - 11 * scale, offsetY = size / 2 - 12.25 * scale;
  const segments = [];
  for (const line of flattenPath(NOODLE_PATH)) {
    for (let index = 1; index < line.length; index++) {
      const [ax, ay] = line[index - 1], [bx, by] = line[index];
      segments.push([offsetX + ax * scale, offsetY + ay * scale, offsetX + bx * scale, offsetY + by * scale]);
    }
  }
  const centre = size / 2, half = size / 2 - Math.max(size * 0.04, 0.5), radius = size * 0.22;
  const edge = Math.max(size / 64, 0.6);
  const samples = 4, rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples, y = py + (sy + 0.5) / samples;
          const outside = roundedSquare(x, y, centre, half, radius);
          if (outside > 0) continue;
          let near = Infinity;
          for (const [ax, ay, bx, by] of segments) {
            const distance = segmentDistance(x, y, ax, ay, bx, by);
            if (distance < near) near = distance;
          }
          const color = near <= stroke ? EMBER : outside > -edge ? EDGE : CREAM;
          r += color[0]; g += color[1]; b += color[2]; a += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a); rgba[offset + 1] = Math.round(g / a); rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round(255 * a / (samples * samples));
      }
    }
  }
  return rgba;
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([header, data, checksum]);
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('Pixel buffer size mismatch');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) rgba.copy(raw, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Reads back only what encodePng writes (8-bit RGBA, filter 0). Checks every CRC.
export function decodePng(png) {
  if (!SIGNATURE.equals(png.subarray(0, 8))) throw new Error('Not a PNG');
  let offset = 8, width = 0, height = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if ((crc32(png.subarray(offset + 4, offset + 8 + length)) >>> 0) !== png.readUInt32BE(offset + 8 + length)) throw new Error('Bad PNG checksum');
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('Unsupported PNG format');
    } else if (type === 'IDAT') data.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    if (raw[row * (width * 4 + 1)] !== 0) throw new Error('Unsupported PNG filter');
    raw.copy(rgba, row * width * 4, row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1));
  }
  return { width, height, rgba };
}

// ICO with embedded PNG images (Windows Vista and later).
export function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size; header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

export function iconFiles() {
  const pngs = new Map(ICON_SIZES.map(size => [size, encodePng(size, size, renderIcon(size))]));
  const files = new Map([...pngs].map(([size, png]) => [`bighelp-${size}.png`, png]));
  files.set('bighelp.ico', encodeIco(ICO_SIZES.map(size => ({ size, png: pngs.get(size) }))));
  return files;
}

export const ICON_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'desktop', 'assets', 'icons');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(ICON_DIRECTORY, { recursive: true });
  const files = iconFiles();
  for (const [name, bytes] of files) await writeFile(join(ICON_DIRECTORY, name), bytes);
  process.stdout.write(`${[...files.keys()].join('\n')}\n`);
}
