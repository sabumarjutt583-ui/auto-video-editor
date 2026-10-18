import { invoke } from "@tauri-apps/api/core";

import type { RenderRequest } from "./request";

export interface EncoderInfo {
  id: string;
  label: string;
  gpu: boolean;
}

export interface RenderResult {
  path: string;
  copyPath: string | null;
  srtPath: string | null;
  sizeBytes: number;
  duration: number;
  expectedDuration: number;
  durationOk: boolean;
  width: number;
  height: number;
  encoder: string;
  secondsTaken: number;
  warnings: string[];
}

export function listEncoders(): Promise<EncoderInfo[]> {
  return invoke<EncoderInfo[]>("list_encoders");
}

export function renderVideo(projectId: string, request: RenderRequest, jobId: string): Promise<RenderResult> {
  return invoke<RenderResult>("render_video", { projectId, request, jobId });
}

export function showInFolder(projectId: string, path: string): Promise<void> {
  return invoke<void>("show_in_folder", { projectId, path });
}
