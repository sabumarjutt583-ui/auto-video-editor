import type { BrandKit } from "./model.ts";
import { FONT_CHOICES } from "./model.ts";

const fonts = (): BrandKit["fonts"] => ({
  latin: "Noto Sans",
  cyrillic: "Noto Sans",
  korean: FONT_CHOICES.korean[0] as string,
  japanese: FONT_CHOICES.japanese[0] as string,
  chinese: FONT_CHOICES.chinese[0] as string,
  devanagari: FONT_CHOICES.devanagari[0] as string,
  arabic: FONT_CHOICES.arabic[0] as string,
});

/** Calm and neutral: for explainers and documentaries. */
export const CLEAN_DOCUMENTARY: BrandKit = {
  id: "clean_documentary",
  name: "Clean Documentary",
  fonts: fonts(),
  colors: { primary: "#3b82f6", secondary: "#1e293b", accent: "#f59e0b", text: "#ffffff", background: "#0f172a", success: "#22c55e", danger: "#ef4444" },
  radius: 1,
  strokeWidth: 1,
  shadow: 0.45,
  headingWeight: 700,
  headingCase: "normal",
  enter: { preset: "fade", duration: 0.4 },
  exit: { preset: "fade", duration: 0.3 },
  easing: "easeOut",
  logo: "",
  density: "normal",
  safeMargins: { x: 0.05, y: 0.06 },
};

/** Sharp corners, capital letters, fast slides: for news and breaking stories. */
export const BOLD_NEWS: BrandKit = {
  id: "bold_news",
  name: "Bold News",
  fonts: fonts(),
  colors: { primary: "#dc2626", secondary: "#111827", accent: "#facc15", text: "#ffffff", background: "#000000", success: "#16a34a", danger: "#f87171" },
  radius: 0.25,
  strokeWidth: 1.6,
  shadow: 0.6,
  headingWeight: 700,
  headingCase: "upper",
  enter: { preset: "slideLeft", duration: 0.28 },
  exit: { preset: "slideLeft", duration: 0.22 },
  easing: "easeOutExpo",
  logo: "",
  density: "high",
  safeMargins: { x: 0.04, y: 0.05 },
};

/** Round, warm and slow: for stories, memories and gentle subjects. */
export const SOFT_STORY: BrandKit = {
  id: "soft_story",
  name: "Soft Story",
  fonts: fonts(),
  colors: { primary: "#e8a87c", secondary: "#3b2f4a", accent: "#f7d794", text: "#fff7ed", background: "#2a2036", success: "#86c9a0", danger: "#e58a8a" },
  radius: 1.8,
  strokeWidth: 0.8,
  shadow: 0.25,
  headingWeight: 400,
  headingCase: "normal",
  enter: { preset: "fade", duration: 0.7 },
  exit: { preset: "fade", duration: 0.6 },
  easing: "easeInOut",
  logo: "",
  density: "low",
  safeMargins: { x: 0.07, y: 0.08 },
};

export const BUILTIN_KITS: readonly BrandKit[] = [CLEAN_DOCUMENTARY, BOLD_NEWS, SOFT_STORY];
export const DEFAULT_KIT_ID = CLEAN_DOCUMENTARY.id;

export const isBuiltinKit = (id: string): boolean => BUILTIN_KITS.some((kit) => kit.id === id);
