import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MotionGraphic } from "../../../types/editor.ts";
import { captionZone, mainExtent, safeArea, touches, type Box } from "../placement/index.ts";
import { DEFAULT_THEME } from "../render/theme.ts";
import { repairSpec, validateSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import {
  animationOf, cleanOverrides, copyStart, dragGraphic, dragTarget, fieldsOf, fillPreset, makePreset, placeholderCount, presetExamples, putGraphic, readPresets, removeGraphic,
  retime, setEnter, setExit, setField, shift, snapTime, themeWith, wordPoints,
} from "./index.ts";

function spec(layers: Record<string, unknown>[], duration = 4): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "g1", duration, layers });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.issues));
  return r.spec;
}
const box = { x: 0.1, y: 0.1, w: 0.4, h: 0.2 };
const sample = (): GraphicSpec => spec([
  { type: "shape", id: "plate", shape: "roundRect", box, start: 0 },
  { type: "text", id: "t", text: "Hello world", box, start: 0 },
  { type: "counter", id: "c", from: 0, to: 45, suffix: "%", label: "Growth", box: { x: 0.1, y: 0.4, w: 0.4, h: 0.2 }, start: 0 },
  { type: "flag", id: "f", country: "pk", label: "Pakistan", box: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 }, start: 0 },
  { type: "chart", id: "ch", kind: "bar", title: "Sales", rows: [{ label: "A", value: 3 }, { label: "B", value: 5 }], box: { x: 0.55, y: 0.4, w: 0.4, h: 0.4 }, start: 0 },
  { type: "list", id: "l", style: "bullets", items: [{ text: "One", icon: { set: "lucide", name: "users" } }, { text: "Two" }], box: { x: 0.1, y: 0.65, w: 0.4, h: 0.25 }, start: 0 },
]);

describe("fields and edits", () => {
  it("lists texts, numbers, countries and icons of the layers", () => {
    const fields = fieldsOf(sample());
    const byId = (id: string) => fields.find((f) => f.id === id);
    assert.equal(byId("layers.1.text")?.value, "Hello world");
    assert.equal(byId("layers.2.to")?.kind, "number");
    assert.equal(byId("layers.2.suffix")?.value, "%");
    assert.equal(byId("layers.3.country")?.kind, "country");
    assert.equal(byId("layers.4.rows.1.value")?.value, 5);
    assert.equal(byId("layers.4.rows.0.label")?.value, "A");
    assert.equal(byId("layers.5.items.0.icon")?.value, "lucide:users");
    assert.equal(byId("layers.5.items.1.text")?.value, "Two");
    assert.ok(!fields.some((f) => f.id.includes("box")));
  });
  it("changes a field and leaves the old graphic untouched (so Undo can bring it back)", () => {
    const before = sample();
    const snapshot = JSON.stringify(before);
    const field = fieldsOf(before).find((f) => f.id === "layers.1.text") as ReturnType<typeof fieldsOf>[number];
    const next = setField(before, field, "New words");
    assert.ok(next.ok);
    if (next.ok) assert.equal((next.spec.layers[1] as { text: string }).text, "New words");
    assert.equal(JSON.stringify(before), snapshot);
    const back = setField(next.ok ? next.spec : before, field, "Hello world");
    assert.ok(back.ok && JSON.stringify(back.spec) === snapshot);
  });
  it("numbers, countries and icons are checked", () => {
    const s = sample();
    const f = (id: string) => fieldsOf(s).find((x) => x.id === id) as ReturnType<typeof fieldsOf>[number];
    assert.ok(setField(s, f("layers.2.to"), 80).ok);
    assert.equal(setField(s, f("layers.2.to"), Number.NaN).ok, false);
    assert.ok(setField(s, f("layers.3.country"), "jp").ok);
    assert.equal(setField(s, f("layers.3.country"), "ZZ").ok, false);
    assert.ok(setField(s, f("layers.5.items.0.icon"), "lucide:star").ok);
    const bad = setField(s, f("layers.5.items.0.icon"), "lucide:not-an-icon");
    assert.equal(bad.ok, false);
    assert.equal(setField(s, f("layers.1.text"), "   ").ok, false);
    assert.ok(validateSpec(setField(s, f("layers.3.country"), "us").ok ? (setField(s, f("layers.3.country"), "us") as { spec: GraphicSpec }).spec : s).ok);
  });
  it("entrance and exit apply to the main layers and are read back", () => {
    const s = sample();
    const entered = setEnter(s, "slideUp");
    const exited = entered.ok ? setExit(entered.spec, "scale") : entered;
    assert.ok(exited.ok);
    if (exited.ok) {
      assert.deepEqual(animationOf(exited.spec), { enter: "slideUp", exit: "scale" });
      assert.equal(validateSpec(exited.spec).ok, true);
    }
    assert.equal(setEnter(s, "nonsense").ok, false);
  });
  it("graphic colours override the kit for one graphic only", () => {
    assert.deepEqual(cleanOverrides({ primary: "#FF0000", accent: "red", bogus: "#000000", text: "#12345" }), { primary: "#ff0000" });
    const themed = themeWith(DEFAULT_THEME, { primary: "#ff0000" });
    assert.equal(themed.colors.primary, "#ff0000");
    assert.equal(themed.colors.accent, DEFAULT_THEME.colors.accent);
    assert.equal(DEFAULT_THEME.colors.primary, "#8b5cf6");
    assert.equal(themeWith(DEFAULT_THEME, undefined), DEFAULT_THEME);
  });
});

