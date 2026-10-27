import { invoke } from "@tauri-apps/api/core";

export interface DrawResult {
  filters: string[];
  skipped: string[];
  plan: { id: string; layerType: string; start: number; end: number; opacity: number; visible: boolean }[];
}

/** Turns a graphic spec into FFmpeg filters (text + lower-third only). */
export const graphicsFilters = (specJson: string, width: number, height: number): Promise<DrawResult> =>
  invoke<DrawResult>("graphics_filters", { specJson, width, height });

/** Draws the spec over a finished video of the project; saves `<name>-graphics.mp4` in exports. */
export const graphicsApplyOverlay = (projectId: string, inputPath: string, specJson: string): Promise<DrawResult> =>
  invoke<DrawResult>("graphics_apply_overlay", { projectId, inputPath, specJson });

export const SAMPLE_SPEC = JSON.stringify(
  {
    schemaVersion: 1,
    id: "title-card",
    duration: 10,
    layers: [
      { type: "text", id: "t1", box: { x: 0.1, y: 0.08, w: 0.8, h: 0.1 }, start: 0, duration: 10, text: "Your title here", size: 0.06 },
      { type: "lowerThird", id: "lt1", box: { x: 0.06, y: 0.72, w: 0.5, h: 0.17 }, start: 1, duration: 8, title: "Name here", subtitle: "Role here" },
    ],
  },
  null,
  2,
);
