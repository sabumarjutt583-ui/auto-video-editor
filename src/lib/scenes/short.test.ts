import assert from "node:assert/strict";
import { test } from "node:test";

import { splitSentences } from "../sentences.ts";
import { buildOutcome } from "../timing/build.ts";
import type { TimedWord } from "../timing/types.ts";
import type { SceneSettings } from "../../types/project.ts";
import { buildBySentences } from "./build.ts";
import { mergeShortScenes } from "./short.ts";

const SETTINGS: SceneSettings = { mode: "sentence", sentencesPerScene: 1, targetSeconds: 5, maxVideoSeconds: 30, minSeconds: 2 };

/** Sentences of the given lengths in seconds: one word per 0.5 s, the last word of a sentence ends it. */
function voice(lengths: number[]): { words: TimedWord[]; duration: number } {
  const words: TimedWord[] = [];
  let time = 0;
  lengths.forEach((seconds, s) => {
    const count = Math.max(1, Math.round(seconds / 0.5));
    for (let i = 0; i < count; i += 1) {
      words.push({ text: `W${s}x${i}${i === count - 1 ? "." : ""}`, start: time, end: time + 0.5 });
      time += 0.5;
    }
  });
  return { words, duration: time };
}

test("a 0.5 s and a 1.5 s scene are joined to a neighbour; ids and timecodes follow", () => {
  const { words, duration } = voice([3, 0.5, 4, 1.5, 3]);
  const scenes = buildBySentences({ words, voiceDuration: duration, settings: SETTINGS });
  assert.equal(scenes.length, 3);
  assert.deepEqual(scenes.map((s) => s.id), ["S01", "S02", "S03"]);
  assert.ok(scenes.every((s) => s.duration >= 2));
  assert.equal(scenes[0]?.start, 0);
  assert.equal(scenes[scenes.length - 1]?.end, duration);
  for (let i = 0; i + 1 < scenes.length; i += 1) assert.equal(scenes[i]?.end, scenes[i + 1]?.start);
  assert.ok(scenes[0]?.text.includes("W1x0."), "the short scene's words are in the previous scene");
});

test("a short first scene joins the next one; a short last scene joins the previous one", () => {
  const first = voice([1, 4, 4]);
  const a = buildBySentences({ words: first.words, voiceDuration: first.duration, settings: SETTINGS });
  assert.equal(a.length, 2);
  assert.equal(a[0]?.start, 0);
  assert.ok(a[0]?.text.startsWith("W0x0"));
  const last = voice([4, 4, 1]);
  const b = buildBySentences({ words: last.words, voiceDuration: last.duration, settings: SETTINGS });
  assert.equal(b.length, 2);
  assert.equal(b[1]?.end, last.duration);
});

test("the minimum is a setting and 0 turns it off", () => {
  const { words, duration } = voice([3, 0.5, 3]);
  const off = buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, minSeconds: 0 } });
  assert.equal(off.length, 3);
  const sentences = splitSentences(words);
  assert.equal(mergeShortScenes(off, words, sentences, duration, 0.4).length, 3);
});

test("the narration is the user's script, not the speech recognition text (Korean sample)", () => {
  const script = "할머니는 매일 아침 시장에 갔습니다. 손자는 집에서 기다렸습니다.";
  const speech: TimedWord[] = [
    { text: "할머니는", start: 0, end: 0.6 },
    { text: "매일", start: 0.6, end: 1.0 },
    { text: "아침에", start: 1.0, end: 1.6 }, // recognised wrongly
    { text: "시장애", start: 1.6, end: 2.2 }, // recognised wrongly
    { text: "갔습니다", start: 2.2, end: 3.0 },
    { text: "손자는", start: 3.4, end: 4.0 },
    { text: "집에서", start: 4.0, end: 4.6 },
    { text: "기다렸슴니다", start: 4.6, end: 5.6 }, // recognised wrongly
  ];
  const outcome = buildOutcome(script, speech, 6);
  const text = outcome.words.map((w) => w.text).join(" ");
  assert.ok(text.includes("시장에") && text.includes("기다렸습니다") && !text.includes("시장애") && !text.includes("기다렸슴니다"), text);
  const scenes = buildBySentences({ words: outcome.words, voiceDuration: 6, settings: { ...SETTINGS, minSeconds: 0 } });
  assert.ok(scenes.map((s) => s.text).join(" ").includes("갔습니다."));
  assert.ok(!scenes.some((s) => s.text.includes("시장애")));
});
