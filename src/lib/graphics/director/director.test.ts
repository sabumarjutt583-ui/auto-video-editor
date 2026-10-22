import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { loadCities } from "../geo/cities.ts";
import { COUNTRY_ALIASES } from "./places.ts";
import {
  acceptGraphic, buildBatchPrompt, buildPlaceIndex, buildSystem, detectTriggers, directGraphics, graphicWindow, selectScenes,
  type DirectorScene, type DirectorSettings, type PlaceIndex, type TimedWord,
} from "./index.ts";

let places: PlaceIndex;
before(async () => { places = buildPlaceIndex(await loadCities()); });

function words(text: string, from = 10, spaced = true): TimedWord[] {
  const toks = spaced ? text.split(/\s+/) : text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,3}|[A-Za-z0-9.,%％]+|\S/gu) ?? [];
  return toks.map((t, i) => ({ text: t, start: from + i * 0.5, end: from + (i + 1) * 0.5 }));
}
function scene(id: string, text: string, from = 10, spaced = true, index = 0): DirectorScene {
  const w = words(text, from, spaced);
  const base = { id, start: from, end: from + Math.max(4, w.length * 0.5), text, words: w };
  return { ...base, index, description: "", triggers: detectTriggers(base, places) };
}
const kinds = (s: DirectorScene): string[] => s.triggers.map((t) => t.kind);
const SETTINGS: DirectorSettings = { density: "normal", language: "English", styleName: "Cinematic", kitSummary: "Clean." };

describe("detection", () => {
  it("English numbers, money, places, dates, percent", () => {
    const s = scene("S01", "In 1969 the United States spent 25.4 billion dollars on Apollo, and 12 percent left London.");
    assert.ok(kinds(s).includes("date"));
    assert.ok(kinds(s).includes("money"));
    assert.ok(kinds(s).includes("percent"));
    assert.equal(s.triggers.find((t) => t.kind === "money")?.value, 25_400_000_000);
    assert.ok(s.triggers.some((t) => t.kind === "place" && t.code === "US"));
    assert.ok(s.triggers.some((t) => t.kind === "place" && t.code === "GB"));
  });
  it("exact times come from the words", () => {
    const s = scene("S01", "Two million people lived there");
    const t = s.triggers.find((x) => x.kind === "number");
    assert.equal(t?.value, 2_000_000);
    assert.equal(t?.time, 10);
    assert.equal(t?.exact, true);
  });
  it("English person, quote, comparison, one list", () => {
    assert.ok(kinds(scene("S01", "Dr. Amina Khan from Karachi explained why.")).includes("person"));
    assert.ok(kinds(scene("S01", "He said: “We choose to go to the moon in this decade.”")).includes("quote"));
    assert.ok(kinds(scene("S01", "Traffic is worse than last year.")).includes("comparison"));
    const list = scene("S01", "Here are three reasons. First, it is cheap. Second, it is fast.");
    assert.equal(kinds(list).filter((k) => k === "list").length, 1);
  });
  it("a clean sentence has no trigger", () => {
    assert.deepEqual(kinds(scene("S01", "The weather was calm and the sea was blue.")), []);
  });
  it("Urdu", () => {
    const s = scene("S01", "پاکستان کی آبادی تقریباً 24 کروڑ ہے اور 2023 میں مہنگائی ۳۰ فیصد تک پہنچ گئی۔");
    assert.ok(s.triggers.some((t) => t.kind === "place" && t.code === "PK"));
    assert.equal(s.triggers.find((t) => t.kind === "number")?.value, 240_000_000);
    assert.equal(s.triggers.find((t) => t.kind === "percent")?.value, 30);
    const p = scene("S02", "ڈاکٹر عائشہ خان نے کراچی میں کہا کہ پچھلے سال کے مقابلے میں قیمتیں بڑھ گئیں۔");
    assert.equal(p.triggers.find((t) => t.kind === "person")?.text, "ڈاکٹر عائشہ خان");
    assert.ok(kinds(p).includes("comparison"));
  });
  it("Korean", () => {
    const s = scene("S01", "한국의 인구는 약 5,100만 명이고 2020년에 서울에서 3.5% 증가했습니다.");
    assert.ok(s.triggers.some((t) => t.kind === "place" && t.code === "KR"));
    assert.equal(s.triggers.find((t) => t.kind === "number")?.value, 51_000_000);
    assert.ok(kinds(s).includes("date"));
    assert.equal(s.triggers.find((t) => t.kind === "percent")?.value, 3.5);
    const m = scene("S02", "김철수 박사는 작년에 비해 5000원 더 싸다고 말했습니다.");
    assert.ok(kinds(m).includes("person"));
    assert.equal(m.triggers.find((t) => t.kind === "money")?.value, 5000);
  });
  it("Japanese", () => {
    const s = scene("S01", "日本の人口は約1億2000万人で、2020年に東京で3.5パーセント増えました。", 10, false);
    assert.ok(s.triggers.some((t) => t.kind === "place" && t.code === "JP"));
    assert.equal(s.triggers.find((t) => t.kind === "number")?.value, 120_000_000);
    assert.ok(kinds(s).includes("date"));
    assert.equal(s.triggers.find((t) => t.kind === "percent")?.value, 3.5);
    const m = scene("S02", "田中さんは去年に比べて500円安いと言いました。", 10, false);
    assert.equal(m.triggers.find((t) => t.kind === "money")?.value, 500);
    assert.ok(kinds(m).includes("person"));
  });
  it("every country alias points to a real country", async () => {
    const codes = new Set((await import("../library/countries.ts")).COUNTRIES.map((c: { a2: string }) => c.a2));
    for (const code of Object.keys(COUNTRY_ALIASES)) assert.ok(codes.has(code), code);
  });
});

