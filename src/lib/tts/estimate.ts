/** About how long a script takes to read aloud, so the person can see the length before making it. */

const WIDE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/gu;

export interface ScriptStats {
  characters: number;
  /** Words of languages written with spaces (English...). */
  words: number;
  /** Korean / Japanese / Chinese characters. */
  wideCharacters: number;
  /** Rough speaking time. */
  seconds: number;
  /** How many pieces the voice is made in (a rough count). */
  pieces: number;
}

/** English is read at about 150 words a minute, Korean at about 300 characters a minute. */
export function scriptStats(text: string): ScriptStats {
  const wideCharacters = (text.match(WIDE) ?? []).length;
  const withoutWide = text.replace(WIDE, " ");
  const words = withoutWide.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const seconds = Math.round((words / 150 + wideCharacters / 300) * 60);
  const weight = withoutWide.replace(/\s+/gu, " ").trim().length + wideCharacters * 2;
  return { characters: text.length, words, wideCharacters, seconds, pieces: weight === 0 ? 0 : Math.max(1, Math.ceil(weight / 1200)) };
}

export function formatLength(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
