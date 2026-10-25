import { invoke } from "@tauri-apps/api/core";

import { wavBytesFromAddress } from "./sample.ts";

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

/** A short sample in the chosen voice, as a `blob:` address that the page is allowed to play. */
export async function ttsPreview(voice: string, model: string, style: string, text: string): Promise<string> {
  const address = await invoke<string>("tts_preview", { voice, model, style, text });
  return URL.createObjectURL(new Blob([wavBytesFromAddress(address)], { type: "audio/wav" }));
}

export function ttsGenerate(projectId: string, request: TtsRequest, jobId: string): Promise<TtsResult> {
  return invoke<TtsResult>("tts_generate", { projectId, request, jobId });
}
