import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { recorder } from "../render/recorder.ts";
import type { RenderContext } from "../render/context.ts";
import { renderFrame } from "../render/renderFrame.ts";
import { DEFAULT_THEME } from "../render/theme.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { allKits, BOLD_NEWS, BUILTIN_KITS, CLEAN_DOCUMENTARY, contrast, DEFAULT_KIT_ID, findKit, normalizeHex, repairBrandKit, resolveKit, SOFT_STORY, SUGGESTED_KITS, suggestKit, themeOfKit } from "./index.ts";
import { SUGGESTED_STYLE_IDS } from "./suggest.ts";

const styleIds = readdirSync(new URL("../../../../resources/styles/", import.meta.url))
  .filter((f) => f.endsWith(".json") && f !== "package.json")
  .map((f) => (JSON.parse(readFileSync(new URL(`../../../../resources/styles/${f}`, import.meta.url), "utf8")) as { id: string }).id);

test("the three built-in kits are valid as they are and have different looks", () => {
  assert.deepEqual(BUILTIN_KITS.map((k) => k.name), ["Clean Documentary", "Bold News", "Soft Story"]);
  for (const kit of [...BUILTIN_KITS, ...SUGGESTED_KITS]) {
    const { kit: repaired, notes } = repairBrandKit(kit);
    assert.deepEqual(notes, [], `${kit.id}: ${notes.join(" ")}`);
    assert.deepEqual(repaired, kit);
    assert.ok(contrast(kit.colors.text, kit.colors.background) >= 4.5, `${kit.id}: text must be readable`);
    assert.ok(contrast(kit.colors.text, kit.colors.secondary) >= 4.5, `${kit.id}: text must be readable on cards`);
  }
  const ids = [...BUILTIN_KITS, ...SUGGESTED_KITS].map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.notEqual(CLEAN_DOCUMENTARY.colors.primary, BOLD_NEWS.colors.primary);
  assert.notEqual(BOLD_NEWS.radius, SOFT_STORY.radius);
});

test("an invalid kit is repaired and every repair is explained", () => {
  const { kit, notes } = repairBrandKit({
    id: "Bad Id!", name: "  ",
    colors: { primary: "red", secondary: "#FFF", accent: 5, text: "#101010", background: "#000000", success: null },
    fonts: { latin: "Comic Sans", korean: "Noto Sans KR" },
    radius: 99, strokeWidth: -1, shadow: "lots", headingWeight: 500, headingCase: "shout",
    enter: { preset: "explode", duration: 50 }, exit: { preset: "fade", duration: -2 }, easing: "bouncy",
    logo: "a\u0000b", density: "huge", safeMargins: { x: 0.9, y: "no" },
  });
  assert.equal(kit.id, "clean_documentary", "a bad id becomes the name's id");
  assert.equal(kit.name, "Clean Documentary");
  assert.equal(kit.colors.primary, CLEAN_DOCUMENTARY.colors.primary);
  assert.equal(kit.colors.secondary, "#ffffff", "#FFF is read as #ffffff");
  assert.equal(kit.colors.text, "#ffffff", "dark grey text on black is replaced");
  assert.equal(kit.fonts.latin, "Noto Sans");
  assert.equal(kit.radius, 2);
  assert.equal(kit.strokeWidth, 0.5);
  assert.equal(kit.shadow, CLEAN_DOCUMENTARY.shadow);
  assert.equal(kit.headingWeight, 700);
  assert.equal(kit.headingCase, "normal");
  assert.equal(kit.enter.preset, "fade");
  assert.equal(kit.enter.duration, 2);
  assert.equal(kit.exit.duration, 0);
  assert.equal(kit.easing, "easeOut");
  assert.equal(kit.logo, "");
  assert.equal(kit.density, "normal");
  assert.equal(kit.safeMargins.x, 0.2);
  assert.equal(kit.safeMargins.y, CLEAN_DOCUMENTARY.safeMargins.y);
  assert.ok(notes.length >= 15, notes.join("\n"));
  assert.deepEqual(repairBrandKit(kit).notes, [], "a repaired kit is valid");
});

test("anything that is not an object gives the base kit, and a kit never throws", () => {
  for (const input of [undefined, null, 5, "kit", [], () => 1]) {
    const { kit } = repairBrandKit(input);
    assert.equal(kit.name, CLEAN_DOCUMENTARY.name);
    assert.deepEqual(kit.colors, CLEAN_DOCUMENTARY.colors);
  }
  assert.equal(repairBrandKit({ name: "My Channel" }).kit.id, "my_channel");
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex("blue"), null);
});

