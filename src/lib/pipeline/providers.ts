import type { AppSettings } from "../../types/settings.ts";
import type { ChannelProfile } from "./profile.ts";
import type { TtsOptions } from "../tts/api.ts";

/** Explicit whitelist: never persist keys, account sessions or unrelated settings. */
export interface ProviderSnapshot {
  version: 1;
  textProvider: "gemini" | "groq";
  geminiModel: string;
  groqTextModel: string;
  fallbackToGroq: boolean;
  groqWhisperModel: string;
  apiBatchSize: number;
  apiParallel: number;
  voice: { provider: "edge" | "gemini"; model: string; voice: string; style: string; rate: number; volume: number };
}

export function captureProviders(settings: AppSettings, profile: ChannelProfile, defaults: Pick<TtsOptions, "defaultModel" | "defaultVoice" | "edgeDefaultVoice">): ProviderSnapshot {
  // Existing channel selectors stored Gemini names without recording the provider.
  const legacyVoice = profile.voice.voice;
  const legacyEdge = /Neural$/.test(legacyVoice);
  const provider = profile.voice.provider || (legacyVoice ? (legacyEdge ? "edge" : "gemini") : settings.ttsProvider === "edge" ? "edge" : "gemini");
  return {
    version: 1,
    textProvider: settings.textProvider === "groq" ? "groq" : "gemini",
    geminiModel: settings.geminiModel,
    groqTextModel: settings.groqTextModel,
    fallbackToGroq: settings.fallbackToGroq,
    groqWhisperModel: settings.groqWhisperModel,
    apiBatchSize: Math.min(20, Math.max(5, settings.apiBatchSize)),
    apiParallel: Math.min(3, Math.max(1, settings.apiParallel)),
    voice: { provider, model: profile.voice.model || settings.ttsModel || defaults.defaultModel,
      voice: provider === "edge" ? profile.voice.edgeVoice || (legacyEdge ? legacyVoice : "") || settings.ttsEdgeVoice || defaults.edgeDefaultVoice : (!legacyEdge ? legacyVoice : "") || settings.ttsVoice || defaults.defaultVoice,
      style: provider === "edge" ? "" : profile.voice.style || settings.ttsStyle || "",
      rate: profile.voice.rate ?? settings.ttsRate, volume: profile.voice.volume ?? settings.ttsVolume },
  };
}


/** Reject a cross-provider identifier before starting a speech request. */
export function voiceProviderMismatch(voice: ProviderSnapshot["voice"]): boolean {
  const microsoftName = /^[a-z]{2,3}-[A-Za-z]{2,4}-.+Neural$/.test(voice.voice);
  return voice.provider === "edge" ? !microsoftName : microsoftName;
}
