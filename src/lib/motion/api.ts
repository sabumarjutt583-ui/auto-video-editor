import { invoke } from "@tauri-apps/api/core";

/** Mirrors src-tauri/src/motion/generate.rs */
export interface MotionRequest {
  id: string;
  narration: string;
  language: string;
  seconds: number;
  look: string;
  idea: string;
  width: number;
  height: number;
  fps: number;
}

export interface MotionResult {
  id: string;
  framesDir: string;
  htmlPath: string;
  frames: number;
  fps: number;
  seconds: number;
  width: number;
  height: number;
  tries: number;
}

export function motionGenerate(projectId: string, request: MotionRequest, jobId: string): Promise<MotionResult> {
  return invoke<MotionResult>("motion_generate", { projectId, request, jobId });
}