describe("dragging on the preview", () => {
  const safe = safeArea({ x: 0.05, y: 0.05 });
  const caption = captionZone({ preset: "clean", position: "bottom", fontSize: 5 }, "16:9") as Box;
  const g = spec([{ type: "text", id: "t", text: "Hello", box: { x: 0.3, y: 0.3, w: 0.3, h: 0.15 }, start: 0 }]);
  it("a free drag moves the graphic", () => {
    const moved = dragGraphic(g, 0.1, 0.05, { safe, caption });
    const e = mainExtent(moved) as Box;
    assert.ok(Math.abs(e.x - 0.4) < 0.02 && Math.abs(e.y - 0.35) < 0.02);
  });
  it("it can never enter the caption zone, however far it is dragged", () => {
    for (const [dx, dy] of [[0, 0.6], [0.2, 0.7], [-0.2, 0.9], [0, 5]] as const) {
      const e = mainExtent(dragGraphic(g, dx, dy, { safe, caption })) as Box;
      assert.equal(touches(e, caption), false, `${dx},${dy}`);
    }
  });
  it("it can never leave the safe area, and snaps to its edges and the middle", () => {
    const e = mainExtent(dragGraphic(g, -2, -2, { safe, caption })) as Box;
    assert.ok(Math.abs(e.x - safe.x) < 1e-9 && Math.abs(e.y - safe.y) < 1e-9);
    const snap = dragTarget({ x: 0.3, y: 0.3, w: 0.3, h: 0.15 }, { x: 0.358, y: 0.3, w: 0.3, h: 0.15 }, { safe, caption: null });
    assert.ok(Math.abs(snap.x - 0.35) < 1e-9, "snapped to the centre line");
    const right = dragTarget({ x: 0.3, y: 0.3, w: 0.3, h: 0.15 }, { x: 0.99, y: 0.3, w: 0.3, h: 0.15 }, { safe, caption: null });
    assert.ok(Math.abs(right.x + right.w - (safe.x + safe.w)) < 1e-9);
  });
  it("slides along an axis when the straight drag would enter the captions", () => {
    const wanted = { x: 0.5, y: caption.y - 0.05, w: 0.3, h: 0.15 };
    const t = dragTarget({ x: 0.3, y: 0.3, w: 0.3, h: 0.15 }, wanted, { safe, caption });
    assert.equal(touches(t, caption), false);
  });
});

