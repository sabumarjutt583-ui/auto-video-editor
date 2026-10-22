import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_THEME } from "../render/theme.ts";
import type { RenderNote } from "../render/context.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { captionZone, safeArea } from "../placement/index.ts";
import { badgesOf, checkGraphics, contrastRatio, glyphChecker, missingCharacters, familiesOf, readingSeconds, wordCount, type GraphicItem, type QualityEnv, type RGB } from "./index.ts";

const FONTS = new URL("../../../../resources/fonts/", import.meta.url);
const checkers = new Map<string, (cp: number) => boolean>();
const fontFile: Record<string, string> = { "Noto Sans": "NotoSans-Regular.ttf", "Noto Sans KR": "NotoSansKR-Regular.otf", "Noto Sans Arabic": "NotoSansArabic-Regular.ttf", "Noto Sans JP": "NotoSansJP-Regular.otf" };
function realGlyph(family: string, cp: number): boolean | null {
  const file = fontFile[family];
  if (!file) return null;
  let check = checkers.get(file);
  if (!check) { check = glyphChecker(new Uint8Array(readFileSync(new URL(file, FONTS)))); checkers.set(file, check); }
  return check(cp);
}

function spec(layers: Record<string, unknown>[], duration = 4): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "g1", duration, layers });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.issues));
  return r.spec;
}
const text = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: "text", id: "t", text: "45 percent", box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, start: 0, ...extra });
const item = (s: GraphicSpec, extra: Partial<GraphicItem> = {}): GraphicItem => ({ id: "g1", sceneId: "S01", start: 10, duration: s.duration, spec: s, ...extra });

function env(extra: Partial<QualityEnv> = {}): QualityEnv {
  return {
    theme: DEFAULT_THEME,
    scene: () => ({ start: 10, end: 20 }),
    caption: captionZone({ preset: "clean", position: "bottom", fontSize: 5 }, "16:9"),
    safe: safeArea({ x: 0.05, y: 0.05 }),
    subjectsFor: () => [],
    pictureColor: () => null,
    notes: () => [],
    hasGlyph: realGlyph,
    ...extra,
  };
}
const issuesOf = (g: GraphicItem[], e: QualityEnv, check: string) => checkGraphics(g, e).issues.filter((i) => i.check === check);

