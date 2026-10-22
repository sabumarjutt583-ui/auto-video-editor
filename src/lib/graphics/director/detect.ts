import { findNumbers, normalizeDigits, type Span } from "./numbers.ts";
import { findComparisons, findLists, findPersons, findQuotes } from "./phrases.ts";
import { findPlaces, type PlaceIndex } from "./places.ts";
import type { SceneInput, TimedWord, Trigger, TriggerKind } from "./types.ts";

const CJK_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

interface Joined {
  text: string;
  starts: number[];
  ends: number[];
}

/** The words as one text (a space between words, none between Chinese or Japanese characters), with where each word sits. */
export function joinWords(words: readonly TimedWord[]): Joined {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  words.forEach((word, i) => {
    const piece = word.text.trim();
    const prev = words[i - 1]?.text.trim() ?? "";
    if (i > 0 && !(CJK_EDGE.test(prev.slice(-1)) || CJK_EDGE.test(piece.slice(0, 1))) && !/^[,.;:!?)\]”»」』、。，！？]/u.test(piece)) text += " ";
    starts.push(text.length);
    text += piece;
    ends.push(text.length);
  });
  return { text, starts, ends };
}

function wordAt(joined: Joined, char: number): number {
  let lo = 0;
  let hi = joined.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((joined.starts[mid] as number) <= char) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

function spansOf(text: string, places: PlaceIndex): Array<Span & { code?: string; city?: string; lat?: number; lon?: number }> {
  const norm = normalizeDigits(text);
  const all: Array<Span & { code?: string; city?: string; lat?: number; lon?: number }> = [
    ...findNumbers(norm),
    ...findPlaces(text, places).map((p) => ({ kind: "place" as const, start: p.start, end: p.end, code: p.code, ...(p.city ? { city: p.city, lat: p.lat as number, lon: p.lon as number } : {}) })),
    ...findQuotes(text),
    ...findComparisons(text),
    ...findLists(norm),
  ];
  const persons = findPersons(text).filter((p) => !all.some((a) => a.kind === "place" && p.start < a.end && p.end > a.start));
  const merged = [...all, ...persons].sort((a, b) => a.start - b.start || a.end - b.end);
  // One list trigger per scene is enough (the first); "three reasons ... first ... second" is one list.
  let seenList = false;
  return merged.filter((s) => (s.kind === "list" ? !seenList && (seenList = true) : true));
}

/** Candidate moments for a graphic in one scene, with the exact start time of the first word (words known) or an estimate (script only). */
export function detectTriggers(scene: SceneInput, places: PlaceIndex): Trigger[] {
  const out: Trigger[] = [];
  if (scene.words.length > 0) {
    const joined = joinWords(scene.words);
    for (const span of spansOf(joined.text, places)) {
      const first = wordAt(joined, span.start);
      const last = wordAt(joined, Math.max(span.start, span.end - 1));
      out.push(toTrigger(span, joined.text, scene.words[first]?.start ?? scene.start, scene.words[last]?.end ?? scene.end, first, true));
    }
  }
  // The script's own wording can have things the transcript wrote differently (digits against number words). Estimate their time.
  const script = scene.text.trim();
  if (script !== "") {
    const length = Math.max(1, script.length);
    for (const span of spansOf(script, places)) {
      const t = toTrigger(span, script, scene.start + ((span.start + 0) / length) * (scene.end - scene.start), scene.start + (span.end / length) * (scene.end - scene.start), -1, false);
      if (!out.some((o) => same(o, t))) out.push(t);
    }
  }
  return out.sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind));
}

const squash = (text: string): string => normalizeDigits(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function same(a: Trigger, b: Trigger): boolean {
  if (a.kind !== b.kind) return false;
  if (a.value !== undefined && b.value !== undefined) return a.value === b.value;
  if (a.code !== undefined || b.code !== undefined) return a.code === b.code && a.city === b.city;
  return squash(a.text) === squash(b.text) || Math.abs(a.time - b.time) < 0.5;
}

function toTrigger(span: Span & { code?: string; city?: string; lat?: number; lon?: number }, text: string, time: number, endTime: number, wordIndex: number, exact: boolean): Trigger {
  return {
    kind: span.kind,
    text: text.slice(span.start, span.end),
    time: Math.round(time * 1000) / 1000,
    endTime: Math.round(endTime * 1000) / 1000,
    wordIndex,
    exact,
    ...(span.value !== undefined ? { value: span.value } : {}),
    ...(span.currency ? { currency: span.currency } : {}),
    ...(span.code ? { code: span.code } : {}),
    ...(span.city ? { city: span.city } : {}),
    ...(span.lat !== undefined ? { lat: span.lat } : {}),
    ...(span.lon !== undefined ? { lon: span.lon } : {}),
  };
}

/** How much a kind of trigger is worth a graphic (used to pick scenes when the density is limited). */
export const TRIGGER_WEIGHT: Record<TriggerKind, number> = { money: 3, percent: 3, list: 3, quote: 3, comparison: 2.5, place: 2.5, number: 2, person: 2, date: 1.5 };

/** How good a scene is for a graphic: its best trigger counts fully, every other one a little. */
export function sceneScore(triggers: readonly Trigger[]): number {
  const weights = triggers.map((t) => TRIGGER_WEIGHT[t.kind]).sort((a, b) => b - a);
  return weights.reduce((sum, w, i) => sum + (i === 0 ? w : Math.min(0.5, w * 0.2)), 0);
}
