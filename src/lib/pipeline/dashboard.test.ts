import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSummary } from "../../types/project.ts";
import { countVideos, currentStage, needAttention, percentOf, recentlyFinished, stageProgress, videoState, videosOf, type ActiveRun } from "./dashboard.ts";

function video(id: string, patch: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    name: id,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    voiceDuration: 0,
    sceneCount: 0,
    status: null,
    channelId: "a",
    voiceLocked: false,
    hasWords: false,
    bibleLocked: false,
    promptsWritten: 0,
    pictureScenes: 0,
    pictures: 0,
    audioMixed: false,
    rendered: false,
    ...patch,
  };
}
const idle: ActiveRun = { projectId: null, running: false, waiting: null, failed: false };

test("a new video has no finished step and a finished one has all", () => {
  assert.equal(percentOf(video("n")), 0);
  assert.equal(currentStage(video("n")), "voice");
  const all = video("f", { voiceLocked: true, hasWords: true, sceneCount: 4, bibleLocked: true, promptsWritten: 4, pictureScenes: 4, pictures: 4, audioMixed: true, rendered: true });
  assert.equal(percentOf(all), 100);
  assert.equal(currentStage(all), null);
});

test("steps with a count show how far they are", () => {
  const rows = stageProgress(video("p", { voiceLocked: true, hasWords: true, sceneCount: 40, bibleLocked: true, promptsWritten: 40, pictureScenes: 40, pictures: 12 }));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.scenes?.detail, "40 scenes");
  assert.equal(by.prompts?.done, true);
  assert.equal(by.images?.done, false);
  assert.equal(by.images?.detail, "12 of 40");
  assert.equal(currentStage(video("p", { voiceLocked: true, hasWords: true, sceneCount: 40, bibleLocked: true, promptsWritten: 40, pictureScenes: 40, pictures: 12 })), "images");
});

test("half-written prompts are not a finished step", () => {
  const rows = stageProgress(video("p", { sceneCount: 10, promptsWritten: 9 }));
  assert.equal(rows.find((r) => r.id === "prompts")?.done, false);
});

test("the state of a video comes from the run that is going on, else from its progress", () => {
  const v = video("a", { voiceLocked: true });
  assert.equal(videoState(v, idle), "stopped");
  assert.equal(videoState(v, { projectId: "a", running: true, waiting: null, failed: false }), "running");
  assert.equal(videoState(v, { projectId: "a", running: true, waiting: "images", failed: false }), "waiting");
  assert.equal(videoState(v, { projectId: "a", running: false, waiting: null, failed: true }), "failed");
  assert.equal(videoState(v, { projectId: "other", running: true, waiting: null, failed: false }), "stopped");
  assert.equal(videoState(video("e"), idle), "empty");
  assert.equal(videoState(video("r", { rendered: true }), idle), "finished");
});

test("counts do not include empty projects", () => {
  const list = [video("a", { voiceLocked: true }), video("b", { rendered: true }), video("c"), video("d", { voiceLocked: true })];
  const counts = countVideos(list, { projectId: "d", running: true, waiting: "prompts", failed: false });
  assert.deepEqual(counts, { total: 3, running: 0, waiting: 1, failed: 0, stopped: 1, finished: 1 });
});

test("videos of a channel are newest first and videos of others are left out", () => {
  const list = [video("a", { updatedAt: "2026-10-02T00:00:00Z" }), video("b", { updatedAt: "2026-10-05T00:00:00Z" }), video("c", { channelId: "z" }), video("d", { channelId: "" })];
  assert.deepEqual(videosOf(list, "a").map((v) => v.id), ["b", "a"]);
  assert.deepEqual(videosOf(list, "").map((v) => v.id), ["d"]);
});

test("attention list and recent list", () => {
  const list = [
    video("run", { voiceLocked: true, updatedAt: "2026-10-03T00:00:00Z" }),
    video("old", { rendered: true, updatedAt: "2026-10-01T00:00:00Z" }),
    video("new", { rendered: true, updatedAt: "2026-10-04T00:00:00Z" }),
    video("idle", { voiceLocked: true }),
  ];
  const active: ActiveRun = { projectId: "run", running: true, waiting: null, failed: false };
  assert.deepEqual(needAttention(list, active).map((v) => v.id), ["run"]);
  assert.deepEqual(recentlyFinished(list).map((v) => v.id), ["new", "old"]);
  assert.equal(recentlyFinished(list, 1).length, 1);
});
