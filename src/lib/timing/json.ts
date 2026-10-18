import { splitWords } from "../text.ts";
import { cuesResult, round } from "./cues.ts";
import type { Cue, ParsedTiming, TimedWord } from "./types.ts";
import { TimingParseError } from "./types.ts";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number, or text that is a number ("1.5"). */
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A word entry `{ word | text, start, end }`, or null if it is not one. */
function wordEntry(value: unknown): TimedWord | null {
  if (!isObject(value)) return null;
  const text = typeof value.word === "string" ? value.word : typeof value.text === "string" ? value.text : null;
  const start = num(value.start);
  const end = num(value.end);
  if (text === null || start === null || end === null) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return { text: trimmed, start: round(start), end: round(Math.max(start, end)) };
}

/** A word entry that may hold several words or no-space characters: split it and share its time. */
function splitEntry(entry: TimedWord): TimedWord[] {
  const tokens = splitWords(entry.text);
  if (tokens.length <= 1) return [entry];
  const length = entry.end - entry.start;
  return tokens.map((token, index) => ({
    text: token,
    start: round(entry.start + (length * index) / tokens.length),
    end: round(entry.start + (length * (index + 1)) / tokens.length),
  }));
}

function wordList(values: unknown): TimedWord[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const words: TimedWord[] = [];
  for (const value of values) {
    const entry = wordEntry(value);
    if (entry === null) return null;
    words.push(...splitEntry(entry));
  }
  return words;
}

/** ElevenLabs `{ characters, character_start_times_seconds, character_end_times_seconds }`. */
function findAlignment(value: unknown): Obj | null {
  if (!isObject(value)) return null;
  if (Array.isArray(value.characters) && Array.isArray(value.character_start_times_seconds)) return value;
  for (const key of ["alignment", "normalized_alignment"]) {
    const found = findAlignment(value[key]);
    if (found) return found;
  }
  return null;
}

function alignmentWords(alignment: Obj): TimedWord[] {
  const characters = alignment.characters as unknown[];
  const starts = alignment.character_start_times_seconds as unknown[];
  const ends = (alignment.character_end_times_seconds ?? alignment.character_start_times_seconds) as unknown[];
  if (characters.length !== starts.length || characters.length !== ends.length) {
    throw new TimingParseError("The character timing lists in this file have different lengths.");
  }
  const words: TimedWord[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text !== "") {
      for (const piece of splitEntry({ text, start: round(start), end: round(Math.max(start, end)) })) words.push(piece);
    }
    text = "";
  };
  characters.forEach((character, index) => {
    const s = num(starts[index]);
    const e = num(ends[index]);
    if (typeof character !== "string" || s === null || e === null) {
      throw new TimingParseError("The character timing lists in this file contain something that is not text or a number.");
    }
    if (/^\s$/.test(character)) {
      flush();
      return;
    }
    if (text === "") start = s;
    text += character;
    end = e;
  });
  flush();
  return words;
}

function segmentCues(segments: unknown[]): Cue[] {
  const cues: Cue[] = [];
  for (const segment of segments) {
    if (!isObject(segment)) continue;
    const start = num(segment.start);
    const end = num(segment.end);
    if (typeof segment.text === "string" && start !== null && end !== null) cues.push({ start, end, text: segment.text.trim() });
  }
  return cues;
}

const UNKNOWN =
  "I could not recognise this JSON file. Supported: Whisper/OpenAI (words or segments), ElevenLabs alignment, or a list of { text, start, end }.";

/** Reads the four supported JSON timing formats. */
export function parseTimingJson(text: string): ParsedTiming {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new TimingParseError("This file is not valid JSON.");
  }

  // (4) a simple list of { text|word, start, end }
  const listed = wordList(data);
  if (listed) return { words: listed, estimated: false, format: "JSON word list" };

  if (isObject(data)) {
    // (1) Whisper / OpenAI verbose_json: top-level words[]
    const top = wordList(data.words);
    if (top) return { words: top, estimated: false, format: "Whisper JSON (words)" };

    // (2) segments[] with words inside
    if (Array.isArray(data.segments)) {
      const inner: TimedWord[] = [];
      let everySegmentHasWords = data.segments.length > 0;
      for (const segment of data.segments) {
        const words = isObject(segment) ? wordList(segment.words) : null;
        if (words) inner.push(...words);
        else everySegmentHasWords = false;
      }
      if (everySegmentHasWords && inner.length > 0) return { words: inner, estimated: false, format: "Whisper JSON (segments with words)" };
      // Segments with line times only: estimate the words inside each line.
      const cues = segmentCues(data.segments);
      if (cues.length > 0) return cuesResult(cues, "JSON segments");
    }

    // (3) ElevenLabs character alignment
    const alignment = findAlignment(data);
    if (alignment) {
      const words = alignmentWords(alignment);
      if (words.length > 0) return { words, estimated: false, format: "ElevenLabs alignment" };
    }
  }
  throw new TimingParseError(UNKNOWN);
}
