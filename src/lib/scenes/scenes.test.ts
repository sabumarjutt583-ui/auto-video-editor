import assert from "node:assert/strict";
import { test } from "node:test";

import { splitSentences } from "../sentences.ts";
import { splitWords } from "../text.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene, SceneSettings } from "../../types/project.ts";
import { parseAiGroups, aiPrompt } from "./ai.ts";
import { buildBySeconds, buildBySentences, buildFromSentenceGroups } from "./build.ts";
import { editText, mergeWithNext, setMediaType, splitAtWord, totals, type Context } from "./edit.ts";
import { formatSeconds, formatTimecode, parseSceneId, parseTimecode, sceneId } from "./timecode.ts";

/** Gives every word of the text a time: `wordSeconds` each, plus a pause after sentence ends and commas. */
function speak(text: string, wordSeconds = 0.4, pause = 0.5): { words: TimedWord[]; duration: number } {
  let time = 0.3;
  const words = splitWords(text).map((token) => {
    const start = time;
    const end = start + wordSeconds;
    time = end + (/[.!?。！？।۔؟]$/u.test(token) ? pause : /[,，、،]$/u.test(token) ? pause / 2 : 0.02);
    return { text: token, start, end };
  });
  return { words, duration: time + 0.2 };
}

const SETTINGS: SceneSettings = { mode: "sentence", sentencesPerScene: 1, targetSeconds: 5, maxVideoSeconds: 8 };

function assertNoGaps(scenes: readonly Scene[], duration: number) {
  assert.ok(scenes.length > 0);
  assert.equal(scenes[0]?.start, 0);
  for (let i = 0; i + 1 < scenes.length; i += 1) {
    assert.equal(scenes[i]?.end, scenes[i + 1]?.start, `gap or overlap after scene ${i + 1}`);
    assert.ok((scenes[i]?.duration ?? 0) > 0);
  }
  assert.equal(scenes[scenes.length - 1]?.end, duration);
  const sum = scenes.reduce((acc, scene) => acc + scene.duration, 0);
  assert.ok(Math.abs(sum - duration) < 1e-9);
}

const STORY =
  "Once upon a time, in a quiet village by the sea, a boy lived with his grandmother. " +
  "Every morning he walked to the river. One day he found a glowing stone! " +
  "He carried it home. His grandmother smiled and said nothing. " +
  "That night the stone began to sing, and the whole house filled with light. " +
  "Nobody in the village ever forgot that song. The end.";

test("timecode formatting", () => {
  assert.equal(formatSeconds(0), "000.0");
  assert.equal(formatSeconds(5.06), "005.1");
  assert.equal(formatSeconds(32.4), "032.4");
  assert.equal(formatSeconds(138.96), "139.0");
  assert.equal(formatSeconds(1000), "1000.0");
  assert.equal(formatSeconds(-3), "000.0");
  assert.equal(formatTimecode("S01", 0, 5.1), "S01_000.0-005.1");
  assert.equal(formatTimecode("S07", 32.4, 38.9), "S07_032.4-038.9");
  assert.equal(formatTimecode("S12a", 61.25, 70), "S12a_061.3-070.0");
  assert.ok(!formatTimecode("S01", 1, 2).includes(":"));
  assert.equal(sceneId(5), "S05");
  assert.equal(sceneId(5, 1), "S05b");
  assert.equal(sceneId(120), "S120");
});

test("timecodes are read back from file names", () => {
  assert.deepEqual(parseTimecode("S07_032.4-038.9.png"), { id: "S07", start: 32.4, end: 38.9 });
  assert.deepEqual(parseTimecode("S05b_010.0-014.5 extra.mp4"), { id: "S05b", start: 10, end: 14.5 });
  assert.equal(parseTimecode("photo.png"), null);
  assert.deepEqual(parseSceneId("S05b"), { number: 5, part: 1 });
  assert.deepEqual(parseSceneId("S12"), { number: 12, part: null });
});

test("sentence splitting in many languages", () => {
  const cases: [string, number][] = [
    ["Hello there. How are you? Fine!", 3],
    ["안녕하세요. 저는 학생입니다. 만나서 반갑습니다!", 3],
    ["今日は天気がいいです。散歩に行きましょう。楽しみです！", 3],
    ["今天天气很好。我们去公园吧。真开心！", 3],
    ["Привет, друг. Как дела? Всё хорошо!", 3],
    ["यह एक कहानी है। वह घर गया। सब खुश थे।", 3],
    ["یہ ایک کہانی ہے۔ وہ گھر گیا۔ کیا تم خوش ہو؟", 3],
    ["Mr. Smith met Dr. Jones. They talked.", 2],
    ["Wait... what happened? Nothing.", 2],
  ];
  for (const [text, count] of cases) {
    const { words } = speak(text);
    assert.equal(splitSentences(words).length, count, text);
  }
});

