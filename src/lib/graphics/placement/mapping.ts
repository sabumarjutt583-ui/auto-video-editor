import { containTarget, coverSource, kenBurnsAt, type Motion } from "../../editor/motion.ts";
import { clampBox, type Box } from "./geometry.ts";

export type Fit = "crop" | "blur";

/** Where a box of the source picture (fractions of the picture) lies in the frame (fractions of the frame), before any camera move. */
export function sourceToFrame(box: Box, source: { width: number; height: number }, frame: { width: number; height: number }, fit: Fit): Box {
  if (fit === "blur") {
    const t = containTarget(source.width, source.height, frame.width, frame.height);
    return { x: (t.x + box.x * t.width) / frame.width, y: (t.y + box.y * t.height) / frame.height, w: (box.w * t.width) / frame.width, h: (box.h * t.height) / frame.height };
  }
  const c = coverSource(source.width, source.height, frame.width, frame.height);
  const x0 = (box.x * source.width - c.x) / c.width;
  const y0 = (box.y * source.height - c.y) / c.height;
  return { x: x0, y: y0, w: (box.w * source.width) / c.width, h: (box.h * source.height) / c.height };
}

/** The same box after the Ken Burns move of a picture at `progress` (0..1) of its scene (as the preview and the render draw it), kept inside the frame. */
export function withCameraMove(box: Box, motion: Motion, progress: number): Box {
  const t = kenBurnsAt(motion, progress);
  const moved = { x: 0.5 + t.scale * (box.x - 0.5) + t.x, y: 0.5 + t.scale * (box.y - 0.5) + t.y, w: box.w * t.scale, h: box.h * t.scale };
  // Parts outside the frame cannot be covered: cut them off.
  const x0 = Math.max(0, moved.x), y0 = Math.max(0, moved.y);
  const x1 = Math.min(1, moved.x + moved.w), y1 = Math.min(1, moved.y + moved.h);
  return x1 > x0 && y1 > y0 ? clampBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : { x: 0, y: 0, w: 0, h: 0 };
}
