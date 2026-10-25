import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScriptQuestion, cleanScript, scriptProblem } from "./prompt.ts";

test("the question holds the master prompt, the topic and the answer rule", () => {
  const q = buildScriptQuestion("  You write calm stories.  ", " A farmer's last harvest ");
  assert.ok(q.startsWith("You write calm stories.\n\nTOPIC OF THIS VIDEO:\nA farmer's last harvest\n\n"));
  assert.ok(q.includes("the exact words to be spoken"));
  assert.ok(q.includes("no markdown"));
});

test("an answer is reduced to the spoken words", () => {
  const answer = "Sure! Here is your script:\n\n# The Last Harvest\n\n**It was** autumn.\n\n[Intro music]\n\nHe walked alone.\n\n---\n\nLet me know if you want changes.";
  assert.equal(cleanScript(answer), "It was autumn.\n\nHe walked alone.");
});

test("a script inside one code block is taken out of it", () => {
  assert.equal(cleanScript("```text\nFirst line.\n\nSecond line.\n```"), "First line.\n\nSecond line.");
});

test("normal sentences are not damaged", () => {
  const text = "He paid 5 * 3 dollars (a lot) and left.\nThen he said: \"Enough.\"";
  assert.equal(cleanScript(text), text);
});

test("empty and very short scripts are problems", () => {
  assert.match(scriptProblem("") ?? "", /empty/);
  assert.match(scriptProblem("Too short.") ?? "", /very short/);
  assert.equal(scriptProblem("word ".repeat(40)), null);
});
