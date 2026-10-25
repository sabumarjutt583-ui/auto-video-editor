import assert from "node:assert/strict";
import { test } from "node:test";

import type { Project, Scene } from "../../types/project.ts";
import { scenesWithoutPicture, stageDone } from "./plan.ts";
import {
  defaultProfile,
  duplicateProfile,
  exportProfile,
  importProfile,
  newProfileId,
  profileProblems,
  profileToPatch,
  readProfile,
  readProfiles,
} from "./profile.ts";
import { chosenProfile, MAX_PROFILES, removeProfile, upsertProfile } from "./profileList.ts";
import { runPipeline, type PipelineEvent } from "./runner.ts";
import { initialView, percentDone, reduceView, restart, withDetail } from "./view.ts";
import { NO_PAUSES, STAGE_IDS, type StageId } from "./stages.ts";

function project(patch: Partial<Project>): Project {
  return { voiceLocked: false, voicePath: null, voiceDuration: 0, words: [], scenes: [], bibleLocked: false, mediaMap: {}, renderedAt: null, editor: null, ...patch } as Project;
}
const scene = (id: string, patchScene: Partial<Scene> = {}): Scene => ({ id, index: 0, prompt: "p", mediaType: "image", ...patchScene }) as Scene;

test("a profile read from nothing is the default", () => {
  const profile = readProfile(undefined, "x");
  assert.equal(profile.id, "x");
  assert.equal(profile.aspect, "16:9");
  assert.equal(profile.scenes.mode, "seconds");
  assert.equal(profile.look.outputType, "image");
  assert.deepEqual(profile.pauses, NO_PAUSES);
});

test("damaged values are replaced and limits are kept", () => {
  const profile = readProfile({
    id: "my channel!",
    name: "  Korean Senior  ",
    language: "KO",
    aspect: "4:3",
    quality: "8K",
    scenes: { mode: "weird", targetSeconds: 500, sentencesPerScene: 9, minSeconds: -2 },
    look: { styleId: "cinematic_realism", detail: "huge", outputType: "video" },
    audio: { musicVolume: 400, ducking: "x", musicPaths: ["a.mp3", 5, "", "b.mp3"] },
    pauses: { prompts: true, render: "yes" },
  });
  assert.equal(profile.id, "my-channel-");
  assert.equal(profile.name, "Korean Senior");
  assert.equal(profile.language, "ko");
  assert.equal(profile.aspect, "16:9");
  assert.equal(profile.quality, "1080p");
  assert.equal(profile.scenes.mode, "seconds");
  assert.equal(profile.scenes.targetSeconds, 60);
  assert.equal(profile.scenes.sentencesPerScene, 4);
  assert.equal(profile.scenes.minSeconds, 0);
  assert.equal(profile.look.styleId, "cinematic_realism");
  assert.equal(profile.look.detail, "medium");
  assert.equal(profile.look.outputType, "image", "phase 1 makes pictures only");
  assert.equal(profile.audio.musicVolume, 100);
  assert.equal(profile.audio.ducking, "normal");
  assert.deepEqual(profile.audio.musicPaths, ["a.mp3", "b.mp3"]);
  assert.equal(profile.pauses.prompts, true);
  assert.equal(profile.pauses.render, false, "only true counts");
});

test("a very long name is cut and an empty name gets a default", () => {
  assert.equal(readProfile({ name: "x".repeat(200) }).name.length, 60);
  assert.equal(readProfile({ name: "   " }).name, "My channel");
});

test("profiles with the same id get a number", () => {
  const list = readProfiles([{ id: "a" }, { id: "a" }, { id: "a" }, "junk"]);
  assert.deepEqual(list.map((p) => p.id), ["a", "a-2", "a-3", "channel-4"]);
});

test("new ids do not collide and a copy has its own id and name", () => {
  const first = defaultProfile("channel-abc");
  const id = newProfileId([first], 0);
  assert.notEqual(id, first.id);
  const taken = newProfileId([{ ...first, id: `channel-${(5).toString(36)}` }], 5);
  assert.equal(taken, `channel-${(5).toString(36)}-2`);
  const copy = duplicateProfile({ ...first, name: "Roblox" }, [first], 10);
  assert.equal(copy.name, "Roblox copy");
  assert.notEqual(copy.id, first.id);
});

test("export then import gives the same profile with a new id", () => {
  const original = { ...defaultProfile("old"), name: "Policy to Price", language: "en", look: { ...defaultProfile("x").look, styleId: "s1" } };
  const back = importProfile(exportProfile(original), [original], 7);
  assert.ok(back);
  assert.notEqual(back.id, "old");
  assert.deepEqual({ ...back, id: "old" }, original);
});

