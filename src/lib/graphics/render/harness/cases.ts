import { repairSpec } from "../../spec/index.ts";
import type { GraphicSpec } from "../../spec/schema.ts";
import { GEO_CASES, type GeoAssets } from "./geoCases.ts";
import type { Canvas2D } from "../context.ts";
import type { RenderOptions } from "../renderFrame.ts";
import { BOLD_NEWS, CLEAN_DOCUMENTARY, SOFT_STORY, suggestKit, themeOfKit, type BrandKit } from "../../brand/index.ts";
import type { Theme } from "../theme.ts";

export interface GoldenCase {
  name: string;
  spec: GraphicSpec;
  frame: number;
  options?: RenderOptions;
  /** Brand kit look (the default theme when missing). */
  theme?: Theme;
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

// ---- Phase 5 layers: every type at three moments of a 3-second graphic: entering (0.5 s), holding (2.0 s) and leaving (2.77 s). ----
const FULL = { x: 0.06, y: 0.08, w: 0.88, h: 0.84 };
const MOMENTS = [["enter", 15], ["hold", 60], ["exit", 83]] as const;
const timed = (layer: Record<string, unknown>): Record<string, unknown> => ({ enter: { preset: "fade", duration: 0.3, easing: "linear" }, exit: { preset: "fade", duration: 0.6, easing: "linear" }, ...layer });
const three = (name: string, layer: Record<string, unknown>, moments: readonly (typeof MOMENTS)[number][] = MOMENTS): void => {
  for (const [moment, frame] of moments) add(`${name}_${moment}`, [timed(layer)], frame, undefined, 3);
};
const HOLD = [MOMENTS[1]] as const;

three("counter_grouped", { id: "c", type: "counter", box: { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }, from: 0, to: 1200000, format: "grouped", size: 0.22, label: "Total views" });
three("counter_money", { id: "c", type: "counter", box: { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }, from: 0, to: 3500000, format: "compact", decimals: 1, prefix: "$", size: 0.22, label: "Revenue", color: "accent" }, HOLD);
three("counter_percent", { id: "c", type: "counter", box: { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }, from: 100, to: 45, suffix: "%", size: 0.25 }, HOLD);

const ROWS4 = [{ label: "2021", value: 120 }, { label: "2022", value: 180 }, { label: "2023", value: 260 }, { label: "2024", value: 340 }];
three("chart_bar", { id: "c", type: "chart", box: FULL, kind: "bar", title: "Yearly users", unit: "K", rows: ROWS4, highlight: 3 });
add("chart_bar_horizontal_hold", [timed({ id: "c", type: "chart", box: FULL, kind: "bar", title: "Top countries", rows: ["India", "China", "United States", "Indonesia", "Pakistan", "Nigeria", "Brazil", "Bangladesh"].map((label, i) => ({ label, value: 1400 - i * 150 })) })], 60, undefined, 3);
add("chart_bar_negative_hold", [timed({ id: "c", type: "chart", box: FULL, kind: "bar", unit: "%", rows: [{ label: "Q1", value: 12 }, { label: "Q2", value: -8 }, { label: "Q3", value: 5 }, { label: "Q4", value: -3 }] })], 60, undefined, 3);
three("chart_line", { id: "c", type: "chart", box: FULL, kind: "line", title: "Subscribers", rows: [{ label: "Jan", value: 10 }, { label: "Feb", value: 14 }, { label: "Mar", value: 13 }, { label: "Apr", value: 22 }, { label: "May", value: 31 }, { label: "Jun", value: 45 }] });
three("chart_pie", { id: "c", type: "chart", box: FULL, kind: "pie", rows: [{ label: "Mobile", value: 55 }, { label: "Desktop", value: 30 }, { label: "Tablet", value: 15 }], highlight: 0 });
three("chart_donut", { id: "c", type: "chart", box: FULL, kind: "donut", title: "Traffic", rows: [{ label: "Search", value: 50 }, { label: "Social", value: 30 }, { label: "Direct", value: 20 }] });

const EVENTS = [{ label: "Company founded", date: "1998" }, { label: "First product", date: "2001" }, { label: "Goes public", date: "2010" }, { label: "Global launch", date: "2020" }];
three("timeline_horizontal", { id: "t", type: "timeline", box: FULL, orientation: "horizontal", events: EVENTS });
add("timeline_vertical_hold", [timed({ id: "t", type: "timeline", box: FULL, orientation: "vertical", events: EVENTS })], 60, undefined, 3);

const MAP = { id: "m", type: "map", box: FULL, region: "world", projection: "naturalEarth", countries: [{ code: "PK", label: "Pakistan" }, { code: "JP", label: "Japan" }], pins: [{ name: "Karachi", lat: 24.87, lon: 66.99 }], routes: [{ from: { lat: 24.87, lon: 66.99 }, to: { lat: 35.69, lon: 139.75 } }], camera: [{ t: 0, zoom: 1 }, { t: 2.5, zoom: 1.5, panX: -0.15, panY: 0.05 }] };
three("map_world", MAP);
add("map_europe_hold", [timed({ id: "m", type: "map", box: FULL, region: "europe", projection: "mercator", countries: [{ code: "DE", label: "Germany" }, { code: "FR" }, { code: "IT" }], pins: [{ name: "Paris", lat: 48.86, lon: 2.35 }], routes: [] })], 60, undefined, 3);
add("map_globe_hold", [timed({ id: "m", type: "map", box: FULL, region: "asia", projection: "orthographic", countries: [{ code: "IN" }, { code: "CN" }], pins: [], routes: [{ from: { lat: 28.61, lon: 77.21 }, to: { lat: 39.9, lon: 116.4 } }] })], 60, undefined, 3);

three("lower_third", { id: "l", type: "lowerThird", box: { x: 0.08, y: 0.62, w: 0.62, h: 0.26 }, title: "Dr. Amina Khan", subtitle: "Climate scientist", icon: { set: "lucide", name: "users" } });
three("quote_card", { id: "q", type: "quoteCard", box: { x: 0.1, y: 0.12, w: 0.8, h: 0.76 }, quote: "The best way to predict the future is to create it.", author: "Peter Drucker" });
three("list_bullets", { id: "l", type: "list", box: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, style: "bullets", items: [{ text: "Faster rendering" }, { text: "Smarter captions" }, { text: "One-click export" }] });
add("list_numbered_hold", [timed({ id: "l", type: "list", box: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, style: "numbered", items: [{ text: "Record the voice" }, { text: "Add the pictures" }, { text: "Render the video" }, { text: "Upload" }] })], 60, undefined, 3);
add("list_checks_icons_hold", [timed({ id: "l", type: "list", box: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, style: "checks", items: [{ text: "Done" }, { text: "Trending", icon: { set: "lucide", name: "trending-up" } }, { text: "Hot", icon: { set: "tabler", name: "flame" } }] })], 60, undefined, 3);
three("progress_bar", { id: "p", type: "progressBar", box: { x: 0.1, y: 0.35, w: 0.8, h: 0.3 }, from: 0.2, to: 0.72, label: "Upload progress" });

for (const kind of ["confetti", "sparks", "dust", "snow", "bubbles"]) {
  if (kind === "confetti") three("particles_confetti", { id: "pa", type: "particles", box: { x: 0, y: 0, w: 1, h: 1 }, kind, count: 70 });
  else add(`particles_${kind}_hold`, [timed({ id: "pa", type: "particles", box: { x: 0, y: 0, w: 1, h: 1 }, kind, count: 70 })], 60, undefined, 3);
}
three("kinetic_pop", { id: "k", type: "kineticText", box: { x: 0.08, y: 0.2, w: 0.84, h: 0.6 }, words: ["Fast", "Smart", "and", "Simple"], style: "pop", size: 0.16 });
add("kinetic_slide_hold", [timed({ id: "k", type: "kineticText", box: { x: 0.08, y: 0.2, w: 0.84, h: 0.6 }, words: ["Fast", "Smart", "and", "Simple"], style: "slide", size: 0.16 })], 60, undefined, 3);
add("kinetic_highlight_enter", [timed({ id: "k", type: "kineticText", box: { x: 0.08, y: 0.2, w: 0.84, h: 0.6 }, words: ["Fast", "Smart", "and", "Simple"], style: "highlight", size: 0.16 })], 22, undefined, 3);
three("flag_rect", { id: "f", type: "flag", box: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, country: "PK", label: "Pakistan" });
add("flag_circle_hold", [timed({ id: "f", type: "flag", box: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 }, country: "JP", shape: "circle", label: "Japan" })], 60, undefined, 3);

