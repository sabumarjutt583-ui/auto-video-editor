import assert from "node:assert/strict";
import { test } from "node:test";
import { captureProviders, voiceProviderMismatch } from "./providers.ts";
import { defaultProfile, readProfile, exportProfile, importProfile } from "./profile.ts";
import type { AppSettings } from "../../types/settings.ts";

const defaults = { defaultModel: "speech-default", defaultVoice: "voice-default", edgeDefaultVoice: "edge-default" };
function settings(): AppSettings {
  return { textProvider: "groq", geminiModel: "gemini-original", groqTextModel: "groq-original", fallbackToGroq: false,
    groqWhisperModel: "whisper-original", apiBatchSize: 10, apiParallel: 2,
    ttsProvider: "edge", ttsModel: "speech-original", ttsEdgeVoice: "edge-original", ttsVoice: "gemini-voice",
    ttsStyle: "warm", ttsRate: 5, ttsVolume: -10, secretKey: "never-save", channelProfiles: ["unrelated"] } as unknown as AppSettings;
}

test("provider choices are detached from later settings and profile changes", () => {
  const current = settings();
  const profile = defaultProfile("test");
  profile.voice.provider = "edge";
  profile.voice.edgeVoice = "ko-KR-InJoonNeural";
  const frozen = captureProviders(current, profile, defaults);
  current.textProvider = "gemini";
  current.groqTextModel = "new-model";
  current.ttsEdgeVoice = "new-voice";
  profile.voice.edgeVoice = "ko-KR-SunHiNeural";
  assert.equal(frozen.textProvider, "groq");
  assert.equal(frozen.groqTextModel, "groq-original");
  assert.equal(frozen.voice.voice, "ko-KR-InJoonNeural");
  assert.equal(frozen.voice.rate, 5);
  assert.equal(frozen.voice.style, "");
  assert.ok(!JSON.stringify(frozen).includes("never-save"));
  assert.ok(!JSON.stringify(frozen).includes("unrelated"));
  assert.deepEqual(JSON.parse(JSON.stringify(frozen)), frozen);
});

test("provider defaults and channel voice overrides resolve once", () => {
  const current = settings();
  const profile = defaultProfile("test");
  profile.voice.model = ""; profile.voice.voice = ""; profile.voice.style = "";
  assert.equal(captureProviders(current, profile, defaults).voice.voice, "edge-original");
  current.ttsProvider = "gemini";
  profile.voice.model = "channel-model";
  profile.voice.style = "channel-style";
  const frozen = captureProviders(current, profile, defaults);
  assert.equal(frozen.voice.provider, "gemini");
  assert.equal(frozen.voice.model, "channel-model");
  assert.equal(frozen.voice.voice, "gemini-voice");
  assert.equal(frozen.voice.style, "channel-style");
  assert.equal(frozen.fallbackToGroq, false);
});


test("legacy Gemini channel voice never gets sent to global Edge provider", () => {
  const profile = defaultProfile("legacy");
  profile.voice.voice = "Leda";
  const result = captureProviders(settings(), profile, defaults);
  assert.equal(result.voice.provider, "gemini");
  assert.equal(result.voice.voice, "Leda");
  assert.equal(voiceProviderMismatch(result.voice), false);
  assert.equal(voiceProviderMismatch({ ...result.voice, provider: "edge" }), true);
});

test("explicit Microsoft channel keeps its own voice, rate and volume separate from Gemini", () => {
  const profile = defaultProfile("edge");
  profile.voice = { ...profile.voice, provider: "edge", voice: "Leda", edgeVoice: "ko-KR-InJoonNeural", rate: -20, volume: 15 };
  const current = settings(); current.ttsProvider = "gemini";
  const result = captureProviders(current, profile, defaults);
  assert.equal(result.voice.provider, "edge");
  assert.equal(result.voice.voice, "ko-KR-InJoonNeural");
  assert.equal(result.voice.rate, -20);
  assert.equal(result.voice.volume, 15);
  assert.equal(result.voice.style, "");
  assert.equal(voiceProviderMismatch(result.voice), false);
  profile.voice.provider = "gemini";
  assert.equal(captureProviders(current, profile, defaults).voice.voice, "Leda");
});


test("channel Microsoft settings survive export/import and clamp unsafe rate values", () => {
  const profile = readProfile({ voice: { provider: "edge", edgeVoice: "ko-KR-HyunsuMultilingualNeural", voice: "Leda", rate: -500, volume: 900 } }, "voice");
  assert.equal(profile.voice.provider, "edge");
  assert.equal(profile.voice.edgeVoice, "ko-KR-HyunsuMultilingualNeural");
  assert.equal(profile.voice.rate, -50);
  assert.equal(profile.voice.volume, 100);
  assert.deepEqual(importProfile(exportProfile(profile), [])?.voice, profile.voice);
});
