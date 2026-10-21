import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFolderJobs, freeFileName, freeId, highestNumber, parsePrompts } from "./prompts.ts";

test("plain lines: one prompt per line, empty lines are ignored", () => {
  assert.deepEqual(parsePrompts("a red fox\n\n  a blue whale  \r\nthird\n"), [{ text: "a red fox" }, { text: "a blue whale" }, { text: "third" }]);
  assert.deepEqual(parsePrompts("   \n\n"), []);
});

test("Prompt N: headings start a prompt and following lines belong to it", () => {
  const text = "Prompt 1: A cinematic photo of a lighthouse at dawn, mist\nover the sea\nPrompt 2: A cozy watercolor cafe on a rainy Paris street,\nwarm window glow";
  assert.deepEqual(parsePrompts(text), [
    { text: "A cinematic photo of a lighthouse at dawn, mist over the sea" },
    { text: "A cozy watercolor cafe on a rainy Paris street, warm window glow" },
  ]);
});

test("numbered lists with dots or brackets work, empty prompts are dropped", () => {
  assert.deepEqual(parsePrompts("1. first one\n2) second one\n3:\n4 - fourth"), [{ text: "first one" }, { text: "second one" }, { text: "fourth" }]);
});

test("a line that only starts with a number inside the text is not a heading in plain mode", () => {
  assert.deepEqual(parsePrompts("a man with 3 dogs\nthe year 1999 in Rome"), [{ text: "a man with 3 dogs" }, { text: "the year 1999 in Rome" }]);
});

test("ids and file names", () => {
  assert.equal(freeId(1), "I001");
  assert.equal(freeId(1234), "I1234");
  assert.equal(freeFileName(7), "Image 007.png");
  assert.ok(!freeFileName(7).includes(":"));
});

test("new prompts continue after the pictures already in the folder", () => {
  assert.equal(highestNumber([]), 0);
  assert.equal(highestNumber([{ id: "I001" }, { id: "I012" }, { id: "S03" }]), 12);
  const jobs = buildFolderJobs([{ text: "a" }, { text: "b" }], "1:1", [{ id: "I001" }, { id: "I002" }]);
  assert.deepEqual(jobs.map((j) => [j.sceneId, j.fileName, j.prompt, j.aspect]), [
    ["I003", "Image 003.png", "a", "1:1"],
    ["I004", "Image 004.png", "b", "1:1"],
  ]);
});