// Writing systems inside the new layers (right-to-left layouts mirror).
add("labels_korean_chart_hold", [timed({ id: "c", type: "chart", box: FULL, kind: "bar", title: "연간 사용자", rows: [{ label: "서울", value: 90 }, { label: "부산", value: 60 }, { label: "대구", value: 35 }] })], 60, undefined, 3);
add("labels_urdu_list_hold", [timed({ id: "l", type: "list", box: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, style: "checks", items: [{ text: "تیز رفتار" }, { text: "آسان استعمال" }, { text: "مفت" }] })], 60, undefined, 3);
add("labels_urdu_lower_third_hold", [timed({ id: "l", type: "lowerThird", box: { x: 0.2, y: 0.62, w: 0.72, h: 0.26 }, title: "ڈاکٹر امینہ خان", subtitle: "ماہر ماحولیات", icon: { set: "lucide", name: "users" } })], 60, undefined, 3);
add("labels_japanese_quote_hold", [timed({ id: "q", type: "quoteCard", box: { x: 0.1, y: 0.12, w: 0.8, h: 0.76 }, quote: "千里の道も一歩から始まる。", author: "老子" })], 60, undefined, 3);
add("labels_devanagari_counter_hold", [timed({ id: "c", type: "counter", box: { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }, from: 0, to: 25000, size: 0.22, label: "कुल दर्शक" })], 60, undefined, 3);

