import type { City } from "../geo/cities.ts";
import { COUNTRIES, normalizeName } from "../library/countries.ts";

/** A country or city found in a text. */
export interface PlaceMatch {
  /** Character range in the text. */
  start: number;
  end: number;
  text: string;
  /** ISO alpha-2 code of the country (of the city's country for a city). */
  code: string;
  /** The English name when it is a city. */
  city?: string;
  lat?: number;
  lon?: number;
}

interface Entry {
  code: string;
  city?: City;
}

export interface PlaceIndex {
  /** Normalised name -> place, for names written with spaces between words. */
  byName: ReadonlyMap<string, Entry>;
  /** Names without spaces between words (Chinese and Japanese), found inside the text. */
  cjk: ReadonlyArray<{ name: string; entry: Entry }>;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
/** Particles that stick to the end of a Korean word (은/는, 에서, 으로 ...). */
const KO_PARTICLES_2 = ["에서", "으로", "에게", "부터", "까지", "처럼", "이라", "라는"];
const KO_PARTICLES_1 = ["은", "는", "이", "가", "을", "를", "의", "도", "에", "와", "과", "로", "만"];

/** Everyday names that are not the official ones in the tables (the official name of Korea is 대한민국, people say 한국). */
export const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  US: ["America", "USA", "امریکہ", "امریکا", "아메리카", "アメリカ", "米国", "美国"],
  GB: ["UK", "Britain", "Great Britain", "England", "انگلینڈ", "英国"],
  IN: ["بھارت", "ہندوستان", "भारत"],
  KR: ["한국", "韓国", "جنوبی کوریا"],
  KP: ["北朝鮮"],
  RU: ["Russia", "러시아", "ロシア"],
  CN: ["中国", "چین"],
  IR: ["ایران", "イラン"],
  AE: ["UAE", "امارات"],
  NL: ["Holland"],
  TR: ["Türkiye", "ترکیہ"],
  MM: ["Burma"],
};

/** "서울특별시" -> "서울", "東京都" -> "東京": what people say for a city whose official name has a ending. */
const CITY_ENDINGS = /(?:특별자치시|특별자치도|특별시|광역시|시|도|特別市|特別区|都|府|県|市)$/u;

/** Builds the lookup of country and city names (all bundled languages). Countries win over cities with the same name. */
export function buildPlaceIndex(cities: readonly City[]): PlaceIndex {
  const byName = new Map<string, Entry>();
  const cjk: Array<{ name: string; entry: Entry }> = [];
  const add = (name: string, entry: Entry, replace: boolean, acronym = false): void => {
    const raw = name.trim();
    if (raw === "") return;
    if (CJK.test(raw)) {
      if (raw.length >= 2) cjk.push({ name: raw, entry });
      return;
    }
    const key = normalizeName(raw);
    // Three letters at least in Latin and Cyrillic (so "Ho" or "Ur" do not match); two are enough in the other scripts.
    if (key.length < (/^[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(key) && !acronym ? 3 : 2)) return;
    if (replace || !byName.has(key)) byName.set(key, entry);
  };
  for (const city of [...cities].sort((a, b) => b.pop - a.pop)) {
    for (const name of [city.name, ...Object.values(city.names ?? {})]) {
      add(name, { code: city.cc, city }, false);
      const short = name.replace(CITY_ENDINGS, "");
      if (short !== name && short.length >= 2 && /[\p{Script=Hangul}\p{Script=Han}\p{Script=Katakana}]/u.test(short)) add(short, { code: city.cc, city }, false);
    }
  }
  for (const country of COUNTRIES) {
    for (const list of Object.values(country.names)) for (const name of list ?? []) add(name, { code: country.a2 }, true);
  }
  for (const [code, names] of Object.entries(COUNTRY_ALIASES)) for (const name of names) add(name, { code }, true, true);
  cjk.sort((a, b) => b.name.length - a.name.length);
  return { byName, cjk };
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’.-]*/gu)) {
    const raw = m[0].replace(/[.'’-]+$/u, "");
    if (raw !== "") out.push({ text: raw, start: m.index ?? 0, end: (m.index ?? 0) + raw.length });
  }
  return out;
}

function lookup(index: PlaceIndex, words: readonly string[], last: Token): Entry | undefined {
  const direct = index.byName.get(normalizeName(words.join(" ")));
  if (direct) return direct;
  if (!HANGUL.test(last.text)) return undefined;
  // A Korean word with a particle on the end: 파키스탄에서 -> 파키스탄.
  for (const list of [KO_PARTICLES_2, KO_PARTICLES_1]) {
    for (const particle of list) {
      if (last.text.length > particle.length && last.text.endsWith(particle)) {
        const stem = [...words.slice(0, -1), last.text.slice(0, last.text.length - particle.length)];
        const hit = index.byName.get(normalizeName(stem.join(" ")));
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

/** All countries and cities named in a text, left to right, the longest name first, without overlaps. */
export function findPlaces(text: string, index: PlaceIndex): PlaceMatch[] {
  const found: PlaceMatch[] = [];
  const taken = (start: number, end: number): boolean => found.some((f) => start < f.end && end > f.start);
  const toMatch = (start: number, end: number, entry: Entry): PlaceMatch => ({
    start, end, text: text.slice(start, end), code: entry.code,
    ...(entry.city ? { city: entry.city.name, lat: entry.city.lat, lon: entry.city.lon } : {}),
  });

  const tokens = tokensOf(text);
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
      const slice = tokens.slice(i, i + n);
      const first = slice[0] as Token;
      const last = slice[n - 1] as Token;
      // Words are neighbours: only spaces between them.
      if (n > 1 && slice.some((t, k) => k > 0 && !/^\s+$/u.test(text.slice((slice[k - 1] as Token).end, t.start)))) continue;
      // In Latin and Cyrillic a place name is written with a capital letter (so "nice weather" is not a city).
      if (/^[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(first.text) && !/^\p{Lu}/u.test(first.text)) continue;
      const entry = lookup(index, slice.map((t) => t.text), last);
      if (!entry) continue;
      const end = last.end;
      if (taken(first.start, end)) continue;
      found.push(toMatch(first.start, end, entry));
      i += n - 1;
      break;
    }
  }
  for (const { name, entry } of index.cjk) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      if (!taken(at, at + name.length)) found.push(toMatch(at, at + name.length, entry));
      from = at + name.length;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
