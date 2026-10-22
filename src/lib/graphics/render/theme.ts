import type { Script } from "./script.ts";

/** Colours and fonts a graphic uses by default. Phase 6 replaces this with the brand kits. */
export interface Theme {
  colors: { primary: string; secondary: string; accent: string; text: string; muted: string; background: string };
  /** Colours for the slices, lines and bars of a chart, in order. Phase 6 brand kits can replace them. */
  palette: readonly string[];
  /** Font family per script (a CSS family list). */
  fonts: Record<Script, string>;
}

export const DEFAULT_THEME: Theme = {
  colors: { primary: "#8b5cf6", secondary: "#1e293b", accent: "#f59e0b", text: "#ffffff", muted: "#cbd5e1", background: "#0f172a" },
  palette: ["#8b5cf6", "#f59e0b", "#22c55e", "#3b82f6", "#ef4444", "#14b8a6", "#ec4899", "#eab308", "#a78bfa", "#f97316", "#84cc16", "#06b6d4"],
  fonts: {
    latin: '"Noto Sans", sans-serif',
    cyrillic: '"Noto Sans", sans-serif',
    korean: '"Noto Sans KR", "Noto Sans", sans-serif',
    japanese: '"Noto Sans JP", "Noto Sans", sans-serif',
    chinese: '"Noto Sans SC", "Noto Sans", sans-serif',
    devanagari: '"Noto Sans Devanagari", "Noto Sans", sans-serif',
    arabic: '"Noto Sans Arabic", "Noto Sans", sans-serif',
  },
};

/** A colour name of the spec (primary, accent, ...) or #RRGGBB(AA), as a CSS colour. */
export function resolveColor(value: string | undefined, theme: Theme, fallback: keyof Theme["colors"] = "text"): string {
  if (value === undefined) return theme.colors[fallback];
  if (value.startsWith("#")) return value;
  return theme.colors[value as keyof Theme["colors"]] ?? theme.colors[fallback];
}

export const WEIGHTS = { regular: 400, semibold: 600, bold: 700 } as const;
