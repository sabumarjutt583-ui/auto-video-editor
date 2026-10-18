import { invoke } from "@tauri-apps/api/core";

import type { CleanupParams, CleanupResult, SilenceReport, VoiceImport, Waveform } from "../types";

export function importVoice(projectId: string, sourcePath: string): Promise<VoiceImport> {
  return invoke<VoiceImport>("import_voice", { projectId, sourcePath });
}

export function getWaveform(projectId: string, path: string): Promise<Waveform> {
  return invoke<Waveform>("get_waveform", { projectId, path });
}

/** The full path of a project file, ready for convertFileSrc. */
export function projectFilePath(projectId: string, path: string): Promise<string> {
  return invoke<string>("project_file_path", { projectId, path });
}

export function previewSilence(
  projectId: string,
  originalPath: string,
  params: CleanupParams,
  jobId: string,
): Promise<SilenceReport> {
  return invoke<SilenceReport>("preview_silence", { projectId, originalPath, params, jobId });
}

export function applySilenceRemoval(
  projectId: string,
  originalPath: string,
  params: CleanupParams,
  jobId: string,
): Promise<CleanupResult> {
  return invoke<CleanupResult>("apply_silence_removal", { projectId, originalPath, params, jobId });
}

export function skipSilenceRemoval(
  projectId: string,
  originalPath: string,
  normalize: boolean,
  jobId: string,
): Promise<CleanupResult> {
  return invoke<CleanupResult>("skip_silence_removal", { projectId, originalPath, normalize, jobId });
}

export function cancelJob(jobId: string): Promise<boolean> {
  return invoke<boolean>("cancel_job", { jobId });
}