test("a file that is not a profile is refused", () => {
  assert.equal(importProfile("not json", []), null);
  assert.equal(importProfile("{}", []), null);
  assert.equal(importProfile('{"profile": 5}', []), null);
  assert.equal(importProfile('[1,2]', []), null);
});

test("the profile puts its choices into a new project", () => {
  const profile = { ...defaultProfile("a"), language: "ko", aspect: "9:16" as const, quality: "720p" as const, look: { ...defaultProfile("a").look, styleId: "noir" } };
  const patch = profileToPatch(profile);
  assert.equal(patch.language, "ko");
  assert.deepEqual(patch.settings, { aspectRatio: "9:16", quality: "720p" });
  assert.equal(patch.styleId, "noir");
  assert.equal(patch.promptSettings?.outputType, "image");
  assert.equal(profileToPatch(defaultProfile("b")).styleId, null);
});

test("problems stop a run before it starts", () => {
  const ready = { ...defaultProfile("a"), language: "ko", look: { ...defaultProfile("a").look, styleId: "noir" } };
  assert.deepEqual(profileProblems(ready, { script: "Hello", voiceFile: null }), []);
  assert.deepEqual(profileProblems(ready, { script: "", voiceFile: "/voice.mp3" }), []);
  assert.equal(profileProblems(ready, { script: " ", voiceFile: null }).length, 1);
  assert.equal(profileProblems(defaultProfile("a"), { script: "", voiceFile: null }).length, 2);
  assert.deepEqual(profileProblems({ ...ready, language: "" }, { script: "Hello", voiceFile: null }), [], "the language may be detected automatically");
});

test("each step knows when it is finished", () => {
  assert.ok(!stageDone(project({}), "voice"));
  assert.ok(stageDone(project({ voiceLocked: true, voicePath: "audio/p.wav", voiceDuration: 10 }), "voice"));
  assert.ok(!stageDone(project({ voiceLocked: true, voicePath: null, voiceDuration: 10 }), "voice"));
  assert.ok(stageDone(project({ words: [{ text: "a", start: 0, end: 1 }] }), "timing"));
  assert.ok(stageDone(project({ scenes: [scene("S01")] }), "scenes"));
  assert.ok(stageDone(project({ bibleLocked: true }), "cast"));
  assert.ok(stageDone(project({ renderedAt: "2026-10-25T10:00:00Z" }), "render"));
  assert.ok(!stageDone(project({}), "audio"));
});

test("prompts are done only when every scene has one", () => {
  assert.ok(!stageDone(project({ scenes: [] }), "prompts"));
  assert.ok(!stageDone(project({ scenes: [scene("S01"), scene("S02", { prompt: " " })] }), "prompts"));
  assert.ok(stageDone(project({ scenes: [scene("S01"), scene("S02")] }), "prompts"));
});

test("pictures are done when every image scene with a prompt has a file", () => {
  const scenes = [scene("S01"), scene("S02"), scene("S03", { mediaType: "video" }), scene("S04", { prompt: "" })];
  assert.ok(!stageDone(project({ scenes, mediaMap: { S01: "media/a.png" } }), "images"));
  assert.deepEqual(scenesWithoutPicture(project({ scenes, mediaMap: { S01: "media/a.png" } })), ["S02"]);
  assert.ok(stageDone(project({ scenes, mediaMap: { S01: "media/a.png", S02: "media/b.png" } }), "images"));
  assert.ok(!stageDone(project({ scenes: [] }), "images"), "no scenes, nothing to show");
});

function run(options: { done?: StageId[]; fail?: StageId; cancelAt?: StageId; pauses?: Partial<typeof NO_PAUSES>; confirm?: boolean; incomplete?: StageId; stages?: StageId[] }) {
  const events: PipelineEvent[] = [];
  const ran: StageId[] = [];
  const done = new Set<StageId>(options.done ?? []);
  let cancel = false;
  const promise = runPipeline({
    stages: options.stages ?? STAGE_IDS,
    isDone: (stage) => done.has(stage),
    run: async (stage) => {
      ran.push(stage);
      if (stage === options.fail) throw new Error("boom");
      if (stage === options.cancelAt) {
        cancel = true;
        throw new Error("cancelled");
      }
      if (stage !== options.incomplete) done.add(stage);
    },
    pauses: { ...NO_PAUSES, ...options.pauses },
    confirm: async () => options.confirm ?? true,
    cancelRequested: () => cancel,
    isCancel: (error) => error instanceof Error && error.message === "cancelled",
    onEvent: (event) => events.push(event),
  });
  return { promise, events, ran };
}

test("all steps run in order and the run finishes", async () => {
  const { promise, events, ran } = run({});
  assert.equal(await promise, "finished");
  assert.deepEqual(ran, [...STAGE_IDS]);
  assert.equal(events.at(-1)?.type, "finished");
});

