import type { CaptionLine, CaptionPreset, SceneOverride, SfxCategory, SfxCue, SfxIntensity, SfxSound, TransitionMode } from "../../types/editor.ts";
import type { Location, Scene } from "../../types/project.ts";
import { effectiveTransition, isMoving } from "../editor/transitions.ts";
import { splitSentences } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";

/** No two sound effects closer than this (seconds). */
export const MIN_GAP = 0.8;
/** The start of a sentence is kept clear of loud effects for this long (seconds). */
export const SENTENCE_GUARD = 0.5;
export const RISER_LEAD = 1.5;
/** A loud effect inside a sentence start is turned down to at most this gain. */
export const GUARD_GAIN = 0.4;

export interface PlanInput {
  scenes: readonly Scene[];
  overrides: Readonly<Record<string, SceneOverride>>;
  locations: readonly Location[];
  words: readonly TimedWord[];
  captionLines: readonly CaptionLine[];
  captionPreset: CaptionPreset;
  intensity: SfxIntensity;
  transitionMode: TransitionMode;
  sounds: readonly SfxSound[];
}

const SCALE: Record<SfxIntensity, number> = { low: 0.6, normal: 0.85, high: 1 };
/** Lower number wins when two effects are too close. */
const PRIORITY: Record<string, number> = { hit: 0, riser: 1, whoosh: 2, pop: 3, ambience: 4 };

function byCategory(sounds: readonly SfxSound[], categories: readonly SfxCategory[]): SfxSound[] {
  return sounds.filter((s) => categories.includes(s.category));
}

/** Picks the n-th sound of a group (rotating, so effects do not repeat all the time). */
function rotate(group: readonly SfxSound[], n: number): SfxSound | null {
  return group.length === 0 ? null : (group[n % group.length] ?? null);
}

/** Maps a mood tag ("calm", "tense", "nature") to an ambience sound. */
export function ambienceFor(mood: string | undefined, sounds: readonly SfxSound[]): SfxSound | null {
  const wanted = (mood ?? "").trim().toLowerCase();
  if (wanted === "") return null;
  const group = byCategory(sounds, ["ambience"]);
  return group.find((s) => s.id === `ambience_${wanted}` || s.tags.includes(wanted)) ?? null;
}

interface Candidate {
  cue: Omit<SfxCue, "id">;
  priority: number;
}

/** Plans the sound effects from the rules of Phase 13. Pure: same input, same cues. */
export function planSfx(input: PlanInput): SfxCue[] {
  const { scenes, overrides, locations, words, captionLines, captionPreset, intensity, sounds } = input;
  const scale = SCALE[intensity];
  const found: Candidate[] = [];
  const counters: Record<string, number> = {};
  const add = (reason: SfxCue["reason"], categories: readonly SfxCategory[], time: number, gainFactor = 1) => {
    const n = counters[reason] ?? 0;
    const sound = rotate(byCategory(sounds, categories), n);
    if (!sound || time < 0) return;
    counters[reason] = n + 1;
    found.push({ priority: PRIORITY[reason] ?? 9, cue: { soundId: sound.id, time, gain: Math.min(1, sound.defaultGain * scale * gainFactor), reason } });
  };

  scenes.forEach((scene, i) => {
    const o = overrides[scene.id];
    if (i > 0) {
      const kind = effectiveTransition(o?.transition ?? "auto", scene.index, input.transitionMode);
      if (isMoving(kind)) add("whoosh", ["whoosh", "transition"], Math.max(0, scene.start - 0.1));
    }
    if (o?.emphasis) {
      add("hit", ["hit"], scene.start);
      if (intensity === "high") add("riser", ["riser"], Math.max(0, scene.start - RISER_LEAD));
    }
    const location = locations.find((l) => l.id === scene.locationId);
    const previous = scenes[i - 1];
    const sameAsBefore = previous !== undefined && previous.locationId === scene.locationId;
    if (location && location.mood && !sameAsBefore) {
      const sound = ambienceFor(location.mood, sounds);
      if (sound) found.push({ priority: PRIORITY.ambience ?? 9, cue: { soundId: sound.id, time: scene.start, gain: Math.min(1, sound.defaultGain * 0.5), reason: "ambience" } });
    }
  });

  if (captionPreset === "pop" && intensity !== "low") {
    for (const line of captionLines) add("pop", ["pop", "click"], line.start, 0.6);
  }

  // Keep the strongest effects first; ambience beds are long and ignore the gap rule.
  const beds = found.filter((c) => c.cue.reason === "ambience");
  const spot = found.filter((c) => c.cue.reason !== "ambience").sort((a, b) => a.priority - b.priority || a.cue.time - b.cue.time);
  const kept: Candidate[] = [];
  for (const c of spot) if (kept.every((k) => Math.abs(k.cue.time - c.cue.time) >= MIN_GAP)) kept.push(c);

  const sentences = splitSentences(words);
  const result = [...kept, ...beds].map((c) => c.cue).sort((a, b) => a.time - b.time);
  return result.map((cue, i) => {
    const guarded = cue.reason !== "ambience" && cue.reason !== "riser" && sentences.some((s) => cue.time >= s.start && cue.time < s.start + SENTENCE_GUARD);
    const gain = guarded ? Math.min(cue.gain, GUARD_GAIN) : cue.gain;
    return { ...cue, gain, id: `X${String(i + 1).padStart(3, "0")}` };
  });
}

/** A new id for a cue added by hand. */
export function nextCueId(cues: readonly SfxCue[]): string {
  let max = 0;
  for (const c of cues) {
    const n = /^X(\d+)$/.exec(c.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `X${String(max + 1).padStart(3, "0")}`;
}
