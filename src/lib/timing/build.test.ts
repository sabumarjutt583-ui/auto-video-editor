import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOutcome, parseTimingFile } from "./build.ts";
import { TimingParseError } from "./types.ts";

const speech = [
  { text: "hello", start: 0, end: 1 },
  { text: "world", start: 1, end: 2 },
];

test("without a script the speech words are used as they are", () => {
  const outcome = buildOutcome("  ", speech, 2);
  assert.equal(outcome.quality, null);
  assert.equal(outcome.words.length, 2);
});

test("with a script, wording comes from the script and misses are listed", () => {
  const outcome = buildOutcome("Hello big world.", speech, 2);
  assert.deepEqual(outcome.words.map((w) => w.text), ["Hello", "big", "world."]);
  assert.deepEqual(outcome.unmatched, [1]);
  assert.ok(outcome.quality !== null && outcome.quality > 60 && outcome.quality < 70);
});

test("the parser is chosen from the file name or content", () => {
  assert.equal(parseTimingFile("a.srt", "1\n00:00:00,000 --> 00:00:01,000\nHi\n").format, "SRT");
  assert.equal(parseTimingFile("a.txt", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n").words.length, 1);
  assert.equal(parseTimingFile("a.json", JSON.stringify([{ text: "x", start: 0, end: 1 }])).words.length, 1);
  assert.throws(() => parseTimingFile("a.docx", "binary"), TimingParseError);
});

import { activeWordIndex } from "./active.ts";

test("the active word follows the playback time", () => {
  const words = [
    { text: "a", start: 0, end: 1 },
    { text: "b", start: 1, end: 2 },
    { text: "c", start: 3, end: 4 },
  ];
  assert.equal(activeWordIndex(words, -1), -1);
  assert.equal(activeWordIndex(words, 0), 0);
  assert.equal(activeWordIndex(words, 1.5), 1);
  assert.equal(activeWordIndex(words, 2.5), 1);
  assert.equal(activeWordIndex(words, 99), 2);
  assert.equal(activeWordIndex([], 1), -1);
});
