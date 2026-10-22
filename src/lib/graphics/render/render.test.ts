import assert from "node:assert/strict";
import { test } from "node:test";

import { poseOf } from "./anim.ts";
import { ease } from "./easing.ts";
import { DEFAULT_THEME } from "./theme.ts";
import { ellipsize, fitText } from "./fit.ts";
import { detectScript, isRtl } from "./script.ts";
import { FPS, frameCount, layerTiming, visibleLayers } from "./timing.ts";
import { breakLines, lineText, toPieces, type Piece } from "./wrap.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec, Layer } from "../spec/schema.ts";

function spec(layers: Record<string, unknown>[], duration = 4): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "t", duration, layers });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.issues));
  return r.spec;
}
const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.2 };
const layerOf = (extra: Record<string, unknown>): Layer => {
  const l = spec([{ id: "a", type: "shape", box, ...extra }]).layers[0];
  assert.ok(l);
  return l;
};

// A fake font: Latin 10 px per character at size 20 (0.5 em), CJK full width, space 0.25 em.
const fake = (text: string, _m: undefined, size = 20): number => {
  let w = 0;
  for (const ch of text) w += ch === " " ? size * 0.25 : (ch.codePointAt(0) ?? 0) > 0x2e80 ? size : size * 0.5;
  return w;
};

test("easing: ends are exact and spring/back overshoot", () => {
  for (const name of ["linear", "easeOut", "easeInOut", "easeOutBack", "easeOutExpo", "spring"] as const) {
    assert.ok(Math.abs(ease(name, 0)) < 0.01, name);
    assert.equal(ease(name, 1), 1, name);
    assert.equal(ease(name, 5), 1);
    assert.ok(Math.abs(ease(name, -3)) < 0.01);
  }
  assert.ok(ease("easeOutBack", 0.6) > 1);
  assert.ok(ease("easeOut", 0.5) > 0.5);
  assert.equal(ease("easeOut", 0.5), ease("easeOut", 0.5));
});

test("timing: frame count, visibility window, exact frame edges", () => {
  assert.equal(frameCount(3), 90);
  assert.equal(frameCount(0.34), 10);
  const s = spec([{ id: "a", type: "shape", box, start: 0.3, duration: 1 }]);
  const l = s.layers[0] as Layer;
  assert.equal(layerTiming(l, 4, 8 / FPS).visible, false);
  assert.equal(layerTiming(l, 4, 9 / FPS).visible, true); // 0.3 s
  assert.equal(layerTiming(l, 4, 38 / FPS).visible, true);
  assert.equal(layerTiming(l, 4, 39 / FPS).visible, false); // 1.3 s is the end
  assert.deepEqual(visibleLayers(s, 20).map((x) => x.id), ["a"]);
  assert.deepEqual(visibleLayers(s, 0), []);
});

test("timing: entrance and exit progress", () => {
  const l = layerOf({ start: 1, duration: 2, enter: { preset: "fade", duration: 0.5, delay: 0.2, easing: "linear" }, exit: { preset: "fade", duration: 1, easing: "linear" } });
  assert.equal(layerTiming(l, 4, 1).enter, 0);
  assert.ok(Math.abs(layerTiming(l, 4, 1.45).enter - 0.5) < 1e-9);
  assert.equal(layerTiming(l, 4, 1.75).enter, 1);
  assert.equal(layerTiming(l, 4, 1.9).exit, 0);
  assert.ok(Math.abs(layerTiming(l, 4, 2.5).exit - 0.5) < 1e-9);
  assert.ok(layerTiming(l, 4, 2.99).exit > 0.98);
  const none = layerOf({ start: 0 });
  assert.equal(layerTiming(none, 4, 0).enter, 1);
});

