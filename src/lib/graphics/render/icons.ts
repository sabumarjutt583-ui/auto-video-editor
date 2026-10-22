import type { IconShape } from "./context.ts";

/**
 * A small hand-drawn set so the renderer can draw icons before the real Lucide and Tabler sets are bundled (phase 4).
 * Same shape as the converted library icons: SVG path data in a 24 x 24 box.
 */
const ICONS: Record<string, IconShape> = {
  check: { paths: ["M4 12.5l5 5L20 6.5"], viewBox: 24, filled: false, strokeWidth: 2.4 },
  star: { paths: ["M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.6 6.6 19.6l1.2-6.1L3.3 9.3l6.1-.7z"], viewBox: 24, filled: true },
  "arrow-right": { paths: ["M4 12h16", "M14 6l6 6-6 6"], viewBox: 24, filled: false, strokeWidth: 2.2 },
  circle: { paths: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"], viewBox: 24, filled: false, strokeWidth: 2 },
  users: { paths: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.2c2.2.6 3.5 2.5 3.5 5.8"], viewBox: 24, filled: false, strokeWidth: 2 },
  flame: { paths: ["M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1.5.8 2.5 1.8 2.5C10.5 8.5 11 5.5 12 3z"], viewBox: 24, filled: false, strokeWidth: 2 },
};

export function builtinIcon(set: string, name: string): IconShape | undefined {
  void set;
  return ICONS[name];
}

export const BUILTIN_ICON_NAMES: readonly string[] = Object.keys(ICONS);
