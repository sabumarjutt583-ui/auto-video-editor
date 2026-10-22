import { detectScript } from "../render/script.ts";

/** Seconds a viewer needs per word, plus a moment to notice the graphic. */
export const SECONDS_PER_WORD = 0.3;
export const NOTICE_SECONDS = 0.5;

/** Words of a text. Chinese and Japanese have no spaces: about two characters make one word. */
export function wordCount(text: string): number {
  const clean = text.trim();
  if (clean === "") return 0;
  const script = detectScript(clean);
  if (script === "chinese" || script === "japanese") {
    const characters = [...clean.replace(/[\s\p{P}\p{S}]/gu, "")].length;
    return Math.max(1, Math.ceil(characters / 2));
  }
  return clean.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** How long the words of a text must stay on screen: 0.3 s per word plus 0.5 s. */
export function readingSeconds(text: string): number {
  const words = wordCount(text);
  return words === 0 ? 0 : Math.round((words * SECONDS_PER_WORD + NOTICE_SECONDS) * 100) / 100;
}