test("pose: every enter preset starts hidden/moved and ends at rest; every exit preset ends invisible or moved", () => {
  const enters = ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "pop", "wipe", "typewriter"] as const;
  for (const preset of enters) {
    const l = layerOf({ enter: { preset, duration: 0.5, easing: "linear" } });
    const start = poseOf(l, { visible: true, local: 0, enter: 0, exit: 0, length: 4 }, 1920, 1080);
    const end = poseOf(l, { visible: true, local: 1, enter: 1, exit: 0, length: 4 }, 1920, 1080);
    assert.deepEqual([end.alpha, end.dx, end.dy, end.scale, end.clipFrom, end.clipTo, end.reveal], [1, 0, 0, 1, 0, 1, 1], preset);
    const changed = start.alpha < 1 || start.dx !== 0 || start.dy !== 0 || start.scale !== 1 || start.clipTo < 1 || start.reveal < 1;
    assert.ok(changed, `${preset} does something at progress 0`);
  }
  for (const preset of ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "wipe"] as const) {
    const l = layerOf({ exit: { preset, duration: 0.5 } });
    const rest = poseOf(l, { visible: true, local: 1, enter: 1, exit: 0, length: 4 }, 1920, 1080);
    assert.deepEqual([rest.alpha, rest.dx, rest.dy, rest.scale, rest.clipFrom], [1, 0, 0, 1, 0], preset);
    const gone = poseOf(l, { visible: true, local: 4, enter: 1, exit: 1, length: 4 }, 1920, 1080);
    assert.ok(gone.alpha === 0 || gone.clipFrom === 1 || gone.dx !== 0 || gone.dy !== 0 || gone.scale < 1, preset);
  }
});

test("pose: layer opacity is kept", () => {
  const l = layerOf({ opacity: 0.4 });
  assert.equal(poseOf(l, { visible: true, local: 0, enter: 1, exit: 0, length: 4 }, 100, 100).alpha, 0.4);
});

test("script detection: every supported writing system", () => {
  assert.equal(detectScript("Hello world 123"), "latin");
  assert.equal(detectScript("Привет, мир"), "cyrillic");
  assert.equal(detectScript("안녕하세요 세계"), "korean");
  assert.equal(detectScript("こんにちは世界"), "japanese");
  assert.equal(detectScript("漢字だけ日本語です"), "japanese");
  assert.equal(detectScript("你好，世界"), "chinese");
  assert.equal(detectScript("नमस्ते दुनिया"), "devanagari");
  assert.equal(detectScript("یہ اردو ہے"), "arabic");
  assert.equal(detectScript("مرحبا بالعالم"), "arabic");
  assert.equal(detectScript("2024 • 50%"), "latin");
  assert.equal(detectScript("Visit 서울 today"), "latin");
  assert.ok(isRtl("arabic") && !isRtl("latin"));
});

test("wrap: words, long words, spaces", () => {
  const pieces = toPieces("hello big world", undefined, (t) => fake(t, undefined), 1000);
  assert.deepEqual(pieces.map((p) => p.text), ["hello", "big", "world"]);
  const lines = breakLines(pieces, 100, 5);
  assert.deepEqual(lines.map(lineText), ["hello big", "world"]);
  const long = toPieces("abcdefghijklmnopqrstuvwxyz", undefined, (t) => fake(t, undefined), 100);
  assert.ok(long.length > 1 && long.map((p) => p.text).join("") === "abcdefghijklmnopqrstuvwxyz");
  assert.ok(breakLines(long, 100, 5).every((l) => l.reduce((n, p) => n + p.width, 0) <= 100));
  assert.deepEqual(breakLines([], 100, 5), []);
});

test("wrap: CJK breaks anywhere and punctuation never starts a line", () => {
  const text = "今日は天気がとても良いですね。散歩に行きましょう。";
  const pieces = toPieces(text, undefined, (t) => fake(t, undefined), 1000);
  const lines = breakLines(pieces, 100, 5); // 5 characters per line at 20 px
  assert.ok(lines.length >= 4);
  for (const line of lines) assert.ok(!/^[。、]/.test(lineText(line)), lineText(line));
  assert.equal(lines.map(lineText).join(""), text);
  const kor = toPieces("안녕하세요 반갑습니다", undefined, (t) => fake(t, undefined), 1000);
  assert.deepEqual(kor.map((p) => p.text), ["안녕하세요", "반갑습니다"]);
});

test("wrap: Arabic/Urdu text wraps by words in logical order", () => {
  const text = "یہ ایک بہت لمبی اردو جملہ ہے";
  const pieces = toPieces(text, undefined, (t) => fake(t, undefined), 1000);
  assert.equal(pieces.length, 7);
  const lines = breakLines(pieces, 60, 5);
  assert.equal(lines.map(lineText).join(" "), text);
});

const piecesFor = (text: string) => (size: number): Piece<undefined>[] => toPieces(text, undefined, (t) => fake(t, undefined, size), 1e6);

