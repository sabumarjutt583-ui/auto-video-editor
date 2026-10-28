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

export interface EdgeVoice {
  name: string;
  locale: string;
  gender: string;
}

export interface TtsOptions {
  voices: TtsVoice[];
  models: TtsModel[];
  defaultModel: string;
  defaultVoice: string;
  /** The built-in Edge fallback voices; the live list comes from edgeVoices(). */
  edgeVoices: EdgeVoice[];
  edgeDefaultVoice: string;
}

export interface TtsRequest {
  text: string;
  voice: string;
  model: string;
  style: string;
  /** "gemini" (the default) or "edge". */
  provider?: string;
  /** Edge only: speaking rate (-50..+100) in percent. */
  rate?: number;
  /** Edge only: volume (-100..+100) in percent. */
  volume?: number;
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

/** The same sample, with provider and Edge rate/volume (Edge ignores model/style). */
export async function ttsPreviewFull(
  voice: string,
  model: string,
  style: string,
  text: string,
  provider: string,
  rate: number,
  volume: number,
): Promise<string> {
  const address = await invoke<string>("tts_preview_full", { voice, model, style, text, provider, rate, volume });
  return URL.createObjectURL(new Blob([wavBytesFromAddress(address)], { type: "audio/wav" }));
}

/** The live Microsoft voice list (cached a day in the backend); falls back to
 * the built-in list when Microsoft cannot be reached, so it never comes back empty. */
export function edgeVoices(): Promise<EdgeVoice[]> {
  return invoke<EdgeVoice[]>("edge_voices");
}

export function ttsGenerate(projectId: string, request: TtsRequest, jobId: string): Promise<TtsResult> {
  return invoke<TtsResult>("tts_generate", { projectId, request, jobId });
}
