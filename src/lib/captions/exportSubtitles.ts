import type { CaptionLine } from "../../types/editor.ts";

function stamp(seconds: number, separator: "," | "."): string {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const ms = total % 1000;
  const s = Math.floor(total / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${separator}${pad(ms, 3)}`;
}

/** SRT for YouTube: one entry per caption (sentence level, not per word). */
export function toSrt(lines: readonly CaptionLine[]): string {
  return lines.map((line, i) => `${i + 1}\n${stamp(line.start, ",")} --> ${stamp(line.end, ",")}\n${line.text}\n`).join("\n");
}

/** WebVTT, the same entries. */
export function toVtt(lines: readonly CaptionLine[]): string {
  return `WEBVTT\n\n${lines.map((line) => `${stamp(line.start, ".")} --> ${stamp(line.end, ".")}\n${line.text}\n`).join("\n")}`;
}
