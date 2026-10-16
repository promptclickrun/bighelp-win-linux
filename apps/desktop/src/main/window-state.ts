// Window size, position and maximized state across launches. Not secret: a small
// JSON file under userData. Anything unexpected in it is ignored, and a restored
// window is always placed fully inside one display's work area.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

export const WINDOW_STATE_FILE = 'window-state.json';
export const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1280, height: 800 });
export const MINIMUM_WINDOW_SIZE = Object.freeze({ width: 640, height: 480 });
const MAXIMUM_EDGE = 32768;
const MAXIMUM_OFFSET = 1_000_000;
const MAXIMUM_FILE_BYTES = 4096;

export type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;
export type WindowState = Readonly<Rectangle & { maximized: boolean }>;

const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export function parseWindowState(input: unknown): WindowState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'height,maximized,version,width,x,y' || value.version !== 1) return null;
  const { x, y, width, height, maximized } = value;
  if (!integer(x, -MAXIMUM_OFFSET, MAXIMUM_OFFSET) || !integer(y, -MAXIMUM_OFFSET, MAXIMUM_OFFSET)
    || !integer(width, MINIMUM_WINDOW_SIZE.width, MAXIMUM_EDGE) || !integer(height, MINIMUM_WINDOW_SIZE.height, MAXIMUM_EDGE)
    || typeof maximized !== 'boolean') return null;
  return Object.freeze({ x, y, width, height, maximized });
}

export function serializeWindowState(state: WindowState): string {
  return `${JSON.stringify({ version: 1, x: Math.round(state.x), y: Math.round(state.y),
    width: Math.round(state.width), height: Math.round(state.height), maximized: state.maximized })}\n`;
}

function overlap(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

// Pick the display the saved window mostly covered (the primary one if none),
// shrink the window to fit that work area, then move it fully inside.
export function placeWindow(saved: WindowState | null, workAreas: readonly Rectangle[], primary: Rectangle): WindowState {
  const wanted = saved ?? { x: primary.x, y: primary.y, ...DEFAULT_WINDOW_SIZE, maximized: false };
  let area = primary, best = 0;
  if (saved) for (const candidate of workAreas) {
    const covered = overlap(saved, candidate);
    if (covered > best) { best = covered; area = candidate; }
  }
  const width = Math.min(wanted.width, Math.max(area.width, MINIMUM_WINDOW_SIZE.width));
  const height = Math.min(wanted.height, Math.max(area.height, MINIMUM_WINDOW_SIZE.height));
  const x = saved ? clamp(saved.x, area.x, area.x + area.width - width) : area.x + Math.max(0, Math.floor((area.width - width) / 2));
  const y = saved ? clamp(saved.y, area.y, area.y + area.height - height) : area.y + Math.max(0, Math.floor((area.height - height) / 2));
  return Object.freeze({ x, y, width, height, maximized: saved?.maximized ?? false });
}

export function loadWindowState(path: string): WindowState | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAXIMUM_FILE_BYTES) return null;
    return parseWindowState(JSON.parse(readFileSync(path, 'utf8')));
  } catch { return null; }
}

// Write a temporary file, then rename it over the old one.
export function saveWindowState(path: string, state: WindowState): boolean {
  try {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, serializeWindowState(state), { mode: 0o600 });
    renameSync(temporary, path);
    return true;
  } catch { return false; }
}