describe("colour and reading helpers", () => {
  it("contrast ratio: black/white 21, same colour 1", () => {
    assert.ok(Math.abs(contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
    assert.equal(contrastRatio([10, 20, 30], [10, 20, 30]), 1);
  });
  it("reading time: 0.3 s per word plus 0.5 s, per script", () => {
    assert.equal(wordCount("one two three"), 3);
    assert.equal(readingSeconds("one two three"), 1.4);
    assert.equal(readingSeconds(""), 0);
    assert.equal(wordCount("日本の人口は約1億2000万人です"), 9);
    assert.equal(wordCount("한국의 인구는 약 오천만 명"), 5);
  });
});

describe("glyph coverage from the real font files", () => {
  it("Noto Sans draws Latin, not Hangul; Noto Sans KR draws Hangul; Arabic draws Urdu", () => {
    assert.equal(realGlyph("Noto Sans", 0x41), true);
    assert.equal(realGlyph("Noto Sans", 0xd55c), false);
    assert.equal(realGlyph("Noto Sans KR", 0xd55c), true);
    assert.equal(realGlyph("Noto Sans Arabic", 0x0627), true);
    assert.equal(realGlyph("Noto Sans Arabic", 0x0679), true); // Urdu letter ٹ
    assert.equal(realGlyph("Noto Sans JP", 0x65e5), true);
  });
  it("missingCharacters names what no font in the list can draw, and ignores spaces and joiners", () => {
    const families = familiesOf('"Noto Sans", sans-serif');
    assert.deepEqual(missingCharacters("Hi 한", families, realGlyph), ["한"]);
    assert.deepEqual(missingCharacters("Hi ‌ there", families, realGlyph), []);
    assert.deepEqual(missingCharacters("한", ["Mystery"], realGlyph), []);
  });
});

describe("checks (each with a failing and a passing example)", () => {
  it("glyph: Korean text with a Latin-only font fails, with the Korean font passes", () => {
    const ko = item(spec([text({ text: "한국의 인구" })]));
    const latinOnly = { ...DEFAULT_THEME, fonts: { ...DEFAULT_THEME.fonts, korean: '"Noto Sans", sans-serif' } };
    assert.equal(issuesOf([ko], env({ theme: latinOnly }), "glyph").length, 1);
    assert.equal(issuesOf([ko], env(), "glyph").length, 0);
  });
  it("font: a font that suits no part of the script is an error; Urdu with the Arabic font passes", () => {
    const ur = item(spec([text({ text: "پاکستان کی آبادی" })]));
    const wrong = { ...DEFAULT_THEME, fonts: { ...DEFAULT_THEME.fonts, arabic: '"Noto Sans KR", sans-serif' } };
    const bad = issuesOf([ur], env({ theme: wrong }), "font");
    assert.equal(bad.length, 1);
    assert.equal(bad[0]?.severity, "error");
    assert.equal(issuesOf([ur], env(), "font").length, 0);
    assert.equal(issuesOf([ur], env(), "glyph").length, 0);
  });
  it("timing: past the end of the scene fails and is trimmed; inside passes; a tiny scene is an error", () => {
    const late = item(spec([text()], 6), { start: 16 });
    const found = issuesOf([late], env(), "timing");
    assert.equal(found.length, 1);
    const fixed = checkGraphics([late], env(), { fix: true });
    assert.ok(fixed.changed.length === 1);
    const g = fixed.changed[0] as GraphicItem;
    assert.ok(g.start + g.duration <= 19.9 + 1e-9 && g.duration >= 1.2);
    assert.equal(fixed.issues.filter((i) => !i.fixed && i.check === "timing").length, 0);
    assert.equal(issuesOf([item(spec([text()], 4))], env(), "timing").length, 0);
    assert.equal(issuesOf([late], env({ scene: () => ({ start: 16, end: 17 }) }), "timing")[0]?.severity, "error");
  });
  it("reading: 12 words in 1.2 s fails and is extended; enough time passes", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve";
    const quick = item(spec([text({ text: words, maxLines: 4 })], 1.2));
    assert.equal(issuesOf([quick], env(), "reading").length, 1);
    const fixed = checkGraphics([quick], env(), { fix: true });
    assert.equal(fixed.changed.length, 1);
    assert.ok((fixed.changed[0] as GraphicItem).duration >= 4.1);
    assert.equal(fixed.issues.filter((i) => !i.fixed && i.check === "reading").length, 0);
    assert.equal(issuesOf([item(spec([text({ text: words, maxLines: 4 })], 5))], env(), "reading").length, 0);
  });
  it("reading: no room in the scene stays a warning", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve";
    const crowded = item(spec([text({ text: words, maxLines: 4 })], 3), { start: 15 });
    const out = checkGraphics([crowded], env({ scene: () => ({ start: 15, end: 19 }) }), { fix: true });
    assert.ok(out.issues.some((i) => i.check === "reading" && !i.fixed));
  });
  it("fit: cut text fails and is made smaller; text that fits passes", () => {
    const notes = (s: GraphicSpec): RenderNote[] => (s.layers.some((l) => "size" in l && typeof l.size === "number" && l.size > 0.07) ? [{ layerId: "t", kind: "truncated", message: "cut" }] : []);
    const big = item(spec([text({ size: 0.09 })]));
    assert.equal(issuesOf([big], env({ notes }), "fit").length, 1);
    const fixed = checkGraphics([big], env({ notes }), { fix: true });
    assert.equal(fixed.changed.length, 1);
    assert.equal(fixed.issues.filter((i) => !i.fixed && i.check === "fit").length, 0);
    assert.equal(issuesOf([item(spec([text({ size: 0.05 })]))], env({ notes }), "fit").length, 0);
  });
  it("contrast: white text on a bright picture fails and gets a plate; on a dark picture it passes", () => {
    const g = item(spec([text({ color: "text" })]));
    const bright = (): RGB => [235, 235, 220];
    assert.equal(issuesOf([g], env({ pictureColor: bright }), "contrast").length, 1);
    assert.equal(issuesOf([g], env({ pictureColor: () => [20, 20, 30] }), "contrast").length, 0);
    const fixed = checkGraphics([g], env({ pictureColor: bright }), { fix: true });
    assert.equal(fixed.changed.length, 1);
    const after = fixed.changed[0] as GraphicItem;
    assert.ok(after.spec.layers.some((l) => l.type === "shape" && l.id.startsWith("plate-")));
    assert.equal(fixed.issues.filter((i) => !i.fixed && i.check === "contrast").length, 0);
  });
  it("contrast: text on a plate of the graphic is measured against the plate", () => {
    const withPlate = item(spec([{ type: "shape", id: "p", shape: "roundRect", fill: "background", opacity: 1, box: { x: 0.05, y: 0.05, w: 0.5, h: 0.3 }, start: 0 }, text()]));
    assert.equal(issuesOf([withPlate], env({ pictureColor: () => [240, 240, 240] }), "contrast").length, 0);
  });
  it("placement: over the subject or the captions fails and is moved; free passes", () => {
    const g = item(spec([text({ box: { x: 0.3, y: 0.3, w: 0.4, h: 0.2 } })]));
    const subject = { x: 0.25, y: 0.2, w: 0.5, h: 0.5 };
    assert.equal(issuesOf([g], env({ subjectsFor: () => [subject] }), "placement").length, 1);
    const fixed = checkGraphics([g], env({ subjectsFor: () => [subject] }), { fix: true });
    assert.equal(fixed.changed.length, 1);
    assert.equal(fixed.issues.filter((i) => !i.fixed && i.check === "placement").length, 0);
    assert.equal(issuesOf([g], env(), "placement").length, 0);
    const onCaptions = item(spec([text({ box: { x: 0.1, y: 0.85, w: 0.5, h: 0.1 } })]));
    assert.equal(issuesOf([onCaptions], env(), "placement").length, 1);
  });
  it("overlap: two graphics at once that cover each other fails and the first is shortened; side by side is fine", () => {
    const a = item(spec([text()], 6), { id: "a", sceneId: "S01", start: 10 });
    const b = item(spec([text()], 4), { id: "b", sceneId: "S02", start: 13 });
    const e = env({ scene: () => ({ start: 10, end: 30 }) });
    assert.equal(issuesOf([a, b], e, "overlap").length, 1);
    const fixed = checkGraphics([a, b], e, { fix: true });
    const first = fixed.changed.find((g) => g.id === "a") as GraphicItem;
    assert.ok(first.start + first.duration <= 13);
    const apart = item(spec([text({ box: { x: 0.55, y: 0.1, w: 0.4, h: 0.2 } })], 4), { id: "b", sceneId: "S02", start: 13 });
    assert.equal(issuesOf([a, apart], e, "overlap").length, 0);
  });
  it("fixes are repeatable and badges show only what is still open", () => {
    const late = item(spec([text()], 6), { start: 16 });
    const a = checkGraphics([late], env(), { fix: true });
    const b = checkGraphics([late], env(), { fix: true });
    assert.deepEqual(a, b);
    const ko = item(spec([text({ text: "한국" })]), { id: "k" });
    const latinOnly = { ...DEFAULT_THEME, fonts: { ...DEFAULT_THEME.fonts, korean: '"Noto Sans", sans-serif' } };
    const badges = badgesOf(checkGraphics([late, ko], env({ theme: latinOnly }), { fix: true }));
    assert.equal(badges.has("g1"), false);
    assert.equal(badges.get("k")?.severity, "error");
  });
});
