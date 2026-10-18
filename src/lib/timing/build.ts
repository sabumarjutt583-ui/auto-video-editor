import { alignScript } from "./align.ts";
import { parseTimingJson } from "./json.ts";
import { parseSrt, parseVtt } from "./subtitles.ts";
import { TimingParseError } from "./types.ts";
import type { ParsedTiming, TimedWord } from "./types.ts";
import { tidyWords } from "./validate.ts";

export interface TimingOutcome {
  words: TimedWord[];
  /** Indexes of script words that were not found in the speech. */
  unmatched: number[];
  /** Percent of script words found, or null when there was no script to compare with. */
  quality: number | null;
}

/** Combines the timed speech with the user's script (the script's wording wins). */
export function buildOutcome(script: string, speech: readonly TimedWord[], voiceDuration: number): TimingOutcome {
  const tidy = tidyWords(speech);
  if (script.trim() === "") return { words: tidy, unmatched: [], quality: null };
  const aligned = alignScript(script, tidy, { voiceDuration });
  const unmatched: number[] = [];
  aligned.matched.forEach((found, index) => {
    if (!found) unmatched.push(index);
  });
  return { words: aligned.words, unmatched, quality: aligned.quality };
}

/** Reads a subtitle or JSON timing file, choosing the parser from the name and the content. */
export function parseTimingFile(fileName: string, text: string): ParsedTiming {
  const lower = fileName.toLowerCase();
  const clean = text.replace(/^﻿/, "");
  if (lower.endsWith(".json") || /^\s*[[{]/.test(clean)) return parseTimingJson(clean);
  if (lower.endsWith(".vtt") || clean.trimStart().startsWith("WEBVTT")) return parseVtt(clean);
  if (lower.endsWith(".srt") || lower.endsWith(".txt")) return parseSrt(clean);
  throw new TimingParseError("Please choose an .srt, .vtt or .json file.");
}
