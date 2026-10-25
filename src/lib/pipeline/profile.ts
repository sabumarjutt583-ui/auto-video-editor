/** A channel profile: every choice that stays the same from one video of a channel to the next. */

import { DEFAULT_CAPTION_STYLE } from "../captions/presets.ts";
import { readCaptions } from "../captions/read.ts";
import { DEFAULT_AUDIO, readAudio } from "../audio/read.ts";
import { DEFAULT_RENDER, readRender } from "../render/read.ts";
import type { AudioData, CaptionStyle, RenderData } from "../../types/editor.ts";
import type { DetailLevel, OutputType, ProjectPatch, SceneMode, SceneSettings, TargetTool } from "../../types/project.ts";
import type { AspectRatio, Quality } from "../../types/settings.ts";
import { NO_PAUSES, STAGE_IDS, type Pauses } from "./stages.ts";

export const PROFILE_VERSION = 1;
export const MAX_NAME = 60;
export const MAX_MUSIC_FILES = 20;

export interface ProfileVoice {
  /** Empty = the model chosen in Settings. */
  model: string;
  /** Empty = the voice chosen in Settings. */
  voice: string;
  /** For example "slow and warm". Empty = none. */
  style: string;
  /** Cut the long pauses out of the voice. */
  cutSilence: boolean;
}

export interface ProfileLook {
  /** Empty = the person must choose a style before the first run. */
  styleId: string;
  detail: DetailLevel;
  tool: TargetTool;
  outputType: OutputType;
}

export interface ProfileAudio {
  musicVolume: number;
  ducking: AudioData["ducking"];
  autoSfx: boolean;
  graphicSfx: boolean;
  intensity: AudioData["intensity"];
  sfxVolume: number;
  /** Music files (full paths on this computer) that are copied into every new video. */
  musicPaths: string[];
}

