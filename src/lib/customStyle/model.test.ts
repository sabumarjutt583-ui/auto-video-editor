import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnalyzeAnswer } from "../../types/customStyle.ts";
import type { StyleProfile } from "../../types/style.ts";
import { blankStyle } from "../styleModel.ts";
import { analyzeBlocker, analyzeWithRetry, checkDraft, defaultEngine, endsWithLock, engineChoices, finishDraft, nameProblems, splitPictures } from "./model.ts";

const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(", ");

function goodStyle(): StyleProfile {
  const lock = items(14, "look");
  return {
    ...blankStyle(),
    id: "custom_soft",
    name: "Soft",
    category: "My Styles",
    version: "1.0.0",
    core_identity: "Soft.",
    medium: "Paint",
    lighting: "Window light.",
    color_palette: "Warm.",
    camera: "Close.",
    composition: "Centered.",
    texture: "Grain.",
    characters: "Simple.",
    mood: "calm, warm, quiet, soft",
    negative: items(14, "bad"),
    motion_rules: "Slow.",
    style_lock: lock,
    example_prompt: `${Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ")} ${lock}`,
  };
}

const answer = (style: StyleProfile, raw = "{}"): AnalyzeAnswer => ({ style, raw });

test("only png, jpg and webp are taken, and only up to 20 pictures in all", () => {
  const split = splitPictures(["a.PNG", "b.txt", "c.jpg", "d.webp", "e.jpeg", "f.png"], 18);
  assert.deepEqual(split.accepted, ["a.PNG", "c.jpg"]);
  assert.deepEqual(split.notPictures, ["b.txt"]);
  assert.deepEqual(split.tooMany, ["d.webp", "e.jpeg", "f.png"]);
  assert.deepEqual(splitPictures(["C:\\x\\a.webp"], 0).accepted, ["C:\\x\\a.webp"]);
  assert.deepEqual(splitPictures(["a.png"], 20).accepted, []);
});

test("Analyze needs a name and 3 pictures", () => {
  assert.match(analyzeBlocker("", 3) ?? "", /name/);
  assert.match(analyzeBlocker("Soft", 2) ?? "", /3 to 20/);
  assert.equal(analyzeBlocker("Soft", 3), null);
  assert.equal(analyzeBlocker("Soft", 4), null);
  assert.match(analyzeBlocker("Pixar look", 3) ?? "", /brand/);
  assert.equal(nameProblems("Soft Film").length, 0);
});

test("the AI never chooses the id, name, category or version", () => {
  const draft = { ...goodStyle(), id: "hacked", name: "Evil", category: "x", version: "9" };
  const done = finishDraft(draft, { id: "custom_mine", name: "  Mine ", category: "" });
  assert.deepEqual([done.id, done.name, done.category, done.version, done.builtin], ["custom_mine", "Mine", "My Styles", "1.0.0", false]);
});

test("a good style passes the same rules as styles:check", () => {
  assert.deepEqual(checkDraft(goodStyle()), []);
  const short = { ...goodStyle(), style_lock: "a, b" };
  assert.ok(checkDraft(short).some((p) => p.includes("style_lock has 2 items")));
});

test("a passing answer is used at once, without a second question", async () => {
  let asked = 0;
  const result = await analyzeWithRetry(
    async () => {
      asked += 1;
      return answer({ ...goodStyle(), id: "", name: "", category: "" });
    },
    (draft) => finishDraft(draft, { id: "custom_soft", name: "Soft", category: "My Styles" }),
  );
  assert.equal(asked, 1);
  assert.deepEqual([result.problems, result.retried], [[], false]);
});

test("a failing answer is asked again once, with the problems and the earlier answer", async () => {
  const calls: { problems: string[]; previous: string | null }[] = [];
  const result = await analyzeWithRetry(
    async (problems, previous) => {
      calls.push({ problems, previous });
      return calls.length === 1 ? answer({ ...goodStyle(), style_lock: "a, b" }, "FIRST") : answer(goodStyle(), "SECOND");
    },
    (draft) => finishDraft(draft, { id: "custom_soft", name: "Soft", category: "My Styles" }),
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { problems: [], previous: null });
  assert.ok(calls[1]?.problems.some((p) => p.includes("style_lock")));
  assert.equal(calls[1]?.previous, "FIRST");
  assert.deepEqual([result.problems, result.retried], [[], true]);
});

test("when the second answer still breaks rules, the errors are returned and nobody asks a third time", async () => {
  let asked = 0;
  const result = await analyzeWithRetry(
    async () => {
      asked += 1;
      return answer({ ...goodStyle(), mood: "one" });
    },
    (draft) => finishDraft(draft, { id: "custom_soft", name: "Soft", category: "My Styles" }),
  );
  assert.equal(asked, 2);
  assert.ok(result.problems.some((p) => p.includes("mood has 1 items")));
  assert.equal(result.retried, true);
});

test("an error from the AI is passed on", async () => {
  await assert.rejects(analyzeWithRetry(async () => { throw new Error("401"); }, (d) => d), /401/);
});

test("engines that need a key say so, and the start engine follows the settings", () => {
  const choices = engineChoices({ gemini: false, openai: true });
  assert.match(choices.find((c) => c.value === "gemini")?.unavailable ?? "", /Gemini key/);
  assert.equal(choices.find((c) => c.value === "openai")?.unavailable, null);
  assert.equal(choices.find((c) => c.value === "chat")?.unavailable, null);
  assert.equal(defaultEngine({ gemini: true, openai: true }, true), "chat");
  assert.equal(defaultEngine({ gemini: true, openai: true }, false), "gemini");
  assert.equal(defaultEngine({ gemini: false, openai: true }, false), "openai");
  assert.equal(defaultEngine({ gemini: false, openai: false }, false), "chat");
});

test("a prompt must end with the style lock", () => {
  const style = goodStyle();
  assert.equal(endsWithLock(`A man. ${style.style_lock}`, style), true);
  assert.equal(endsWithLock(`A man. ${style.style_lock} --ar 16:9`, style), false);
  assert.equal(endsWithLock("x", { style_lock: "" }), false);
});
