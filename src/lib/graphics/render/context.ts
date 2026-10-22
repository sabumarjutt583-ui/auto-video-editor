import type { Theme } from "./theme.ts";

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** An icon as SVG path data in a square `viewBox` (Lucide and Tabler icons are converted to this in phase 4). */
export interface IconShape {
  paths: string[];
  viewBox: number;
  /** True for solid icons, false for outline icons (drawn with a round stroke). */
  filled: boolean;
  strokeWidth?: number;
}

export interface Scratch {
  ctx: Canvas2D;
  canvas: CanvasImageSource;
}

/** Everything the renderer needs from the outside. Nothing here reads the clock, the network or random numbers. */
export interface RenderContext {
  width: number;
  height: number;
  theme: Theme;
  /** A loaded picture by the `src` of an image layer. */
  image: (src: string) => CanvasImageSource | undefined;
  icon: (set: string, name: string) => IconShape | undefined;
  /** Makes a second canvas of the same size (needed for motion blur only). */
  createScratch?: () => Scratch;
}

/** A thing that went wrong or was changed while drawing a frame (text cut, picture missing ...). */
export interface RenderNote {
  layerId: string;
  kind: "truncated" | "shrunk" | "missing-image" | "missing-icon" | "not-drawn";
  message: string;
}

export interface FrameReport {
  drawn: string[];
  notes: RenderNote[];
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}
