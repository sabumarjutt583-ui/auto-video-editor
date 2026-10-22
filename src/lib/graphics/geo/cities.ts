import { normalizeName } from "../library/countries.ts";

/** Natural Earth populated places (public domain), the 1,248 largest and most important places. */
export interface City {
  name: string;
  /** Upper-case ISO alpha-2 code. */
  cc: string;
  lat: number;
  lon: number;
  pop: number;
  capital: 0 | 1;
  /** Names in other languages (ur, ko, ja, ru, hi, zh, ar, fa) when they differ from `name`. */
  names?: Partial<Record<"ur" | "ko" | "ja" | "ru" | "hi" | "zh" | "ar" | "fa", string>>;
}

let cities: Promise<readonly City[]> | null = null;
let byName: Map<string, City[]> | null = null;

export function loadCities(): Promise<readonly City[]> {
  cities ??= import("../assets/cities.json", { with: { type: "json" } }).then((m) => m.default as City[]);
  return cities;
}

function indexOf(list: readonly City[]): Map<string, City[]> {
  if (!byName) {
    byName = new Map<string, City[]>();
    for (const city of list) {
      for (const name of [city.name, ...Object.values(city.names ?? {})]) {
        const key = normalizeName(name);
        const bucket = byName.get(key);
        if (bucket) bucket.push(city);
        else byName.set(key, [city]);
      }
    }
  }
  return byName;
}

/** The city with this name in any supported language, from a list that is already loaded. When several share it, the one in `cc` wins, then the biggest. */
export function findCityIn(list: readonly City[], name: string, cc?: string): City | undefined {
  const matches = indexOf(list).get(normalizeName(name));
  if (!matches || matches.length === 0) return undefined;
  const wanted = cc?.toUpperCase();
  return [...matches].sort((a, b) => Number(b.cc === wanted) - Number(a.cc === wanted) || b.pop - a.pop)[0];
}

export async function findCity(name: string, cc?: string): Promise<City | undefined> {
  return findCityIn(await loadCities(), name, cc);
}
