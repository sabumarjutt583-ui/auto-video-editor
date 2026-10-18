import { invoke } from "@tauri-apps/api/core";

import type { SfxSound } from "../../types/editor";
import type { MixRequest } from "./mixRequest";

export interface SfxListing {
  dir: string;
  sounds: SfxSound[];
  warnings: string[];
}
export interface ImportedMusic {
  path: string;
  name: string;
  duration: number;
}
export interface MusicImportResult {
  imported: ImportedMusic[];
  failed: { name: string; reason: string }[];
}
export interface MixResult {
  path: string;
  duration: number;
  loudness: { integrated: number; truePeak: number; range: number };
}

export function listSfx(): Promise<SfxListing> {
  return invoke<SfxListing>("list_sfx");
}
export function importMusic(projectId: string, paths: string[], jobId: string): Promise<MusicImportResult> {
  return invoke<MusicImportResult>("import_music", { projectId, paths, jobId });
}
export function removeMusic(projectId: string, path: string): Promise<void> {
  return invoke<void>("remove_music", { projectId, path });
}
export function buildAudioMix(projectId: string, request: MixRequest, jobId: string): Promise<MixResult> {
  return invoke<MixResult>("build_audio_mix", { projectId, request, jobId });
}
