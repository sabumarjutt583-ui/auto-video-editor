import assert from "node:assert/strict";
import { test } from "node:test";

import type { MotionGraphic } from "../../types/editor.ts";
import type { Project, Scene } from "../../types/project.ts";
import { approvalFromView, approve, initialApprovals, isApprovedFor, markNeedsAttention, nextWaitingApproval, reject, stagesNeedingAttention } from "./approval.ts";
import { failedSceneIds, failedScenes, failedScenesFromProject, MAX_SCENE_RETRIES, retryableFailedScenes } from "./failedScenes.ts";
import { accountsSummary, allStagesDone, remainingStages, runSummary } from "./runSummary.ts";
import { NO_PAUSES, type Pauses } from "./stages.ts";
import { initialView, reduceView } from "./view.ts";
import { motionPlanSteps, pipelineExtras, sceneVideoSteps, videoScenesMissing } from "./videoPlan.ts";

const scene = (id: string, patch: Partial<Scene> = {}): Scene => ({ id, index: 0, prompt: "p", motionPrompt: "", mediaType: "image", start: 0, end: 5, ...patch }) as Scene;
const project = (patch: Partial<Project>): Project => ({ scenes: [], mediaMap: {}, ...patch }) as Project;
const pauses = (patch: Partial<Pauses>): Pauses => ({ ...NO_PAUSES, ...patch });

// (a) Approval state machine.

test("a step without a pause needs no approval, a paused step does", () => {
  const state = initialApprovals();
  assert.ok(isApprovedFor(state, NO_PAUSES, "images"), "one-click path unchanged");
  assert.ok(!isApprovedFor(state, pauses({ images: true }), "images"));
  assert.ok(isApprovedFor(approve(state, "images"), pauses({ images: true }), "images"));
});

test("approve, reject and needs-attention change only one step", () => {
  let state = initialApprovals();
  state = approve(state, "voice");
  state = reject(state, "prompts");
  state = markNeedsAttention(state, "images");
  assert.equal(state.voice, "approved");
  assert.equal(state.prompts, "rejected");
  assert.deepEqual(stagesNeedingAttention(state), ["images"]);
  assert.equal(state.timing, "pending");
});

test("the next waiting approval is the first paused step still pending", () => {
  const state = approve(initialApprovals(), "voice");
  assert.equal(nextWaitingApproval(state, pauses({ voice: true, prompts: true })), "prompts");
  assert.equal(nextWaitingApproval(state, NO_PAUSES), null);
});

test("approval is read out of a run view: waiting, error, stopped", () => {
  let view = initialView(["voice", "prompts", "images"]);
  view = reduceView(view, { type: "done", stage: "voice" });
  view = reduceView(view, { type: "waiting", stage: "prompts" });
  view = reduceView(view, { type: "start", stage: "images" });
  view = reduceView(view, { type: "error", stage: "images", error: new Error("x") });
  const state = approvalFromView(view);
  assert.equal(state.voice, "approved");
  assert.equal(state.prompts, "pending");
  assert.equal(state.images, "needs-attention");

  let stopped = initialView(["voice", "images"]);
  stopped = reduceView(stopped, { type: "stopped", stage: "images" });
  assert.equal(approvalFromView(stopped).images, "rejected");
});

// (b) Single-failed-scenes list.

test("only failed and missing scenes are listed, with a reason and retry state", () => {
  const list = failedScenes([
    { id: "S01", status: "done" },
    { id: "S02", status: "failed", error: "Account is out of pictures.", retries: 1 },
    { id: "S03", status: "missing" },
    { id: "S04", status: "waiting" },
    { id: "S05", status: "failed", error: "  ", retries: MAX_SCENE_RETRIES },
  ]);
  assert.deepEqual(list.map((item) => item.id), ["S02", "S03", "S05"]);
  assert.equal(list[0]?.reason, "Account is out of pictures.");
  assert.equal(list[1]?.kind, "missing");
  assert.equal(list[1]?.reason, "Picture is missing.");
  assert.equal(list[0]?.retryable, true);
  assert.equal(list[2]?.retryable, false, "tried enough times: needs a look, not another retry");
  assert.deepEqual(failedSceneIds([{ id: "S02", status: "failed" }]), ["S02"]);
  assert.deepEqual(retryableFailedScenes([{ id: "S05", status: "failed", retries: MAX_SCENE_RETRIES }]), []);
});

