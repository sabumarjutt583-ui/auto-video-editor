import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cameraAt } from "../geo/camera.ts";
import { buildMapData } from "../geo/mapData.ts";
import type { Topology } from "../geo/topo.ts";
import { ensureIcons, iconShape } from "../library/icons.ts";
import { LAYER_TYPES, repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { RenderContext } from "./context.ts";
import { countDuration, counterValue } from "./draw/counter.ts";
import { wordTimes } from "./draw/kinetic.ts";
import { formatChartValue, formatNumber } from "./format.ts";
import { recorder } from "./recorder.ts";
import { renderFrame } from "./renderFrame.ts";
import { DEFAULT_THEME } from "./theme.ts";

const topo = (res: string): Topology => JSON.parse(readFileSync(new URL(`../assets/maps/countries-${res}.json`, import.meta.url), "utf8")) as Topology;
const map110 = buildMapData("110m", topo("110m"));
const map50 = buildMapData("50m", topo("50m"));
// Node has no Path2D; the recorder only needs something to hand to fill() and stroke().
(globalThis as { Path2D?: unknown }).Path2D ??= class {};
await ensureIcons([{ set: "lucide", name: "" }, { set: "tabler", name: "" }]);

const rc: RenderContext = {
  width: 320, height: 180, theme: DEFAULT_THEME,
  image: () => undefined,
  icon: iconShape,
  flag: () => ({ width: 480, height: 360 }) as unknown as CanvasImageSource,
  map: (res) => (res === "110m" ? map110 : map50),
};

function specOf(layers: Record<string, unknown>[], duration = 3): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "t", duration, layers });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.spec;
}