// Maps and flags are drawn by helpers (their layers come in phase 5); the spec is a placeholder.
for (const item of GEO_CASES) cases.push({ name: item.name, spec: make(item.name, [text("map")]), frame: 0, custom: item.draw });

// Brand kits: the same four sample graphics (lower third, counter, list, map) in each kit. They have no entrance of their own, so the
// kit's default entrance runs; frame 60 (2 s) is fully in.
const SAMPLER = [
  { id: "lt", type: "lowerThird", box: { x: 0.04, y: 0.52, w: 0.46, h: 0.2 }, title: "Dr. Amina Khan", subtitle: "Climate scientist", icon: { set: "lucide", name: "users" } },
  { id: "co", type: "counter", box: { x: 0.52, y: 0.06, w: 0.44, h: 0.4 }, from: 0, to: 1200000, format: "grouped", size: 0.2, label: "Total views" },
  { id: "li", type: "list", box: { x: 0.04, y: 0.76, w: 0.5, h: 0.22 }, style: "checks", items: [{ text: "Fast" }, { text: "Clear" }] },
  { id: "ma", type: "map", box: { x: 0.04, y: 0.04, w: 0.46, h: 0.44 }, region: "world", projection: "naturalEarth", countries: [{ code: "PK", label: "Pakistan" }], pins: [], routes: [], camera: [] },
  { id: "ch", type: "chart", box: { x: 0.56, y: 0.5, w: 0.4, h: 0.46 }, kind: "bar", rows: [{ label: "A", value: 3 }, { label: "B", value: 5 }, { label: "C", value: 4 }] },
];
const kitCase = (kit: BrandKit): void => {
  cases.push({ name: `brand_${kit.id}_sampler`, spec: make(`brand_${kit.id}`, SAMPLER, 3), frame: 60, theme: themeOfKit(kit) });
};
for (const kit of [CLEAN_DOCUMENTARY, BOLD_NEWS, SOFT_STORY, suggestKit("noir").kit, suggestKit("anime").kit, suggestKit("cyberpunk").kit]) kitCase(kit);

export const GOLDEN_CASES: readonly GoldenCase[] = cases;
