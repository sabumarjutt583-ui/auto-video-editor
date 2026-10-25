import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { readRender } from "./read.ts";
import { aspectLabel, buildRenderScenes, formatSize, renderProblems, timeLeft, todayStamp } from "./request.ts";

function scene(index: number, start: number, end: number): Scene {
  return { ...emptyScene(), id: `S${String(index).padStart(2, "0")}`, index, start, end, duration: end - start };
}
function file(path: string, kind: "image" | "video", duration = 0): MediaFile {
  return { path, name: path, kind, width: 1920, height: 1080, duration, modified: 0, sceneId: null, start: null, end: null, how: null, confidence: null };
}
function editorWith(patch: Record<string, unknown>) {
  return readEditor({ editor: patch } as never);
}

const SCENES = [scene(1, 0, 5), scene(2, 5, 10), scene(3, 10, 15), scene(4, 15, 20)];

test("readRender repairs damaged data", () => {
  assert.deepEqual(readRender(null), { fps: 30, transitions: "mixed", kenBurns: true, shortClip: "smart" });
  assert.deepEqual(readRender({ fps: 25, transitions: "wild", kenBurns: false }), { fps: 30, transitions: "mixed", kenBurns: false, shortClip: "smart" });
  assert.equal(readRender({ fps: 60 }).fps, 60);
  assert.equal(readRender({ shortClip: "loop" }).shortClip, "loop");
  assert.equal(readRender({ shortClip: "nope" }).shortClip, "smart");
});

test("scenes get their media, motion and a transition that never starts the video", () => {
  const editor = editorWith({ media: [file("media/a.png", "image"), file("media/b.mp4", "video", 6)] });
  const map = { S01: "media/a.png", S02: "media/b.mp4" };
  const scenes = buildRenderScenes(SCENES, editor, { mediaMap: map }, {});
  assert.deepEqual(scenes[0]?.source, { kind: "image", path: "media/a.png", duration: 0, lastFrame: false, blurAll: false });
  assert.equal(scenes[1]?.source.kind, "video");
  assert.equal(scenes[1]?.source.duration, 6);
  assert.equal(scenes[0]?.transition.kind, "cut");
  assert.equal(scenes[0]?.transition.seconds, 0);
  assert.equal(scenes[0]?.motion, "zoom_in");
});

test("Ken Burns off means no motion, and render mode cut means no transitions", () => {
  const editor = editorWith({ media: [file("media/a.png", "image")], render: { kenBurns: false, transitions: "cut" } });
  const scenes = buildRenderScenes(SCENES, editor, { mediaMap: { S01: "media/a.png", S02: "media/a.png" } }, {});
  assert.ok(scenes.every((s) => s.motion === "none"));
  assert.ok(scenes.every((s) => s.transition.kind === "cut"));
});

test("a scene's own transition choice wins over the render mode", () => {
  const editor = editorWith({ render: { transitions: "cut" }, overrides: { S03: { transition: "slide" } } });
  const scenes = buildRenderScenes(SCENES, editor, { mediaMap: {} }, {});
  assert.equal(scenes[2]?.transition.kind, "slide");
  assert.equal(scenes[2]?.transition.seconds, 0.5);
});

test("a scene without media, or with a deleted file, uses the placeholder", () => {
  const media = [file("media/a.png", "image"), file("media/b.mp4", "video", 6)];
  const map = { S01: "media/a.png", S02: "media/b.mp4", S03: "media/gone.png" };
  const hold = buildRenderScenes(SCENES, editorWith({ media: [...media, file("media/gone.png", "image")], placeholder: "hold" }), { mediaMap: map }, { "media/gone.png": false });
  assert.equal(hold[2]?.source.path, "media/b.mp4", "holds the last real scene");
  assert.equal(hold[2]?.source.lastFrame, true);
  assert.equal(hold[2]?.motion, "none");
  assert.equal(hold[3]?.source.path, "media/b.mp4");

  const blur = buildRenderScenes(SCENES, editorWith({ media, placeholder: "blur" }), { mediaMap: map }, {});
  assert.equal(blur[2]?.source.blurAll, true);

  const black = buildRenderScenes(SCENES, editorWith({ media, placeholder: "black" }), { mediaMap: map }, {});
  assert.equal(black[2]?.source.kind, "black");

  const first = buildRenderScenes(SCENES, editorWith({ placeholder: "hold" }), { mediaMap: {} }, {});
  assert.equal(first[0]?.source.kind, "black", "nothing to hold at the start");
});

test("problems that stop a render", () => {
  assert.deepEqual(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 10, scenes: SCENES }), []);
  assert.equal(renderProblems({ voicePath: null, voiceDuration: 0, scenes: [] }).length, 2);
});

test("labels, dates, sizes and time left", () => {
  assert.equal(aspectLabel("16:9"), "16x9");
  assert.equal(todayStamp(new Date(2026, 9, 8)), "2026-10-08");
  assert.equal(formatSize(500 * 1024), "500 KB");
  assert.equal(formatSize(12.34 * 1024 * 1024), "12.3 MB");
  assert.equal(timeLeft(1, 100), "", "too early to guess");
  assert.equal(timeLeft(50, 60), "about 60 seconds left");
  assert.equal(timeLeft(25, 120), "about 6 min left");
  assert.equal(timeLeft(95, 100), "a few seconds left");
});

test("buildOverlays sends a clip for app-drawn graphics and a frames folder for AI graphics", async () => {
  const { buildOverlays } = await import("./request.ts");
  const base = { id: "a", sceneId: "S01", start: 2, duration: 3, idea: "", htmlPath: "", fps: 30, frames: 90, width: 1920, height: 1080, enabled: true };
  const spec = { schemaVersion: 1, id: "a", duration: 3, seed: 1, brand: "default", layers: [] };
  const overlays = buildOverlays(
    [
      { ...base, framesDir: "", kind: "spec", clipPath: "graphics/a/clip.mov", spec: spec as never },
      { ...base, id: "b", framesDir: "motion/b/frames" },
      { ...base, id: "c", framesDir: "", kind: "spec", clipPath: "graphics/c/clip.mov", enabled: false, spec: spec as never },
      { ...base, id: "d", framesDir: "", kind: "spec", clipPath: "graphics/d/clip.mov", width: 1080, height: 1920, spec: spec as never },
    ],
    1920, 1080, 60,
  );
  assert.deepEqual(overlays, [{ clip: "graphics/a/clip.mov", start: 2, fps: 30 }, { framesDir: "motion/b/frames", start: 2, fps: 30 }]);
});
