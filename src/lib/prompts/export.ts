import type { Scene } from "../../types/project.ts";
import { formatTimecode } from "../scenes/timecode.ts";

/** "S01_000.0-005.1" for a timed scene, "P01" for a quick prompt that has no timing. */
export function timecodeOf(scene: Scene): string {
  return scene.id.startsWith("P") ? scene.id : formatTimecode(scene.id, scene.start, scene.end);
}

export interface CopyOptions {
  /** Add a MOTION line under the prompts that have one. */
  withMotion: boolean;
  /** Empty lines after every prompt (0 = none). */
  emptyLines: number;
  /** Write "S01_000.0-005.1 | " before the prompt. */
  includeIds: boolean;
}

export const DEFAULT_EMPTY_LINES = 2;

export function clampEmptyLines(value: number): number {
  return Number.isFinite(value) ? Math.min(3, Math.max(1, Math.round(value))) : DEFAULT_EMPTY_LINES;
}

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ").trim();

/** One prompt, with its MOTION line directly under it. No empty lines. */
export function copyBlock(scene: Scene, withMotion: boolean, includeIds = true): string {
  const lines = [includeIds ? `${timecodeOf(scene)} | ${oneLine(scene.prompt)}` : oneLine(scene.prompt)];
  if (withMotion && scene.motionPrompt.trim() !== "") lines.push(`MOTION: ${oneLine(scene.motionPrompt)}`);
  return lines.join("\n");
}

/** Copy all / Export TXT: every prompt (with its MOTION line) followed by empty lines. Nothing trails at the end. */
export function copyLines(scenes: readonly Scene[], options: CopyOptions | boolean): string {
  const o: CopyOptions = typeof options === "boolean" ? { withMotion: options, emptyLines: 0, includeIds: true } : options;
  const blocks = scenes.filter((scene) => scene.prompt.trim() !== "").map((scene) => copyBlock(scene, o.withMotion, o.includeIds));
  return blocks.join("\n".repeat(Math.max(0, o.emptyLines) + 1));
}

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = ["id", "start", "end", "duration", "text", "prompt", "motion", "negative"];

/** CSV with a UTF-8 byte order mark so Excel shows Korean, Japanese, Urdu... correctly. */
export function toCsv(scenes: readonly Scene[]): string {
  const rows = scenes.map((scene) =>
    [timecodeOf(scene), scene.start.toFixed(1), scene.end.toFixed(1), scene.duration.toFixed(1), scene.text, scene.prompt, scene.motionPrompt, scene.negative].map(csvField).join(","),
  );
  return `﻿${[CSV_HEADER.join(","), ...rows].join("\r\n")}\r\n`;
}

export function toJson(scenes: readonly Scene[]): string {
  const items = scenes.map((scene) => ({
    id: timecodeOf(scene),
    sceneId: scene.id,
    start: Math.round(scene.start * 1000) / 1000,
    end: Math.round(scene.end * 1000) / 1000,
    duration: Math.round(scene.duration * 1000) / 1000,
    mediaType: scene.mediaType,
    text: scene.text,
    prompt: scene.prompt,
    motion: scene.motionPrompt,
    negative: scene.negative,
  }));
  return `${JSON.stringify(items, null, 2)}\n`;
}
