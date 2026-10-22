import { repairSpec } from "../../spec/index.ts";
import type { GraphicSpec } from "../../spec/schema.ts";
import { GEO_CASES, type GeoAssets } from "./geoCases.ts";
import type { Canvas2D } from "../context.ts";
import type { RenderOptions } from "../renderFrame.ts";

export interface GoldenCase {
  name: string;
  spec: GraphicSpec;
  frame: number;
  options?: RenderOptions;
  /** Draws the picture itself instead of `renderFrame` (maps and flags, whose layers come in phase 5). */
  custom?: (ctx: Canvas2D, width: number, height: number, assets: GeoAssets) => void;
}

export const GOLDEN_SIZE = { width: 320, height: 180 };

function make(id: string, layers: Record<string, unknown>[], duration = 2): GraphicSpec {
  const result = repairSpec({ schemaVersion: 1, id, duration, layers });
  if (!result.ok) throw new Error(`golden case ${id} is not a valid spec: ${JSON.stringify(result.issues)}`);
  return result.spec;
}

const BOX = { x: 0.1, y: 0.25, w: 0.8, h: 0.5 };
const text = (value: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "t", type: "text", box: BOX, text: value, size: 0.12, ...extra });

const cases: GoldenCase[] = [];
const add = (name: string, layers: Record<string, unknown>[], frame: number, options?: RenderOptions, duration = 2): void => {
  cases.push({ name, spec: make(name, layers, duration), frame, ...(options ? { options } : {}) });
};

// Text in every supported writing system.
add("text_latin", [text("Hello, world")], 30);
add("text_wrap_three_lines", [text("A longer headline that wraps onto several lines inside its box", { maxLines: 3, size: 0.09 })], 30);
add("text_shrinks_to_fit", [text("Shrink this headline", { maxLines: 1, size: 0.2, box: { x: 0.05, y: 0.4, w: 0.9, h: 0.2 } })], 30);
add("text_truncated", [text("This text is far too long for a tiny box and must be cut with an ellipsis at the end of it", { maxLines: 1, size: 0.2, box: { x: 0.05, y: 0.4, w: 0.5, h: 0.1 } })], 30);
add("text_cyrillic", [text("Привет, мир! Это тест.")], 30);
add("text_korean", [text("안녕하세요, 세계! 이것은 테스트입니다.", { maxLines: 2, size: 0.1 })], 30);
add("text_japanese_wrap", [text("今日は天気がとても良いですね。散歩に行きましょう。", { maxLines: 3, size: 0.1 })], 30);
add("text_chinese", [text("你好，世界！这是一个测试。", { maxLines: 2, size: 0.1 })], 30);
add("text_devanagari", [text("नमस्ते दुनिया, यह एक परीक्षण है", { maxLines: 2, size: 0.1 })], 30);
add("text_urdu_rtl", [text("یہ ایک اردو جملہ ہے جو دائیں سے بائیں لکھا جاتا ہے", { maxLines: 2, size: 0.1 })], 30);
add("text_left_aligned", [text("Left aligned", { align: "left" })], 30);
add("text_right_aligned", [text("Right aligned", { align: "right" })], 30);
add("richtext_mixed", [{ id: "r", type: "richText", box: BOX, size: 0.1, maxLines: 2, runs: [{ text: "Plain then " }, { text: "bold gold", weight: "bold", color: "accent" }, { text: " and more plain words" }] }], 30);

// Shapes, icons, pictures.
add("shape_round_rect", [{ id: "s", type: "shape", box: BOX, shape: "roundRect", fill: "primary", radius: 0.3 }], 30);
add("shape_circle_stroke", [{ id: "s", type: "shape", box: { x: 0.35, y: 0.2, w: 0.3, h: 0.6 }, shape: "circle", fill: "secondary", stroke: "accent", strokeWidth: 0.02 }], 30);
add("shape_line", [{ id: "s", type: "shape", box: { x: 0.1, y: 0.45, w: 0.8, h: 0.1 }, shape: "line", stroke: "accent", strokeWidth: 0.02 }], 30);
for (const name of ["check", "star", "arrow-right", "users", "flame"]) {
  add(`icon_${name}`, [{ id: "i", type: "icon", box: { x: 0.3, y: 0.15, w: 0.4, h: 0.7 }, icon: { set: "lucide", name }, color: "accent" }], 30);
}
// The bundled sets: Lucide (outline, one with solid dots), Tabler outline and Tabler solid.
for (const [set, name] of [["lucide", "trending-up"], ["lucide", "brain-circuit"], ["tabler", "flame"], ["tabler", "star-filled"], ["tabler", "world"]] as const) {
  add(`icon_${set}_${name}`, [{ id: "i", type: "icon", box: { x: 0.3, y: 0.15, w: 0.4, h: 0.7 }, icon: { set, name }, color: "accent" }], 30);
}
add("image_cover_rounded", [{ id: "p", type: "image", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, src: "test.png", fit: "cover", radius: 0.2 }], 30);
add("image_contain", [{ id: "p", type: "image", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, src: "test.png", fit: "contain" }], 30);

// Every entrance (a frame in the middle of the move, 0.5 s long: frame 8 is 0.267 s) and every exit (frame 8 of a 0.5 s graphic).
for (const preset of ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "pop", "wipe", "typewriter"]) {
  add(`enter_${preset}`, [
    { id: "c", type: "shape", box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, shape: "roundRect", fill: "secondary", enter: { preset, duration: 0.5, easing: "linear" } },
    text("Enter", { id: "t", size: 0.14, box: { x: 0.2, y: 0.35, w: 0.6, h: 0.3 }, enter: { preset, duration: 0.5, easing: "linear" } }),
  ], 8);
}
for (const preset of ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "wipe"]) {
  add(`exit_${preset}`, [
    { id: "c", type: "shape", box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, shape: "roundRect", fill: "secondary", exit: { preset, duration: 0.5, easing: "linear" } },
    text("Exit", { id: "t", size: 0.14, box: { x: 0.2, y: 0.35, w: 0.6, h: 0.3 }, exit: { preset, duration: 0.5, easing: "linear" } }),
  ], 8, undefined, 0.5);
}

// Motion blur on a moving box (slides in from the right over 0.15 s: about 3 px per frame).
const MOVING = { id: "c", type: "shape", box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, shape: "roundRect", fill: "accent", enter: { preset: "slideLeft", duration: 0.15, easing: "linear" } };
add("motion_blur_off", [MOVING], 2);
add("motion_blur_on", [MOVING], 2, { motionBlurSamples: 6, shutter: 1 });

// Maps and flags are drawn by helpers (their layers come in phase 5); the spec is a placeholder.
for (const item of GEO_CASES) cases.push({ name: item.name, spec: make(item.name, [text("map")]), frame: 0, custom: item.draw });

export const GOLDEN_CASES: readonly GoldenCase[] = cases;