test("per sentence: 1 to 4 sentences, no gaps, ends at the voice length", () => {
  const { words, duration } = speak(STORY);
  const sentences = splitSentences(words);
  for (const n of [1, 2, 3, 4]) {
    const scenes = buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, sentencesPerScene: n } });
    assert.equal(scenes.length, Math.ceil(sentences.length / n));
    assertNoGaps(scenes, duration);
  }
  const one = buildBySentences({ words, voiceDuration: duration, settings: SETTINGS });
  assert.equal(one[0]?.id, "S01");
  assert.equal(one[0]?.text.startsWith("Once upon a time,"), true);
  assert.equal(one[0]?.start, 0);
  assert.equal(one[1]?.start, words[one[1]?.firstWord ?? 0]?.start);
});

test("per seconds: cuts only at sentence ends, no gaps", () => {
  const { words, duration } = speak(STORY);
  for (const target of [3, 5, 8, 12]) {
    const scenes = buildBySeconds({ words, voiceDuration: duration, settings: SETTINGS }, target);
    assertNoGaps(scenes, duration);
    for (const scene of scenes.slice(0, -1)) {
      assert.match(words[scene.lastWord]?.text ?? "", /[.!?,]$/, `scene ${scene.id} ends mid-sentence`);
    }
  }
  const coarse = buildBySeconds({ words, voiceDuration: duration, settings: SETTINGS }, 12);
  const fine = buildBySeconds({ words, voiceDuration: duration, settings: SETTINGS }, 3);
  assert.ok(coarse.length < fine.length);
});

test("per seconds: a very long sentence is cut at commas or pauses, never inside a word", () => {
  const long = "First he packed his bag, then he locked the door, then he walked down the hill, then he crossed the bridge, then he reached the station, and finally he sat down to wait for the last train of the night.";
  const { words, duration } = speak(long);
  const scenes = buildBySeconds({ words, voiceDuration: duration, settings: SETTINGS }, 3);
  assert.ok(scenes.length > 2);
  assertNoGaps(scenes, duration);
  const joined = scenes.map((scene) => scene.text).join(" ");
  assert.equal(joined.replace(/\s+/g, " "), long);
  for (const scene of scenes.slice(0, -1)) assert.match(words[scene.lastWord]?.text ?? "", /,$/);
});

test("scene texts always add up to the script", () => {
  const { words, duration } = speak(STORY);
  for (const scenes of [
    buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, sentencesPerScene: 3 } }),
    buildBySeconds({ words, voiceDuration: duration, settings: SETTINGS }, 5),
  ]) {
    assert.equal(scenes.map((s) => s.text).join(" "), words.map((w) => w.text).join(" "));
  }
});

test("Japanese scenes keep the exact script and have no gaps", () => {
  const text = "今日は天気がいいです。散歩に行きましょう。公園で友達に会いました。みんなで笑いました。";
  const { words, duration } = speak(text, 0.2, 0.4);
  const scenes = buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, sentencesPerScene: 2 } });
  assert.equal(scenes.length, 2);
  assert.equal(scenes.map((s) => s.text).join(""), text);
  assertNoGaps(scenes, duration);
});

test("AI grouping is checked strictly", () => {
  assert.deepEqual(parseAiGroups('[{"scene":1,"sentences":[1,2]},{"scene":2,"sentences":[3]}]', 3), [[0, 1], [2, 2]]);
  assert.deepEqual(parseAiGroups('```json\n[{"scene":1,"sentences":[1,2,3]}]\n```', 3), [[0, 2]]);
  assert.deepEqual(parseAiGroups('Here you go: [{"scene":1,"sentences":[1]},{"scene":2,"sentences":[2]}] done', 2), [[0, 0], [1, 1]]);
  assert.deepEqual(parseAiGroups('{"scenes":[{"scene":1,"sentences":[1,2]}]}', 2), [[0, 1]]);
  assert.equal(parseAiGroups('[{"scene":1,"sentences":[1]},{"scene":2,"sentences":[3]}]', 3), null, "skipped sentence");
  assert.equal(parseAiGroups('[{"scene":1,"sentences":[1,2]},{"scene":2,"sentences":[2,3]}]', 3), null, "repeated sentence");
  assert.equal(parseAiGroups('[{"scene":1,"sentences":[2,1]}]', 2), null, "out of order");
  assert.equal(parseAiGroups('[{"scene":1,"sentences":[1,2]}]', 3), null, "missing sentence");
  assert.equal(parseAiGroups('[{"scene":1,"sentences":[]}]', 1), null);
  assert.equal(parseAiGroups("not json", 3), null);
  assert.equal(aiPrompt(["One.", "Two\nlines."]), "1. One.\n2. Two lines.");
});

