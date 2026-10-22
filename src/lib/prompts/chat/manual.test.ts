import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../../scenes/assemble.ts";
import { blankStyle } from "../../styleModel.ts";
import type { Character, PromptSettings, Scene } from "../../../types/project.ts";
import type { PromptContext } from "../generate.ts";
import { applyManualAnswer, planManual } from "./manual.ts";

const LOCK = "film noir, hard shadows, 35mm grain";
const MINA: Character = { id: "c1", name: "Mina", role: "girl", appearance: "An 8-year-old girl with a short black bob." };
const SETTINGS: PromptSettings = { outputType: "image", detail: "short", tool: "generic" };
const CONTEXT: PromptContext = { style: { ...blankStyle(), id: "n", name: "Noir", style_lock: LOCK, example_prompt: "E" }, characters: [MINA], locations: [], settings: SETTINGS, aspect: "16:9" };
const scenes: Scene[] = Array.from({ length: 45 }, (_, i) => ({ ...emptyScene(), id: `S${String(i + 1).padStart(2, "0")}`, index: i + 1, duration: 4, text: `Line ${i + 1}.`, characterIds: ["c1"] }));
const ALL = new Set(scenes.map((s) => s.id));
const long = "Mina stands at the window and watches the rain fall slowly over the empty street while a lamp flickers behind her and the room stays quiet and still around her tonight.";
const item = (id: string) => ({ id, prompt: `${long} ${MINA.appearance} ${LOCK}`, motion: "" });

test("the manual plan is the setup plus the same batches the web chat sends", () => {
  const steps = planManual(CONTEXT, scenes, ALL, "P7", 20);
  assert.equal(steps.length, 4);
  assert.equal(steps[0]?.kind, "setup");
  assert.ok(steps[0]?.message.trimEnd().endsWith("READY."));
  assert.deepEqual(steps.slice(1).map((s) => s.ids.length), [20, 20, 5]);
  for (const s of steps.slice(1)) assert.ok(s.message.includes(`BATCH_ID: ${s.id}`) && s.message.includes(LOCK));
});

test("a pasted answer in a code block, plain JSON, or with words around it is used", () => {
  const step = planManual(CONTEXT, scenes, ALL, "P7", 2)[1];
  assert.ok(step);
  const list = JSON.stringify(step.ids.map(item));
  for (const text of ["```json\n" + list + "\n```", list, `Here you go!\n${list}\nAnything else?`]) {
    const result = applyManualAnswer(step, text, scenes, CONTEXT);
    assert.deepEqual(result.applied, step.ids);
    assert.deepEqual(result.missing, []);
    assert.equal(result.followUp, null);
    assert.ok(result.scenes.slice(0, 2).every((s) => s.prompt.endsWith(LOCK) && s.status === "prompt_ready"));
    assert.equal(result.scenes[2]?.prompt, "", "other scenes are untouched");
  }
});

test("missing and extra ids are reported, found ones are kept, and a follow-up message is offered", () => {
  const step = planManual(CONTEXT, scenes, ALL, "P7", 3)[1];
  assert.ok(step);
  const answer = JSON.stringify([item("S01"), item("S03"), item("S99")]);
  const result = applyManualAnswer(step, answer, scenes, CONTEXT);
  assert.deepEqual(result.applied, ["S01", "S03"]);
  assert.deepEqual(result.missing, ["S02"]);
  assert.deepEqual(result.extra, ["S99"]);
  assert.ok(result.followUp?.includes("BATCH_ID: ") && result.followUp.includes("S02 |") && !result.followUp.includes("S01 |"));
  const nothing = applyManualAnswer(step, "I cannot do that", scenes, CONTEXT);
  assert.equal(nothing.readable, false);
  assert.deepEqual(nothing.missing, step.ids);
});

test("a manual answer is verified and repaired like a web chat answer", () => {
  const step = planManual(CONTEXT, scenes, ALL, "P7", 1)[1];
  assert.ok(step);
  const result = applyManualAnswer(step, JSON.stringify([{ id: "S01", prompt: "Mina waits by the door." }]), scenes, CONTEXT);
  const first = result.scenes[0];
  assert.ok(first?.prompt.endsWith(LOCK) && first.prompt.includes(MINA.appearance));
  assert.ok((first?.fixNotes ?? []).length > 0);
});
