import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeIssues, LAYER_TYPES, repairSpec, validateSpec } from "./index.ts";

const load = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Loose = { layers: Record<string, unknown>[] } & Record<string, unknown>;
const stat = (): Loose => clone(load("stat_callout.json")) as Loose;

test("fixtures: stat callout is valid and defaults are filled", () => {
  const r = validateSpec(load("stat_callout.json"));
  assert.equal(r.ok, true, r.ok ? "" : describeIssues(r.issues));
  if (r.ok) {
    const counter = r.spec.layers.find((l) => l.type === "counter");
    assert.equal(counter?.type === "counter" && counter.decimals, 0);
  }
});

test("fixtures: all 16 layer types validate (country code is upper-cased only in repair)", () => {
  const spec = clone(load("all_layers.json")) as Loose;
  const strict = validateSpec(spec);
  // "pk" is lower case: strict accepts it because the parser normalises it; no issue is reported.
  assert.equal(strict.ok, true, strict.ok ? "" : describeIssues(strict.issues));
  if (strict.ok) assert.deepEqual([...new Set(strict.spec.layers.map((l) => l.type))].sort(), [...LAYER_TYPES].sort());
});

test("strict: unknown field, bad type and missing field are errors with paths", () => {
  const spec = stat();
  spec.extra = 1;
  (spec.layers[2] as Record<string, unknown>).to = "many";
  delete (spec.layers[1] as Record<string, unknown>).icon;
  const r = validateSpec(spec);
  assert.equal(r.ok, false);
  if (!r.ok) {
    const paths = r.issues.map((i) => i.path);
    assert.ok(paths.includes("extra"));
    assert.ok(paths.includes("layers[2].to"));
    assert.ok(paths.includes("layers[1].icon"));
  }
});

test("strict: wrong schema version, empty layers and bad duration fail", () => {
  for (const patch of [{ schemaVersion: 2 }, { layers: [] }, { duration: 99 }, { duration: 0.1 }]) {
    assert.equal(validateSpec({ ...stat(), ...patch }).ok, false, JSON.stringify(patch));
  }
});

test("strict: non-object input and layer type unknown", () => {
  for (const bad of [null, undefined, 5, "x", [], { }]) assert.equal(validateSpec(bad).ok, false);
  const spec = stat();
  spec.layers.push({ id: "z", type: "hologram", box: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(validateSpec(spec).ok, false);
});

test("strict: box outside the picture, ids repeated, layer outside time", () => {
  const a = stat();
  (a.layers[0] as { box: { x: number } }).box.x = 0.9;
  assert.equal(validateSpec(a).ok, false);
  const b = stat();
  (b.layers[1] as { id: string }).id = "card";
  assert.equal(validateSpec(b).ok, false);
  const c = stat();
  (c.layers[2] as { start: number }).start = 4;
  assert.equal(validateSpec(c).ok, false);
  const d = stat();
  (d.layers[2] as { duration: number }).duration = 3.9;
  assert.equal(validateSpec(d).ok, false);
});

test("strict: unknown icon, unknown country, empty map", () => {
  const a = stat();
  (a.layers[1] as { icon: { name: string } }).icon.name = "Not A Name!";
  assert.equal(validateSpec(a).ok, false);
  const b = clone(load("all_layers.json")) as Loose;
  const flag = b.layers.find((l) => l.type === "flag") as { country: string };
  flag.country = "ZZ";
  assert.equal(validateSpec(b).ok, false);
  const c = clone(load("all_layers.json")) as Loose;
  const map = c.layers.find((l) => l.type === "map") as Record<string, unknown>;
  map.countries = []; map.pins = []; map.routes = [];
  assert.equal(validateSpec(c).ok, false);
});

test("strict: control characters and long text are errors", () => {
  const a = clone(load("all_layers.json")) as Loose;
  (a.layers[0] as { text: string }).text = "line\nbreak";
  assert.equal(validateSpec(a).ok, false);
  (a.layers[0] as { text: string }).text = "x".repeat(121);
  assert.equal(validateSpec(a).ok, false);
});

test("repair: clamps numbers, cuts text, drops unknown fields, and the result is strictly valid", () => {
  const spec = clone(load("all_layers.json")) as Loose;
  spec.junk = true;
  (spec.layers[0] as Record<string, unknown>).text = "a\nb" + "x".repeat(300);
  (spec.layers[0] as Record<string, unknown>).size = 9;
  (spec.layers.find((l) => l.type === "counter") as Record<string, unknown>).decimals = 2.6;
  (spec.layers.find((l) => l.type === "chart") as { rows: unknown[] }).rows = Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: i }));
  (spec.layers.find((l) => l.type === "particles") as Record<string, unknown>).count = 100000;
  const r = repairSpec(spec);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.issues.length >= 5);
    assert.equal(validateSpec(r.spec).ok, true);
    const t = r.spec.layers[0];
    assert.ok(t?.type === "text" && t.size === 0.3 && t.text.length <= 120 && !t.text.includes("\n"));
    const particles = r.spec.layers.find((l) => l.type === "particles");
    assert.ok(particles?.type === "particles" && particles.count === 300);
    const chart = r.spec.layers.find((l) => l.type === "chart");
    assert.ok(chart?.type === "chart" && chart.rows.length === 12);
    assert.ok(!("junk" in r.spec));
  }
});