export interface ChannelProfile {
  version: number;
  id: string;
  name: string;
  /** Language of the narration, for example "ko". */
  language: string;
  aspect: AspectRatio;
  quality: Quality;
  voice: ProfileVoice;
  scenes: SceneSettings;
  look: ProfileLook;
  captions: CaptionStyle;
  audio: ProfileAudio;
  render: RenderData;
  /** Steps that stop and ask before they start. */
  pauses: Pauses;
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function str(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

const ASPECTS: readonly AspectRatio[] = ["16:9", "9:16", "1:1"];
const QUALITIES: readonly Quality[] = ["720p", "1080p", "4K"];
const MODES: readonly SceneMode[] = ["sentence", "seconds", "ai"];
const DETAILS: readonly DetailLevel[] = ["short", "medium", "detailed"];
const TOOLS: readonly TargetTool[] = ["generic", "midjourney", "stable_diffusion", "flux", "dalle_gemini", "video"];
/** Phase 1 makes pictures only. */
const OUTPUTS: readonly OutputType[] = ["image"];

export const DEFAULT_SCENES: SceneSettings = { mode: "seconds", sentencesPerScene: 2, targetSeconds: 5, maxVideoSeconds: 8, minSeconds: 2 };

export function defaultProfile(id: string, name = "My channel"): ChannelProfile {
  return {
    version: PROFILE_VERSION,
    id,
    name,
    language: "",
    aspect: "16:9",
    quality: "1080p",
    voice: { model: "", voice: "", style: "", cutSilence: true },
    scenes: { ...DEFAULT_SCENES },
    look: { styleId: "", detail: "medium", tool: "dalle_gemini", outputType: "image" },
    captions: { ...DEFAULT_CAPTION_STYLE },
    audio: {
      musicVolume: DEFAULT_AUDIO.musicVolume,
      ducking: DEFAULT_AUDIO.ducking,
      autoSfx: DEFAULT_AUDIO.autoSfx,
      graphicSfx: DEFAULT_AUDIO.graphicSfx,
      intensity: DEFAULT_AUDIO.intensity,
      sfxVolume: DEFAULT_AUDIO.sfxVolume,
      musicPaths: [],
    },
    render: { ...DEFAULT_RENDER },
    pauses: { ...NO_PAUSES },
  };
}

function readPauses(value: unknown): Pauses {
  const o = isObject(value) ? value : {};
  const result: Pauses = { ...NO_PAUSES };
  for (const id of STAGE_IDS) result[id] = o[id] === true;
  return result;
}

/** Cleans an id so it is safe to keep: letters, digits, dash and underscore. */
export function cleanId(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60) : "";
  return text === "" ? fallback : text;
}

/** One profile from any JSON: every missing or damaged part is replaced by its default. */
export function readProfile(value: unknown, fallbackId = "channel"): ChannelProfile {
  const o = isObject(value) ? value : {};
  const base = defaultProfile(cleanId(o.id, fallbackId), str(o.name, MAX_NAME, "My channel") || "My channel");
  const scenes = isObject(o.scenes) ? o.scenes : {};
  const voice = isObject(o.voice) ? o.voice : {};
  const look = isObject(o.look) ? o.look : {};
  const audio = isObject(o.audio) ? o.audio : {};
  const readAudioPart = readAudio({ musicVolume: audio.musicVolume, ducking: audio.ducking, autoSfx: audio.autoSfx, graphicSfx: audio.graphicSfx, intensity: audio.intensity, sfxVolume: audio.sfxVolume });
  const paths = Array.isArray(audio.musicPaths) ? audio.musicPaths.filter((p): p is string => typeof p === "string" && p.trim() !== "" && p.length <= 1024).slice(0, MAX_MUSIC_FILES) : [];
  return {
    ...base,
    language: str(o.language, 12).toLowerCase().replace(/[^a-z-]/g, ""),
    aspect: pick(o.aspect, ASPECTS, base.aspect),
    quality: pick(o.quality, QUALITIES, base.quality),
    voice: {
      model: str(voice.model, 80),
      voice: str(voice.voice, 40),
      style: str(voice.style, 300),
      cutSilence: voice.cutSilence === undefined ? base.voice.cutSilence : voice.cutSilence === true,
    },
    scenes: {
      mode: pick(scenes.mode, MODES, base.scenes.mode),
      sentencesPerScene: Math.round(num(scenes.sentencesPerScene, 1, 4, base.scenes.sentencesPerScene)),
      targetSeconds: num(scenes.targetSeconds, 1, 60, base.scenes.targetSeconds),
      maxVideoSeconds: num(scenes.maxVideoSeconds, 2, 30, base.scenes.maxVideoSeconds),
      minSeconds: num(scenes.minSeconds, 0, 10, base.scenes.minSeconds ?? 2),
    },
    look: {
      styleId: str(look.styleId, 80),
      detail: pick(look.detail, DETAILS, base.look.detail),
      tool: pick(look.tool, TOOLS, base.look.tool),
      outputType: pick(look.outputType, OUTPUTS, base.look.outputType),
    },
    captions: readCaptions({ style: o.captions }).style,
    audio: {
      musicVolume: readAudioPart.musicVolume,
      ducking: readAudioPart.ducking,
      autoSfx: readAudioPart.autoSfx,
      graphicSfx: readAudioPart.graphicSfx,
      intensity: readAudioPart.intensity,
      sfxVolume: readAudioPart.sfxVolume,
      musicPaths: paths,
    },
    render: readRender(o.render),
    pauses: readPauses(o.pauses),
  };
}

/** All profiles from the settings: damaged ones are repaired, doubled ids get a number. */
export function readProfiles(values: readonly unknown[]): ChannelProfile[] {
  const seen = new Set<string>();
  const result: ChannelProfile[] = [];
  values.forEach((value, index) => {
    const profile = readProfile(value, `channel-${index + 1}`);
    let id = profile.id;
    let n = 2;
    while (seen.has(id)) {
      id = `${profile.id}-${n}`;
      n += 1;
    }
    seen.add(id);
    result.push(id === profile.id ? profile : { ...profile, id });
  });
  return result;
}

/** A new id that no other profile uses. */
export function newProfileId(existing: readonly ChannelProfile[], now: number = Date.now()): string {
  const used = new Set(existing.map((p) => p.id));
  let id = `channel-${now.toString(36)}`;
  let n = 2;
  while (used.has(id)) {
    id = `channel-${now.toString(36)}-${n}`;
    n += 1;
  }
  return id;
}

/** A copy with a new id and the name "<name> copy". */
export function duplicateProfile(profile: ChannelProfile, existing: readonly ChannelProfile[], now: number = Date.now()): ChannelProfile {
  return { ...profile, id: newProfileId(existing, now), name: `${profile.name} copy`.slice(0, MAX_NAME) };
}

/** What is saved in a profile file. */
export function exportProfile(profile: ChannelProfile): string {
  return JSON.stringify({ avProfile: PROFILE_VERSION, profile }, null, 2);
}

/** Reads a profile file. Returns null when the text is not a profile. The profile gets a new id. */
export function importProfile(text: string, existing: readonly ChannelProfile[], now: number = Date.now()): ChannelProfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.avProfile === undefined || !isObject(parsed.profile)) return null;
  const profile = readProfile(parsed.profile, "imported");
  return { ...profile, id: newProfileId(existing, now) };
}

/** What a new video needs from the profile: the choices that live in the project itself. */
export function profileToPatch(profile: ChannelProfile): ProjectPatch {
  return {
    language: profile.language,
    settings: { aspectRatio: profile.aspect, quality: profile.quality },
    sceneSettings: { ...profile.scenes },
    promptSettings: { outputType: profile.look.outputType, detail: profile.look.detail, tool: profile.look.tool },
    styleId: profile.look.styleId === "" ? null : profile.look.styleId,
  };
}

/** The editor choices of a profile (captions, audio, render) put on top of the editor data a project has. */
export function profileEditor(profile: ChannelProfile, current: { captions: { style: CaptionStyle; lines: unknown }; audio: AudioData; render: RenderData }): { captions: { style: CaptionStyle; lines: null }; audio: AudioData; render: RenderData } {
  const { musicPaths: _musicPaths, ...audio } = profile.audio;
  return {
    captions: { style: profile.captions, lines: null },
    audio: { ...current.audio, ...audio },
    render: profile.render,
  };
}

/** What stops a run before it starts, in plain words (empty = it can start). */
export function profileProblems(profile: ChannelProfile, input: { script: string; voiceFile: string | null }): string[] {
  const problems: string[] = [];
  if (profile.look.styleId === "") problems.push("Choose a picture style in the channel profile.");
  if (input.voiceFile === null && input.script.trim() === "") problems.push("Paste the script, or choose your own voice file.");
  return problems;
}
