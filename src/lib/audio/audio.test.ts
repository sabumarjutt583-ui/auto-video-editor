import assert from "node:assert/strict";
import { test } from "node:test";

import type { CaptionLine, SceneOverride, SfxSound } from "../../types/editor.ts";
import type { Location, Scene } from "../../types/project.ts";
import { emptyScene } from "../scenes/assemble.ts";
import type { TimedWord } from "../timing/types.ts";
import { cueForScene, nextAddedId } from "./addCue.ts";
import { buildMixRequest, activeCues } from "./mixRequest.ts";
import { DEFAULT_AUDIO, readAudio } from "./read.ts";
import { MIN_GAP, planSfx, nextCueId, type PlanInput } from "./sfxPlan.ts";

const sound = (id: string, category: SfxSound["category"], tags: string[] = []): SfxSound => ({ id, file: `${id}.wav`, category, tags, duration: 1, defaultGain: 0.8 });
const SOUNDS = [sound("whoosh_a", "whoosh"), sound("hit_a", "hit"), sound("pop_a", "pop"), sound("riser_a", "riser"), sound("ambience_calm", "ambience", ["calm"])];
const override = (patch: Partial<SceneOverride>): SceneOverride => ({ kenBurns: "auto", videoFit: "crop", speed: 1, transition: "auto", emphasis: false, ...patch });

function scenes(starts: number[], total = 40): Scene[] {
  return starts.map((start, i) => ({ ...emptyScene(), id: `S${String(i + 1).padStart(2, "0")}`, index: i + 1, start, end: starts[i + 1] ?? total, duration: (starts[i + 1] ?? total) - start }));
}
function input(patch: Partial<PlanInput> = {}): PlanInput {
  return { scenes: scenes([0, 10, 20, 30]), overrides: {}, locations: [], words: [], captionLines: [], captionPreset: "highlight", intensity: "normal", transitionMode: "mixed", sounds: SOUNDS, ...patch };
}

test("whoosh goes to moving transitions only", () => {
  // "mixed": scene 2 dissolves, scene 3 is a cut, scene 4 slides
  const cues = planSfx(input());
  assert.deepEqual(cues.map((c) => c.reason), ["whoosh"]);
  assert.ok(Math.abs((cues[0]?.time ?? 0) - 29.9) < 1e-9);
  assert.equal(planSfx(input({ transitionMode: "cut" })).length, 0, "no transitions, no whoosh");
  assert.equal(planSfx(input({ transitionMode: "fade" })).length, 0, "cross-fades do not move the picture");
});

test("hit on emphasis, riser only at high", () => {
  const overrides = { S03: override({ emphasis: true, transition: "cut" }) };
  const normal = planSfx(input({ overrides }));
  assert.ok(normal.some((c) => c.reason === "hit" && c.time === 20));
  assert.ok(!normal.some((c) => c.reason === "riser"));
  const high = planSfx(input({ overrides, intensity: "high" }));
  assert.ok(high.some((c) => c.reason === "riser" && c.time === 18.5));
});

test("pop needs the pop caption preset and not low intensity", () => {
  const lines = [{ id: "L1", start: 3, end: 4, text: "a", words: [], breakAt: null }] as CaptionLine[];
  assert.ok(planSfx(input({ captionPreset: "pop", captionLines: lines })).some((c) => c.reason === "pop"));
  assert.ok(!planSfx(input({ captionPreset: "pop", captionLines: lines, intensity: "low" })).some((c) => c.reason === "pop"));
  assert.ok(!planSfx(input({ captionPreset: "highlight", captionLines: lines })).some((c) => c.reason === "pop"));
});

test("effects are never closer than 0.8 s, the stronger one stays", () => {
  const overrides = { S02: override({ emphasis: true, transition: "slide" }) };
  const cues = planSfx(input({ overrides })).filter((c) => c.reason !== "ambience");
  for (let i = 1; i < cues.length; i += 1) assert.ok((cues[i]?.time ?? 0) - (cues[i - 1]?.time ?? 0) >= MIN_GAP - 1e-9);
  assert.ok(cues.some((c) => c.reason === "hit" && c.time === 10));
  assert.ok(!cues.some((c) => c.reason === "whoosh" && c.time === 9.9));
});

test("ambience follows the location mood once per place", () => {
  const list = scenes([0, 10, 20]);
  const withLoc = list.map((s) => ({ ...s, locationId: "L1" }));
  const locations: Location[] = [{ id: "L1", name: "Forest", description: "", mood: "calm" }];
  const cues = planSfx(input({ scenes: withLoc, locations })).filter((c) => c.reason === "ambience");
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.soundId, "ambience_calm");
});