describe("density and window", () => {
  const mk = (n: number, trig: boolean) => Array.from({ length: n }, (_, i) => {
    const s = scene(`S${i + 1}`, trig ? "About 45% said yes in 2020." : "Calm sea.", i * 10, true, i);
    return { id: s.id, index: i, duration: 6, triggers: s.triggers };
  });
  it("respects the density limit", () => {
    const all = mk(20, true);
    assert.ok(selectScenes(all, "low").chosen.length <= 5);
    assert.ok(selectScenes(all, "normal").chosen.length <= 10);
    assert.ok(selectScenes(all, "high").chosen.length <= 15);
    assert.deepEqual(selectScenes(all, "normal"), selectScenes(all, "normal"));
  });
  it("breaks long runs and keeps clean scenes clean", () => {
    const sel = selectScenes(mk(10, true), "high");
    const idx = sel.chosen.map((id) => Number(id.slice(1)) - 1);
    let run = 0, worst = 0;
    for (let i = 0; i < 10; i++) { run = idx.includes(i) ? run + 1 : 0; worst = Math.max(worst, run); }
    assert.ok(worst <= 3);
    assert.equal(selectScenes(mk(5, false), "high").chosen.length, 0);
  });
  it("window starts on the trigger and ends before the scene", () => {
    const w = graphicWindow({ start: 0, end: 10 }, 3, 3.5);
    assert.ok(w && w.start === 3 && w.start + w.duration <= 9.9 && w.duration >= 1.2 && w.duration <= 8);
    const late = graphicWindow({ start: 0, end: 10 }, 9.5, 9.8);
    assert.ok(late && late.start + late.duration <= 9.9);
    assert.equal(graphicWindow({ start: 0, end: 1 }, 0, 0.5), null);
  });
});

const GOOD = (type: "text" | "counter" = "text") => type === "text"
  ? { schemaVersion: 1, id: "x", duration: 3, layers: [{ type: "text", id: "t", text: "45%", box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, start: 0, duration: 3 }] }
  : { schemaVersion: 1, id: "x", duration: 3, layers: [{ type: "counter", id: "c", to: 45, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, start: 0, duration: 3 }] };