test("AI groups become scenes without gaps", () => {
  const { words, duration } = speak(STORY);
  const count = splitSentences(words).length;
  const scenes = buildFromSentenceGroups({ words, voiceDuration: duration, settings: SETTINGS }, [[0, 1], [2, count - 1]]);
  assert.equal(scenes.length, 2);
  assertNoGaps(scenes, duration);
});

function context(words: TimedWord[], duration: number): Context {
  return { words, sentences: splitSentences(words), voiceDuration: duration, maxVideoSeconds: 8 };
}

test("video scenes longer than the maximum are split into a/b parts", () => {
  const { words, duration } = speak(STORY);
  const ctx = context(words, duration);
  const base = buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, sentencesPerScene: 4 } });
  assert.ok((base[0]?.duration ?? 0) > 8, "test needs a long scene");
  const asVideo = setMediaType(base, 0, "video", ctx);
  assertNoGaps(asVideo, duration);
  assert.ok(asVideo.length > base.length);
  assert.deepEqual(asVideo.slice(0, 2).map((s) => s.id), ["S01a", "S01b"]);
  for (const scene of asVideo.filter((s) => s.id.startsWith("S01"))) assert.ok(scene.duration <= 8 + 1e-9, `${scene.id} is ${scene.duration}`);
  assert.equal(asVideo.map((s) => s.text).join(" "), words.map((w) => w.text).join(" "));
  const followId = asVideo[asVideo.findIndex((s) => !s.id.startsWith("S01"))]?.id;
  assert.equal(followId, "S02");

  const backToImage = setMediaType(asVideo, 0, "image", ctx);
  assert.equal(backToImage.length, base.length);
  assert.equal(backToImage[0]?.id, "S01");
  assertNoGaps(backToImage, duration);
});

test("short video scenes stay whole", () => {
  const { words, duration } = speak(STORY);
  const ctx = context(words, duration);
  const base = buildBySentences({ words, voiceDuration: duration, settings: SETTINGS });
  const video = setMediaType(base, 1, "video", ctx);
  assert.equal(video.length, base.length);
  assert.equal(video[1]?.mediaType, "video");
});

test("merge with next and split at a word keep timing clean", () => {
  const { words, duration } = speak(STORY);
  const ctx = context(words, duration);
  const base = buildBySentences({ words, voiceDuration: duration, settings: SETTINGS });
  const merged = mergeWithNext(base, 1, ctx);
  assert.equal(merged.length, base.length - 1);
  assertNoGaps(merged, duration);
  assert.equal(merged[1]?.text, `${base[1]?.text} ${base[2]?.text}`);
  assert.deepEqual(merged.map((s) => s.id), merged.map((_, i) => sceneId(i + 1)));

  const second = base[2];
  assert.ok(second);
  const cut = (second?.firstWord ?? 0) + 1;
  const split = splitAtWord(base, 2, cut, ctx);
  assert.equal(split.length, base.length + 1);
  assertNoGaps(split, duration);
  assert.equal(split[2]?.lastWord, cut - 1);
  assert.equal(split[3]?.firstWord, cut);
  assert.deepEqual(split.map((s) => s.id), split.map((_, i) => sceneId(i + 1)));
  assert.equal(split.map((s) => s.text).join(" "), words.map((w) => w.text).join(" "));
});

test("merging clears prompts; editing text keeps timing", () => {
  const { words, duration } = speak(STORY);
  const ctx = context(words, duration);
  const base = buildBySentences({ words, voiceDuration: duration, settings: SETTINGS }).map((s) => ({ ...s, prompt: "p", status: "prompt_ready" as const }));
  const merged = mergeWithNext(base, 0, ctx);
  assert.equal(merged[0]?.prompt, "");
  assert.equal(merged[1]?.prompt, "p");
  const edited = editText(base, 1, "Different words");
  assert.equal(edited[1]?.text, "Different words");
  assert.equal(edited[1]?.start, base[1]?.start);
  assert.equal(edited[1]?.end, base[1]?.end);
  assert.equal(edited[1]?.prompt, "p");
});

test("totals and long image warning", () => {
  const { words, duration } = speak(STORY);
  const base = buildBySentences({ words, voiceDuration: duration, settings: { ...SETTINGS, sentencesPerScene: 4 } });
  const t = totals(base);
  assert.equal(t.count, base.length);
  assert.ok(Math.abs(t.averageSeconds * t.count - duration) < 1e-9);
  assert.ok(t.longestSeconds >= t.averageSeconds);
  assert.ok(t.longImages.length > 0 === base.some((s) => s.duration > 12));
  assert.equal(totals([]).count, 0);
});
