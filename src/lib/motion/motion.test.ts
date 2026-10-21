import assert from "node:assert/strict";
import test from "node:test";

import type { MotionGraphic } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";
import { buildOverlays } from "../render/request.ts";
import { buildMotionRequest, frameAt, motionSeconds, newMotionId, toGraphic, withGraphic } from "./request.ts";

const scene = { id: "S02", index: 2, start: 5, end: 9.4, duration: 4.4, text: "Inflation hit 9 percent." } as unknown as Scene;

const graphic = (patch: Partial<MotionGraphic> = {}): MotionGraphic => ({ id: "m1", sceneId: "S02", start: 5, duration: 4.4, idea: "", framesDir: "motion/m1/frames", htmlPath: "motion/m1/motion.html", fps: 30, frames: 132, width: 1920, height: 1080, enabled: true, ...patch });

test("ids are folder-safe and requests carry the scene", () => {
  assert.match(newMotionId(1700000000000, 0.5), /^[a-z0-9]+$/);
  const request = buildMotionRequest(scene, "m1", "en", "16:9", "calm blue", "  a rising bar  ");
  assert.deepEqual([request.width, request.height, request.fps, request.seconds, request.idea, request.narration], [1920, 1080, 30, 4.4, "a rising bar", "Inflation hit 9 percent."]);
  assert.equal(buildMotionRequest(scene, "m1", "en", "9:16", "", "").width, 1080);
  assert.equal(motionSeconds({ start: 0, end: 60 }), 12);
  assert.equal(motionSeconds({ start: 0, end: 0.1 }), 0.8);
});

test("a result becomes a graphic that starts with its scene; regenerating replaces the old one", () => {
  const made = toGraphic({ id: "m2", framesDir: "motion/m2/frames", htmlPath: "motion/m2/motion.html", frames: 132, fps: 30, seconds: 4.4, width: 1920, height: 1080, tries: 1 }, scene, " idea ");
  assert.deepEqual([made.sceneId, made.start, made.idea, made.enabled], ["S02", 5, "idea", true]);
  const list = withGraphic([graphic(), graphic({ id: "m0", start: 1 })], made, "m1");
  assert.deepEqual(list.map((g) => g.id), ["m0", "m2"]);
});

test("the preview picks frames in range", () => {
  assert.equal(frameAt({ frames: 132 }, 0), "00000.png");
  assert.equal(frameAt({ frames: 132 }, 1), "00131.png");
  assert.equal(frameAt({ frames: 0 }, 0.5), "00000.png");
});

test("only graphics that are on and have the video's shape are rendered", () => {
  const list = [graphic(), graphic({ id: "off", enabled: false }), graphic({ id: "tall", width: 1080, height: 1920 }), graphic({ id: "late", start: 100 }), graphic({ id: "empty", frames: 0 })];
  assert.deepEqual(buildOverlays(list, 1920, 1080, 60).map((o) => o.framesDir), ["motion/m1/frames"]);
  assert.deepEqual(buildOverlays(list, 1080, 1920, 60).length, 1);
});

test("damaged saved graphics are dropped and unsafe folders refused", () => {
  const editor = readEditor({ editor: { motion: [graphic(), { id: "x" }, graphic({ id: "up", framesDir: "../etc" }), graphic({ id: "abs", framesDir: "/etc" }), 5, graphic({ id: "n", fps: 500, start: -3 })] } as never });
  assert.deepEqual(editor.motion.map((g) => g.id), ["m1", "n"]);
  assert.deepEqual([editor.motion[1]?.fps, editor.motion[1]?.start], [60, 0]);
  assert.deepEqual(readEditor({ editor: {} as never }).motion, []);
});
