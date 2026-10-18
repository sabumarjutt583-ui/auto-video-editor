import assert from "node:assert/strict";
import { test } from "node:test";

import { stepAccess } from "./steps.ts";
import type { Project, Scene } from "../types/project.ts";

function project(patch: Partial<Project>): Project {
  return { voiceLocked: false, words: [], scenes: [], styleId: null, ...patch } as Project;
}

test("a new project can only use the voice step", () => {
  const access = stepAccess(project({}));
  assert.deepEqual(
    Object.entries(access).filter(([, step]) => step.enabled).map(([id]) => id),
    ["voice"],
  );
});

test("each step opens when the one before it is finished", () => {
  assert.ok(stepAccess(project({ voiceLocked: true })).timing.enabled);
  assert.ok(!stepAccess(project({ voiceLocked: true })).scenes.enabled);
  const words = [{ text: "a", start: 0, end: 1 }];
  assert.ok(stepAccess(project({ voiceLocked: true, words })).scenes.enabled);
  const scenes = [{ prompt: "" } as Scene];
  const withScenes = stepAccess(project({ voiceLocked: true, words, scenes }));
  assert.ok(withScenes.style.enabled);
  assert.ok(!withScenes.prompts.enabled);
  assert.equal(withScenes.prompts.reason, "Choose a style first.");
  assert.ok(stepAccess(project({ voiceLocked: true, words, scenes, styleId: "x" })).prompts.enabled);
});

test("prompts are done only when every scene has one", () => {
  const base = { voiceLocked: true, words: [{ text: "a", start: 0, end: 1 }], styleId: "x" };
  assert.ok(!stepAccess(project({ ...base, scenes: [{ prompt: "a" } as Scene, { prompt: " " } as Scene] })).prompts.done);
  assert.ok(stepAccess(project({ ...base, scenes: [{ prompt: "a" } as Scene] })).prompts.done);
  assert.ok(!stepAccess(project({ ...base, scenes: [] })).prompts.done);
});
