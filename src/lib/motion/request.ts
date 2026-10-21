import type { AspectRatio } from "../../types/settings.ts";
import type { MotionGraphic } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { outputSize } from "../editor/size.ts";
import type { MotionRequest, MotionResult } from "./api.ts";

export const MOTION_FPS = 30;
const MIN_SECONDS = 0.8;
const MAX_SECONDS = 12;

/** Letters, digits, "-" and "_" only (it becomes a folder name). */
export function newMotionId(now: number = Date.now(), random: number = Math.random()): string {
  return `m${now.toString(36)}${Math.floor(random * 1296).toString(36)}`;
}

export function motionSeconds(scene: Pick<Scene, "start" | "end">): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round((scene.end - scene.start) * 10) / 10));
}

/** Graphics are drawn at 1080p (the renderer scales them) so that drawing stays fast. */
export function motionSize(aspect: AspectRatio): { width: number; height: number } {
  return outputSize(aspect, "1080p");
}

export function buildMotionRequest(scene: Scene, id: string, language: string, aspect: AspectRatio, look: string, idea: string): MotionRequest {
  const { width, height } = motionSize(aspect);
  return { id, narration: scene.text, language, seconds: motionSeconds(scene), look, idea: idea.trim(), width, height, fps: MOTION_FPS };
}

export function toGraphic(result: MotionResult, scene: Pick<Scene, "id" | "start">, idea: string): MotionGraphic {
  return {
    id: result.id,
    sceneId: scene.id,
    start: scene.start,
    duration: result.seconds,
    idea: idea.trim(),
    framesDir: result.framesDir,
    htmlPath: result.htmlPath,
    fps: result.fps,
    frames: result.frames,
    width: result.width,
    height: result.height,
    enabled: true,
  };
}

/** Frame file name (00000.png ...) shown at `progress` (0 to 1) of the graphic. */
export function frameAt(graphic: Pick<MotionGraphic, "frames">, progress: number): string {
  const index = Math.min(Math.max(graphic.frames - 1, 0), Math.max(0, Math.floor(progress * graphic.frames)));
  return `${String(index).padStart(5, "0")}.png`;
}

/** A graphic replaces the one with the same scene when it is regenerated. */
export function withGraphic(list: readonly MotionGraphic[], graphic: MotionGraphic, replaceId: string | null): MotionGraphic[] {
  return [...list.filter((g) => g.id !== replaceId), graphic].sort((a, b) => a.start - b.start);
}
