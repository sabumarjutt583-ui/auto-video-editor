import type { MusicMode, MusicTrack } from "../../types/editor.ts";

export interface MusicSegment {
  trackId: string;
  name: string;
  start: number;
  end: number;
}

/**
 * Where the music plays on the timeline: the tracks in order, repeated until the video ends
 * ("loop"), or played once ("fade"). The last piece is cut at the end of the video.
 */
export function musicSegments(tracks: readonly MusicTrack[], duration: number, mode: MusicMode): MusicSegment[] {
  const usable = tracks.filter((t) => t.duration > 0.1);
  if (usable.length === 0 || duration <= 0) return [];
  const once = usable.reduce((sum, t) => sum + t.duration, 0);
  const rounds = mode === "loop" && once < duration ? Math.min(200, Math.ceil(duration / once)) : 1;
  const result: MusicSegment[] = [];
  let at = 0;
  for (let r = 0; r < rounds && at < duration; r += 1) {
    for (const t of usable) {
      if (at >= duration) break;
      const end = Math.min(duration, at + t.duration);
      result.push({ trackId: t.id, name: t.name, start: at, end });
      at += t.duration;
    }
  }
  return result;
}
