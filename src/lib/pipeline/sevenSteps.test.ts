import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSummary } from "../../types/project.ts";
import { NO_PAUSES, type Pauses } from "./stages.ts";
import {
  REVIEW_TOGGLES,
  reviewToggleChecked,
  setReviewToggle,
  sevenStepCurrent,
  sevenStepLabel,
  sevenStepPercent,
  sevenStepsFromSummary,
  sevenStepsFromView,
} from "./sevenSteps.ts";
import { initialView, reduceView, type RunView } from "./view.ts";

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

function byId(rows: ReturnType<typeof sevenStepsFromSummary>) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test("the display steps are the brother tool's seven, in order", () => {
  assert.deepEqual(
    sevenStepsFromSummary(video("n")).map((row) => row.label),
    ["Script Writing", "Voice Generation", "SRT Generation", "Image Prompts", "Image Generation", "Video Editing", "Export & Verify"],
  );
  assert.equal(sevenStepLabel("exportVerify"), "Export & Verify");
});

test("a new video is 0% and a finished one is 100%", () => {
  const fresh = sevenStepsFromSummary(video("n"));
  assert.equal(sevenStepPercent(fresh), 0);
  assert.equal(sevenStepCurrent(fresh), "script");
  const done = video("f", { voiceLocked: true, hasWords: true, sceneCount: 4, bibleLocked: true, promptsWritten: 4, pictureScenes: 4, pictures: 4, audioMixed: true, rendered: true });
  assert.equal(sevenStepPercent(sevenStepsFromSummary(done)), 100);
  assert.equal(sevenStepCurrent(sevenStepsFromSummary(done)), null);
});

test("the bible is folded into Image Prompts and audio into Video Editing", () => {
  const rows = byId(sevenStepsFromSummary(video("p", { sceneCount: 10, promptsWritten: 10, bibleLocked: false })));
  assert.equal(rows.imagePrompts?.done, false, "prompts alone do not finish Image Prompts without the bible");
  const withBible = byId(sevenStepsFromSummary(video("p", { sceneCount: 10, promptsWritten: 10, bibleLocked: true, audioMixed: true })));
  assert.equal(withBible.imagePrompts?.done, true);
  assert.equal(withBible.videoEditing?.done, true);
  assert.equal(withBible.exportVerify?.done, false, "render, not audio, finishes Export & Verify");
  assert.equal(withBible.imagePrompts?.detail, "10 of 10");
});

test("a live run folds cast and prompts, and an error beats the other states", () => {
  let view: RunView = initialView();
  view = reduceView(view, { type: "done", stage: "cast" });
  view = reduceView(view, { type: "error", stage: "prompts", error: new Error("no") });
  const rows = byId(sevenStepsFromView(view));
  assert.equal(rows.imagePrompts?.state, "error");
  assert.equal(rows.imagePrompts?.done, false);
  const ok: RunView = reduceView(reduceView(initialView(), { type: "done", stage: "cast" }), { type: "done", stage: "prompts" });
  assert.equal(byId(sevenStepsFromView(ok)).imagePrompts?.state, "done");
});

test("a pause toggle covers every step it names, and nothing else", () => {
  const toggle = REVIEW_TOGGLES.find((item) => item.id === "imagePrompts")!;
  assert.deepEqual(toggle.stages, ["cast", "prompts"]);
  const half: Pauses = { ...NO_PAUSES, cast: true };
  assert.equal(reviewToggleChecked(half, toggle), false, "on only when both steps are paused");
  const on = setReviewToggle(NO_PAUSES, toggle, true);
  assert.equal(on.cast, true);
  assert.equal(on.prompts, true);
  assert.equal(on.voice, false);
  assert.equal(reviewToggleChecked(on, toggle), true);
  const off = setReviewToggle(on, toggle, false);
  assert.equal(off.cast, false);
  assert.equal(off.prompts, false);
});
