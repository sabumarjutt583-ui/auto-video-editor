import type { CaptionScript } from "../../types/editor.ts";

const HANGUL = /\p{Script=Hangul}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HAN = /\p{Script=Han}/gu;
const DEVANAGARI = /\p{Script=Devanagari}/gu;
const ARABIC = /\p{Script=Arabic}/gu;
const LATIN = /\p{Script=Latin}/gu;
/** Letters that Urdu uses and Arabic does not (ٹ ڈ ڑ ں ے ھ ہ ۂ ۃ گ چ پ ژ ک ی). */
const URDU_ONLY = /[ٹڈڑںھہۂۃےگچپژکی]/gu;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** The main writing system of a text. Japanese wins over Chinese when kana are present. */
export function detectScript(text: string): CaptionScript {
  const counts: [CaptionScript, number][] = [
    ["korean", count(text, HANGUL)],
    ["japanese", count(text, KANA)],
    ["chinese", count(text, HAN)],
    ["devanagari", count(text, DEVANAGARI)],
    ["arabic", count(text, ARABIC)],
    ["latin", count(text, LATIN)],
  ];
  // Kana mixed with Han are Japanese; Han alone are Chinese.
  const kana = counts[1]?.[1] ?? 0;
  const han = counts[2]?.[1] ?? 0;
  if (kana > 0 && han > 0) counts[1] = ["japanese", kana + han], (counts[2] = ["chinese", 0]);
  let best: [CaptionScript, number] = ["other", 0];
  for (const entry of counts) if (entry[1] > best[1]) best = entry;
  if (best[0] === "arabic" && count(text, URDU_ONLY) > 0) return "urdu";
  return best[0];
}

/** How many characters fit on one caption line. */
export function maxCharsPerLine(script: CaptionScript): number {
  switch (script) {
    case "korean":
    case "japanese":
    case "chinese":
      return 16;
    case "devanagari":
    case "arabic":
    case "urdu":
      return 28;
    default:
      return 32;
  }
}

export function isRtl(script: CaptionScript): boolean {
  return script === "arabic" || script === "urdu";
}

/** Uppercase only makes sense for Latin letters. */
export function supportsUppercase(script: CaptionScript): boolean {
  return script === "latin";
}
