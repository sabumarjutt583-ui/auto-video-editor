import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_THEME } from "../render/theme.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { cacheable, cacheKey, poolSize, runPool, stableJson } from "./index.ts";

function spec(text = "Hello", id = "g1", extra: Record<string, unknown> = {}): GraphicSpec {
  const made = repairSpec({ schemaVersion: 1, id, duration: 3, layers: [{ id: "a", type: "text", box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, text, ...extra }] });
  assert.ok(made.ok);
  return made.spec;
}
const parts = (s: GraphicSpec, patch: Record<string, unknown> = {}) => ({ spec: s, theme: DEFAULT_THEME, fonts: ["NotoSans-Regular.ttf"], width: 1920, height: 1080, ...patch });

test("stableJson ignores key order", () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test("the key is 64 hex characters, the same for the same picture whatever its id", async () => {
  const a = await cacheKey(parts(spec("Hello", "g1")));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await cacheKey(parts(spec("Hello", "other-id"))));
});

test("anything that changes the picture changes the key", async () => {
  const base = await cacheKey(parts(spec()));
  const changed = [
    await cacheKey(parts(spec("Hallo"))),
    await cacheKey(parts(spec(), { width: 1080, height: 1920 })),
    await cacheKey(parts(spec(), { fps: 60 })),
    await cacheKey(parts(spec(), { fonts: ["NotoSansKR-Regular.otf"] })),
    await cacheKey(parts(spec(), { theme: { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, accent: "#ff0000" } } })),
  ];
  for (const k of changed) assert.notEqual(k, base);
  assert.equal(new Set(changed).size, changed.length);
});

test("graphics with a picture file are not cached", () => {
  assert.equal(cacheable(spec()), true);
  const withImage = repairSpec({ schemaVersion: 1, id: "g", duration: 3, layers: [{ id: "i", type: "image", box: { x: 0, y: 0, w: 0.3, h: 0.3 }, src: "media/a.png" }] });
  assert.ok(withImage.ok);
  assert.equal(cacheable(withImage.spec), false);
});

test("poolSize is half the cores, from 1 to 4", () => {
  assert.deepEqual([1, 2, 4, 8, 32, Number.NaN].map(poolSize), [1, 1, 2, 4, 4, 1]);
});

test("runPool keeps the order, never runs more than the limit at once, and stops starting after a failure", async () => {
  let running = 0, peak = 0;
  const out = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5 * (7 - n))); running--; return n * 10; });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 2);
  const started: number[] = [];
  await assert.rejects(runPool([1, 2, 3, 4, 5, 6], 1, async (n) => { started.push(n); if (n === 2) throw new Error("boom"); return n; }), /boom/);
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(await runPool([], 3, async () => 1), []);
});
