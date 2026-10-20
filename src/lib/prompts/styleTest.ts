import type { Scene } from "../../types/project.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { copyLines } from "./export.ts";

const SECONDS_PER_SCENE = 6;

/** One scene per non-empty line of the sample story (6 seconds each). */
export function sampleScenes(story: string): Scene[] {
  return story
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((text, index) => ({
      ...emptyScene(),
      id: `S${String(index + 1).padStart(2, "0")}`,
      index,
      start: index * SECONDS_PER_SCENE,
      end: (index + 1) * SECONDS_PER_SCENE,
      duration: SECONDS_PER_SCENE,
      text,
    }));
}

/** The text for Copy and Export TXT: one prompt per line, with its timecode. */
export function styleTestText(scenes: readonly Scene[]): string {
  return copyLines(scenes, false);
}