test("repair: broken layers are dropped, the rest stays", () => {
  const spec = stat();
  spec.layers.push({ id: "bad", type: "counter", box: { x: 0, y: 0, w: 0.2, h: 0.1 } }); // no `to`
  spec.layers.push({ id: "bad2", type: "hologram" });
  spec.layers.push("not an object" as unknown as Record<string, unknown>);
  const r = repairSpec(spec);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.spec.layers.length, 3);
});

test("repair: moves boxes inside, renames repeated ids, fits time", () => {
  const spec = stat();
  (spec.layers[0] as { box: { x: number } }).box.x = 0.9;
  (spec.layers[1] as { id: string }).id = "card";
  (spec.layers[2] as { duration: number }).duration = 3.9;
  const r = repairSpec(spec);
  assert.equal(r.ok, true);
  if (r.ok) {
    const [card, dup, counter] = r.spec.layers;
    assert.ok(card && card.box.x + card.box.w <= 1 + 1e-9);
    assert.equal(dup?.id, "card-2");
    assert.ok(counter && counter.start + (counter.duration ?? 0) <= 4 + 1e-9);
  }
});

test("repair: a layer that starts after the end is removed; nothing left means failure", () => {
  const a = stat();
  (a.layers[2] as { start: number }).start = 9;
  const r = repairSpec(a);
  assert.equal(r.ok && r.spec.layers.length, 2);
  const b = stat();
  b.layers = [{ ...(b.layers[2] as Record<string, unknown>), start: 9 }];
  assert.equal(repairSpec(b).ok, false);
});

test("repair: cannot fix schema version, missing duration or non-object", () => {
  assert.equal(repairSpec({ ...stat(), schemaVersion: 3 }).ok, false);
  const s = stat();
  delete s.duration;
  assert.equal(repairSpec(s).ok, false);
  assert.equal(repairSpec("hello").ok, false);
  assert.equal(repairSpec(null).ok, false);
});

test("repair: bad optional values are removed, bad values with defaults use the default", () => {
  const spec = stat();
  (spec.layers[2] as Record<string, unknown>).format = "weird";
  (spec.layers[2] as Record<string, unknown>).color = "red";
  (spec.layers[0] as Record<string, unknown>).enter = "slide";
  const r = repairSpec(spec);
  assert.equal(r.ok, true);
  if (r.ok) {
    const counter = r.spec.layers[2];
    assert.ok(counter?.type === "counter" && counter.format === "grouped" && counter.color === undefined);
    assert.equal(r.spec.layers[0]?.enter, undefined);
  }
});

test("repair is idempotent and never throws on random garbage", () => {
  const first = repairSpec(clone(load("all_layers.json")));
  assert.ok(first.ok);
  if (first.ok) {
    const second = repairSpec(first.spec);
    assert.ok(second.ok && second.issues.length === 0);
    assert.deepEqual(second.ok && second.spec, first.spec);
  }
  let seed = 12345;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const junk = (depth: number): unknown => {
    const k = Math.floor(rnd() * 7);
    if (depth > 3 || k < 2) return [null, undefined, 1e99, -1, NaN, "x", true, ""][Math.floor(rnd() * 8)];
    if (k < 4) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(depth + 1));
    const o: Record<string, unknown> = {};
    for (const key of ["schemaVersion", "id", "duration", "layers", "type", "box", "text", "to", "rows", "x"]) if (rnd() < 0.5) o[key] = junk(depth + 1);
    return o;
  };
  for (let i = 0; i < 500; i++) {
    const r = repairSpec(junk(0));
    if (r.ok) assert.equal(validateSpec(r.spec).ok, true);
  }
});

test("repair of a mostly valid spec with bad values keeps strict validity (fuzz around the fixture)", () => {
  const base = load("all_layers.json");
  let seed = 99;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const values: unknown[] = [-5, 1e30, "zz", null, [], {}, 0.5, "#12345", true];
  const mutate = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => (rnd() < 0.15 ? values[Math.floor(rnd() * values.length)] : mutate(x)));
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (rnd() < 0.05) continue;
        o[k] = rnd() < 0.1 ? values[Math.floor(rnd() * values.length)] : mutate(x);
      }
      return o;
    }
    return v;
  };
  let repaired = 0;
  for (let i = 0; i < 300; i++) {
    const r = repairSpec(mutate(base));
    if (r.ok) { repaired++; assert.equal(validateSpec(r.spec).ok, true); }
  }
  assert.ok(repaired > 100);
});

test("image layer: only project-relative paths are accepted", () => {
  const spec = clone(load("all_layers.json")) as Loose;
  const image = spec.layers.find((l) => l.type === "image") as { src: string };
  for (const bad of ["https://x.com/a.png", "../secret.png", "/etc/passwd", "C:\\x.png", "a/../b.png", "file:///a.png"]) {
    image.src = bad;
    assert.equal(validateSpec(spec).ok, false, bad);
    const repaired = repairSpec(spec);
    assert.ok(!repaired.ok || !repaired.spec.layers.some((l) => l.type === "image"), bad);
  }
  image.src = "media/ok file.png";
  assert.equal(validateSpec(spec).ok, true);
});
