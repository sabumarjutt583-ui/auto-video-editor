import type { City } from "../../geo/cities.ts";
import { findCityIn } from "../../geo/cities.ts";
import type { MapData } from "../../geo/mapData.ts";
import { makeView, REGION_BOUNDS, type ProjectionKind } from "../../geo/projections.ts";
import { routePixels, trimPolylines } from "../../geo/route.ts";
import type { Canvas2D } from "../context.ts";
import { drawCountries, drawFlagPicture, drawPin, drawRoutePieces } from "../draw/geo.ts";

/** What the browser harness loads before drawing maps and flags. */
export interface GeoAssets {
  map110: MapData;
  map50: MapData;
  cities: readonly City[];
  flags: ReadonlyMap<string, ImageBitmap>;
}

export interface GeoCaseDef {
  name: string;
  draw: (ctx: Canvas2D, width: number, height: number, assets: GeoAssets) => void;
}

const COLORS = { sea: "#0b1220", land: "#334155", border: "#0b1220", borderWidth: 0.6 };
const GOLD = "#f59e0b";
const GREEN = "#22c55e";

function city(assets: GeoAssets, name: string): { lat: number; lon: number } {
  const found = findCityIn(assets.cities, name);
  if (!found) throw new Error(`city ${name} is not in the table`);
  return found;
}

function mapCase(name: string, kind: ProjectionKind, region: string, high: Record<string, string>, route?: { from: string; to: string; progress: number }, hi = false): GeoCaseDef {
  return {
    name,
    draw: (ctx, width, height, assets) => {
      const view = makeView(kind, REGION_BOUNDS[region] ?? REGION_BOUNDS.world!, { x: 6, y: 6, w: width - 12, h: height - 12 });
      drawCountries(ctx, (hi ? assets.map50 : assets.map110).countries, view, { ...COLORS, highlight: high });
      if (route) {
        const a = city(assets, route.from);
        const b = city(assets, route.to);
        const full = routePixels(view, a, b);
        drawRoutePieces(ctx, full, "rgba(255,255,255,0.25)", 1);
        const { pieces, end } = trimPolylines(full, route.progress);
        drawRoutePieces(ctx, pieces, "#ffffff", 2);
        for (const p of [a, b]) {
          const xy = view.project(p.lon, p.lat);
          if (xy) drawPin(ctx, xy[0], xy[1], 3, GOLD, "#ffffff");
        }
        if (end) drawPin(ctx, end[0], end[1], 2, "#ffffff", GOLD);
      }
    },
  };
}

const FLAG_SAMPLE = ["PK", "JP", "KR", "NP", "RU", "US", "GB", "DE", "FR", "CN", "IN", "BR"];

function flagCase(name: string, shape: "rect" | "circle"): GeoCaseDef {
  return {
    name,
    draw: (ctx, width, height, assets) => {
      const cols = 4;
      const rows = 3;
      const cellW = width / cols;
      const cellH = height / rows;
      FLAG_SAMPLE.forEach((code, i) => {
        const flag = assets.flags.get(code);
        if (!flag) throw new Error(`no flag ${code}`);
        const col = i % cols;
        const row = Math.floor(i / cols);
        drawFlagPicture(ctx, flag, { x: col * cellW + 6, y: row * cellH + 6, w: cellW - 12, h: cellH - 12 }, shape);
      });
    },
  };
}

export const GEO_CASES: readonly GeoCaseDef[] = [
  mapCase("geo_world_naturalEarth_route", "naturalEarth", "world", { PK: GOLD, JP: GREEN }, { from: "Karachi", to: "Tokyo", progress: 1 }),
  mapCase("geo_world_mercator", "mercator", "world", { US: GOLD, BR: GREEN }),
  mapCase("geo_world_equirectangular", "equirectangular", "world", { AU: GOLD, EG: GREEN }),
  mapCase("geo_route_across_date_line", "mercator", "world", { JP: GOLD, US: GREEN }, { from: "Tokyo", to: "Los Angeles", progress: 0.6 }),
  mapCase("geo_globe_asia", "orthographic", "asia", { IN: GOLD, CN: GREEN }, { from: "New Delhi", to: "Beijing", progress: 0.5 }),
  mapCase("geo_europe_50m", "mercator", "europe", { DE: GOLD, FR: GREEN, ES: "#3b82f6" }, { from: "London", to: "Istanbul", progress: 1 }, true),
  mapCase("geo_middle_east_50m", "mercator", "middleEast", { SA: GOLD, IR: GREEN, TR: "#3b82f6" }, undefined, true),
  mapCase("geo_asia_50m_naturalEarth", "naturalEarth", "asia", { PK: GOLD, NP: GREEN, KR: "#3b82f6", JP: "#ef4444" }, undefined, true),
  flagCase("flags_rect", "rect"),
  flagCase("flags_circle", "circle"),
];
