import { countryByNumeric } from "../library/countries.ts";
import { shapesOf, type Shape, type Topology } from "./topo.ts";

/** Country outlines from world-atlas (Natural Earth, public domain). 110m is light (previews, world view), 50m is detailed (regions). */
export type MapResolution = "110m" | "50m";

export interface CountryShape extends Shape {
  /** Upper-case alpha-2 code, empty for areas without an ISO code (Somaliland, N. Cyprus). */
  a2: string;
}

export interface MapData {
  resolution: MapResolution;
  countries: CountryShape[];
}

const loaders: Record<MapResolution, () => Promise<{ default: unknown }>> = {
  "110m": () => import("../assets/maps/countries-110m.json", { with: { type: "json" } }),
  "50m": () => import("../assets/maps/countries-50m.json", { with: { type: "json" } }),
};
const cache = new Map<MapResolution, Promise<MapData>>();

/** Kosovo has no ISO numeric id in the data; it is the only unnamed-code shape we map by name. */
const NAME_TO_CODE: Record<string, string> = { Kosovo: "XK" };

export function buildMapData(resolution: MapResolution, topology: Topology): MapData {
  const countries = shapesOf(topology, "countries").map((shape): CountryShape => {
    const row = shape.id ? countryByNumeric(shape.id) : undefined;
    return { ...shape, a2: row?.a2 ?? NAME_TO_CODE[shape.name] ?? "" };
  });
  return { resolution, countries };
}

export function loadMapData(resolution: MapResolution): Promise<MapData> {
  let task = cache.get(resolution);
  if (!task) {
    task = loaders[resolution]().then((module) => buildMapData(resolution, module.default as Topology));
    cache.set(resolution, task);
  }
  return task;
}

/** The resolution to use for a view: detailed only when a region (not the world) is shown. */
export function resolutionFor(region: string): MapResolution {
  return region === "world" ? "110m" : "50m";
}
