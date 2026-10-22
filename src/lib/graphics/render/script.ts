/** Writing systems the renderer has a bundled font for. */
export type Script = "latin" | "cyrillic" | "korean" | "japanese" | "chinese" | "devanagari" | "arabic";

const RANGES: ReadonlyArray<readonly [Script, number, number]> = [
  ["korean", 0xac00, 0xd7af], ["korean", 0x1100, 0x11ff], ["korean", 0x3130, 0x318f],
  ["japanese", 0x3040, 0x30ff], ["japanese", 0x31f0, 0x31ff], ["japanese", 0xff66, 0xff9f],
  ["chinese", 0x4e00, 0x9fff], ["chinese", 0x3400, 0x4dbf],
  ["devanagari", 0x0900, 0x097f],
  ["arabic", 0x0600, 0x06ff], ["arabic", 0x0750, 0x077f], ["arabic", 0x08a0, 0x08ff], ["arabic", 0xfb50, 0xfdff], ["arabic", 0xfe70, 0xfeff],
  ["cyrillic", 0x0400, 0x04ff],
];

export function scriptOfChar(code: number): Script | null {
  for (const [script, from, to] of RANGES) if (code >= from && code <= to) return script;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f)) return "latin";
  return null;
}

/**
 * The main script of a text. Counts letters per script; kana makes a Han text Japanese; digits and punctuation do not count.
 * A text with no letters is "latin".
 */
export function detectScript(text: string): Script {
  const counts: Record<Script, number> = { latin: 0, cyrillic: 0, korean: 0, japanese: 0, chinese: 0, devanagari: 0, arabic: 0 };
  for (const ch of text) {
    const script = scriptOfChar(ch.codePointAt(0) ?? 0);
    if (script) counts[script]++;
  }
  if (counts.japanese > 0 && counts.japanese + counts.chinese >= Math.max(counts.latin, counts.cyrillic, counts.korean, counts.devanagari, counts.arabic)) return "japanese";
  let best: Script = "latin";
  let bestCount = 0;
  for (const script of Object.keys(counts) as Script[]) {
    if (counts[script] > bestCount) {
      best = script;
      bestCount = counts[script];
    }
  }
  return best;
}

export const isRtl = (script: Script): boolean => script === "arabic";

/** True for characters that may break a line between each other (no spaces in the writing system). */
export function breaksEverywhere(code: number): boolean {
  const script = scriptOfChar(code);
  return script === "korean" ? false : script === "japanese" || script === "chinese" || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef);
}

/** True when the text is written right to left (Urdu, Arabic ...), so cards and lists mirror their layout. */
export const isRtlText = (...texts: string[]): boolean => isRtl(detectScript(texts.join(" ")));
