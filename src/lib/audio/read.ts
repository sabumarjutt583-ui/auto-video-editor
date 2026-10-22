import type { AudioData, DuckingPreset, MixInfo, MusicMode, MusicTrack, SfxCue, SfxIntensity, SfxReason } from "../../types/editor.ts";

type Obj = Record<string, unknown>;

export const DEFAULT_AUDIO: AudioData = {
  tracks: [],
  musicVolume: 20,
  fadeIn: 2,
  fadeOut: 3,
  mode: "loop",
  ducking: "normal",
  autoSfx: true,
  graphicSfx: true,
  intensity: "normal",
  sfxVolume: 80,
  cues: null,
  addedCues: [],
  normalize: true,
  mix: null,
};

const DUCKING: readonly DuckingPreset[] = ["off", "light", "normal", "strong"];
const MODES: readonly MusicMode[] = ["loop", "fade"];
const INTENSITIES: readonly SfxIntensity[] = ["low", "normal", "high"];
const REASONS: readonly SfxReason[] = ["whoosh", "pop", "hit", "riser", "ambience", "graphic", "manual"];

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readTrack(value: unknown, index: number): MusicTrack | null {
  if (!isObject(value) || typeof value.path !== "string" || typeof value.name !== "string") return null;
  const duration = typeof value.duration === "number" && value.duration > 0 ? value.duration : 0;
  if (duration === 0) return null;
  return { id: typeof value.id === "string" ? value.id : `m${index + 1}`, path: value.path, name: value.name, duration };
}

function readCue(value: unknown, index: number): SfxCue | null {
  if (!isObject(value) || typeof value.soundId !== "string" || typeof value.time !== "number" || !Number.isFinite(value.time) || value.time < 0) return null;
  return { id: typeof value.id === "string" ? value.id : `X${String(index + 1).padStart(3, "0")}`, soundId: value.soundId, time: value.time, gain: num(value.gain, 0, 1, 0.8), reason: pick(value.reason, REASONS, "manual") };
}

function readMix(value: unknown): MixInfo | null {
  if (!isObject(value) || typeof value.path !== "string") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const integrated = n(value.integrated);
  const truePeak = n(value.truePeak);
  if (integrated === null || truePeak === null) return null;
  return { path: value.path, integrated, truePeak, range: n(value.range) ?? 0, builtAt: typeof value.builtAt === "string" ? value.builtAt : "" };
}

/** The audio settings of a project, with every missing or damaged part replaced by its default. */
export function readAudio(value: unknown): AudioData {
  const o = isObject(value) ? value : {};
  const d = DEFAULT_AUDIO;
  const cues = Array.isArray(o.cues) ? o.cues.map(readCue).filter((c): c is SfxCue => c !== null) : null;
  return {
    tracks: Array.isArray(o.tracks) ? o.tracks.map(readTrack).filter((t): t is MusicTrack => t !== null) : [],
    musicVolume: num(o.musicVolume, 0, 100, d.musicVolume),
    fadeIn: num(o.fadeIn, 0, 30, d.fadeIn),
    fadeOut: num(o.fadeOut, 0, 30, d.fadeOut),
    mode: pick(o.mode, MODES, d.mode),
    ducking: pick(o.ducking, DUCKING, d.ducking),
    autoSfx: o.autoSfx === undefined ? d.autoSfx : o.autoSfx === true,
    graphicSfx: o.graphicSfx === undefined ? d.graphicSfx : o.graphicSfx === true,
    intensity: pick(o.intensity, INTENSITIES, d.intensity),
    sfxVolume: num(o.sfxVolume, 0, 100, d.sfxVolume),
    cues,
    addedCues: Array.isArray(o.addedCues) ? o.addedCues.map(readCue).filter((c): c is SfxCue => c !== null) : [],
    normalize: o.normalize === undefined ? d.normalize : o.normalize === true,
    mix: readMix(o.mix),
  };
}
