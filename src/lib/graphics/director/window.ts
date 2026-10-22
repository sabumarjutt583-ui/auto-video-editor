import type { Trigger } from "./types.ts";

/** A graphic stays this far away from the end of its scene (so it is gone when the next picture arrives). */
export const END_MARGIN = 0.1;
export const MIN_GRAPHIC_SECONDS = 1.2;
export const DEFAULT_GRAPHIC_SECONDS = 3.5;
export const MAX_GRAPHIC_SECONDS = 8;

export interface Window {
  /** Seconds from the start of the voice-over. */
  start: number;
  duration: number;
}

/**
 * When a graphic is on screen: it starts on the spoken trigger word and ends before the next scene. It lasts as long as the words
 * plus two seconds to read, within 1.2 and 8 seconds. Near the end of a scene it starts earlier instead of becoming too short.
 * Returns null when the scene is too short for any graphic.
 */
export function graphicWindow(scene: { start: number; end: number }, triggerTime: number, triggerEnd: number, wanted?: number): Window | null {
  const latestEnd = scene.end - END_MARGIN;
  const room = latestEnd - scene.start;
  if (room < MIN_GRAPHIC_SECONDS) return null;
  const ideal = wanted ?? Math.min(MAX_GRAPHIC_SECONDS, Math.max(2.5, triggerEnd - triggerTime + 2));
  const length = Math.min(ideal, room, MAX_GRAPHIC_SECONDS);
  const readable = Math.min(2, length);
  let start = Math.max(scene.start, triggerTime);
  let duration = length;
  if (latestEnd - start >= readable) duration = Math.min(length, latestEnd - start);
  else {
    // The words come too late in the scene: start a little early rather than leave the graphic too short to read.
    duration = readable;
    start = Math.max(scene.start, latestEnd - duration);
  }
  duration = Math.round(duration * 100) / 100;
  if (duration < MIN_GRAPHIC_SECONDS - 1e-9) return null;
  return { start: Math.round(start * 100) / 100, duration };
}

export const triggerWindow = (scene: { start: number; end: number }, trigger: Trigger): Window | null => graphicWindow(scene, trigger.time, trigger.endTime);