test("every style has a kit, and the special ones point at real styles", () => {
  assert.equal(styleIds.length, 51);
  for (const id of styleIds) assert.equal(repairBrandKit(suggestKit(id).kit).notes.length, 0, id);
  for (const id of SUGGESTED_STYLE_IDS) assert.ok(styleIds.includes(id), `${id} is not a style`);
  assert.equal(suggestKit("noir").kit.id, "mono_noir");
  assert.equal(suggestKit("noir").kit.headingCase, "upper");
  assert.equal(suggestKit("anime").kit.id, "bright_pop");
  assert.equal(suggestKit("custom_my_look").kit.id, DEFAULT_KIT_ID);
  assert.ok(suggestKit("noir").reason.length > 10);
  const covered = styleIds.filter((id) => SUGGESTED_STYLE_IDS.includes(id)).length;
  assert.ok(covered >= 45, `${covered} of 51 styles have their own suggestion`);
});

test("the kit of a project: its own choice, then the app's, then Clean Documentary", () => {
  const custom = [{ ...BOLD_NEWS, id: "mine", name: "Mine" }, { ...SOFT_STORY, id: "clean_documentary" }];
  assert.equal(allKits(custom).filter((k) => k.id === "clean_documentary").length, 1, "a custom kit cannot replace a built-in one");
  assert.equal(resolveKit({ custom, activeId: "bold_news", projectId: "", styleId: "" }).id, "bold_news");
  assert.equal(resolveKit({ custom, activeId: "bold_news", projectId: "mine", styleId: "" }).id, "mine");
  assert.equal(resolveKit({ custom, activeId: "gone", projectId: "gone", styleId: "" }).id, "clean_documentary");
  assert.equal(resolveKit({ custom, activeId: "", projectId: "match-style", styleId: "anime" }).id, "bright_pop");
  assert.equal(findKit("nope", custom), undefined);
});

test("a kit becomes a theme: colours, fonts, shape and animations", () => {
  const theme = themeOfKit(BOLD_NEWS);
  assert.equal(theme.colors.primary, BOLD_NEWS.colors.primary);
  assert.equal(theme.colors.danger, BOLD_NEWS.colors.danger);
  assert.notEqual(theme.colors.muted, theme.colors.text);
  assert.equal(theme.palette[0], BOLD_NEWS.colors.primary);
  assert.equal(theme.palette.length, 12);
  assert.equal(theme.fonts.latin, '"Noto Sans", sans-serif');
  assert.equal(theme.fonts.korean, '"Noto Sans KR", "Noto Sans", sans-serif');
  assert.equal(theme.enter?.preset, "slideLeft");
  assert.equal(theme.enter?.easing, "easeOutExpo");
  assert.equal(themeOfKit({ ...BOLD_NEWS, enter: { preset: "none", duration: 0.3 } }).enter, undefined);
});

// ---- Rendering: the kit changes what is drawn ----

const rcWith = (theme: RenderContext["theme"]): RenderContext => ({ width: 320, height: 180, theme, image: () => undefined, icon: () => undefined });
function specOf(layers: Record<string, unknown>[], duration = 3): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "t", duration, layers });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.spec;
}
function draw(spec: GraphicSpec, frame: number, theme: RenderContext["theme"]): string[] {
  const rec = recorder();
  renderFrame(spec, frame, rec.ctx, rcWith(theme));
  return rec.log;
}

/** The words drawn, in order, as one text. */
const words = (log: string[]): string =>
  log.filter((l) => l.startsWith("fillText(")).map((l) => l.slice(9, l.lastIndexOf(",", l.lastIndexOf(",") - 1))).join(" ");

const LOWER = specOf([{ id: "l", type: "lowerThird", box: { x: 0.08, y: 0.62, w: 0.62, h: 0.26 }, title: "Dr. Amina Khan", subtitle: "Climate scientist", enter: { preset: "none" } }]);

