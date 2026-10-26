import type { RenderData, RenderFps, ShortClipMode, TransitionMode } from "../../types/editor.ts";

export const DEFAULT_RENDER: RenderData = { fps: 30, transitions: "mixed", kenBurns: true, shortClip: "smart" };

const FPS: readonly RenderFps[] = [24, 30, 60];
const SHORT: readonly ShortClipMode[] = ["smart", "hold", "loop", "ping_pong"];
const MODES: readonly TransitionMode[] = ["cut", "fade", "mixed"];

/** The render choices of a project, with every missing or damaged part replaced by its default. */
export function readRender(value: unknown): RenderData {
  const o = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fps = FPS.find((f) => f === o.fps) ?? DEFAULT_RENDER.fps;
  const transitions = MODES.find((m) => m === o.transitions) ?? DEFAULT_RENDER.transitions;
  const shortClip = SHORT.find((m) => m === o.shortClip) ?? DEFAULT_RENDER.shortClip;
  return { fps, transitions, kenBurns: o.kenBurns === undefined ? DEFAULT_RENDER.kenBurns : o.kenBurns === true, shortClip };
}