test("fit: fits at full size when it can, shrinks before overflowing, truncates at the minimum", () => {
  const base = { spaceWidth: (s: number) => s * 0.25, minSize: 8, maxLines: 2 };
  const easy = fitText({ ...base, makePieces: piecesFor("short text"), boxW: 400, boxH: 100, size: 20 });
  assert.equal(easy.size, 20);
  assert.ok(!easy.shrunk && !easy.truncated && easy.lines.length === 1);
  const text = "this is a longer headline that needs more room than one line";
  const tight = fitText({ ...base, makePieces: piecesFor(text), boxW: 300, boxH: 60, size: 40 });
  assert.ok(tight.shrunk && tight.size < 40 && tight.size >= 8);
  assert.ok(tight.lines.length <= 2 && !tight.truncated);
  const hopeless = fitText({ ...base, makePieces: piecesFor(text.repeat(5)), boxW: 100, boxH: 30, size: 40 });
  assert.ok(hopeless.truncated && hopeless.lines.length <= 2 && hopeless.size === 8);
  assert.ok(hopeless.lineHeight * hopeless.lines.length <= 30 + 1e-6);
});

test("fit: ellipsis fits the width", () => {
  const pieces = piecesFor("a very long single line of words")(20);
  const cut = ellipsize(pieces, 80, (t) => fake(t, undefined), 5);
  const width = cut.reduce((n, p) => n + p.width, 0) + 5 * (cut.length - 1);
  assert.ok(width <= 80 + 1e-6);
  assert.ok(lineText(cut).endsWith("…"));
});

// A canvas that only records what is called on it: enough to test order, timing and determinism without a browser.
function recorder(): { ctx: import("./context.ts").Canvas2D; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        log.push(`${key}(${args.map((a) => (typeof a === "number" ? Math.round(a * 1000) / 1000 : typeof a === "object" ? "obj" : String(a))).join(",")})`);
        return key === "measureText" ? { width: 10 } : undefined;
      };
    },
    set(target, key: string, value: unknown) {
      log.push(`${key}=${String(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as import("./context.ts").Canvas2D;
  return { ctx, log };
}

const rc = { width: 320, height: 180, theme: DEFAULT_THEME, image: () => undefined, icon: () => undefined };

test("renderFrame: same input gives the same drawing calls; layers outside their time are not drawn", async () => {
  const s = spec([
    { id: "early", type: "shape", box, start: 0, duration: 1 },
    { id: "late", type: "shape", box, start: 2, duration: 1, enter: { preset: "slideUp", duration: 0.5 } },
  ]);
  const { renderFrame } = await import("./renderFrame.ts");
  const a = recorder();
  const b = recorder();
  const ra = renderFrame(s, 10, a.ctx, rc);
  renderFrame(s, 10, b.ctx, rc);
  assert.deepEqual(ra.drawn, ["early"]);
  assert.deepEqual(a.log, b.log);
  assert.ok(a.log[0]?.startsWith("setTransform"));
  assert.ok(a.log.some((l) => l.startsWith("clearRect")));
  assert.deepEqual(renderFrame(s, 65, recorder().ctx, rc).drawn, ["late"]);
  assert.deepEqual(renderFrame(s, 100, recorder().ctx, rc).drawn, []);
});

test("renderFrame: layers are drawn in list order, and unfinished layer types are reported", async () => {
  const s = spec([
    { id: "back", type: "shape", box },
    { id: "num", type: "counter", box, to: 5 },
    { id: "front", type: "shape", box },
  ]);
  const { renderFrame } = await import("./renderFrame.ts");
  const report = renderFrame(s, 0, recorder().ctx, rc);
  assert.deepEqual(report.drawn, ["back", "front"]);
  assert.deepEqual(report.notes.map((n) => `${n.layerId}:${n.kind}`), ["num:not-drawn"]);
});

test("renderFrame: a missing icon or picture is reported, not thrown", async () => {
  const s = spec([
    { id: "i", type: "icon", box, icon: { set: "lucide", name: "check" } },
    { id: "p", type: "image", box, src: "media/none.png" },
  ]);
  const { renderFrame } = await import("./renderFrame.ts");
  const report = renderFrame(s, 0, recorder().ctx, rc);
  assert.deepEqual(report.notes.map((n) => n.kind).sort(), ["missing-icon", "missing-image"]);
});