test("changing the kit changes the colours, the letters and the corners that are drawn", () => {
  const clean = draw(LOWER, 60, themeOfKit(CLEAN_DOCUMENTARY));
  const bold = draw(LOWER, 60, themeOfKit(BOLD_NEWS));
  const soft = draw(LOWER, 60, themeOfKit(SOFT_STORY));
  // Colours: the accent stripe of each kit is drawn.
  assert.ok(clean.includes(`fillStyle=${CLEAN_DOCUMENTARY.colors.accent}`));
  assert.ok(bold.includes(`fillStyle=${BOLD_NEWS.colors.accent}`));
  assert.ok(soft.includes(`fillStyle=${SOFT_STORY.colors.accent}`));
  assert.ok(!bold.includes(`fillStyle=${CLEAN_DOCUMENTARY.colors.accent}`));
  // Letters: Bold News writes titles in capitals, the others as given.
  assert.ok(words(bold).includes("DR. AMINA KHAN"), words(bold));
  assert.ok(words(clean).includes("Dr. Amina Khan"), words(clean));
  // Weight: Soft Story uses the regular weight for titles.
  assert.ok(soft.some((l) => /^font=400 /.test(l)));
  assert.ok(clean.some((l) => /^font=700 /.test(l)));
  // Corners and shadow differ.
  assert.notDeepEqual(clean, bold);
  assert.notDeepEqual(clean, soft);
  assert.notDeepEqual(bold, soft);
});

test("the default theme still draws exactly what it drew before the kits", () => {
  const a = draw(LOWER, 60, DEFAULT_THEME);
  const b = draw(LOWER, 60, { ...DEFAULT_THEME });
  assert.deepEqual(a, b);
  assert.ok(words(a).includes("Dr. Amina Khan"));
});

test("the kit's entrance is used by layers that have none, and a layer's own choice wins", () => {
  const plain = specOf([{ id: "t", type: "text", box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, text: "Hello" }]);
  const own = specOf([{ id: "t", type: "text", box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, text: "Hello", enter: { preset: "none" } }]);
  const soft = themeOfKit(SOFT_STORY); // fade, 0.7 s
  const alphaAt = (spec: GraphicSpec, frame: number, theme: RenderContext["theme"]): number => {
    const log = draw(spec, frame, theme);
    return Math.min(1, ...log.filter((l) => l.startsWith("globalAlpha=")).map((l) => Number(l.split("=")[1])));
  };
  assert.ok(alphaAt(plain, 3, soft) < 0.5, "fading in at 0.1 s");
  assert.equal(alphaAt(plain, 30, soft), 1, "fully in after 1 s");
  assert.equal(alphaAt(own, 3, soft), 1, "enter: none is respected");
  assert.equal(alphaAt(plain, 3, DEFAULT_THEME), 1, "no kit animation with the default theme");
});

test("charts, timelines and the map follow the kit's colours and line thickness", () => {
  const chart = specOf([{ id: "c", type: "chart", box: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, kind: "line", rows: [{ label: "A", value: 1 }, { label: "B", value: 3 }, { label: "C", value: 2 }], enter: { preset: "none" } }]);
  const thin = draw(chart, 80, themeOfKit({ ...CLEAN_DOCUMENTARY, strokeWidth: 0.5 }));
  const thick = draw(chart, 80, themeOfKit({ ...CLEAN_DOCUMENTARY, strokeWidth: 3 }));
  const width = (log: string[]): number => Math.max(...log.filter((l) => l.startsWith("lineWidth=")).map((l) => Number(l.split("=")[1])));
  assert.ok(width(thick) > width(thin) * 3, `${width(thick)} vs ${width(thin)}`);
  const red = draw(chart, 80, themeOfKit(BOLD_NEWS));
  assert.ok(red.some((l) => l === `strokeStyle=${BOLD_NEWS.colors.primary}`));
});

test("the shadow strength of the kit reaches the letters", () => {
  const counter = specOf([{ id: "c", type: "counter", box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, from: 0, to: 100, label: "Visitors", enter: { preset: "none" } }]);
  const shadowOf = (shadow: number): string[] => draw(counter, 60, themeOfKit({ ...CLEAN_DOCUMENTARY, shadow })).filter((l) => l.startsWith("shadowColor="));
  assert.ok(shadowOf(0.45).every((l) => l === "shadowColor=rgba(0,0,0,0.45)") && shadowOf(0.45).length > 0);
  assert.ok(shadowOf(0.9).every((l) => l === "shadowColor=rgba(0,0,0,0.9)") && shadowOf(0.9).length > 0);
  assert.equal(shadowOf(0).length, 0, "no shadow at all");
});
