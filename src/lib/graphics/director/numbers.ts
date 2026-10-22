import { CURRENCY_SYMBOLS, CURRENCY_WORDS, DAYS_EN, MONTHS_EN, MONTHS_UR, PERCENT_WORDS, SCALES, YEAR_BEFORE } from "./patterns.ts";
import type { TriggerKind } from "./types.ts";

/** A found number, amount, percentage or date, as a character range of the text. */
export interface Span {
  kind: TriggerKind;
  start: number;
  end: number;
  value?: number;
  currency?: string;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const longestFirst = (list: readonly string[]): string => [...list].sort((a, b) => b.length - a.length).map(esc).join("|");

const NUMBER = String.raw`\d{1,3}(?:[,٬]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const SCALE_RE = word(SCALES.map(([w]) => w));
const CURRENCY_RE = word(CURRENCY_WORDS.map(([w]) => w));
const SYMBOL_RE = CURRENCY_SYMBOLS.map(([s]) => esc(s)).join("");
const PERCENT_RE = word(PERCENT_WORDS);
/** Words of the alphabets that put spaces between words must not be the start of a longer word; Chinese, Japanese and Korean attach counters and particles. */
function word(list: readonly string[]): string {
  const spaced = list.filter((w) => /^[\p{Script=Latin}\p{Script=Arabic}]/u.test(w));
  const attached = list.filter((w) => !spaced.includes(w));
  const parts: string[] = [];
  if (spaced.length > 0) parts.push(`(?:${longestFirst(spaced)})(?![\\p{L}])`);
  if (attached.length > 0) parts.push(longestFirst(attached));
  return `(?:${parts.join("|")})`;
}

const scaleOf = (word: string | undefined): number => (word ? (SCALES.find(([w]) => w === word.toLowerCase())?.[1] ?? 1) : 1);
const parseNumber = (text: string): number => Number(text.replace(/[,٬]/g, ""));
const currencyOf = (word: string): string => CURRENCY_WORDS.find(([w]) => w === word.toLowerCase())?.[1] ?? "";

/** Arabic-Indic and Persian digits (Urdu writes ۱۲۳) as 0-9. The text keeps its length. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

const ONES = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const WORD_VALUES: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_NUMBER = new RegExp(String.raw`\b(?:(?:a|${ONES})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\s+)?(?:hundred|thousand|million|billion|trillion)(?:\s+(?:and\s+)?(?:(?:${ONES})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\s+)?(?:hundred|thousand|million|billion))*\b`, "giu");

/** The value of English number words: `two million` = 2000000, `twenty five thousand` = 25000. */
export function wordsValue(phrase: string): number {
  let total = 0;
  let current = 0;
  for (const raw of phrase.toLowerCase().split(/[\s-]+/)) {
    if (raw === "and") continue;
    const small = WORD_VALUES[raw];
    if (small !== undefined) current += small;
    else if (raw === "hundred") current = (current || 1) * 100;
    else {
      const scale = scaleOf(raw);
      total += (current || 1) * scale;
      current = 0;
    }
  }
  return total + current;
}

function free(taken: Span[], start: number, end: number): boolean {
  return !taken.some((t) => start < t.end && end > t.start);
}

/** Money, percentages, dates and plain numbers in a text (digits already normalised). Longer, more specific kinds win. */
export function findNumbers(text: string): Span[] {
  const spans: Span[] = [];
  const push = (span: Span): void => {
    if (free(spans, span.start, span.end)) spans.push(span);
  };

  // Money: $5 million, 5 million dollars, 3000 روپے, 5억 원, 3万円
  for (const m of text.matchAll(new RegExp(String.raw`([${SYMBOL_RE}])\s?(${NUMBER})(?:\s?(${SCALE_RE}))?`, "giu"))) {
    const symbol = m[1] as string;
    push({ kind: "money", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: parseNumber(m[2] as string) * scaleOf(m[3]), currency: CURRENCY_SYMBOLS.find(([s]) => s === symbol)?.[1] ?? symbol });
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUMBER})\s?(?:(${SCALE_RE})\s?)?(${CURRENCY_RE})`, "giu"))) {
    push({ kind: "money", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: parseNumber(m[1] as string) * scaleOf(m[2]), currency: currencyOf(m[3] as string) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${WORD_NUMBER.source})\s+(${CURRENCY_RE})`, "giu"))) {
    push({ kind: "money", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: wordsValue(m[1] as string), currency: currencyOf(m[2] as string) });
  }
  // Percent: 45%, 45 percent, 45 فیصد, 45퍼센트, 45パーセント, forty percent
  for (const m of text.matchAll(new RegExp(String.raw`(${NUMBER})\s?(?:${PERCENT_RE})`, "giu"))) {
    push({ kind: "percent", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: parseNumber(m[1] as string) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b((?:${ONES})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)\s+(?:percent|per cent)\b`, "giu"))) {
    push({ kind: "percent", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: wordsValue(m[1] as string) });
  }
  // Dates: March 5, 5 March 2020, 3월 5일, 3月5日, years with a clue (in 1999, 1990s, 2020年, 2020년, سال 2020)
  const months = longestFirst([...MONTHS_EN, ...MONTHS_UR]);
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}\d])(?:(?:${months})\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:${months})(?:,?\s+\d{4})?|(?:${months})\s+\d{4})(?![\p{L}\d])`, "giu"))) {
    push({ kind: "date", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of text.matchAll(/\d{1,2}\s?[月월]\s?\d{1,2}\s?[日일]|\d{4}\s?[年년](?:\s?\d{1,2}\s?[月월])?/gu)) {
    const year = /\d{4}/.exec(m[0])?.[0];
    push({ kind: "date", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, ...(year ? { value: Number(year) } : {}) });
  }
  // A four-digit number is a year when a word before it says so (in 1999, since 2010, سال 2020), when it is a decade (1990s),
  // or when Urdu "میں" follows it (2020 میں).
  for (const m of text.matchAll(/(?<![\p{Script=Latin}\p{Script=Arabic}\p{Script=Cyrillic}\d.,])((?:1[0-9]|20)\d{2})(s|'s|’s)?(?![\p{L}\d])/giu)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const lead = text.slice(Math.max(0, start - 12), start);
    const clue = new RegExp(String.raw`(?:^|[^\p{L}])(?:${longestFirst(YEAR_BEFORE)})\s+$`, "iu").test(lead);
    const after = text.slice(end, end + 6).trimStart();
    if (clue || m[2] !== undefined || /^(?:میں|ء)/u.test(after)) push({ kind: "date", start, end, value: Number(m[1]) });
  }
  // Numbers with a scale (3.5 million, 20 لاکھ, 5억, 3万), number words with a scale (two million), plain numbers of 10 or more.
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{Script=Latin}\p{Script=Arabic}\p{Script=Cyrillic}\d.,])(${NUMBER})\s?(${SCALE_RE})`, "giu"))) {
    push({ kind: "number", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: parseNumber(m[1] as string) * scaleOf(m[2]) });
  }
  for (const m of text.matchAll(WORD_NUMBER)) push({ kind: "number", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: wordsValue(m[0]) });
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{Script=Latin}\p{Script=Arabic}\p{Script=Cyrillic}\d.,])(${NUMBER})(?![\p{Script=Latin}\d])`, "gu"))) {
    const value = parseNumber(m[1] as string);
    const end = (m.index ?? 0) + m[0].length;
    // Small whole numbers ("in 2 days", "step 1") are not worth a graphic.
    if (value < 10 && !m[0].includes(".")) continue;
    // A date like 12.05 or a version like 3.2.1 is not an amount.
    if (/^[.,]\d/.test(text.slice(end, end + 2))) continue;
    push({ kind: "number", start: m.index ?? 0, end, value });
  }
  return mergeCompound(spans.sort((a, b) => a.start - b.start), text);
}

/** 1億2000万 is one number (120 million): a number that ends in a big Chinese-style unit joins the amount written right after it. */
function mergeCompound(spans: Span[], text: string): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "number" && /[兆億万조억만]$/u.test(text.slice(prev.start, prev.end)) && span.start === prev.end && (span.kind === "number" || span.kind === "money") && span.value !== undefined && prev.value !== undefined) {
      out[out.length - 1] = { ...span, start: prev.start, value: prev.value + span.value };
    } else out.push(span);
  }
  return out;
}

export const MONTH_AND_DAY_NAMES: ReadonlySet<string> = new Set([...MONTHS_EN, ...DAYS_EN]);
