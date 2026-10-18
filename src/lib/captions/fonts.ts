import type { CaptionFont, CaptionScript } from "../../types/editor.ts";

export interface FontInfo {
  id: Exclude<CaptionFont, "auto">;
  /** The family name used in the ASS file and in the preview. */
  family: string;
  label: string;
  regular: string;
  bold: string;
}

/** The fonts in resources/fonts. */
export const FONTS: readonly FontInfo[] = [
  { id: "noto_sans", family: "Noto Sans", label: "Noto Sans (Latin, Cyrillic, Greek)", regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" },
  { id: "noto_kr", family: "Noto Sans KR", label: "Noto Sans KR (Korean)", regular: "NotoSansKR-Regular.otf", bold: "NotoSansKR-Bold.otf" },
  { id: "noto_jp", family: "Noto Sans JP", label: "Noto Sans JP (Japanese)", regular: "NotoSansJP-Regular.otf", bold: "NotoSansJP-Bold.otf" },
  { id: "noto_sc", family: "Noto Sans SC", label: "Noto Sans SC (Chinese)", regular: "NotoSansSC-Regular.otf", bold: "NotoSansSC-Bold.otf" },
  { id: "noto_devanagari", family: "Noto Sans Devanagari", label: "Noto Sans Devanagari (Nepali, Hindi)", regular: "NotoSansDevanagari-Regular.ttf", bold: "NotoSansDevanagari-Bold.ttf" },
  { id: "noto_arabic", family: "Noto Sans Arabic", label: "Noto Sans Arabic", regular: "NotoSansArabic-Regular.ttf", bold: "NotoSansArabic-Bold.ttf" },
];

const BY_SCRIPT: Record<CaptionScript, FontInfo["id"]> = {
  latin: "noto_sans",
  other: "noto_sans",
  korean: "noto_kr",
  japanese: "noto_jp",
  chinese: "noto_sc",
  devanagari: "noto_devanagari",
  arabic: "noto_arabic",
  // Noto Nastaliq Urdu looks better but FFmpeg's caption renderer (libass) draws it as empty boxes, so Urdu uses Noto Sans Arabic.
  urdu: "noto_arabic",
};

export function fontById(id: FontInfo["id"]): FontInfo {
  return FONTS.find((font) => font.id === id) ?? (FONTS[0] as FontInfo);
}

/** The font for a script, or the one the user chose. */
export function resolveFont(choice: CaptionFont, script: CaptionScript): FontInfo {
  return fontById(choice === "auto" ? BY_SCRIPT[script] : choice);
}

/** The font to try for a text in case of mixed scripts: the script's font first, then Noto Sans. */
export function fallbackFamilies(font: FontInfo): string {
  return font.id === "noto_sans" ? `"${font.family}", sans-serif` : `"${font.family}", "Noto Sans", sans-serif`;
}
