import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ICON_DIRECTORY, ICON_SIZES, ICO_SIZES, NOODLE_PATH, decodePng, encodePng, flattenPath, iconFiles, renderIcon,
} from '../scripts/desktop/icons.mjs';

test('icon generator draws the same Noodle path as the app', async () => {
  const glyphs = await readFile(new URL('../packages/ui/glyphs.ts', import.meta.url), 'utf8');
  assert.equal(/export const NOODLE_PATH = '([^']+)'/u.exec(glyphs)?.[1], NOODLE_PATH);
  const lines = flattenPath(NOODLE_PATH);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0][0], [8.5, 3]);
  assert.deepEqual(lines[1], [[8.5, 18.5], [5, 21.5]]);
  assert.throws(() => flattenPath('M1 2Q3 4 5 6'), /Unsupported/u);
});

test('PNG encoding round-trips pixels and rejects corrupted chunks', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4]);
  const png = encodePng(2, 2, pixels);
  assert.deepEqual(decodePng(png), { width: 2, height: 2, rgba: pixels });
  const corrupted = Buffer.from(png);
  corrupted[20] ^= 1;
  assert.throws(() => decodePng(corrupted), /checksum/u);
  assert.throws(() => encodePng(2, 2, Buffer.alloc(3)), /mismatch/u);
});

test('committed icons are exactly what the generator draws', async () => {
  const generated = iconFiles();
  assert.deepEqual([...generated.keys()].sort(), [...ICON_SIZES.map(size => `bighelp-${size}.png`), 'bighelp.ico'].sort());
  for (const size of ICON_SIZES) {
    const committed = decodePng(await readFile(join(ICON_DIRECTORY, `bighelp-${size}.png`)));
    assert.equal(committed.width, size);
    assert.equal(committed.height, size);
    assert.ok(committed.rgba.equals(decodePng(generated.get(`bighelp-${size}.png`)).rgba), `bighelp-${size}.png is stale; run node scripts/desktop/icons.mjs`);
  }
});

test('icon is an opaque rounded square with transparent corners and an ember stroke', () => {
  const size = 64, rgba = renderIcon(size);
  const pixel = (x, y) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  assert.equal(pixel(0, 0)[3], 0, 'corner is transparent');
  assert.deepEqual(pixel(52, 12), [0xFF, 0xF9, 0xF5, 255], 'background is cream');
  const colors = new Set();
  for (let index = 0; index < rgba.length; index += 4) if (rgba[index + 3] === 255) colors.add(rgba.readUInt32BE(index));
  assert.ok(colors.has(0xFF8A7AFF), 'stroke is ember');
});

test('ICO embeds the committed PNG sizes', async () => {
  const ico = await readFile(join(ICON_DIRECTORY, 'bighelp.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  ICO_SIZES.forEach((size, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size === 256 ? 0 : size);
    const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
    assert.equal(decodePng(png).width, size);
  });
});
