import table from "../assets/countries.json" with { type: "json" };

/** ISO 3166-1 countries (plus Kosovo as XK) with names in the languages the app supports. Data: i18n-iso-countries (MIT). */
export interface CountryRow {
  /** Upper-case ISO alpha-2 code. */
  a2: string;
  a3: string;
  /** ISO numeric code as text ("004"), empty for Kosovo. */
  n: string;
  names: Partial<Record<CountryLang, string[]>>;
}
export type CountryLang = "en" | "ur" | "ko" | "ja" | "ru" | "hi" | "zh" | "ar" | "fa";

export const COUNTRIES: readonly CountryRow[] = table as CountryRow[];

const byA2 = new Map(COUNTRIES.map((c) => [c.a2, c]));
const byNumeric = new Map(COUNTRIES.filter((c) => c.n).map((c) => [c.n, c]));

export function countryByCode(code: string): CountryRow | undefined {
  return byA2.get(code.toUpperCase());
}

/** The country of a world-atlas id (ISO numeric, "004" or "4"). */
export function countryByNumeric(id: string | number): CountryRow | undefined {
  return byNumeric.get(String(id).padStart(3, "0"));
}

/** The first name of a country in a language, English when there is none. */
export function countryName(code: string, lang: CountryLang = "en"): string | undefined {
  const row = byA2.get(code.toUpperCase());
  return row?.names[lang]?.[0] ?? row?.names.en?.[0];
}

/** Letters only, lower case, no accents: "São  Tomé" and "sao tome" match. */
export function normalizeName(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

let nameIndex: Map<string, string> | null = null;

/** Finds a country by any of its names in any supported language (exact, after normalising). */
export function findCountryByName(text: string): CountryRow | undefined {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const row of COUNTRIES) {
      for (const list of Object.values(row.names)) for (const name of list ?? []) if (!nameIndex.has(normalizeName(name))) nameIndex.set(normalizeName(name), row.a2);
    }
  }
  const code = nameIndex.get(normalizeName(text));
  return code ? byA2.get(code) : undefined;
}
