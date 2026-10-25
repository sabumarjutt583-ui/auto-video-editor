import assert from "node:assert/strict";
import test from "node:test";

import type { AppError } from "../../types/error.ts";
import type { VideoResult } from "../../types/imagegen.ts";
import type { Scene } from "../../types/project.ts";
import { buildVideoItems, registerVideo, runVideoQueue, waitSignal, WAIT_MARGIN_MS, type QueueDeps, type VideoItem } from "./video.ts";

function scene(index: number, extra: Partial<Scene> = {}): Scene {
  return { id: `S0${index}`, index, start: (index - 1) * 5, end: index * 5, duration: 5, prompt: `prompt ${index}`, motionPrompt: "", matchedFile: null, mediaType: "image", ...extra } as Scene;
}
const video = (name: string): VideoResult => ({ path: `media/${name}`, accountName: "A", width: 1920, height: 1080, duration: 8, modified: 1 });

test("video items: the picture is animated, the others are made from words, finished ones are skipped", () => {
  const scenes = [scene(1, { matchedFile: "media/S01_000.0-005.0.png", motionPrompt: "slow push in" }), scene(2), scene(3, { matchedFile: "media/S03_010.0-015.0.mp4" }), scene(4, { prompt: "  " })];
  const mediaMap = { S01: "media/S01_000.0-005.0.png", S03: "media/S03_010.0-015.0.mp4" };
  const items = buildVideoItems(scenes, mediaMap, { only: null, animatePictures: true, skipDone: true });
  assert.deepEqual(items.map((i) => i.sceneId), ["S01", "S02"]);
  assert.equal(items[0]?.fileName, "S01_000.0-005.0.mp4");
  assert.equal(items[0]?.image, "media/S01_000.0-005.0.png");
  assert.match(items[0]?.prompt ?? "", /Animate this picture.*slow push in/);
  assert.equal(items[1]?.image, null);
  assert.equal(items[1]?.prompt, "prompt 2");
  const words = buildVideoItems(scenes, mediaMap, { only: new Set(["S01", "S03"]), animatePictures: false, skipDone: false });
  assert.deepEqual(words.map((i) => [i.sceneId, i.image]), [["S01", null], ["S03", null]]);
});

test("a made video becomes the scene's file in the timeline", () => {
  const scenes = [scene(1, { matchedFile: "media/S01_000.0-005.0.png" })];
  const patch = registerVideo({ scenes, mediaMap: { S01: "media/S01_000.0-005.0.png" }, editor: null }, "S01", video("S01_000.0-005.0.mp4"));
  assert.ok(patch);
  assert.equal(patch.mediaMap?.["S01"], "media/S01_000.0-005.0.mp4");
  assert.equal(patch.scenes?.[0]?.matchedFile, "media/S01_000.0-005.0.mp4");
  const listed = patch.editor?.media?.find((m) => m.path === "media/S01_000.0-005.0.mp4");
  assert.equal(listed?.kind, "video");
  assert.equal(listed?.sceneId, "S01");
  assert.equal(listed?.duration, 8);
  assert.equal(registerVideo({ scenes, mediaMap: {}, editor: null }, "S99", video("x.mp4")), null);
});

test("the engine's waiting signals are read from the error details", () => {
  assert.deepEqual(waitSignal({ details: "video_wait:1761400000000" }), { kind: "wait", at: 1761400000000 });
  assert.deepEqual(waitSignal({ details: "video_busy" }), { kind: "busy" });
  assert.equal(waitSignal({ details: "something else" }), null);
});

function fake(over: Partial<QueueDeps> & { script: (item: VideoItem, call: number) => Promise<VideoResult> }): { deps: QueueDeps; clock: { t: number }; made: string[]; failed: string[]; waits: (number | null)[] } {
  const clock = { t: 0 };
  const made: string[] = [];
  const failed: string[] = [];
  const waits: (number | null)[] = [];
  let calls = 0;
  const deps: QueueDeps = {
    make: (item) => over.script(item, (calls += 1)),
    onMade: (item) => made.push(item.sceneId),
    onFailed: (item) => failed.push(item.sceneId),
    onWaiting: (at) => waits.push(at),
    concurrency: () => 1,
    isStopped: () => false,
    sleep: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    autoContinue: false,
    ...over,
  };
  return { deps, clock, made, failed, waits };
}
const items = (...ids: string[]): VideoItem[] => ids.map((id) => ({ sceneId: id, fileName: `${id}.mp4`, prompt: "p", image: null }));
const err = (details: string): AppError => ({ message: "m", details });

test("every scene is tried once; a failed scene does not stop the others", async () => {
  const t = fake({ script: async (item) => (item.sceneId === "S02" ? Promise.reject(err("blocked")) : video(`${item.sceneId}.mp4`)) });
  const report = await runVideoQueue(items("S01", "S02", "S03"), t.deps);
  assert.deepEqual(t.made, ["S01", "S03"]);
  assert.deepEqual(t.failed, ["S02"]);
  assert.deepEqual([report.made, report.failed, report.left.length], [2, 1, 0]);
});

test("when every account is out of videos the queue stops and returns the rest", async () => {
  const t = fake({ script: async (item, call) => (call >= 2 ? Promise.reject(err("video_wait:5000")) : video(`${item.sceneId}.mp4`)) });
  const report = await runVideoQueue(items("S01", "S02", "S03"), t.deps);
  assert.deepEqual(t.made, ["S01"]);
  assert.deepEqual(report.left.map((i) => i.sceneId), ["S02", "S03"]);
  assert.equal(t.waits.at(-1), null);
  assert.ok(t.waits.includes(5000));
});

test("with automatic continuing the queue waits for the reset time and then goes on", async () => {
  const t = fake({ autoContinue: true, script: async (item, call) => (call === 1 ? Promise.reject(err("video_wait:3000")) : video(`${item.sceneId}.mp4`)) });
  const report = await runVideoQueue(items("S01", "S02"), t.deps);
  assert.deepEqual(t.made, ["S01", "S02"]);
  assert.equal(report.left.length, 0);
  assert.ok(t.clock.t >= 3000 + WAIT_MARGIN_MS, `waited until ${t.clock.t}`);
});

test("Stop leaves the untried scenes", async () => {
  let stopped = false;
  const t = fake({ isStopped: () => stopped, script: async (item) => { stopped = true; return video(`${item.sceneId}.mp4`); } });
  const report = await runVideoQueue(items("S01", "S02", "S03"), t.deps);
  assert.deepEqual(t.made, ["S01"]);
  assert.equal(report.left.length, 2);
});

test("several accounts make several videos at the same time", async () => {
  let running = 0;
  let peak = 0;
  const t = fake({ concurrency: () => 3, script: async (item) => { running += 1; peak = Math.max(peak, running); await Promise.resolve(); running -= 1; return video(`${item.sceneId}.mp4`); } });
  await runVideoQueue(items("S01", "S02", "S03", "S04"), t.deps);
  assert.equal(peak, 3);
  assert.equal(t.made.length, 4);
});
