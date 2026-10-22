import { MONTH_AND_DAY_NAMES, type Span } from "./numbers.ts";
import { COMPARISON_PATTERNS, LIST_PATTERNS, NOT_NAMES, ORDINALS, TITLES_JA_AFTER, TITLES_KO_AFTER, TITLES_LATIN, TITLES_UR } from "./patterns.ts";

const UR_LITTLE_WORDS = new Set(["نے", "کا", "کی", "کے", "کو", "سے", "میں", "اور", "پر", "نے،", "ہے", "ہیں", "تھا", "تھی", "نے۔"]);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (list: readonly string[]): string => [...list].sort((a, b) => b.length - a.length).map(esc).join("|");

/** A person's name: a title with a name, or two or three capitalised words (Latin, Cyrillic); Urdu, Korean and Japanese titles. */
export function findPersons(text: string): Span[] {
  const out: Span[] = [];
  const add = (start: number, end: number): void => {
    if (!out.some((o) => start < o.end && end > o.start)) out.push({ kind: "person", start, end });
  };
  // Title + name: Dr. Amina Khan, President Lincoln
  const titled = new RegExp(String.raw`(?<![\p{L}])(?:${alt(TITLES_LATIN)})\.?\s+\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+){0,2}`, "giu");
  for (const m of text.matchAll(titled)) add(m.index ?? 0, (m.index ?? 0) + m[0].length);
  // Two or three capitalised words in a row that are not the start of a sentence.
  for (const m of text.matchAll(/(?<![\p{L}])\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+){1,2}(?![\p{L}])/gu)) {
    const start = m.index ?? 0;
    const words = m[0].split(/\s+/);
    const first = (words[0] as string).toLowerCase();
    if (NOT_NAMES.has(first) || words.some((w) => MONTH_AND_DAY_NAMES.has(w.toLowerCase()))) continue;
    if (words.some((w) => NOT_NAMES.has(w.toLowerCase()))) continue;
    add(start, start + m[0].length);
  }
  // Urdu: ڈاکٹر عائشہ خان
  const ur = new RegExp(String.raw`(?:${alt(TITLES_UR)})\s+[\p{Script=Arabic}]{2,}(?:\s+[\p{Script=Arabic}]{2,}){0,2}`, "gu");
  for (const m of text.matchAll(ur)) {
    // Drop the Urdu little words that follow a name: ڈاکٹر عائشہ خان نے -> ڈاکٹر عائشہ خان
    const kept = m[0].split(/\s+/);
    while (kept.length > 1 && UR_LITTLE_WORDS.has(kept[kept.length - 1] as string)) kept.pop();
    add(m.index ?? 0, (m.index ?? 0) + kept.join(" ").length);
  }
  // Korean: 김철수 박사, 홍길동 씨
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}])\p{Script=Hangul}{2,4}\s?(?:${alt(TITLES_KO_AFTER)})`, "gu"))) add(m.index ?? 0, (m.index ?? 0) + m[0].length);
  // Japanese: 田中さん, 山田博士
  for (const m of text.matchAll(new RegExp(String.raw`(?:\p{Script=Han}{1,4}|\p{Script=Katakana}{2,10})(?:${alt(TITLES_JA_AFTER)})`, "gu"))) add(m.index ?? 0, (m.index ?? 0) + m[0].length);
  return out.sort((a, b) => a.start - b.start);
}

/** Quoted speech: “...”, "...", «...», 「...」, 『...』 with at least a few words inside. */
export function findQuotes(text: string): Span[] {
  const out: Span[] = [];
  const patterns = [/“[^”]{12,}”/gu, /"[^"]{12,}"/gu, /«[^»]{12,}»/gu, /「[^」]{6,}」/gu, /『[^』]{6,}』/gu, /‘[^’]{14,}’/gu];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (!out.some((o) => start < o.end && start + m[0].length > o.start)) out.push({ kind: "quote", start, end: start + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** "vs", "compared to", "more than", "کے مقابلے میں", "에 비해", "に比べて" ... */
export function findComparisons(text: string): Span[] {
  const out: Span[] = [];
  for (const re of COMPARISON_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) out.push({ kind: "comparison", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A narrator counting through items: "top 5", "three reasons", "first ... second ...", numbered lines, or three or more short
 * items separated by commas. The trigger sits at the first word of the list.
 */
export function findLists(text: string): Span[] {
  const out: Span[] = [];
  for (const re of LIST_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) out.push({ kind: "list", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  const lower = text.toLowerCase();
  for (const words of ORDINALS) {
    const hits: Array<{ at: number; len: number }> = [];
    for (const word of words) {
      const re = /^[a-z]+$/.test(word) ? new RegExp(String.raw`(?<![a-z])${word}(?![a-z])`, "g") : new RegExp(esc(word), "gu");
      for (const m of lower.matchAll(re)) hits.push({ at: m.index ?? 0, len: m[0].length });
    }
    // Different words, not the same word twice.
    const distinct = new Set(hits.map((h) => lower.slice(h.at, h.at + h.len)));
    if (distinct.size >= 2) {
      hits.sort((a, b) => a.at - b.at);
      const first = hits[0] as { at: number; len: number };
      out.push({ kind: "list", start: first.at, end: first.at + first.len });
    }
  }
  for (const m of text.matchAll(/(?:^|\s)(\d{1,2}[.)])\s+\p{L}/gu)) {
    const nums = [...text.matchAll(/(?:^|\s)\d{1,2}[.)]\s+\p{L}/gu)];
    if (nums.length >= 2) {
      const at = (m.index ?? 0) + m[0].indexOf(m[1] as string);
      out.push({ kind: "list", start: at, end: at + (m[1] as string).length });
    }
  }
  // Three or more short items: apples, oranges, bananas and pears.
  const item = String.raw`[\p{L}'’-]+(?:\s[\p{L}'’-]+){0,3}`;
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}])${item}(?:,\s*${item}){2,}(?:,?\s+(?:and|or|اور|یا)\s+${item})?`, "giu"))) {
    out.push({ kind: "list", start: m.index ?? 0, end: (m.index ?? 0) + (m[0].indexOf(",") > 0 ? m[0].indexOf(",") : m[0].length) });
  }
  const sorted = out.sort((a, b) => a.start - b.start);
  return sorted.filter((s, i) => i === 0 || s.start >= (sorted[i - 1] as Span).end);
}
