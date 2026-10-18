import type { AspectRatio } from "../../../types";

/** The size of the preview canvas for an aspect ratio. */
export function frameSize(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === "9:16") return { width: 540, height: 960 };
  if (aspect === "1:1") return { width: 720, height: 720 };
  return { width: 960, height: 540 };
}

export { outputSize } from "../../../lib/editor/size";