describe("AI answers", () => {
  const s1 = scene("S01", "About 45% of people said yes to the plan today.", 10);
  const s2 = scene("S02", "A calm sea.", 20, true, 1);
  const ans = (g: unknown) => JSON.stringify({ scenes: [{ id: "S01", trigger: 0, graphic: g }, { id: "S02", graphic: null }] });

  it("accepts a good graphic and fits it", () => {
    const r = acceptGraphic(GOOD(), s1, 0);
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.value.spec.id, "g-S01"); assert.ok(r.value.window.start >= 10); }
  });
  it("blocks a brand name the narration does not say, allows one it says", () => {
    const bad = { ...GOOD(), layers: [{ ...GOOD().layers[0], text: "Nike" }] };
    assert.equal(acceptGraphic(bad, s1, 0).ok, false);
    const said = scene("S03", "Nike sold 45% more shoes.", 10);
    assert.equal(acceptGraphic(bad, said, 0).ok, true);
  });
  it("strips picture layers", () => {
    const g = { ...GOOD(), layers: [...GOOD().layers, { type: "image", id: "i", src: "x.png", box: { x: 0, y: 0, w: 1, h: 1 } }] };
    const r = acceptGraphic(g, s1, 0);
    assert.ok(r.ok && r.value.spec.layers.every((l) => l.type !== "image"));
  });
  it("invalid JSON is retried once with the problems, then the fallback is used", async () => {
    const prompts: string[] = [];
    const r = await directGraphics({ scenes: [s1, s2], settings: SETTINGS, icons: async () => [], call: async (_s, p) => { prompts.push(p); return "not json {"; } });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1] as string, /problem|wrong|JSON/i);
    assert.equal(r.placed.length, 1);
    assert.equal(r.placed[0]?.source, "fallback");
    assert.equal(r.failed, null);
  });
  it("a bad graphic repaired on the retry is used as AI", async () => {
    let n = 0;
    const r = await directGraphics({ scenes: [s1], settings: SETTINGS, icons: async () => [], call: async () => (++n === 1 ? ans({ layers: "nope" }) : ans(GOOD("counter"))) });
    assert.equal(n, 2);
    assert.equal(r.placed[0]?.source, "ai");
  });
  it("null means no graphic", async () => {
    const r = await directGraphics({ scenes: [s1], settings: SETTINGS, icons: async () => [], call: async () => JSON.stringify({ scenes: [{ id: "S01", graphic: null }] }) });
    assert.equal(r.placed.length, 0);
    assert.equal(r.skipped.length, 1);
  });
  it("a failed call keeps earlier batches; cancel is rethrown", async () => {
    const many = Array.from({ length: 25 }, (_, i) => scene(`S${String(i + 1).padStart(2, "0")}`, "About 45% said yes in 2020.", i * 10, true, i));
    let calls = 0;
    const r = await directGraphics({ scenes: many, settings: { ...SETTINGS, density: "high" }, only: new Set(many.map((s) => s.id)), icons: async () => [], call: async (_s, p) => {
      calls++;
      if (calls === 2) throw new Error("network");
      const ids = [...p.matchAll(/"id":\s*"(S\d+)"/g)].map((m) => m[1]);
      return JSON.stringify({ scenes: [...new Set(ids)].map((id) => ({ id, trigger: 0, graphic: GOOD() })) });
    } });
    assert.equal(r.failed?.batch, 2);
    assert.ok(r.placed.length > 0 && r.placed.length <= 20);
    await assert.rejects(directGraphics({ scenes: [s1], settings: SETTINGS, icons: async () => [], call: async () => { throw { message: "Cancelled", code: "cancelled" }; } }));
  });
  it("the prompt carries the density, triggers, icons and the variety summary", () => {
    assert.match(buildSystem(SETTINGS), /normal/);
    const p = buildBatchPrompt({ scenes: [s1], icons: ["lucide:users"], earlier: [{ id: "S00", type: "chart" }] });
    assert.match(p, /lucide:users/);
    assert.match(p, /chart/);
    assert.match(p, /45%/);
  });
  it("saved presets are offered to the AI as examples (at most 3)", () => {
    const p = buildBatchPrompt({ scenes: [s1], icons: [], earlier: [], examples: ["{\"a\":1}", "{\"b\":2}", "{\"c\":3}", "{\"d\":4}"] });
    assert.match(p, /channelExamples/);
    assert.doesNotMatch(p, /\\"d\\"/);
    assert.doesNotMatch(buildBatchPrompt({ scenes: [s1], icons: [], earlier: [] }), /channelExamples/);
  });
});
