import type { Scene } from "../../types/project.ts";
import { formatTimecode } from "../scenes/timecode.ts";

export function timecodeOf(scene: Scene): string {
  return formatTimecode(scene.id, scene.start, scene.end);
}

/** "S01_000.0-005.1 | prompt", and a MOTION line below it when the scene has one. */
export function copyLines(scenes: readonly Scene[], withMotion: boolean): string {
  const lines: string[] = [];
  for (const scene of scenes) {
    if (scene.prompt.trim() === "") continue;
    lines.push(`${timecodeOf(scene)} | ${scene.prompt.replace(/\s*\n\s*/g, " ").trim()}`);
    if (withMotion && scene.motionPrompt.trim() !== "") lines.push(`MOTION: ${scene.motionPrompt.replace(/\s*\n\s*/g, " ").trim()}`);
  }
  return lines.join("\n");
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
