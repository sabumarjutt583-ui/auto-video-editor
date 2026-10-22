import type { RenderNote } from "../render/context.ts";
import type { Theme } from "../render/theme.ts";
import type { Box } from "../placement/geometry.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { RGB } from "./color.ts";

export type CheckId = "fit" | "contrast" | "reading" | "font" | "glyph" | "placement" | "overlap" | "timing";

/** A graphic as the checks see it: its spec and where it sits in the video. */
export interface GraphicItem {
  id: string;
  sceneId: string;
  /** Seconds from the start of the voice-over. */
  start: number;
  duration: number;
  spec: GraphicSpec;
}

export interface Issue {
  graphicId: string;
  sceneId: string;
  check: CheckId;
  severity: "warning" | "error";
  /** Plain English. */
  message: string;
  /** True when the check found it and the automatic fix repaired it. */
  fixed: boolean;
}

/** What the checks need from the outside world. */
export interface QualityEnv {
  theme: Theme;
  scene: (id: string) => { start: number; end: number } | undefined;
  caption: Box | null;
  safe: Box;
  /** Where the subject is while the graphic is on screen. */
  subjectsFor: (item: GraphicItem) => readonly Box[];
  /** The average colour of the picture under a frame box while the graphic shows; null = unknown (not checked). */
  pictureColor: (item: GraphicItem, box: Box) => RGB | null;
  /** Things that went wrong while drawing the graphic (text cut ...). */
  notes: (spec: GraphicSpec) => readonly RenderNote[];
  /** Can this font family draw this character? null = the font file is not known. */
  hasGlyph: (family: string, codePoint: number) => boolean | null;
}

/** A problem found by one check, with an optional safe repair. */
export interface Found {
  message: string;
  severity: Issue["severity"];
  fix?: () => GraphicItem | null;
}

export interface Check {
  id: CheckId;
  run: (item: GraphicItem, env: QualityEnv, all: readonly GraphicItem[]) => Found[];
}

export interface QualityReport {
  issues: Issue[];
  /** Graphics that were repaired (they need to be drawn again). */
  changed: GraphicItem[];
}
