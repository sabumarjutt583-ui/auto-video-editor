import { splitWords, joinWords } from "../text.ts";
import { splitSentences } from "../sentences.ts";
import { emptyScene } from "../scenes/assemble.ts";
import type { ProjectPatch, Scene, Word } from "../../types/project.ts";

/** Local, deterministic draft planner. No AI result or actual speech transcription is claimed. */
export interface ScriptDraft {
  words: Word[];
  scenes: Scene[];
  duration: number;
  estimated: true;
}

const MAX_SCRIPT_WORDS = 50000;
const MAX_GROUP_WORDS = 22;

/** Estimate readable voiceover timing; replace with actual transcript timestamps when available. */
export function planScriptDraft(script: string, wordsPerMinute = 150): ScriptDraft {
  const tokens = splitWords(script.trim());
  if (!tokens.length) throw new Error("Paste a script containing narration before making a scene plan.");
  if (tokens.length > MAX_SCRIPT_WORDS) throw new Error("The script is too long for a single draft. Split it into parts.");
  const wpm = Number.isFinite(wordsPerMinute) ? Math.min(240, Math.max(90, wordsPerMinute)) : 150;
  const perWord = 60 / wpm;
  const words: Word[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const length = token.includes("…") ? 0.3 : /[.!?。！？۔؟]$/u.test(token) ? 0.22 : /[,;،؛:]$/u.test(token) ? 0.10 : 0;
    words.push({ text: token, start: cursor, end: cursor + perWord });
    cursor += perWord + length;
  }
  const sentences = splitSentences(words, { maxWords: MAX_GROUP_WORDS, maxSeconds: 12 });
  const chunks: { first: number; last: number }[] = [];
  for (const sentence of sentences) {
    let first = sentence.firstWord;
    while (first <= sentence.lastWord) {
      const last = Math.min(sentence.lastWord, first + MAX_GROUP_WORDS - 1);
      chunks.push({ first, last });
      first = last + 1;
    }
  }
  if (chunks.length > 5000) throw new Error("Too many scenes for one project.");
  const scenes = chunks.map(({ first, last }, index): Scene => {
    const start = index === 0 ? 0 : words[first]!.start;
    const end = index + 1 < chunks.length ? words[chunks[index + 1]!.first]!.start : cursor;
    const sceneText = joinWords(tokens.slice(first, last + 1));
    return {
      ...emptyScene(),
      id: `S${String(index + 1).padStart(2, "0")}`,
      index: index + 1,
      start,
      end,
      duration: Math.max(0.01, end - start),
      text: sceneText,
      firstWord: first,
      lastWord: last,
      firstSentence: index,
      lastSentence: index,
      description: `Visual needed for: ${sceneText.slice(0, 160)}`,
      status: "pending",
    };
  });
  return { words, scenes, duration: cursor, estimated: true };
}

export function patchFromScriptDraft(script: string, rate = 150): ProjectPatch {
  const planned = planScriptDraft(script, rate);
  return {
    script: script.trim(),
    words: planned.words,
    scenes: planned.scenes,
    voiceDuration: planned.duration,
    timingEstimated: true,
    timingSource: null,
    mediaMap: {},
    captionOverrides: {},
  };
}
