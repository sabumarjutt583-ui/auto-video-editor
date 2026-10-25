import { invoke } from "@tauri-apps/api/core";

export interface TtsVoice {
  name: string;
  feel: string;
}

export interface TtsModel {
  id: string;
  label: string;
  note: string;
}

export interface TtsOptions {
  voices: TtsVoice[];
  models: TtsModel[];
  defaultModel: string;
  defaultVoice: string;
}

export interface TtsRequest {
  text: string;
  voice: string;
  model: string;
  style: string;
}

export interface TtsResult {
  /** The joined voice file (WAV) in the project. */
  path: string;
  duration: number;
  pieces: number;
  /** Pieces taken from an earlier run. */
  reused: number;
}

export function ttsOptions(): Promise<TtsOptions> {
  return invoke<TtsOptions>("tts_options");
}

/** A short sample in the chosen voice, as a `data:audio/wav` address. */
export function ttsPreview(voice: string, model: string, style: string, text: string): Promise<string> {
  return invoke<string>("tts_preview", { voice, model, style, text });
}

export function ttsGenerate(projectId: string, request: TtsRequest, jobId: string): Promise<TtsResult> {
  return invoke<TtsResult>("tts_generate", { projectId, request, jobId });
}