test("finished steps are skipped, not run again", async () => {
  const { promise, events, ran } = run({ done: ["voice", "timing", "scenes"] });
  assert.equal(await promise, "finished");
  assert.deepEqual(ran, ["cast", "prompts", "images", "audio", "render"]);
  assert.deepEqual(events.filter((e) => e.type === "skipped").map((e) => (e as { stage: StageId }).stage), ["voice", "timing", "scenes"]);
});

test("an error stops the run and keeps what was finished", async () => {
  const { promise, events, ran } = run({ fail: "prompts" });
  assert.equal(await promise, "failed");
  assert.deepEqual(ran, ["voice", "timing", "scenes", "cast", "prompts"]);
  const last = events.at(-1);
  assert.equal(last?.type, "error");
});

test("a step that returns without finishing its work is an error", async () => {
  const { promise, events } = run({ incomplete: "images" });
  assert.equal(await promise, "failed");
  const last = events.at(-1);
  assert.ok(last?.type === "error" && last.stage === "images");
});

test("cancel stops the run quietly", async () => {
  const { promise, events, ran } = run({ cancelAt: "scenes" });
  assert.equal(await promise, "cancelled");
  assert.deepEqual(ran, ["voice", "timing", "scenes"]);
  assert.equal(events.at(-1)?.type, "cancelled");
});

test("a step with a pause waits and goes on after Continue", async () => {
  const { promise, events } = run({ pauses: { prompts: true } });
  assert.equal(await promise, "finished");
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf("waiting") < types.lastIndexOf("start"));
});

test("pressing Stop at a pause ends the run there", async () => {
  const { promise, ran, events } = run({ pauses: { images: true }, confirm: false });
  assert.equal(await promise, "stopped");
  assert.deepEqual(ran, ["voice", "timing", "scenes", "cast", "prompts"]);
  assert.equal(events.at(-1)?.type, "stopped");
});

test("a finished step does not ask for a pause", async () => {
  const { promise, events } = run({ done: ["prompts"], pauses: { prompts: true }, confirm: false });
  assert.equal(await promise, "finished");
  assert.ok(!events.some((e) => e.type === "waiting"));
});

test("only the chosen steps run", async () => {
  const { promise, ran } = run({ stages: ["audio", "render"] });
  assert.equal(await promise, "finished");
  assert.deepEqual(ran, ["audio", "render"]);
});

test("the run screen follows the events", () => {
  let view = initialView(["voice", "timing", "scenes"]);
  assert.equal(view.status, "idle");
  view = reduceView(view, { type: "skipped", stage: "voice" });
  view = reduceView(view, { type: "start", stage: "timing" });
  view = withDetail(view, "timing", "Groq is listening");
  assert.equal(view.rows[1]?.state, "running");
  assert.equal(view.rows[1]?.detail, "Groq is listening");
  view = reduceView(view, { type: "done", stage: "timing" });
  assert.equal(percentDone(view), 67);
  view = reduceView(view, { type: "start", stage: "scenes" });
  view = reduceView(view, { type: "error", stage: "scenes", error: new Error("x") });
  assert.equal(view.status, "failed");
  assert.equal(view.rows[2]?.state, "error");
  view = restart(view);
  assert.equal(view.status, "running");
  assert.deepEqual(view.rows.map((r) => r.state), ["skipped", "done", "pending"]);
  view = reduceView(view, { type: "finished" });
  assert.equal(view.status, "finished");
});

test("stop and cancel mark the row and the run", () => {
  let view = initialView(["voice", "timing"]);
  view = reduceView(view, { type: "stopped", stage: "timing" });
  assert.equal(view.status, "stopped");
  view = reduceView(initialView(["voice"]), { type: "cancelled", stage: "voice" });
  assert.equal(view.status, "cancelled");
  assert.equal(view.rows[0]?.detail, "Cancelled");
  assert.equal(reduceView(initialView(["voice"]), { type: "cancelled", stage: null }).status, "cancelled");
});

test("the profile list: add, replace, remove, choose", () => {
  const a = defaultProfile("a", "A");
  const b = defaultProfile("b", "B");
  let list = upsertProfile([], a);
  list = upsertProfile(list, b);
  list = upsertProfile(list, { ...a, name: "A2" });
  assert.deepEqual(list.map((p) => p.name), ["A2", "B"]);
  assert.equal(chosenProfile(list, "b")?.id, "b");
  assert.equal(chosenProfile(list, "gone")?.id, "a");
  assert.equal(chosenProfile([], "x"), null);
  assert.deepEqual(removeProfile(list, "a").map((p) => p.id), ["b"]);
  const full = Array.from({ length: MAX_PROFILES }, (_, i) => defaultProfile(`p${i}`));
  assert.equal(upsertProfile(full, defaultProfile("extra")).length, MAX_PROFILES);
});
