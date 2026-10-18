import { sceneStatus } from "./status.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { splitSentences } from "../sentences.ts";
import { followFileTime, moveBoundary, moveBoundaryToTime, nearestWord } from "./boundaries.ts";
import { coverSource, containTarget, kenBurnsAt, resolveMotion, ZOOM_AMOUNT } from "./motion.ts";
import { rulerStep, sceneIndexAt, swapMedia } from "./timeline.ts";
import { effectiveTransition, isMoving, resolveTransition, transitionFrame, transitionLength } from "./transitions.ts";

const words = "One two three. Four five six. Seven eight nine ten.".split(" ").map((text, i) => ({ text, start: i * 1, end: i * 1 + 0.8 }));
// 10 words, 1 s apart: "One two three." (0-2.8), "Four five six." (3-5.8), "Seven eight nine ten." (6-9.8)

function threeScenes(): Scene[] {
  const bounds: [number, number][] = [[0, 2], [3, 5], [6, 9]];
  return bounds.map(([firstWord, lastWord], i) => ({
    ...emptyScene(),
    id: `S0${i + 1}`,
    index: i + 1,
    firstWord,
    lastWord,
    start: words[firstWord]?.start ?? 0,
    end: i < 2 ? (words[(bounds[i + 1] ?? [0, 0])[0]]?.start ?? 0) : 10,
    duration: 0,
    text: "x",
  }));
}

const context = { words, sentences: splitSentences(words), voiceDuration: 10, maxVideoSeconds: 8 };

test("moving a boundary updates both neighbours and keeps zero gaps", () => {
  const scenes = threeScenes();
  assert.equal(scenes[0]?.end, 3);
  const moved = moveBoundary(scenes, 0, 2, context); // right scene now starts at word 2 ("three.", 2 s)
  assert.equal(moved[0]?.lastWord, 1);
  assert.equal(moved[1]?.firstWord, 2);
  assert.equal(moved[0]?.end, 2);
  assert.equal(moved[1]?.start, 2);
  assert.equal(moved[0]?.text, "One two");
  assert.equal(moved[1]?.text, "three. Four five six.");
  assert.equal(moved[2]?.start, 6, "the other scenes do not move");
  for (let i = 1; i < moved.length; i += 1) assert.equal(moved[i]?.start, moved[i - 1]?.end, "no gap");
  assert.ok(moved.every((s) => Math.abs(s.duration - (s.end - s.start)) < 1e-9));
});

test("a boundary snaps to word starts and each scene keeps a word", () => {
  const scenes = threeScenes();
  assert.equal(nearestWord(scenes, 0, 1.4, context), 1);
  assert.equal(nearestWord(scenes, 0, 1.6, context), 2);
  assert.equal(nearestWord(scenes, 0, -5, context), 1, "cannot go before the 2nd word of the left scene");
  assert.equal(nearestWord(scenes, 0, 99, context), 5, "cannot take the last word of the right scene away");
  assert.equal(nearestWord(scenes, 2, 5, context), null, "the last scene has no right neighbour");
  const same = moveBoundary(scenes, 0, 3, context);
  assert.deepEqual(same, scenes, "moving to where it already is changes nothing");
  assert.equal(moveBoundaryToTime(scenes, 1, 8.4, context)[2]?.firstWord, 8);
});

test("following a file's time moves both of its boundaries", () => {
  const scenes = threeScenes();
  const next = followFileTime(scenes, 1, 4.1, 7.2, context);
  assert.equal(next[1]?.start, 4);
  assert.equal(next[1]?.end, 7);
  assert.equal(next[0]?.end, 4);
  assert.equal(next[2]?.start, 7);
});

test("Ken Burns stays inside the picture and automatic motions alternate", () => {
  assert.deepEqual(kenBurnsAt("zoom_in", 0), { scale: 1, x: 0, y: 0 });
  assert.ok(Math.abs(kenBurnsAt("zoom_in", 1).scale - (1 + ZOOM_AMOUNT)) < 1e-9);
  assert.ok(Math.abs(kenBurnsAt("zoom_out", 0).scale - (1 + ZOOM_AMOUNT)) < 1e-9);
  for (const motion of ["pan_left", "pan_right", "pan_up"] as const) {
    for (let p = 0; p <= 1; p += 0.1) {
      const t = kenBurnsAt(motion, p);
      assert.ok(Math.abs(t.x) <= (t.scale - 1) / 2 + 1e-9 && Math.abs(t.y) <= (t.scale - 1) / 2 + 1e-9, `${motion} ${p}`);
    }
  }
  assert.ok(kenBurnsAt("pan_left", 0).x > 0 && kenBurnsAt("pan_left", 1).x < 0, "pan left moves the picture to the left");
  assert.deepEqual(kenBurnsAt("none", 0.5), { scale: 1, x: 0, y: 0 });
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => resolveMotion("auto", n)), ["zoom_in", "pan_left", "zoom_out", "pan_right", "zoom_in"]);
  assert.equal(resolveMotion("pan_up", 1), "pan_up");
});