test("the failed list from a project is the picture scenes still without a file", () => {
  const scenes = [scene("S01"), scene("S02"), scene("S03", { mediaType: "video" }), scene("S04", { prompt: "" })];
  const list = failedScenesFromProject(project({ scenes, mediaMap: { S01: "media/a.png" } }), { S02: "Engine error." });
  assert.deepEqual(list.map((item) => item.id), ["S02"]);
  assert.equal(list[0]?.reason, "Engine error.");
  assert.deepEqual(failedScenesFromProject(project({ scenes, mediaMap: { S01: "media/a.png", S02: "media/b.png" } })), []);
});

// (c) Scene videos and motion graphics in the pipeline plan.

test("video steps cover video scenes only, with the video maker's file name", () => {
  const scenes = [scene("S01", { mediaType: "video", prompt: "a cat", motionPrompt: "slow zoom", start: 0, end: 5 }), scene("S02", { mediaType: "image" }), scene("S03", { mediaType: "video", prompt: " " })];
  const steps = sceneVideoSteps(project({ scenes, mediaMap: { S01: "media/v.mp4" } }), { S03: "queued" });
  assert.deepEqual(steps.map((step) => step.sceneId), ["S01"]);
  assert.equal(steps[0]?.fileName, "S01_000.0-005.0.mp4");
  assert.equal(steps[0]?.prompt, "a cat slow zoom");
  assert.equal(steps[0]?.state, "done");
  assert.equal(steps[0]?.mediaPath, "media/v.mp4");
});

test("a video scene without a video file is missing, or queued when the caller says so", () => {
  const scenes = [scene("S01", { mediaType: "video", start: 10, end: 18 })];
  assert.deepEqual(videoScenesMissing(project({ scenes, mediaMap: {} })), ["S01"]);
  assert.equal(sceneVideoSteps(project({ scenes, mediaMap: {} }), { S01: "queued" })[0]?.state, "queued");
  assert.deepEqual(videoScenesMissing(project({ scenes, mediaMap: { S01: "media/v.mp4" } })), []);
});

test("motion plan: spec graphics with a clip are ready, without one are missing, legacy is legacy", () => {
  const motion = [
    { id: "g1", sceneId: "S01", kind: "spec", clipPath: "graphics/g1/clip.mov" },
    { id: "g2", sceneId: "S02", kind: "spec" },
    { id: "g3", sceneId: "S03" },
  ] as MotionGraphic[];
  const steps = motionPlanSteps(motion);
  assert.deepEqual(steps.map((step) => step.state), ["ready", "missing-clip", "legacy"]);
  assert.equal(steps[0]?.hasSpec, true);
  assert.equal(steps[2]?.hasSpec, false);
  const extras = pipelineExtras(project({ scenes: [scene("S01", { mediaType: "video" })], mediaMap: {} }), motion);
  assert.equal(extras.videoMissing, 1);
  assert.equal(extras.motionReady, 1);
  assert.equal(extras.motionMissingClip, 1);
});

// (d) In-page result viewing and multi-account readiness.

test("the run summary names the result and the next step", () => {
  let view = initialView(["voice", "render"]);
  view = reduceView(view, { type: "done", stage: "voice" });
  view = reduceView(view, { type: "waiting", stage: "render" });
  const waiting = runSummary(view, null);
  assert.equal(waiting.waitingStage, "render");
  assert.equal(waiting.nextAction, "Press Continue for render.");
  assert.equal(waiting.percent, 50);

  let failed = initialView(["voice"]);
  failed = reduceView(failed, { type: "error", stage: "voice", error: new Error("x") });
  assert.equal(runSummary(failed, null).nextAction, "Fix the failed step, then resume.");
  assert.equal(runSummary(failed, null).failedStage, "voice");

  let finished = initialView();
  for (const row of finished.rows) finished = reduceView(finished, { type: "done", stage: row.id });
  finished = reduceView(finished, { type: "finished" });
  const done = runSummary(finished, { path: "exports/v.mp4", copyPath: null, seconds: 60, sizeBytes: 1000 });
  assert.equal(done.nextAction, "Open the finished video.");
  assert.equal(done.finished?.path, "exports/v.mp4");
  assert.ok(allStagesDone(finished));
  assert.deepEqual(remainingStages(finished), []);
});

test("account readiness counts ready accounts and the soonest back time", () => {
  const summary = accountsSummary([
    { id: "a1", ready: true, backAt: 0 },
    { id: "a2", ready: false, backAt: 5000 },
    { id: "a3", ready: false, backAt: 3000 },
  ]);
  assert.equal(summary.ready, 1);
  assert.equal(summary.resting, 2);
  assert.equal(summary.canRun, true);
  assert.equal(summary.backAt, 3000);
  assert.equal(accountsSummary([]).canRun, false);
  assert.equal(accountsSummary([{ id: "a1", ready: false, backAt: 0 }]).backAt, 0);
});
