import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLength, scriptStats } from "./estimate.ts";

test("English is counted in words, 150 a minute", () => {
  const text = Array.from({ length: 300 }, () => "word").join(" ");
  const stats = scriptStats(text);
  assert.equal(stats.words, 300);
  assert.equal(stats.seconds, 120);
  assert.equal(stats.pieces, 2);
});

test("Korean is counted in characters, 300 a minute", () => {
  const stats = scriptStats("안녕하세요. ".repeat(60));
  assert.equal(stats.wideCharacters, 300);
  assert.equal(stats.words, 0, "the full stops are not words");
  assert.equal(stats.seconds, 60);
  assert.equal(stats.pieces, 1);
});

test("empty text and lengths", () => {
  assert.deepEqual(scriptStats("  \n "), { characters: 4, words: 0, wideCharacters: 0, seconds: 0, pieces: 0 });
  assert.equal(formatLength(45), "45 s");
  assert.equal(formatLength(120), "2 min");
  assert.equal(formatLength(135), "2 min 15 s");
});
