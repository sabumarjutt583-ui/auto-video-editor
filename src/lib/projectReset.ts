import type { ProjectPatch } from "../types/project.ts";

/**
 * What changes when the voice is unlocked: everything that depends on the exact voice timing
 * (word times, scenes with their prompts and media matches) is cleared. The script, style,
 * bible and settings stay.
 */
export function unlockPatch(): ProjectPatch {
  return {
    voiceLocked: false,
    words: [],
    scenes: [],
    timingSource: null,
    timingEstimated: false,
    alignmentQuality: null,
    unmatchedWords: [],
    mediaMap: {},
    renderedAt: null,
  };
}
