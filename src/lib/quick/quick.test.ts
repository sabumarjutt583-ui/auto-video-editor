import assert from "node:assert/strict";
import { test } from "node:test";

import { splitSentences } from "../sentences.ts";
import { bySentences, byGroups, isQuickId, keepFinishedWork, plainTexts, quickId, scenesFromTexts, splitTextLines, splitTextSentences } from "./textScenes.ts";
import { copyLines } from "../prompts/export.ts";

const STORY = "The bank closed on Monday. People waited outside! Why did it fail? Nobody knew.";

test("sentences are found in English, Korean, Japanese and Urdu text", () => {
  assert.deepEqual(splitTextSentences(STORY), ["The bank closed on Monday.", "People waited outside!", "Why did it fail?", "Nobody knew."]);
  assert.equal(splitTextSentences("할머니는 오래 기다렸다. 아무도 오지 않았다.").length, 2);
  assert.equal(splitTextSentences("銀行は月曜日に閉まった。人々は外で待った。誰も知らなかった。").length, 3);
  assert.equal(splitTextSentences("بینک بند ہو گیا۔ لوگ باہر کھڑے تھے۔").length, 2);
  assert.deepEqual(splitTextSentences("   \n  "), []);
});

test("a long sentence is never cut by length", () => {
  const long = `${"word ".repeat(150)}end.`;
  assert.equal(splitTextSentences(long).length, 1);
});

test("per sentence: 1, 2, 3 or 4 sentences make one prompt, ids are P01, P02 ...", () => {
  assert.deepEqual(plainTexts(STORY, "sentence", 1).length, 4);
  assert.deepEqual(plainTexts(STORY, "sentence", 2), ["The bank closed on Monday. People waited outside!", "Why did it fail? Nobody knew."]);
  assert.equal(plainTexts(STORY, "sentence", 3).length, 2);
  assert.equal(plainTexts(STORY, "sentence", 4).length, 1);
  const scenes = scenesFromTexts(plainTexts(STORY, "sentence", 1));
  assert.deepEqual(scenes.map((s) => s.id), ["P01", "P02", "P03", "P04"]);
  assert.deepEqual([scenes[0]?.start, scenes[0]?.end, scenes[0]?.duration, scenes[0]?.mediaType], [0, 0, 0, "image"]);
  assert.ok(isQuickId("P01") && isQuickId("P120") && !isQuickId("S01"));
  assert.equal(quickId(7), "P07");
  assert.equal(quickId(120), "P120");
});

test("per line: every non-empty line is one prompt, whatever it holds", () => {
  const text = "First line. Still first.\n\n  Second line  \r\n\r\nThird";
  assert.deepEqual(splitTextLines(text), ["First line. Still first.", "Second line", "Third"]);
  assert.deepEqual(plainTexts(text, "line", 3), ["First line. Still first.", "Second line", "Third"]);
});

test("per scene (AI groups) joins the sentences of each group", () => {
  const sentences = splitTextSentences(STORY);
  assert.deepEqual(byGroups(sentences, [[0, 1], [2, 3]]), bySentences(sentences, 2));
  assert.deepEqual(byGroups(sentences, [[0, 0], [1, 3]]), ["The bank closed on Monday.", "People waited outside! Why did it fail? Nobody knew."]);
});

test("building the scenes again keeps the prompts of scenes whose text did not change", () => {
  const before = scenesFromTexts(["a one", "b two"]).map((s, i) => (i === 0 ? { ...s, prompt: "done", edited: true } : s));
  const after = keepFinishedWork(scenesFromTexts(["a one", "c three"]), before);
  assert.deepEqual(after.map((s) => [s.id, s.prompt, s.edited]), [["P01", "done", true], ["P02", "", false]]);
});

test("copying quick prompts uses the P ids with the empty-line spacing", () => {
  const scenes = scenesFromTexts(["x", "y"]).map((s, i) => ({ ...s, prompt: i === 0 ? "first prompt" : "second prompt" }));
  assert.equal(copyLines(scenes, { withMotion: false, emptyLines: 2, includeIds: true }), "P01 | first prompt\n\n\nP02 | second prompt");
});

test("the sentence splitter itself is unchanged for timed words", () => {
  const words = ["Hi", "there.", "Bye."].map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.equal(splitSentences(words).length, 2);
});
