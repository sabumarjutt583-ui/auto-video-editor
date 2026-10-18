import { sceneId as formatSceneId } from "../scenes/timecode.ts";

/** What a file name says about where the file belongs. */
export interface ParsedName {
  /** "timecode": scene and time; "scene": scene only; "none": nothing usable. */
  kind: "timecode" | "scene" | "none";
  sceneId: string | null;
  start: number | null;
  end: number | null;
}

const NONE: ParsedName = { kind: "none", sceneId: null, start: null, end: null };

/** Removes a letter-only extension such as ".png". A name that ends in ".1" (a timecode) is left alone. */
function stem(fileName: string): string {
  return fileName.replace(/\.[a-z][a-z0-9]{0,4}$/i, "").trim();
}

function normalise(digits: string, part: string | undefined): string {
  return formatSceneId(Number(digits)) + (part ? part.toLowerCase() : "");
}

/**
 * Reads a media file name (case-insensitive, any extension):
 *   S01_000.0-005.1.png -> scene S01, 0.0 to 5.1
 *   S05a_020.0-026.0.mp4 -> scene S05a
 *   S01.png or 01.png -> scene S01 only
 */
export function parseMediaName(fileName: string): ParsedName {
  const base = stem(fileName);

  const coded = /^S(\d{1,3})([a-z])?_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?!\d)/i.exec(base);
  if (coded) {
    const id = normalise(coded[1] ?? "", coded[2]);
    const start = Number(coded[3]);
    const end = Number(coded[4]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { kind: "timecode", sceneId: id, start, end };
    return { kind: "scene", sceneId: id, start: null, end: null };
  }

  const scene = /^S(\d{1,3})([a-z])?(?=$|[^a-z0-9])/i.exec(base);
  if (scene) return { kind: "scene", sceneId: normalise(scene[1] ?? "", scene[2]), start: null, end: null };

  // A bare number such as "01" or "7 (2)". Longer numbers (dates, camera counters) are not scene numbers.
  const bare = /^(\d{1,3})(?:\s*\(\d+\))?$/.exec(base);
  if (bare) return { kind: "scene", sceneId: normalise(bare[1] ?? "", undefined), start: null, end: null };

  return NONE;
}
