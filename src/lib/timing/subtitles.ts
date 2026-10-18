import { cuesResult } from "./cues.ts";
import type { Cue, ParsedTiming } from "./types.ts";
import { TimingParseError } from "./types.ts";

/** `01:02:03,456`, `01:02:03.456` or `02:03.456` to seconds. */
export function parseTimestamp(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + millis / 1000;
}

const TIME_LINE = /^\s*(\S+)\s+-->\s+(\S+)/;

function cleanText(lines: readonly string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/g, "") // <i>, <c.colorE5E5E5>, <00:00:01.000>
    .replace(/\{\\[^}]*\}/g, "") // {\an8}
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads subtitle blocks: a time line followed by text lines, blocks separated by blank lines. */
function readCues(text: string): Cue[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const cues: Cue[] = [];
  let index = 0;
  while (index < lines.length) {
    const match = TIME_LINE.exec(lines[index] ?? "");
    index += 1;
    if (!match) continue;
    const start = parseTimestamp(match[1] ?? "");
    const end = parseTimestamp(match[2] ?? "");
    if (start === null || end === null) continue;
    const body: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() !== "") {
      body.push(lines[index] ?? "");
      index += 1;
    }
    const cleaned = cleanText(body);
    if (cleaned !== "") cues.push({ start, end: Math.max(start, end), text: cleaned });
  }
  return cues;
}

export function parseSrt(text: string): ParsedTiming {
  const cues = readCues(text);
  if (cues.length === 0) throw new TimingParseError("This SRT file has no subtitle lines I can read.");
  return cuesResult(cues, "SRT");
}

export function parseVtt(text: string): ParsedTiming {
  if (!/^﻿?WEBVTT/.test(text)) throw new TimingParseError("This does not look like a VTT file (it should start with WEBVTT).");
  const cues = readCues(text);
  if (cues.length === 0) throw new TimingParseError("This VTT file has no subtitle lines I can read.");
  return cuesResult(cues, "VTT");
}
