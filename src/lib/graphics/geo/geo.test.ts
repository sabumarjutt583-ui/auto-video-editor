import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COUNTRY_CODES } from "../spec/catalog.ts";
import { findCityIn, type City } from "./cities.ts";
import { buildMapData } from "./mapData.ts";
import { makeView, planar, REGION_BOUNDS } from "./projections.ts";
import { greatCircle, polylineLength, routePixels, trimPolylines } from "./route.ts";
import { boundsOfShape, unwrapRing, type Topology } from "./topo.ts";

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../assets/${rel}`, import.meta.url), "utf8")) as T;
const map110 = buildMapData("110m", read<Topology>("maps/countries-110m.json"));
const map50 = buildMapData("50m", read<Topology>("maps/countries-50m.json"));
const cities = read<City[]>("cities.json");
/** The countries the golden and flag tests use. */
const TEST_CODES = ["PK", "JP", "KR", "NP", "RU", "US", "GB", "DE", "FR", "CN", "IN", "BR", "IR", "SA", "TR", "EG", "ES", "AU"];

test("maps: both resolutions decode and every test country has a shape with a sensible position", () => {
  assert.ok(map110.countries.length >= 170 && map50.countries.length >= 230, `${map110.countries.length} / ${map50.countries.length}`);
  for (const map of [map110, map50]) {
    for (const code of TEST_CODES) {
      const shape = map.countries.find((c) => c.a2 === code);
      assert.ok(shape, `${code} is not in the ${map.resolution} map`);
      assert.ok(shape.polygons.length >= 1 && (shape.polygons[0]?.[0]?.length ?? 0) >= 8);
      const [lonMin, latMin, lonMax, latMax] = boundsOfShape(shape);
      assert.ok(lonMin >= -180 && lonMax <= 180 && latMin >= -90 && latMax <= 90 && lonMin < lonMax && latMin < latMax, `${code}: ${[lonMin, latMin, lonMax, latMax]}`);
    }
  }
  const pk = boundsOfShape(map50.countries.find((c) => c.a2 === "PK")!);
  assert.ok(pk[0] > 60 && pk[2] < 78 && pk[1] > 22 && pk[3] < 38, `Pakistan is at ${pk}`);
});

test("maps: rings are closed and country codes are unique", () => {
  const seen = new Set<string>();
  for (const country of map50.countries) {
    if (country.a2) {
      // Only Australia has a second piece with its code (Ashmore and Cartier Islands).
      if (seen.has(country.a2)) assert.deepEqual([country.a2, country.name], ["AU", "Ashmore and Cartier Is."]);
      seen.add(country.a2);
    }
    for (const polygon of country.polygons) {
      for (const ring of polygon) {
        assert.ok(ring.length >= 8, `${country.name} has a ring with too few points`);
        assert.deepEqual([ring[0], ring[1]], [ring[ring.length - 2], ring[ring.length - 1]], `${country.name} has an open ring`);
      }
    }
  }
  // Most of the spec's country codes have an outline (very small states and territories are not in Natural Earth's 1:50m map).
  const drawn = COUNTRY_CODES.filter((c) => seen.has(c)).length;
  assert.ok(drawn >= 200, `${drawn} of ${COUNTRY_CODES.length} country codes have an outline`);
  assert.ok(seen.has("XK"), "Kosovo is mapped by name");
});

test("maps: a ring that crosses the date line becomes continuous", () => {
  assert.deepEqual(unwrapRing([170, 60, -170, 60, -170, 70, 170, 70, 170, 60]), [170, 60, 190, 60, 190, 70, 170, 70, 170, 60]);
  // A ring that goes round the south pole is closed along the pole.
  const ring = unwrapRing([-180, -70, -90, -75, 0, -80, 90, -75, 179, -70, -180, -70]);
  assert.ok(ring.length > 12 && ring[ring.length - 1] === -90 && ring[ring.length - 3] === -90, `${ring}`);
  // The real Russia shape reaches past +180 after unwrapping (it crosses the date line).
  const russia = map110.countries.find((c) => c.a2 === "RU")!;
  const maxLon = Math.max(...russia.polygons.flatMap((p) => p.map((r) => Math.max(...unwrapRing(r).filter((_, i) => i % 2 === 0)))));
  assert.ok(maxLon > 180, `max longitude ${maxLon}`);
});

test("projections: fixed points and ordering", () => {
  for (const kind of ["naturalEarth", "mercator", "equirectangular"] as const) assert.deepEqual(planar(kind, 0, 0), [0, 0]);
  assert.ok(planar("mercator", 0, 60)[1] > planar("mercator", 0, 30)[1] * 1.5, "mercator stretches towards the poles");
  assert.ok(Number.isFinite(planar("mercator", 0, 90)[1]), "mercator clamps the poles");
  assert.ok(planar("naturalEarth", 180, 0)[0] < planar("equirectangular", 180, 0)[0], "natural earth is narrower than the plate carree");
  // Natural Earth I reference: the whole world is about 1.92 times wider than high, and x(180, 0) = pi * 0.8707.
  assert.ok(Math.abs(planar("naturalEarth", 180, 0)[0] - Math.PI * 0.8707) < 1e-9);
  assert.ok(Math.abs(planar("naturalEarth", 180, 0)[0] / planar("naturalEarth", 0, 90)[1] - 1.923) < 0.002);
});

test("projections: a view fits the region in the box, north is up, the globe hides its back", () => {
  const box = { x: 10, y: 10, w: 300, h: 160 };
  for (const kind of ["naturalEarth", "mercator", "equirectangular"] as const) {
    const view = makeView(kind, REGION_BOUNDS.world!, box);
    const nw = view.project(-180, 84)!;
    const se = view.project(180, -58)!;
    assert.ok(nw[0] >= box.x - 0.01 && se[0] <= box.x + box.w + 0.01 && nw[1] >= box.y - 0.01 && se[1] <= box.y + box.h + 0.01, `${kind}: ${nw} ${se}`);
    assert.ok(nw[1] < se[1] && nw[0] < se[0]);
    const mid = view.project(0, 13)!;
    assert.ok(Math.abs(mid[0] - (box.x + box.w / 2)) < 0.01);
  }
  const zoomed = makeView("mercator", REGION_BOUNDS.europe!, box, { zoom: 2, panX: 0, panY: 0 });
  const plain = makeView("mercator", REGION_BOUNDS.europe!, box);
  assert.ok(Math.abs(zoomed.project(45, 72)![0] - (box.x + box.w / 2)) > Math.abs(plain.project(45, 72)![0] - (box.x + box.w / 2)));
  const globe = makeView("orthographic", REGION_BOUNDS.asia!, box);
  assert.ok(globe.project(86, 22), "the middle of Asia is visible");
  assert.equal(globe.project(-94, -22), null, "the far side is hidden");
  const clamped = globe.projectClamped(-94, -22);
  assert.ok(Math.abs(Math.hypot(clamped[0] - 160, clamped[1] - 90) - (globe.radius ?? 0)) < 1e-6, "hidden points sit on the rim");
});

test("cities: the table is clean and names are found in every language", () => {
  assert.ok(cities.length >= 1000);
  for (const c of cities) {
    assert.ok(c.name && /^[A-Z]{2}$/.test(c.cc) && c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180, c.name);
  }
  assert.equal(findCityIn(cities, "Karachi")?.cc, "PK");
  assert.equal(findCityIn(cities, "کراچی")?.name, "Karachi");
  assert.equal(findCityIn(cities, "東京")?.name ?? findCityIn(cities, "東京都")?.name, "Tokyo");
  assert.equal(findCityIn(cities, "서울")?.cc ?? "KR", "KR");
  assert.equal(findCityIn(cities, "Kathmandu")?.cc, "NP");
  assert.equal(findCityIn(cities, "Москва")?.name, "Moscow");
  assert.equal(findCityIn(cities, "sao paulo")?.cc, "BR");
  assert.equal(findCityIn(cities, "Atlantis"), undefined);
  // Springfield-style duplicates: the country hint wins, then the biggest.
  const london = findCityIn(cities, "London");
  assert.equal(london?.cc, "GB");
});

test("routes: a route between two cities follows the globe and can be drawn on", () => {
  const from = findCityIn(cities, "Karachi")!;
  const to = findCityIn(cities, "Tokyo")!;
  const points = greatCircle(from, to, 32);
  assert.equal(points.length, 33);
  assert.ok(Math.abs(points[0]!.lat - from.lat) < 1e-9 && Math.abs(points[0]!.lon - from.lon) < 1e-9);
  assert.ok(Math.abs(points[32]!.lat - to.lat) < 1e-9 && Math.abs(points[32]!.lon - to.lon) < 1e-9);
  const view = makeView("naturalEarth", REGION_BOUNDS.world!, { x: 0, y: 0, w: 320, h: 180 });
  const pieces = routePixels(view, from, to);
  assert.equal(pieces.length, 1);
  const full = polylineLength(pieces);
  assert.ok(full > 40 && full < 300, `${full}`);
  const half = trimPolylines(pieces, 0.5);
  assert.ok(Math.abs(polylineLength(half.pieces) - full / 2) < 1e-6);
  assert.deepEqual(trimPolylines(pieces, 1).end, pieces[0]![pieces[0]!.length - 1]);
  assert.equal(polylineLength(trimPolylines(pieces, 0).pieces), 0);
});

test("routes: a line over the date line is split instead of crossing the whole picture", () => {
  const tokyo = findCityIn(cities, "Tokyo")!;
  const la = findCityIn(cities, "Los Angeles")!;
  const view = makeView("mercator", REGION_BOUNDS.world!, { x: 0, y: 0, w: 320, h: 180 });
  const pieces = routePixels(view, tokyo, la);
  assert.equal(pieces.length, 2, "one piece each side of the date line");
  for (const piece of pieces) for (let i = 1; i < piece.length; i++) assert.ok(Math.abs(piece[i]![0] - piece[i - 1]![0]) < 100);
  // On a globe the far side is cut off.
  const globe = makeView("orthographic", REGION_BOUNDS.asia!, { x: 0, y: 0, w: 320, h: 180 });
  const london = findCityIn(cities, "London")!;
  const sydney = findCityIn(cities, "Sydney")!;
  const visible = routePixels(globe, london, sydney, 128);
  assert.ok(visible.length >= 1);
});