test("loud effects are turned down at the start of a sentence", () => {
  const words: TimedWord[] = [
    { text: "Hello.", start: 0, end: 1 },
    { text: "Next", start: 9.6, end: 10.3 },
    { text: "one.", start: 10.3, end: 11 },
  ];
  const cue = planSfx(input({ words, intensity: "high", overrides: { S02: override({ transition: "slide" }) } })).find((c) => c.reason === "whoosh");
  assert.ok(cue && cue.gain <= 0.4);
});

test("planning is repeatable and ids are unique", () => {
  const a = planSfx(input({ intensity: "high" }));
  assert.deepEqual(a, planSfx(input({ intensity: "high" })));
  assert.equal(new Set(a.map((c) => c.id)).size, a.length);
  assert.equal(nextCueId(a), `X${String(a.length + 1).padStart(3, "0")}`);
});

test("readAudio repairs damaged data", () => {
  assert.deepEqual(readAudio(null), DEFAULT_AUDIO);
  const a = readAudio({ musicVolume: 500, ducking: "wild", tracks: [{ path: "music/a.mp3", name: "a", duration: 10 }, { bad: 1 }], cues: [{ soundId: "x", time: -1 }, { soundId: "y", time: 2, gain: 3 }] });
  assert.equal(a.musicVolume, 100);
  assert.equal(a.ducking, "normal");
  assert.equal(a.tracks.length, 1);
  assert.deepEqual(a.cues?.map((c) => [c.soundId, c.gain]), [["y", 1]]);
});

test("mix request scales volumes and drops cues past the end", () => {
  const audio = { ...DEFAULT_AUDIO, musicVolume: 30, sfxVolume: 50 };
  const cues = [
    { id: "X001", soundId: "a", time: 1, gain: 0.8, reason: "hit" as const },
    { id: "X002", soundId: "b", time: 99, gain: 0.8, reason: "hit" as const },
  ];
  const r = buildMixRequest(audio, "voice.wav", 10, cues);
  assert.equal(r.music.volume, 0.3);
  assert.deepEqual(r.sfx, [{ soundId: "a", time: 1, gain: 0.4 }]);
  assert.deepEqual(activeCues({ ...audio, autoSfx: false }, cues), []);
  assert.equal(activeCues({ ...audio, cues: [] }, cues).length, 0);
});

test("music segments loop to the end or play once", async () => {
  const { musicSegments } = await import("./segments.ts");
  const tracks = [{ id: "m1", path: "music/a.mp3", name: "a", duration: 10 }, { id: "m2", path: "music/b.mp3", name: "b", duration: 5 }];
  const loop = musicSegments(tracks, 40, "loop");
  assert.equal(loop.at(-1)?.end, 40);
  assert.deepEqual(loop.slice(0, 3).map((s) => [s.trackId, s.start, s.end]), [["m1", 0, 10], ["m2", 10, 15], ["m1", 15, 25]]);
  const once = musicSegments(tracks, 40, "fade");
  assert.equal(once.length, 2);
  assert.equal(once.at(-1)?.end, 15);
  assert.deepEqual(musicSegments(tracks, 12, "loop").map((s) => s.end), [10, 12]);
  assert.deepEqual(musicSegments([], 10, "loop"), []);
});

test("a sound added from the library joins the planned ones and survives re-reading", () => {
  const planned = [{ id: "X001", soundId: "whoosh_a", time: 5, gain: 0.5, reason: "whoosh" as const }];
  const scene = { ...emptyScene(), start: 2 };
  const added = cueForScene(scene, SOUNDS[1] as SfxSound, [], 40);
  assert.equal(added.id, "A001");
  assert.equal(added.time, 2);
  const audio = readAudio({ addedCues: [added] });
  assert.deepEqual(activeCues(audio, planned).map((c) => c.id), ["A001", "X001"]);
  assert.deepEqual(activeCues({ ...audio, autoSfx: false }, planned).map((c) => c.id), ["A001"], "automatic effects off: only the added one");
  assert.deepEqual(activeCues({ ...audio, cues: [] }, planned), [], "an edited list wins");
  assert.equal(nextAddedId([added]), "A002");
  assert.equal(cueForScene({ start: 99 }, { id: "x", defaultGain: 2 }, [], 40).time, 40, "never after the end of the voice");
  assert.equal(cueForScene({ start: 1 }, { id: "x", defaultGain: 2 }, [], 40).gain, 1);
  assert.deepEqual(readAudio({ addedCues: "bad" }).addedCues, []);
});
