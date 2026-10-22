import type { EasingName } from "./easing.ts";
import type { Script } from "./script.ts";

/** An entrance or exit a layer gets when its spec does not say one (from the brand kit). */
export interface DefaultAnimation {
  preset: string;
  duration: number;
  easing: EasingName;
}

/** Colours, fonts and shapes every graphic uses by default. Built from a brand kit (src/lib/graphics/brand). */
export interface Theme {
  colors: { primary: string; secondary: string; accent: string; text: string; muted: string; background: string; success: string; danger: string };
  /** Colours for the slices, lines and bars of a chart, in order. */
  palette: readonly string[];
  /** Font family per script (a CSS family list). */
  fonts: Record<Script, string>;
  /** Corner roundness of cards and panels, as a multiple of the built-in size (1 = as designed, 0 = square). */
  radius: number;
  /** Line thickness of charts, timelines and shapes, as a multiple of the built-in size. */
  strokeWidth: number;
  /** Strength of the soft shadow under letters, 0..1 (0.45 = as designed, 0 = none). */
  shadow: number;
  /** Weight of titles (lower third name, chart title, counter label). */
  headingWeight: 400 | 700;
  /** "upper" writes titles in capital letters. */
  headingCase: "normal" | "upper";
  /** Entrance and exit for layers that have none. Missing = they appear and disappear at once. */
  enter?: DefaultAnimation;
  exit?: DefaultAnimation;
}

export const DEFAULT_THEME: Theme = {
  colors: { primary: "#8b5cf6", secondary: "#1e293b", accent: "#f59e0b", text: "#ffffff", muted: "#cbd5e1", background: "#0f172a", success: "#22c55e", danger: "#ef4444" },
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
  radius: 1,
  strokeWidth: 1,
  shadow: 0.45,
  headingWeight: 700,
  headingCase: "normal",
};

/** A colour name of the spec (primary, accent, ...) or #RRGGBB(AA), as a CSS colour. */
export function resolveColor(value: string | undefined, theme: Theme, fallback: keyof Theme["colors"] = "text"): string {
  if (value === undefined) return theme.colors[fallback];
  if (value.startsWith("#")) return value;
  return theme.colors[value as keyof Theme["colors"]] ?? theme.colors[fallback];
}

export const WEIGHTS = { regular: 400, semibold: 600, bold: 700 } as const;
