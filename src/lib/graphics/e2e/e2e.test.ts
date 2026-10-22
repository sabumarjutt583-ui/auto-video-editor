import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { loadCities } from "../geo/cities.ts";
import { buildPlaceIndex, detectTriggers, directGraphics, type DirectorScene, type DirectorSettings, type PlaceIndex, type TimedWord } from "../director/index.ts";
import { captionZone, safeArea } from "../placement/index.ts";
import { overlap, type Box } from "../placement/geometry.ts";
import { placeAll } from "../placement/plan.ts";
import { mainExtent } from "../placement/solver.ts";
import { checkGraphics, glyphChecker, type GraphicItem, type QualityEnv } from "../quality/index.ts";
import { DEFAULT_THEME } from "../render/theme.ts";
import { frameCount, FPS } from "../render/timing.ts";

const ROOT = new URL("../../../../", import.meta.url);
const FIXTURES = new URL("tests/fixtures/e2e/", ROOT);
const FONTS = new URL("resources/fonts/", ROOT);
const OUTPUT = new URL("tests/output/", ROOT);

interface Fixture {
  name: string; title: string; language: string; aspect: "16:9" | "9:16"; minSeconds: number; maxSeconds: number; minGraphics: number; scenes: string[];
}

const files: Record<string, string> = { "Noto Sans": "NotoSans-Regular.ttf", "Noto Sans KR": "NotoSansKR-Regular.otf", "Noto Sans Arabic": "NotoSansArabic-Regular.ttf", "Noto Sans JP": "NotoSansJP-Regular.otf" };
const checkers = new Map<string, (cp: number) => boolean>();
function hasGlyph(family: string, cp: number): boolean | null {
  const file = files[family];
  if (!file) return null;
  let check = checkers.get(file);
  if (!check) { check = glyphChecker(new Uint8Array(readFileSync(new URL(file, FONTS)))); checkers.set(file, check); }
  return check(cp);
}

/** Word timing for a script without a voice-over: 0.42 s per word, at least 5.5 s per scene. */
function buildScenes(lines: readonly string[], places: PlaceIndex): { scenes: DirectorScene[]; total: number } {
  let clock = 0;
  const scenes = lines.map((text, index): DirectorScene => {
    const tokens = text.split(/\s+/).filter((t) => t !== "");
    const length = Math.max(5.5, tokens.length * 0.42);
    const step = length / (tokens.length + 1);
    const words: TimedWord[] = tokens.map((t, i) => ({ text: t, start: Math.round((clock + (i + 0.5) * step) * 100) / 100, end: Math.round((clock + (i + 1.5) * step) * 100) / 100 }));
    const base = { id: `S${String(index + 1).padStart(2, "0")}`, start: Math.round(clock * 100) / 100, end: Math.round((clock + length) * 100) / 100, text, words };
    clock += length;
    return { ...base, index, description: "", triggers: detectTriggers(base, places) };
  });
  return { scenes, total: Math.round(clock * 100) / 100 };
}

let places: PlaceIndex;
before(async () => { places = buildPlaceIndex(await loadCities()); });

const fixtures: Fixture[] = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(new URL(f, FIXTURES), "utf8")) as Fixture);

