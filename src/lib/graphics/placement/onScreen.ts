import type { Motion } from "../../editor/motion.ts";
import type { MediaKind } from "../../../types/editor.ts";
import type { Box } from "./geometry.ts";
import { sourceToFrame, withCameraMove, type Fit } from "./mapping.ts";

export interface OnScreenInput {
  kind: MediaKind;
  /** Size of the picture or clip. */
  source: { width: number; height: number };
  frame: { width: number; height: number };
  /** The subject in the source, as fractions of the picture: one for a picture, one per preview frame (spread through the clip) for a clip. */
  boxes: readonly Box[];
  /** Pictures only: the Ken Burns move (a clip does not get one). */
  motion: Motion;
  fit: Fit;
  /** Where in the scene the graphic starts and ends (0 = start of the scene, 1 = end). */
  from: number;
  to: number;
}

const unit = (n: number): number => Math.min(1, Math.max(0, n));
const visible = (b: Box): boolean => b.w > 0 && b.h > 0;

/**
 * Where the subject is in the FRAME at the start and at the end of a graphic. A picture is cropped (or contained) like the
 * preview does it and then moved by the camera; a clip uses the preview frames nearest to those moments. Returns one box for
 * each of the two moments (the solver keeps both clear), without empty ones.
 */
export function subjectsOnScreen(input: OnScreenInput): Box[] {
  const { boxes, kind } = input;
  if (boxes.length === 0) return [];
  const out: Box[] = [];
  for (const progress of [unit(input.from), unit(input.to)]) {
    const index = kind === "video" ? Math.min(boxes.length - 1, Math.floor(progress * boxes.length)) : 0;
    const source = boxes[index] as Box;
    const framed = sourceToFrame(source, input.source, input.frame, input.fit);
    const box = kind === "image" ? withCameraMove(framed, input.motion, progress) : framed;
    if (visible(box)) out.push(box);
  }
  return out;
}
