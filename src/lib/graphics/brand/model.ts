import { EASINGS, ENTER_PRESETS, EXIT_PRESETS } from "../spec/schema.ts";
import type { Script } from "../render/script.ts";

export type EnterPreset = (typeof ENTER_PRESETS)[number];
export type ExitPreset = (typeof EXIT_PRESETS)[number];
export type EasingChoice = (typeof EASINGS)[number];
export type Density = "low" | "normal" | "high";

export const SCRIPTS: readonly Script[] = ["latin", "cyrillic", "korean", "japanese", "chinese", "devanagari", "arabic"];
export const DENSITIES: readonly Density[] = ["low", "normal", "high"];
export { EASINGS, ENTER_PRESETS, EXIT_PRESETS };

/**
 * A brand kit: the look every motion graphic of a channel shares. Colours are `#RRGGBB`. Only the fonts bundled with the app
 * can be used (see FONT_CHOICES), so a kit never points at a font that is missing on another computer.
 */
export interface BrandKit {
  /** Lower-case letters, digits, `_` and `-`. Built-in kits have fixed ids. */
  id: string;
  name: string;
  /** Font family per script. */
  fonts: Record<Script, string>;
  colors: { primary: string; secondary: string; accent: string; text: string; background: string; success: string; danger: string };
  /** Corner roundness as a multiple of the built-in size (0 = square). */
  radius: number;
  /** Line thickness as a multiple of the built-in size. */
  strokeWidth: number;
  /** Strength of the soft shadow under letters (0 = none). */
  shadow: number;
  headingWeight: 400 | 700;
  headingCase: "normal" | "upper";
  /** Entrance and exit of layers that have none of their own. */
  enter: { preset: EnterPreset; duration: number };
  exit: { preset: ExitPreset; duration: number };
  easing: EasingChoice;
  /** Path of the channel logo (a picture file), empty = none. */
  logo: string;
  /** How many graphics the AI director may place (phase 7). */
  density: Density;
  /** Margins kept free of graphics, as a share of the picture width / height (phase 8). */
  safeMargins: { x: number; y: number };
}

/** The bundled font families that can draw each script. The first one is the main font. */
export const FONT_CHOICES: Record<Script, readonly string[]> = {
  latin: ["Noto Sans"],
  cyrillic: ["Noto Sans"],
  korean: ["Noto Sans KR", "Noto Sans"],
  japanese: ["Noto Sans JP", "Noto Sans"],
  chinese: ["Noto Sans SC", "Noto Sans"],
  devanagari: ["Noto Sans Devanagari", "Noto Sans"],
  arabic: ["Noto Sans Arabic", "Noto Sans"],
};

export const KIT_LIMITS = {
  nameMax: 40,
  radius: { min: 0, max: 2 },
  strokeWidth: { min: 0.5, max: 3 },
  shadow: { min: 0, max: 1 },
  duration: { min: 0, max: 2 },
  safeMargin: { min: 0, max: 0.2 },
  logoMax: 500,
} as const;

export const COLOR_KEYS = ["primary", "secondary", "accent", "text", "background", "success", "danger"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
