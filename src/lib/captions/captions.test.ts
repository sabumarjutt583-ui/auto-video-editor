import assert from "node:assert/strict";
import { test } from "node:test";

import type { CaptionLine } from "../../types/editor.ts";
import type { TimedWord } from "../timing/types.ts";
import { removeLine, withText, withTimes } from "./edit.ts";
import { toSrt, toVtt } from "./exportSubtitles.ts";
import { FONTS, resolveFont } from "./fonts.ts";
import { fontPixels, safeMargins } from "./layout.ts";
import { buildLines, chooseBreak, lineAt, MIN_DURATION } from "./lines.ts";
import { applyPreset, DEFAULT_CAPTION_STYLE } from "./presets.ts";
import { readCaptions } from "./read.ts";
import { detectScript, isRtl, maxCharsPerLine } from "./script.ts";

/** Words of a sentence, 0.3 s each, starting at `at`. */
function speak(text: string, at = 0, each = 0.3): TimedWord[] {
  return text.split(" ").map((t, i) => ({ text: t, start: at + i * each, end: at + (i + 1) * each }));
}

test("detectScript finds the writing system", () => {
  assert.equal(detectScript("Once upon a time"), "latin");
  assert.equal(detectScript("안녕하세요 여러분"), "korean");
  assert.equal(detectScript("今日はいい天気です"), "japanese");
  assert.equal(detectScript("今天天气很好"), "chinese");
  assert.equal(detectScript("नमस्ते संसार"), "devanagari");
  assert.equal(detectScript("مرحبا بكم في القناة"), "arabic");
  assert.equal(detectScript("آپ کیسے ہیں؟ ٹھیک ہے"), "urdu");
  assert.equal(detectScript("12345"), "other");
  assert.equal(detectScript("Hello 안녕하세요 여러분 정말"), "korean");
});

test("line length and direction depend on the script", () => {
  assert.equal(maxCharsPerLine("latin"), 32);
  assert.equal(maxCharsPerLine("korean"), 16);
  assert.equal(maxCharsPerLine("japanese"), 16);
  assert.equal(maxCharsPerLine("devanagari"), 28);
  assert.equal(maxCharsPerLine("urdu"), 28);
  assert.equal(isRtl("urdu"), true);
  assert.equal(isRtl("arabic"), true);
  assert.equal(isRtl("korean"), false);
});

test("every script has a font, and auto picks the matching one", () => {
  assert.equal(resolveFont("auto", "korean").family, "Noto Sans KR");
  assert.equal(resolveFont("auto", "japanese").family, "Noto Sans JP");
  assert.equal(resolveFont("auto", "chinese").family, "Noto Sans SC");
  assert.equal(resolveFont("auto", "devanagari").family, "Noto Sans Devanagari");
  assert.equal(resolveFont("auto", "urdu").family, "Noto Sans Arabic");
  assert.equal(resolveFont("auto", "arabic").family, "Noto Sans Arabic");
  assert.equal(resolveFont("auto", "latin").family, "Noto Sans");
  assert.equal(resolveFont("noto_jp", "korean").family, "Noto Sans JP");
  assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length);
});

test("captions break at sentence ends and keep to two lines", () => {
  const words = [...speak("Once upon a time there was a quiet little village."), ...speak("A boy lived there.", 3.5)];
  const lines = buildLines(words, 5, { maxChars: 32 });
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.text, "A boy lived there.");
  for (const line of lines) {
    const rows = line.text.split("\n");
    assert.ok(rows.length <= 2);
    for (const row of rows) assert.ok([...row].length <= 32, row);
  }
  assert.equal(lines[0]?.text.includes("\n"), true);
});

test("a long run of words is cut into captions that fit", () => {
  const words = speak("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty");
  const lines = buildLines(words, 6, { maxChars: 20 });
  assert.ok(lines.length >= 3);
  for (const line of lines) for (const row of line.text.split("\n")) assert.ok([...row].length <= 20, row);
  // No word is lost or repeated.
  assert.equal(lines.flatMap((l) => l.words).length, words.length);
});

test("a pause longer than 0.35 s ends a half-full caption", () => {
  const first = speak("This is the beginning of it", 0, 0.2);
  const second = speak("and this comes after", 2.0, 0.2);
  const lines = buildLines([...first, ...second], 3, { maxChars: 32 });
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.words[0]?.text, "and");
});

test("Korean captions use 16 characters per line", () => {
  const words: TimedWord[] = "오늘은 아주 조용한 마을에서 시작된 이야기를 들려드릴게요 여러분 잘 들어주세요".split(" ").map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.4 }));
  const lines = buildLines(words, 5, { maxChars: maxCharsPerLine("korean") });
  for (const line of lines) for (const row of line.text.split("\n")) assert.ok([...row].length <= 16, row);
});

test("Japanese text has no spaces between characters", () => {
  const words: TimedWord[] = [..."今日はいい天気です"].map((t, i) => ({ text: t, start: i * 0.2, end: i * 0.2 + 0.2 }));
  const lines = buildLines(words, 2, { maxChars: 16 });
  assert.equal(lines[0]?.text, "今日はいい天気です");
});

test("a caption lasts at least 0.8 s: it stretches into quiet or joins the next", () => {
  // "Hi" is only 0.3 s long, and the next caption starts 2 s later.
  const stretch = buildLines([{ text: "Hi.", start: 0, end: 0.3 }, ...speak("Then a long wait", 2.5)], 4, { maxChars: 32 });
  assert.ok((stretch[0]?.end ?? 0) - (stretch[0]?.start ?? 0) >= MIN_DURATION - 1e-9);
  assert.ok((stretch[0]?.end ?? 0) <= (stretch[1]?.start ?? 0));
  // Two quick sentences with no room: they are joined.
  const joined = buildLines([{ text: "Hi.", start: 0, end: 0.2 }, { text: "Yes.", start: 0.25, end: 0.5 }], 1, { maxChars: 32 });
  assert.equal(joined.length, 1);
  assert.equal(joined[0]?.words.length, 2);
  assert.ok((joined[0]?.end ?? 0) - (joined[0]?.start ?? 0) >= 0.5);
});