test("crop to fill and fit whole", () => {
  assert.deepEqual(coverSource(1000, 1000, 160, 90), { x: 0, y: 218.75, width: 1000, height: 562.5 });
  assert.deepEqual(coverSource(2000, 500, 100, 100), { x: 750, y: 0, width: 500, height: 500 });
  assert.deepEqual(containTarget(500, 1000, 160, 90), { x: 57.5, y: 0, width: 45, height: 90 });
});

test("transitions: automatic mix, lengths and frames", () => {
  assert.equal(resolveTransition("auto", 1), "cut");
  assert.deepEqual([2, 3, 4, 5].map((n) => resolveTransition("auto", n)), ["slide", "dissolve", "zoom", "dissolve"]);
  assert.equal(resolveTransition("fade", 9), "fade");
  assert.ok(isMoving("slide") && isMoving("zoom") && isMoving("whip") && !isMoving("dissolve") && !isMoving("cut"));
  assert.equal(transitionLength("cut", 5, 5), 0);
  assert.equal(transitionLength("dissolve", 5, 5), 0.5);
  assert.ok(Math.abs(transitionLength("dissolve", 0.9, 5) - 0.3) < 1e-9, "a short scene shortens the transition");
  assert.equal(transitionFrame("dissolve", 0.25).incoming.alpha, 0.25);
  assert.equal(transitionFrame("slide", 0).incoming.x, 1);
  assert.equal(transitionFrame("slide", 1).incoming.x, 0);
  assert.equal(transitionFrame("fade", 0.5).black, 1);
});

test("finding the scene at a time, and ruler spacing", () => {
  const scenes = threeScenes();
  assert.equal(sceneIndexAt(scenes, 0), 0);
  assert.equal(sceneIndexAt(scenes, 2.99), 0);
  assert.equal(sceneIndexAt(scenes, 3), 1);
  assert.equal(sceneIndexAt(scenes, 500), 2);
  assert.equal(sceneIndexAt([], 1), -1);
  assert.equal(rulerStep(100), 1);
  assert.equal(rulerStep(10), 10);
  assert.equal(rulerStep(1000), 0.5);
});

test("swapping media between two scenes, and moving to an empty scene", () => {
  const file = (path: string, sceneId: string | null): MediaFile => ({ path, name: path, kind: "image", width: 1, height: 1, duration: 0, modified: 0, sceneId, start: null, end: null, how: "name", confidence: null });
  const media = [file("a", "S01"), file("b", "S02")];
  const swapped = swapMedia(media, { S01: "a", S02: "b" }, "S01", "S02");
  assert.deepEqual(swapped.mediaMap, { S01: "b", S02: "a" });
  assert.deepEqual(swapped.media.map((m) => [m.path, m.sceneId]), [["a", "S02"], ["b", "S01"]]);
  const moved = swapMedia(media, { S01: "a", S02: "b" }, "S01", "S03");
  assert.deepEqual(moved.mediaMap, { S02: "b", S03: "a" });
  assert.equal(moved.media[0]?.sceneId, "S03");
  assert.deepEqual(swapMedia(media, { S01: "a" }, "S01", "S01").mediaMap, { S01: "a" });
});

test("sceneStatus tells missing, deleted and short media apart", () => {
  const file = (kind: "image" | "video", duration: number) => ({ path: "media/a.mp4", name: "a.mp4", kind, width: 1, height: 1, duration, modified: 0, sceneId: "S01", start: null, end: null, how: null, confidence: null });
  const scene = { id: "S01", duration: 5 };
  assert.equal(sceneStatus(scene, undefined, {}), "no_media");
  assert.equal(sceneStatus(scene, file("image", 0), { "media/a.mp4": false }), "file_missing");
  assert.equal(sceneStatus(scene, file("video", 3), {}), "short");
  assert.equal(sceneStatus(scene, file("video", 3), {}, 0.5), "ready");
  assert.equal(sceneStatus(scene, file("image", 0), {}), "ready");
});

test("effectiveTransition: the scene's own choice wins, otherwise the render mode decides", () => {
  assert.equal(effectiveTransition("whip", 3, "cut"), "whip");
  assert.equal(effectiveTransition("auto", 1, "fade"), "cut", "the first scene has nothing before it");
  assert.deepEqual([2, 3, 4, 5].map((n) => effectiveTransition("auto", n, "cut")), ["cut", "cut", "cut", "cut"]);
  assert.deepEqual([2, 3, 4, 5].map((n) => effectiveTransition("auto", n, "fade")), ["dissolve", "dissolve", "dissolve", "dissolve"]);
  const mixed = Array.from({ length: 20 }, (_, i) => effectiveTransition("auto", i + 1, "mixed"));
  assert.ok(mixed.filter((k) => k === "cut").length >= 12, "mostly cuts");
  assert.ok(mixed.includes("dissolve") && mixed.includes("slide"));
});
