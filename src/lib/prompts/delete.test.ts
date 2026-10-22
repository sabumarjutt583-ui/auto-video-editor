import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../scenes/assemble.ts";
import type { Scene } from "../../types/project.ts";
import { clearPrompts, restorePrompts, withoutDeleted } from "./delete.ts";

const scene = (n: number, extra: Partial<Scene> = {}): Scene => ({ ...emptyScene(), id: `S0${n}`, index: n, text: `Line ${n}.`, duration: 4, prompt: `prompt ${n}`, description: `d${n}`, motionPrompt: `m${n}`, status: "prompt_ready", ...extra });
const list = [scene(1), scene(2, { edited: true }), scene(3, { prompt: "", description: "", motionPrompt: "", status: "pending" })];

test("clear all keeps the scenes and their narration, and Undo puts the prompts back", () => {
  const { scenes, removed } = clearPrompts(list, null);
  assert.deepEqual(scenes.map((s) => s.prompt), ["", "", ""]);
  assert.deepEqual(scenes.map((s) => s.text), list.map((s) => s.text));
  assert.equal(removed.length, 2, "an empty scene has nothing to restore");
  assert.ok(scenes.every((s) => !s.edited && s.status === "pending"));
  const back = restorePrompts(scenes, removed);
  for (const i of [0, 1]) {
    const [a, b] = [back[i], list[i]];
    assert.deepEqual([a?.prompt, a?.description, a?.motionPrompt, a?.edited, a?.status], [b?.prompt, b?.description, b?.motionPrompt, b?.edited, b?.status]);
  }
  assert.equal(back[2]?.prompt, "");
});

test("delete selected only touches the chosen scenes", () => {
  const { scenes, removed } = clearPrompts(list, new Set(["S02"]));
  assert.equal(scenes[0]?.prompt, "prompt 1");
  assert.equal(scenes[1]?.prompt, "");
  assert.deepEqual(removed.map((r) => r.id), ["S02"]);
});

test("Undo does not overwrite a prompt written in the meantime", () => {
  const { scenes, removed } = clearPrompts(list, new Set(["S01"]));
  const rewritten = scenes.map((s) => (s.id === "S01" ? { ...s, prompt: "new" } : s));
  assert.equal(restorePrompts(rewritten, removed)[0]?.prompt, "new");
});

test("an answer that arrives after a delete does not bring the deleted prompt back", () => {
  const { scenes } = clearPrompts(list, new Set(["S01"]));
  const incoming = list.map((s) => ({ ...s, prompt: "from the AI" }));
  const merged = withoutDeleted(incoming, scenes, new Set(["S01"]));
  assert.equal(merged[0]?.prompt, "");
  assert.equal(merged[1]?.prompt, "from the AI");
  assert.equal(withoutDeleted(incoming, scenes, new Set()).length, 3);
});