describe("end-to-end projects", () => {
  it("there are the four projects of the plan", () => {
    assert.deepEqual(fixtures.map((f) => f.name), ["documentary_en", "short_en_9x16", "story_ko", "story_ur"]);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: graphics are made, placed clear of the subject and captions, pass the quality checks and keep exact 30 fps timing`, async () => {
      const { scenes, total } = buildScenes(fixture.scenes, places);
      assert.ok(total >= fixture.minSeconds && total <= fixture.maxSeconds, `${fixture.name} lasts ${total} s`);

      // 1. The director with an AI that gives no usable answer: the rules still make safe graphics (the app works offline too).
      let calls = 0;
      const settings: DirectorSettings = { density: "normal", language: fixture.language, styleName: "Cinematic", kitSummary: "Clean." };
      const directed = await directGraphics({ scenes, settings, call: async () => { calls++; return "not json"; }, icons: async () => [] });
      assert.equal(directed.failed, null);
      assert.ok(calls >= 1);
      assert.ok(directed.placed.length >= fixture.minGraphics, `${fixture.name}: ${directed.placed.length} graphics`);

      // 2. Placement away from the subject, the caption zone and the margins.
      const caption = captionZone({ preset: "clean", position: "bottom", fontSize: 5 }, fixture.aspect);
      const safe = safeArea({ x: 0.05, y: 0.05 });
      const subject: Box = fixture.aspect === "16:9" ? { x: 0.38, y: 0.18, w: 0.24, h: 0.55 } : { x: 0.3, y: 0.2, w: 0.4, h: 0.35 };
      const placing = placeAll(directed.placed, { caption, safe, subjectsFor: () => [subject] });
      assert.ok(placing.placed.length >= 1, `${fixture.name}: nothing survived placement`);
      for (const p of placing.placed) {
        const extent = mainExtent(p.spec);
        assert.ok(extent, `${p.sceneId} has a main part`);
        assert.equal(overlap(extent, subject) < 1e-6, true, `${p.sceneId} covers the subject`);
        if (caption) assert.equal(overlap(extent, caption) < 1e-6, true, `${p.sceneId} touches the captions`);
        assert.ok(extent.x >= safe.x - 1e-6 && extent.y >= safe.y - 1e-6 && extent.x + extent.w <= safe.x + safe.w + 1e-6 && extent.y + extent.h <= safe.y + safe.h + 1e-6, `${p.sceneId} leaves the safe area`);
      }

      // 3. Timing inside the scene and exact frame counts at 30 fps.
      const byScene = new Map(scenes.map((s) => [s.id, s]));
      for (const p of placing.placed) {
        const scene = byScene.get(p.sceneId);
        assert.ok(scene);
        assert.ok(p.start >= scene.start - 1e-9 && p.start + p.duration <= scene.end - 0.1 + 1e-9, `${p.sceneId} is not inside its scene`);
        assert.equal(frameCount(p.duration), Math.round(p.duration * FPS));
        assert.equal(frameCount(p.spec.duration), Math.round(p.spec.duration * FPS));
      }
      assert.ok(Number.isInteger(Math.round(total * FPS)) && Math.round(total * FPS) > 0);

      // 4. Quality checks: no error is left after the safe fixes.
      const items: GraphicItem[] = placing.placed.map((p, i) => ({ id: `g${i + 1}`, sceneId: p.sceneId, start: p.start, duration: p.duration, spec: p.spec }));
      const env: QualityEnv = {
        theme: DEFAULT_THEME,
        scene: (id) => { const s = byScene.get(id); return s ? { start: s.start, end: s.end } : undefined; },
        caption, safe,
        subjectsFor: () => [subject],
        pictureColor: () => [60, 60, 70],
        notes: () => [],
        hasGlyph,
      };
      const fixed = checkGraphics(items, env, { fix: true });
      const after = checkGraphics(fixed.changed.length > 0 ? items.map((i) => fixed.changed.find((c) => c.id === i.id) ?? i) : items, env);
      const errors = after.issues.filter((i) => i.severity === "error");
      assert.deepEqual(errors.map((e) => `${e.sceneId} ${e.check}: ${e.message}`), []);

      // 5. The plan is saved for the browser test that draws the sample frames (tests/output is not committed).
      const finalItems = items.map((i) => fixed.changed.find((c) => c.id === i.id) ?? i);
      const dir = new URL(`${fixture.name}/`, OUTPUT);
      mkdirSync(dir, { recursive: true });
      const size = fixture.aspect === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
      writeFileSync(new URL("plan.json", dir), JSON.stringify({ name: fixture.name, ...size, total, subject, caption, graphics: finalItems.map((g) => ({ id: g.id, sceneId: g.sceneId, start: g.start, duration: g.duration, spec: g.spec })) }, null, 1));
    });
  }
});
