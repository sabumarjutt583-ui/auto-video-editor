import type { AudioData, SfxCue } from "../../types/editor.ts";

export interface MixRequest {
  duration: number;
  voicePath: string;
  music: {
    tracks: { path: string; duration: number }[];
    volume: number;
    fadeIn: number;
    fadeOut: number;
    mode: AudioData["mode"];
    ducking: AudioData["ducking"];
  };
  sfx: { soundId: string; time: number; gain: number }[];
  normalize: boolean;
}

/** The cues that will really be mixed: none when automatic effects are off and nothing was edited. */
export function activeCues(audio: AudioData, planned: readonly SfxCue[]): SfxCue[] {
  if (audio.cues) return audio.cues.slice();
  const rules = audio.autoSfx ? planned : [];
  return [...rules, ...audio.addedCues].sort((a, b) => a.time - b.time);
}

export function buildMixRequest(audio: AudioData, voicePath: string, duration: number, cues: readonly SfxCue[]): MixRequest {
  const master = audio.sfxVolume / 100;
  return {
    duration,
    voicePath,
    music: {
      tracks: audio.tracks.map((t) => ({ path: t.path, duration: t.duration })),
      volume: audio.musicVolume / 100,
      fadeIn: audio.fadeIn,
      fadeOut: audio.fadeOut,
      mode: audio.mode,
      ducking: audio.ducking,
    },
    sfx: cues.filter((c) => c.time >= 0 && c.time < duration).map((c) => ({ soundId: c.soundId, time: c.time, gain: Math.min(1, c.gain * master) })),
    normalize: audio.normalize,
  };
}
