import type { KenBurns } from "../../types/editor.ts";

/** How far a Ken Burns move zooms in (0.12 = 12 % bigger). */
export const ZOOM_AMOUNT = 0.12;

export type Motion = Exclude<KenBurns, "auto">;

/** The moves "auto" cycles through, so neighbouring scenes never move the same way. */
const AUTO_CYCLE: readonly Motion[] = ["zoom_in", "pan_left", "zoom_out", "pan_right"];

/** The motion a scene really uses. `number` is the scene number (1, 2, 3...). */
export function resolveMotion(choice: KenBurns, number: number): Motion {
  if (choice !== "auto") return choice;
  return AUTO_CYCLE[Math.max(0, number - 1) % AUTO_CYCLE.length] ?? "zoom_in";
}

/** Scale and offset of the picture. Offsets are fractions of the frame size. */
export interface Transform {
  scale: number;
  x: number;
  y: number;
}

/** Smooth start and end: 0 to 1 along an S curve. */
export function ease(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}

/**
 * The picture's transform at `progress` (0 to 1) of its scene. The offsets never go further than the
 * extra size from zooming, so the frame is always completely covered.
 */
export function kenBurnsAt(motion: Motion, progress: number): Transform {
  const p = ease(progress);
  const zoomed = 1 + ZOOM_AMOUNT;
  const room = ZOOM_AMOUNT / 2;
  switch (motion) {
    case "zoom_in":
      return { scale: 1 + ZOOM_AMOUNT * p, x: 0, y: 0 };
    case "zoom_out":
      return { scale: zoomed - ZOOM_AMOUNT * p, x: 0, y: 0 };
    case "pan_left":
      return { scale: zoomed, x: room - 2 * room * p, y: 0 };
    case "pan_right":
      return { scale: zoomed, x: -room + 2 * room * p, y: 0 };
    case "pan_up":
      return { scale: zoomed, x: 0, y: room - 2 * room * p };
    case "none":
      return { scale: 1, x: 0, y: 0 };
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a source picture that fills a frame completely ("crop to fill"). */
export function coverSource(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number): Rect {
  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frameWidth / frameHeight;
  if (sourceRatio > frameRatio) {
    const width = sourceHeight * frameRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / frameRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

/** Where a source picture sits inside a frame when it is shown whole ("blur background" puts it over a blurred copy). */
export function containTarget(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number): Rect {
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}