describe("timing edits", () => {
  const scene = { start: 10, end: 20 };
  const words = Array.from({ length: 10 }, (_, i) => ({ start: 10 + i, end: 10.8 + i }));
  const points = wordPoints(words, scene);
  it("snaps to the word starts and ends", () => {
    assert.equal(snapTime(12.06, points), 12);
    assert.equal(snapTime(12.4, points), 12.4);
    assert.equal(snapTime(12.86, points), 12.8);
  });
  it("dragging an edge snaps, stays in the scene and never gets shorter than 1.2 s", () => {
    const g = { start: 12, duration: 4 };
    assert.deepEqual(retime(g, "start", 13.05, { scene, points }), { start: 13, duration: 3 });
    assert.deepEqual(retime(g, "end", 18.07, { scene, points }), { start: 12, duration: 6 });
    assert.equal(retime(g, "end", 99, { scene, points }).duration, 7.9);
    assert.equal(retime(g, "end", 12.1, { scene, points }).duration, 1.2);
    assert.equal(retime(g, "start", 0, { scene, points }).start, 10);
    assert.ok(retime(g, "start", 99, { scene, points }).duration >= 1.2);
  });
  it("moving the whole graphic keeps its length and stays inside the scene", () => {
    const g = { start: 12, duration: 3 };
    assert.equal(shift(g, 1.02, { scene, points }).start, 13);
    assert.equal(shift(g, 50, { scene, points }).start, 16.9);
    assert.equal(shift(g, -50, { scene, points }).start, 10);
    assert.equal(shift(g, 2, { scene, points }).duration, 3);
  });
});

describe("presets", () => {
  it("a preset keeps the look and replaces the texts by placeholders; inserting fills them", () => {
    const original = sample();
    const preset = makePreset("My growth card", original, []);
    assert.ok(preset);
    assert.equal(preset.id, "my_growth_card");
    assert.equal(placeholderCount(preset) >= 6, true);
    assert.ok(preset.samples.includes("Hello world"));
    assert.match(JSON.stringify(preset.spec), /\{\{1\}\}/);
    const same = fillPreset(preset);
    assert.ok(same);
    assert.equal((same.layers[1] as { text: string }).text, "Hello world");
    const filled = fillPreset(preset, ["Amazing growth"]);
    assert.ok(filled);
    const texts = JSON.stringify(filled);
    assert.ok(texts.includes("Amazing growth") && !texts.includes("{{"));
    assert.equal(filled.layers.length, original.layers.length);
    assert.equal(validateSpec(filled).ok, true);
  });
  it("names and ids", () => {
    assert.equal(makePreset("   ", sample(), []), null);
    assert.equal(makePreset("Card", sample(), ["card"])?.id, "card_2");
  });
  it("quotes in the new texts cannot break the graphic", () => {
    const preset = makePreset("Q", sample(), []);
    assert.ok(preset);
    const s = fillPreset(preset, ['He said "hi" \\ and left']);
    assert.ok(s && JSON.stringify(s).includes('He said \\"hi\\"'));
  });
  it("presets from the settings file are checked, and become examples for the AI", () => {
    const preset = makePreset("Card", sample(), []);
    assert.ok(preset);
    const loaded = readPresets([preset, { id: "bad id", name: "x", spec: {} }, "junk", { ...preset, spec: { nope: 1 } }, { ...preset, id: "ok_2", name: "  Two " }]);
    assert.deepEqual(loaded.map((p) => p.id), ["card", "ok_2"]);
    const examples = presetExamples(loaded, 1);
    assert.equal(examples.length, 1);
    assert.match(examples[0] as string, /^Card: \{"schemaVersion":1/);
    assert.ok(!(examples[0] as string).includes("{{"));
  });
});

describe("graphic list", () => {
  const mk = (id: string, start: number): MotionGraphic => ({ id, sceneId: "S01", start, duration: 3, idea: "", framesDir: "", htmlPath: "", fps: 30, frames: 90, width: 10, height: 10, enabled: true, kind: "spec", clipPath: `graphics/${id}/clip.mov` });
  it("put, replace and remove keep the list sorted", () => {
    let list = putGraphic([], mk("b", 5));
    list = putGraphic(list, mk("a", 2));
    assert.deepEqual(list.map((g) => g.id), ["a", "b"]);
    list = putGraphic(list, { ...mk("a", 9) });
    assert.deepEqual(list.map((g) => g.id), ["b", "a"]);
    assert.deepEqual(removeGraphic(list, "b").map((g) => g.id), ["a"]);
    assert.equal(list.length, 2);
  });
  it("a copy starts right after the original when there is room, else as late as it fits", () => {
    assert.equal(copyStart({ start: 10, duration: 3 }, { start: 10, end: 30 }), 13.1);
    assert.equal(copyStart({ start: 10, duration: 3 }, { start: 10, end: 15 }), 11.9);
  });
});
