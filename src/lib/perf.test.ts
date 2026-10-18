// Performance check for the biggest expected project: a 20-minute voice-over with about 200 scenes.
// All the pure logic of the app (timing, scenes, prompts, timeline, render request) must stay fast,
// so the screen never freezes. The limits are generous: they catch a slow algorithm, not a slow computer.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Project, Scene, SceneSettings } from "../types/project.ts";
import { readEditor } from "./editor/model.ts";
import { effectiveTransition } from "./editor/transitions.ts";
import { generatePrompts, type PromptContext } from "./prompts/generate.ts";
import { toCsv } from "./prompts/export.ts";
import { buildRenderScenes } from "./render/request.ts";
import { buildBySeconds } from "./scenes/build.ts";
import { splitWords } from "./text.ts";
import { blankStyle } from "./styleModel.ts";
import { alignScript } from "./timing/align.ts";
import { parseSrt } from "./timing/subtitles.ts";
import type { TimedWord } from "./timing/types.ts";

const VOICE_SECONDS = 20 * 60;
const SENTENCES = 260;

/** About 3,000 words in 260 sentences, like a 20-minute narration. */
function makeScript(): string {
  const vocab = ["river", "mountain", "grandmother", "lantern", "winter", "harbour", "whisper", "journey", "bridge", "silver", "morning", "village", "shadow", "garden", "story", "window"];
  const sentences: string[] = [];
  for (let s = 0; s < SENTENCES; s += 1) {
    const count = 8 + (s % 9);
    const words = Array.from({ length: count }, (_, i) => vocab[(s * 7 + i * 3) % vocab.length] ?? "word");
    const text = words.join(" ");
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}${s % 5 === 4 ? "!" : "."}`);
  }
  return sentences.join(" ");
}

function srtOf(script: string): string {
  const sentences = script.split(/(?<=[.!?])\s+/);
  const per = VOICE_SECONDS / sentences.length;
  const stamp = (t: number) => {
    const ms = Math.round(t * 1000);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return sentences.map((text, i) => `${i + 1}\n${stamp(i * per)} --> ${stamp((i + 1) * per - 0.1)}\n${text}\n`).join("\n");
}

function timed<T>(label: string, limitMs: number, work: () => T): T {
  const start = performance.now();
  const result = work();
  const took = performance.now() - start;
  console.log(`perf: ${label}: ${took.toFixed(0)} ms`);
  assert.ok(took < limitMs, `${label} took ${took.toFixed(0)} ms (limit ${limitMs} ms)`);
  return result;
}

test("a 20-minute voice-over with about 200 scenes is processed quickly", async () => {
  const script = makeScript();
  assert.ok(splitWords(script).length > 2500);

  const parsed = timed("read the SRT timing file", 1500, () => parseSrt(srtOf(script)));
  const speech: TimedWord[] = parsed.words;
  const aligned = timed("line the script up with the speech (3,000 words)", 3000, () => alignScript(script, speech));
  assert.ok(aligned.words.length > 2500);

  const settings: SceneSettings = { mode: "seconds", sentencesPerScene: 1, targetSeconds: 4, maxVideoSeconds: 8 };
  const scenes: Scene[] = timed("build the scenes", 1500, () => buildBySeconds({ words: aligned.words, voiceDuration: VOICE_SECONDS, settings }));
  assert.ok(scenes.length >= 150 && scenes.length <= 260, `got ${scenes.length} scenes`);
  const sum = scenes.reduce((total, scene) => total + scene.duration, 0);
  assert.ok(Math.abs(sum - VOICE_SECONDS) < 1e-6, "the scenes cover the whole voice-over");

  // Prompts: ten requests of 20 scenes each, with a fake AI that answers instantly.
  let calls = 0;
  const call = async (_system: string, prompt: string): Promise<string> => {
    calls += 1;
    const ids = [...prompt.matchAll(/^(S\d+[a-z]?) \|/gm)].map((m) => m[1]);
    return JSON.stringify(ids.map((id) => ({ id, scene: `Wide shot for ${id}`, motion: "Slow push-in" })));
  };
  const context: PromptContext = {
    style: { ...blankStyle(), id: "x", name: "X", category: "t", style_lock: "film still" },
    characters: [],
    locations: [],
    settings: { outputType: "image", detail: "medium", tool: "generic" },
    aspect: "16:9",
  };
  const start = performance.now();
  const result = await generatePrompts({ scenes, targetIds: new Set(scenes.map((s) => s.id)), context, call });
  console.log(`perf: write prompts for ${scenes.length} scenes in ${calls} batches: ${(performance.now() - start).toFixed(0)} ms`);
  assert.equal(result.failed, null);
  assert.equal(calls, Math.ceil(scenes.length / 20));
  assert.ok(result.scenes.every((s) => s.prompt !== ""));
  timed("export the prompts as CSV", 500, () => toCsv(result.scenes));

  const editor = readEditor({ editor: null } as unknown as Pick<Project, "editor">);
  const renderScenes = timed("plan the render (all scenes)", 500, () => buildRenderScenes(result.scenes, editor, { mediaMap: {} }, {}));
  assert.equal(renderScenes.length, scenes.length);
  timed("transitions for every scene", 200, () => result.scenes.map((s, i) => effectiveTransition("auto", s.index, i % 2 === 0 ? "mixed" : "fade")));
});