const FULL = { x: 0.06, y: 0.08, w: 0.88, h: 0.84 };
/** One layer of every type that phase 5 draws. */
const ALL: Record<string, unknown>[] = [
  { id: "counter", type: "counter", box: FULL, to: 1200000, label: "Views" },
  { id: "chart_bar", type: "chart", box: FULL, kind: "bar", rows: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
  { id: "chart_line", type: "chart", box: FULL, kind: "line", rows: [{ label: "A", value: 1 }, { label: "B", value: 3 }, { label: "C", value: 2 }] },
  { id: "chart_pie", type: "chart", box: FULL, kind: "pie", rows: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
  { id: "chart_donut", type: "chart", box: FULL, kind: "donut", rows: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
  { id: "timeline", type: "timeline", box: FULL, events: [{ label: "One", date: "1999" }, { label: "Two" }] },
  { id: "map", type: "map", box: FULL, countries: [{ code: "PK", label: "Pakistan" }], pins: [{ name: "Karachi", lat: 24.87, lon: 66.99 }], routes: [{ from: { lat: 24.87, lon: 66.99 }, to: { lat: 35.69, lon: 139.75 } }] },
  { id: "lower", type: "lowerThird", box: FULL, title: "Name", subtitle: "Role", icon: { set: "lucide", name: "users" } },
  { id: "quote", type: "quoteCard", box: FULL, quote: "A quote", author: "Someone" },
  { id: "list", type: "list", box: FULL, items: [{ text: "One" }, { text: "Two", icon: { set: "tabler", name: "flame" } }] },
  { id: "progress", type: "progressBar", box: FULL, to: 0.5, label: "Loading" },
  { id: "confetti", type: "particles", box: FULL, kind: "confetti" },
  { id: "sparks", type: "particles", box: FULL, kind: "sparks" },
  { id: "dust", type: "particles", box: FULL, kind: "dust" },
  { id: "snow", type: "particles", box: FULL, kind: "snow" },
  { id: "bubbles", type: "particles", box: FULL, kind: "bubbles" },
  { id: "kinetic", type: "kineticText", box: FULL, words: ["Fast", "and", "simple"] },
  { id: "flag", type: "flag", box: FULL, country: "PK", label: "Pakistan" },
];

/** A spec holds at most 16 layers, so the 18 are split over two graphics. */
const HALVES = [ALL.slice(0, 9), ALL.slice(9)];

test("layers: every layer type of the spec is drawn (nothing is reported as not drawn)", () => {
  const covered = new Set([...ALL.map((l) => l.type as string), "text", "richText", "image", "icon", "shape"]);
  assert.deepEqual([...covered].sort(), [...LAYER_TYPES].sort());
  for (const half of HALVES) {
    const spec = specOf(half);
    for (const frame of [0, 15, 60, 83]) {
      const report = renderFrame(spec, frame, recorder().ctx, rc);
      assert.deepEqual(report.notes.filter((n) => n.kind === "not-drawn"), [], `frame ${frame}`);
      assert.equal(report.drawn.length, half.length, `frame ${frame}: ${report.drawn.join(",")}`);
    }
  }
});

test("layers: drawing is a pure function of the frame (no clock, no random numbers, no state between frames)", () => {
  const spec = specOf(ALL.slice(0, 16));
  const realRandom = Math.random;
  const realNow = Date.now;
  Math.random = () => { throw new Error("Math.random was called while drawing"); };
  Date.now = () => { throw new Error("Date.now was called while drawing"); };
  try {
    const direct = recorder();
    renderFrame(spec, 70, direct.ctx, rc);
    // The same frame after drawing others first (a scrub, or a parallel export) must give the same calls.
    const later = recorder();
    for (const frame of [0, 30, 69, 10]) renderFrame(spec, frame, recorder().ctx, rc);
    renderFrame(spec, 70, later.ctx, rc);
    assert.deepEqual(later.log, direct.log);
    assert.ok(direct.log.length > 500, "something was drawn");
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
  }
});

test("layers: particles are seeded by the layer id: same id same particles, another id other ones", () => {
  const a = recorder();
  const b = recorder();
  const c = recorder();
  const make = (id: string) => specOf([{ id, type: "particles", box: FULL, kind: "confetti", count: 20 }]);
  renderFrame(make("p1"), 40, a.ctx, rc);
  renderFrame(make("p1"), 40, b.ctx, rc);
  renderFrame(make("p2"), 40, c.ctx, rc);
  assert.deepEqual(a.log, b.log);
  assert.notDeepEqual(a.log, c.log);
});

test("counter: formats 1,200,000, $3.5M and 45%", () => {
  assert.equal(formatNumber(1200000, { decimals: 0, format: "grouped" }), "1,200,000");
  assert.equal(formatNumber(3500000, { decimals: 1, format: "compact", prefix: "$" }), "$3.5M");
  assert.equal(formatNumber(45, { decimals: 0, format: "plain", suffix: "%" }), "45%");
  assert.equal(formatNumber(1234567.891, { decimals: 2, format: "grouped" }), "1,234,567.89");
  assert.equal(formatNumber(1500, { decimals: 1, format: "compact" }), "1.5K");
  assert.equal(formatNumber(2.4e9, { decimals: 1, format: "compact", suffix: "+" }), "2.4B+");
  assert.equal(formatNumber(7.25e12, { decimals: 2, format: "compact" }), "7.25T");
  assert.equal(formatNumber(999, { decimals: 0, format: "compact" }), "999");
  assert.equal(formatNumber(999999, { decimals: 0, format: "compact" }), "1M", "999,999 does not read 1000K");
  assert.equal(formatNumber(-3500000, { decimals: 1, format: "compact", prefix: "$" }), "-$3.5M");
  assert.equal(formatNumber(-0.0001, { decimals: 1, format: "grouped" }), "0.0", "no negative zero");
  assert.equal(formatNumber(1000, { decimals: 0, format: "grouped" }), "1,000");
  assert.equal(formatNumber(0, { decimals: 0, format: "grouped", prefix: "$" }), "$0");
  assert.equal(formatNumber(Number.NaN, { decimals: 0, format: "plain" }), "0");
});

test("counter: counts from the first value to exactly the last one and stays there", () => {
  const spec = specOf([{ id: "c", type: "counter", box: FULL, from: 100, to: 45, suffix: "%" }]);
  const layer = spec.layers[0];
  assert.ok(layer && layer.type === "counter");
  const length = 3;
  assert.equal(counterValue(layer, 0, length), 100);
  let previous = 100;
  for (let t = 0; t <= 3; t += 1 / 30) {
    const v = counterValue(layer, t, length);
    assert.ok(v <= previous + 1e-9, "counting down never goes up");
    previous = v;
  }
  assert.equal(counterValue(layer, countDuration(length) + 0.1 + 0.01, length), 45);
  assert.equal(counterValue(layer, 3, length), 45);
  assert.equal(countDuration(1), 0.6);
  assert.equal(countDuration(0.5), 0.4);
  assert.equal(countDuration(20), 2.5);
});

test("charts: values are written without clutter", () => {
  assert.equal(formatChartValue(1500), "1,500");
  assert.equal(formatChartValue(12.5), "12.5");
  assert.equal(formatChartValue(3.14159), "3.14");
  assert.equal(formatChartValue(120, "K"), "120K");
  assert.equal(formatChartValue(45, "%"), "45%");
  assert.equal(formatChartValue(99.5, "$"), "$99.5");
  assert.equal(formatChartValue(2500000), "2.5M");
  assert.equal(formatChartValue(-8, "%"), "-8%");
});

test("charts: a pie with no positive value says so instead of drawing garbage", () => {
  const spec = specOf([{ id: "c", type: "chart", box: FULL, kind: "pie", rows: [{ label: "A", value: 0 }, { label: "B", value: -3 }] }]);
  const report = renderFrame(spec, 60, recorder().ctx, rc);
  assert.deepEqual(report.notes.map((n) => n.kind), ["not-drawn"]);
});

test("kinetic text: words come in one after the other, all of them before the end", () => {
  const { start, each } = wordTimes(4, 3);
  for (let i = 1; i < 4; i++) assert.ok(start(i) > start(i - 1));
  assert.ok(start(3) + each < 3, "the last word is in before the graphic ends");
  const many = wordTimes(20, 3);
  assert.ok(many.start(19) + many.each < 3.2);
});

test("map: the camera holds, then moves smoothly between keys", () => {
  assert.deepEqual(cameraAt([], 1), { zoom: 1, panX: 0, panY: 0 });
  const keys = [{ t: 1, zoom: 1, panX: 0, panY: 0 }, { t: 3, zoom: 4, panX: 0.5, panY: -0.5 }];
  assert.deepEqual(cameraAt(keys, 0), { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual(cameraAt(keys, 5), { zoom: 4, panX: 0.5, panY: -0.5 });
  const mid = cameraAt(keys, 2);
  assert.ok(Math.abs(mid.zoom - 2) < 1e-9, `log-halfway between 1 and 4 is 2, got ${mid.zoom}`);
  assert.ok(Math.abs(mid.panX - 0.25) < 1e-9);
  assert.ok(cameraAt(keys, 1.5).zoom < cameraAt(keys, 2.5).zoom);
});

test("map: a missing country outline or missing outlines are reported, not thrown", () => {
  const spec = specOf([{ id: "m", type: "map", box: FULL, countries: [{ code: "VA" }] }]);
  const light = renderFrame(spec, 60, recorder().ctx, { ...rc, map: (res) => (res === "110m" ? map110 : undefined) });
  assert.ok(light.notes.every((n) => n.kind === "missing-map"));
  const none = renderFrame(spec, 60, recorder().ctx, { ...rc, map: undefined });
  assert.deepEqual(none.notes.map((n) => n.kind), ["missing-map"]);
  const flag = renderFrame(specOf([{ id: "f", type: "flag", box: FULL, country: "PK" }]), 60, recorder().ctx, { ...rc, flag: undefined });
  assert.deepEqual(flag.notes.map((n) => n.kind), ["missing-flag"]);
});

test("layers: text that is too long is made smaller or cut and the report says so", () => {
  const long = "A very long title that cannot possibly fit in this small lower third box at all";
  const spec = specOf([{ id: "l", type: "lowerThird", box: { x: 0.1, y: 0.7, w: 0.3, h: 0.15 }, title: long, subtitle: long }]);
  const report = renderFrame(spec, 60, recorder().ctx, { ...rc, theme: DEFAULT_THEME });
  assert.ok(report.notes.length > 0, "a note about the text");
});
