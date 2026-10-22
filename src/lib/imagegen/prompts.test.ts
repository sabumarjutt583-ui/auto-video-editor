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

test("pasting Copy all text back: one job per prompt, ids kept, MOTION lines ignored, empty lines ignored", () => {
  const copied = "S01_000.0-005.1 | first prompt\nMOTION: push in\n\n\nS02_005.1-008.6 | second prompt\n   with a second line\nMOTION: pan\n\n\nS03_008.6-010.2 | third prompt";
  const prompts = parsePrompts(copied);
  assert.deepEqual(prompts, [
    { id: "S01_000.0-005.1", text: "first prompt" },
    { id: "S02_005.1-008.6", text: "second prompt with a second line" },
    { id: "S03_008.6-010.2", text: "third prompt" },
  ]);
  const jobs = buildFolderJobs(prompts, "16:9", []);
  assert.deepEqual(jobs.map((j) => [j.sceneId, j.fileName]), [["S01", "S01_000.0-005.1.png"], ["S02", "S02_005.1-008.6.png"], ["S03", "S03_008.6-010.2.png"]]);
});

test("quick P ids are kept; an id that already exists in the folder gets the next free number instead", () => {
  const prompts = parsePrompts("P01 | a cat\n\n\nP02 | a dog\n\n\nP01 | again");
  const jobs = buildFolderJobs(prompts, "1:1", [{ id: "I001" }]);
  assert.deepEqual(jobs.map((j) => [j.sceneId, j.fileName]), [["P01", "P01.png"], ["P02", "P02.png"], ["I002", "Image 002.png"]]);
  assert.deepEqual(buildFolderJobs(parsePrompts("P01 | x"), "1:1", [{ id: "P01" }]).map((j) => j.sceneId), ["I001"]);
});

test("text without ids and MOTION-only lines behave as before", () => {
  assert.deepEqual(parsePrompts("a red fox\n\nMOTION: slow\n\nanother"), [{ text: "a red fox" }, { text: "another" }]);
});
