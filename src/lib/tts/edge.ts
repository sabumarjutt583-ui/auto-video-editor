import type { EdgeVoice } from "./api.ts";

/** Keeps only the Microsoft voices for one language: "ko" matches "ko-KR",
 * "ko-KR" matches exactly, and an empty language keeps everything. */
export function filterEdgeVoices(voices: readonly EdgeVoice[], language: string): EdgeVoice[] {
  const wanted = language.trim().toLowerCase();
  if (wanted === "") return [...voices];
  return voices.filter((voice) => {
    const locale = voice.locale.toLowerCase();
    return (
      locale === wanted ||
      (!wanted.includes("-") && locale.split("-")[0] === wanted) ||
      locale.startsWith(`${wanted}-`)
    );
  });
}

/** The distinct languages in a voice list, in first-seen order ("ko-KR"). */
export function edgeLanguages(voices: readonly EdgeVoice[]): string[] {
  const seen = new Set<string>();
  for (const voice of voices) {
    if (voice.locale !== "") seen.add(voice.locale);
  }
  return [...seen];
}
