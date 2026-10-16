// Stand-in glyphs from the approved mock D sheet (docs/design/p0-alternatives/source/build.py),
// on a 24-point grid with round 2-point strokes. Not the licensed Design/Glyphs set.
// Structured data rendered by Icon.tsx; no markup strings are injected.

export type GlyphPart =
  | Readonly<{ shape: 'path'; d: string }>
  | Readonly<{ shape: 'circle'; cx: string; cy: string; r: string }>
  | Readonly<{ shape: 'rect'; x: string; y: string; width: string; height: string; rx?: string }>;

export const GLYPHS = Object.freeze({
  menu: [{ shape: "path", d: "M4 7h16M4 12h16M4 17h16" }],
  sidebar: [{ shape: "rect", x: "3", y: "4.5", width: "18", height: "15", rx: "3" }, { shape: "path", d: "M9.5 4.5v15" }],
  compose: [{ shape: "path", d: "M12 20h8" }, { shape: "path", d: "M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z" }],
  more: [{ shape: "circle", cx: "5", cy: "12", r: "1.2" }, { shape: "circle", cx: "12", cy: "12", r: "1.2" }, { shape: "circle", cx: "19", cy: "12", r: "1.2" }],
  plus: [{ shape: "path", d: "M12 5v14M5 12h14" }],
  send: [{ shape: "path", d: "M12 19V5M5.5 11.5 12 5l6.5 6.5" }],
  mic: [{ shape: "rect", x: "9", y: "3", width: "6", height: "11", rx: "3" }, { shape: "path", d: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" }],
  chat: [{ shape: "path", d: "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4.2A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z" }],
  feed: [{ shape: "rect", x: "4.5", y: "3.5", width: "15", height: "17", rx: "2" }, { shape: "path", d: "M8 8h8M8 12h8M8 16h5" }],
  ideas: [{ shape: "path", d: "M9.5 18h5M10.5 21h3" }, { shape: "path", d: "M12 3a6 6 0 0 0-3.8 10.6c.8.7 1.3 1.5 1.3 2.4h5c0-.9.5-1.7 1.3-2.4A6 6 0 0 0 12 3z" }],
  goals: [{ shape: "circle", cx: "12", cy: "12", r: "8.5" }, { shape: "circle", cx: "12", cy: "12", r: "4.5" }, { shape: "circle", cx: "12", cy: "12", r: "1" }],
  files: [{ shape: "path", d: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" }],
  agents: [{ shape: "circle", cx: "12", cy: "12", r: "8.5" }, { shape: "circle", cx: "9.5", cy: "11", r: ".9" }, { shape: "circle", cx: "14.5", cy: "11", r: ".9" }],
  group: [{ shape: "circle", cx: "9", cy: "10", r: "5.5" }, { shape: "path", d: "M15.2 5.2a5.5 5.5 0 0 1 0 9.6M7 20h4M14 20h4" }],
  projects: [{ shape: "rect", x: "4", y: "4", width: "7", height: "7", rx: "1.5" }, { shape: "rect", x: "13", y: "4", width: "7", height: "7", rx: "1.5" }, { shape: "rect", x: "4", y: "13", width: "7", height: "7", rx: "1.5" }, { shape: "rect", x: "13", y: "13", width: "7", height: "7", rx: "1.5" }],
  kanban: [{ shape: "rect", x: "3.5", y: "4", width: "4.5", height: "16", rx: "1.2" }, { shape: "rect", x: "9.8", y: "4", width: "4.5", height: "10", rx: "1.2" }, { shape: "rect", x: "16", y: "4", width: "4.5", height: "13", rx: "1.2" }],
  workflows: [{ shape: "circle", cx: "6", cy: "6", r: "2.5" }, { shape: "circle", cx: "18", cy: "12", r: "2.5" }, { shape: "circle", cx: "6", cy: "18", r: "2.5" }, { shape: "path", d: "M8.5 6.5 15.6 11M8.5 17.5l7.1-4.5" }],
  clock: [{ shape: "circle", cx: "12", cy: "12", r: "8.5" }, { shape: "path", d: "M12 7.5V12l3 2" }],
  usage: [{ shape: "path", d: "M5 20V11M12 20V4.5M19 20v-6.5" }],
  settings: [{ shape: "path", d: "M4 7h9M17 7h3M4 17h3M11 17h9" }, { shape: "circle", cx: "15", cy: "7", r: "2" }, { shape: "circle", cx: "9", cy: "17", r: "2" }],
  search: [{ shape: "circle", cx: "11", cy: "11", r: "6" }, { shape: "path", d: "m20 20-4.5-4.5" }],
  down: [{ shape: "path", d: "m6.5 9.5 5.5 5.5 5.5-5.5" }],
  right: [{ shape: "path", d: "m9.5 6 6 6-6 6" }],
  left: [{ shape: "path", d: "m14.5 6-6 6 6 6" }],
  question: [{ shape: "circle", cx: "12", cy: "12", r: "8.5" }, { shape: "path", d: "M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9" }, { shape: "circle", cx: "12", cy: "16.8", r: ".6" }],
  offline: [{ shape: "path", d: "m3.5 3.5 17 17M8.6 16.2a4.8 4.8 0 0 1 6.3-.4M5.2 12.6a9.6 9.6 0 0 1 4.3-2.4M18.8 12.6a9.6 9.6 0 0 0-2.6-1.8" }, { shape: "circle", cx: "12", cy: "19.5", r: ".6" }],
  copy: [{ shape: "rect", x: "8.5", y: "8.5", width: "11.5", height: "11.5", rx: "2" }, { shape: "path", d: "M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" }],
  refresh: [{ shape: "path", d: "M19.5 11.5A7.5 7.5 0 1 0 17.3 17" }, { shape: "path", d: "M19.5 5v6.5H13" }],
  tool: [{ shape: "path", d: "M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2.1 2.1 0 0 1-3-3l8.4-8.4" }],
  close: [{ shape: "path", d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }],
  host: [{ shape: "rect", x: "3.5", y: "4.5", width: "17", height: "11.5", rx: "2" }, { shape: "path", d: "M8.5 20h7M12 16v4" }],
  lock: [{ shape: "rect", x: "5", y: "10.5", width: "14", height: "10", rx: "2" }, { shape: "path", d: "M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" }],
  nerd: [{ shape: "path", d: "m4.5 7 5 5-5 5M12.5 18h7" }],
  user: [{ shape: "circle", cx: "12", cy: "8.5", r: "4" }, { shape: "path", d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" }],
  palette: [{ shape: "path", d: "M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.8 1.3-1.7-.4-1.2.4-2.3 1.6-2.3h1.6a4 4 0 0 0 4-4A8.4 8.4 0 0 0 12 3.5z" }, { shape: "circle", cx: "8", cy: "11", r: ".9" }, { shape: "circle", cx: "11", cy: "7.8", r: ".9" }, { shape: "circle", cx: "15.2", cy: "8.6", r: ".9" }],
  bell: [{ shape: "path", d: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" }, { shape: "path", d: "M10 20.5h4" }],
  shield: [{ shape: "path", d: "M12 3.5 19.5 6v6c0 4.6-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.9-7.5-8.5V6z" }],
  check: [{ shape: "path", d: "m5 12.5 4.5 4.5L19 7.5" }],
  attach: [{ shape: "path", d: "M19 11.5 12 18.5a4.6 4.6 0 0 1-6.5-6.5l7.3-7.3a3 3 0 0 1 4.3 4.3l-7.2 7.2a1.5 1.5 0 0 1-2.1-2.1L14.5 7.5" }],
} satisfies Record<string, readonly GlyphPart[]>);
export type GlyphName = keyof typeof GLYPHS;

// Placeholder for the Noodle (one continuous Ember stroke). Not the brand-kit asset.
export const NOODLE_PATH = 'M8.5 3v13.5c0 2.6 1.7 4 4 4 2.6 0 4.5-1.9 4.5-4.6 0-2.6-1.8-4.4-4.2-4.4-2 0-3.5 1.2-4.3 2.6M8.5 18.5 5 21.5';
