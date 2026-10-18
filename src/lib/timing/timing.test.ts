import assert from "node:assert/strict";
import { test } from "node:test";

import { alignScript } from "./align.ts";
import { parseTimingJson } from "./json.ts";
import { parseSrt, parseTimestamp, parseVtt } from "./subtitles.ts";
import { TimingParseError } from "./types.ts";
import type { TimedWord } from "./types.ts";
import { checkAgainstVoice } from "./validate.ts";
import { lowConfidenceSentences, splitSentences } from "../sentences.ts";

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });

test("timestamps", () => {
  assert.equal(parseTimestamp("00:00:01,500"), 1.5);
  assert.equal(parseTimestamp("01:02.250"), 62.25);
});

test("SRT: lines become estimated words inside their time", () => {
  const srt = "1\n00:00:00,000 --> 00:00:02,000\nHello brave world\n\n2\n00:00:02,000 --> 00:00:03,000\nBye now\n";
  const result = parseSrt(srt);
  assert.equal(result.estimated, true);
  assert.deepEqual(result.words.map((x) => x.text), ["Hello", "brave", "world", "Bye", "now"]);
  assert.ok(result.words[0] && result.words[0].start === 0);
  assert.ok(result.words[2] && Math.abs(result.words[2].end - 2) < 0.01);
});

test("SRT without lines gives a friendly error", () => {
  assert.throws(() => parseSrt("nothing here"), TimingParseError);
});

test("VTT is read", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi there\n";
  const result = parseVtt(vtt);
  assert.deepEqual(result.words.map((x) => x.text), ["Hi", "there"]);
  assert.ok((result.words[0]?.start ?? 0) >= 1);
});

test("JSON: whisper words, segment words, ElevenLabs, simple list", () => {
  const a = parseTimingJson(JSON.stringify({ words: [{ word: "a", start: 0, end: 1 }] }));
  assert.equal(a.words.length, 1);
  const b = parseTimingJson(JSON.stringify({ segments: [{ words: [{ word: "a", start: 0, end: 1 }, { word: "b", start: 1, end: 2 }] }] }));
  assert.equal(b.words.length, 2);
  const c = parseTimingJson(JSON.stringify({ alignment: { characters: ["h", "i", " ", "y", "o"], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5] } }));
  assert.deepEqual(c.words.map((x) => x.text), ["hi", "yo"]);
  const d = parseTimingJson(JSON.stringify([{ text: "x", start: 0, end: 1 }]));
  assert.equal(d.words[0]?.text, "x");
  const e = parseTimingJson(JSON.stringify({ segments: [{ start: 0, end: 2, text: "two words" }] }));
  assert.equal(e.estimated, true);
});

test("JSON: bad input", () => {
  assert.throws(() => parseTimingJson("{oops"), TimingParseError);
  assert.throws(() => parseTimingJson("{}"), TimingParseError);
});

test("alignment: identical text matches 100%", () => {
  const speech = [w("one", 0, 1), w("two", 1, 2), w("three", 2, 3)];
  const r = alignScript("one two three", speech);
  assert.equal(r.quality, 100);
  assert.equal(r.words[1]?.start, 1);
});

test("alignment: script wording wins, spelling differences still match", () => {
  const speech = [w("colour", 0, 1), w("is", 1, 2), w("nice", 2, 3)];
  const r = alignScript("Color is nice.", speech);
  assert.equal(r.words[0]?.text, "Color");
  assert.equal(r.quality, 100);
});

test("alignment: missing speech word gets time between neighbours", () => {
  const speech = [w("one", 0, 1), w("three", 2, 3)];
  const r = alignScript("one two three", speech);
  assert.deepEqual(r.matched, [true, false, true]);
  const two = r.words[1];
  assert.ok(two && two.start >= 1 && two.end <= 2);
  assert.ok(Math.abs(r.quality - 66.7) < 0.1);
});

test("alignment: extra spoken words are ignored", () => {
  const speech = [w("one", 0, 1), w("um", 1, 1.5), w("two", 1.5, 2.5)];
  const r = alignScript("one two", speech);
  assert.equal(r.quality, 100);
  assert.equal(r.words[1]?.start, 1.5);
});

test("alignment: times never go backwards", () => {
  const r = alignScript("a b c d e f", [w("a", 0, 1), w("f", 5, 6)]);
  let last = 0;
  for (const word of r.words) {
    assert.ok(word.start >= last && word.end >= word.start);
    last = word.end;
  }
});

test("alignment: Japanese without spaces aligns per character", () => {
  const speech = [w("こんにちは", 0, 2.5), w("世界", 2.5, 3.5)];
  const r = alignScript("こんにちは世界", speech);
  assert.ok(r.words.length >= 4);
  assert.ok(r.quality > 90);
  assert.ok((r.words[r.words.length - 1]?.end ?? 0) <= 3.5 + 0.01);
});

test("alignment: nothing matches spreads over voice", () => {
  const r = alignScript("alpha beta", [w("zzzz", 0, 1)], { voiceDuration: 4 });
  assert.equal(r.quality, 0);
  assert.ok((r.words[1]?.end ?? 0) > 3);
});

test("duration check", () => {
  assert.equal(checkAgainstVoice([w("a", 0, 10)], 11).ok, true);
  const bad = checkAgainstVoice([w("a", 0, 30)], 10);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /longer/);
});

test("sentences: split, abbreviations, CJK, low confidence", () => {
  const words = [w("Hello", 0, 1), w("Dr.", 1, 1.5), w("Smith!", 1.5, 2.5), w("Next", 3, 4), w("one.", 4, 5)];
  const s = splitSentences(words);
  assert.equal(s.length, 2);
  assert.equal(s[0]?.text, "Hello Dr. Smith!");
  const jp = splitSentences([w("今日は。", 0, 1), w("明日", 1, 2)]);
  assert.equal(jp.length, 2);
  const low = lowConfidenceSentences(s, new Set([3, 4]));
  assert.deepEqual([...low], [1]);
});