test("captions never overlap and ids are numbered", () => {
  const words = [...speak("A short one.", 0), ...speak("Another short one.", 1.2), ...speak("The last one here.", 2.6)];
  const lines = buildLines(words, 4, { maxChars: 32 });
  lines.forEach((line, i) => {
    assert.equal(line.id, `C${String(i + 1).padStart(3, "0")}`);
    if (i > 0) assert.ok(line.start >= (lines[i - 1]?.end ?? 0) - 1e-9);
  });
});

test("chooseBreak balances two lines and returns null when one is enough", () => {
  const words = speak("alpha beta gamma delta epsilon zeta");
  assert.equal(chooseBreak(words, 40), null);
  assert.equal(chooseBreak(words, 18), 3);
});

test("lineAt finds the caption on screen", () => {
  const lines = buildLines(speak("One two. Three four.", 0), 2.4, { maxChars: 32 });
  assert.equal(lineAt(lines, 0.1)?.id, "C001");
  assert.equal(lineAt(lines, 100), null);
});

test("SRT and VTT export whole captions with correct times", () => {
  const lines: CaptionLine[] = [
    { id: "C001", start: 0, end: 2.5, text: "Hello there\nmy friend", words: [], breakAt: 2 },
    { id: "C002", start: 3661.2345, end: 3662, text: "안녕하세요", words: [], breakAt: null },
  ];
  assert.equal(toSrt(lines), "1\n00:00:00,000 --> 00:00:02,500\nHello there\nmy friend\n\n2\n01:01:01,235 --> 01:01:02,000\n안녕하세요\n");
  assert.equal(toVtt(lines), "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there\nmy friend\n\n01:01:01.235 --> 01:01:02.000\n안녕하세요\n");
  assert.ok(toSrt([{ id: "x", start: 59.9996, end: 60, text: "t", words: [], breakAt: null }]).includes("00:01:00,000 --> 00:01:00,000"));
});

test("editing the text keeps the timing", () => {
  const [line] = buildLines(speak("one two three"), 1, { maxChars: 32 });
  assert.ok(line);
  const same = withText(line, "uno dos tres", 32);
  assert.deepEqual(same.words.map((w) => [w.start, w.end]), line.words.map((w) => [w.start, w.end]));
  assert.equal(same.text, "uno dos tres");
  const more = withText(line, "one two three four", 32);
  assert.equal(more.words.length, 4);
  assert.ok(Math.abs((more.words[0]?.start ?? 1) - line.start) < 1e-9);
  assert.ok(Math.abs((more.words[3]?.end ?? 0) - line.end) < 1e-9);
  const broken = withText(line, "one\ntwo three", 32);
  assert.equal(broken.breakAt, 1);
  assert.equal(broken.text, "one\ntwo three");
  assert.equal(withText(line, "   ", 32), line);
});

test("editing times stays inside the neighbours", () => {
  const lines = buildLines([...speak("First line.", 0), ...speak("Second line.", 2), ...speak("Third line.", 4)], 6, { maxChars: 32 });
  const moved = withTimes(lines, 1, 0.1, 9, 6);
  assert.equal(moved[1]?.start, lines[0]?.end);
  assert.equal(moved[1]?.end, lines[2]?.start);
  assert.equal(removeLine(lines, 0).length, 2);
});

test("readCaptions repairs damaged data", () => {
  const empty = readCaptions(null);
  assert.deepEqual(empty.style, DEFAULT_CAPTION_STYLE);
  assert.equal(empty.lines, null);
  const odd = readCaptions({ style: { preset: "bogus", fontSize: 99, primary: "red", position: "top", uppercase: true }, lines: [{ id: "a", text: "x", start: 0, end: 1, words: [{ text: "x", start: 0, end: 1 }], breakAt: 7 }, { nope: 1 }] });
  assert.equal(odd.style.preset, DEFAULT_CAPTION_STYLE.preset);
  assert.equal(odd.style.fontSize, 14);
  assert.equal(odd.style.primary, DEFAULT_CAPTION_STYLE.primary);
  assert.equal(odd.style.position, "top");
  assert.equal(odd.style.uppercase, true);
  assert.equal(odd.lines?.length, 1);
  assert.equal(odd.lines?.[0]?.breakAt, null);
});

test("presets change size and position but keep the colors", () => {
  const style = { ...DEFAULT_CAPTION_STYLE, primary: "#00FF00" };
  const pop = applyPreset(style, "pop");
  assert.equal(pop.preset, "pop");
  assert.equal(pop.primary, "#00FF00");
  assert.equal(pop.position, "middle");
  assert.equal(applyPreset(style, "none").fontSize, style.fontSize);
});

test("safe margins differ for wide and tall video", () => {
  const wide = safeMargins("16:9", "bottom", 1920, 1080);
  const tall = safeMargins("9:16", "bottom", 1080, 1920);
  assert.equal(wide.vertical, Math.round(1080 * 0.08));
  assert.equal(tall.vertical, Math.round(1920 * 0.18));
  assert.equal(safeMargins("16:9", "middle", 1920, 1080).vertical, 0);
  assert.ok(fontPixels({ fontSize: 5 }, "9:16", 1080, 1920) > fontPixels({ fontSize: 5 }, "16:9", 1920, 1080) * 0.99);
});
