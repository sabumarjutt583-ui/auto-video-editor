import assert from "node:assert/strict";
import { test } from "node:test";

import type { MotionGraphic, SfxCue, SfxSound } from "../../types/editor.ts";
import { repairSpec } from "../graphics/spec/index.ts";
import type { GraphicSpec } from "../graphics/spec/schema.ts";
import { DEFAULT_AUDIO, readAudio } from "./read.ts";
import { planGraphicSfx, withGraphicSfx } from "./graphicSfx.ts";

const sound = (id: string, category: SfxSound["category"]): SfxSound => ({ id, file: `${id}.wav`, category, tags: [], duration: 1, defaultGain: 0.8 });
const SOUNDS = [sound("pop_bubble", "pop"), sound("whoosh_soft", "whoosh"), sound("whoosh_long", "whoosh"), sound("click_tick", "click")];

function spec(layer: Record<string, unknown>): GraphicSpec {
  const made = repairSpec({ schemaVersion: 1, id: "g", duration: 4, layers: [{ id: "a", box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, ...layer }] });
  assert.ok(made.ok, JSON.stringify(made));
  return made.spec;
}
const entry = (s: GraphicSpec, start = 5, enabled = true): Pick<MotionGraphic, "id" | "start" | "duration" | "enabled" | "kind" | "spec"> => ({ id: "g1", start, duration: 4, enabled, kind: "spec", spec: s });
const run = (graphics: ReturnType<typeof entry>[], intensity: "low" | "normal" | "high" = "normal") => planGraphicSfx({ graphics, sounds: SOUNDS, intensity });

test("a graphic that fades or pops in gets a soft pop at its start", () => {
  const cues = run([entry(spec({ type: "text", text: "Hello", enter: { preset: "fade", duration: 0.4, delay: 0 } }))]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.soundId, "pop_bubble");
  assert.equal(cues[0]?.time, 5);
  assert.equal(cues[0]?.reason, "graphic");
});

test("a sliding graphic gets a whoosh and no entrance means no sound", () => {
  assert.equal(run([entry(spec({ type: "text", text: "Hi", enter: { preset: "slideUp", duration: 0.4, delay: 0 } }))])[0]?.soundId, "whoosh_soft");
  assert.equal(run([entry(spec({ type: "text", text: "Hi", enter: { preset: "none", duration: 0.4, delay: 0 } }))]).length, 0);
});

test("a counter adds light ticks, fewer at low intensity; leaving makes no sound", () => {
  const counter = spec({ type: "counter", from: 0, to: 100, enter: { preset: "fade", duration: 0.4, delay: 0 }, exit: { preset: "fade", duration: 0.3 } });
  const normal = run([entry(counter)]);
  const ticks = normal.filter((c) => c.soundId === "click_tick");
  assert.ok(ticks.length >= 4 && ticks.length <= 6);
  assert.ok(ticks.every((t) => t.gain < 0.4));
  assert.ok(run([entry(counter)], "low").filter((c) => c.soundId === "click_tick").length <= 3);
  assert.ok(normal.every((c) => c.time < 5 + 4 - 0.5), "nothing at the end of the graphic");
});

test("a map route adds a swoosh; a map with only pins does not", () => {
  const route = spec({ type: "map", region: "world", routes: [{ from: { lat: 24.8, lon: 67 }, to: { lat: 35.6, lon: 139.7 } }] });
  assert.ok(run([entry(route)]).some((c) => c.soundId === "whoosh_long"));
  const pins = spec({ type: "map", region: "world", pins: [{ name: "Karachi", lat: 24.8, lon: 67 }] });
  assert.ok(!run([entry(pins)]).some((c) => c.soundId === "whoosh_long"));
});

test("disabled graphics are silent; the same graphics give the same cues", () => {
  const s = spec({ type: "text", text: "Hi" });
  assert.equal(run([entry(s, 5, false)]).length, 0);
  assert.deepEqual(run([entry(s)]), run([entry(s)]));
});

test("a graphic sound next to a scene whoosh is dropped, and cues are numbered again", () => {
  const rule: SfxCue = { id: "X001", soundId: "whoosh_soft", time: 5.1, gain: 0.7, reason: "whoosh" };
  const merged = withGraphicSfx([rule], [{ soundId: "pop_bubble", time: 5, gain: 0.4, reason: "graphic" }, { soundId: "pop_bubble", time: 9, gain: 0.4, reason: "graphic" }]);
  assert.deepEqual(merged.map((c) => c.time), [5.1, 9]);
  assert.deepEqual(merged.map((c) => c.id), ["X001", "X002"]);
});

test("the setting is on by default and survives reading", () => {
  assert.equal(DEFAULT_AUDIO.graphicSfx, true);
  assert.equal(readAudio({}).graphicSfx, true);
  assert.equal(readAudio({ graphicSfx: false }).graphicSfx, false);
  assert.equal(readAudio({ cues: [{ soundId: "x", time: 1, reason: "graphic" }] }).cues?.[0]?.reason, "graphic");
});
