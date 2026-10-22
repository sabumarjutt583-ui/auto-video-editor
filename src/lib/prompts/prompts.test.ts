import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../scenes/assemble.ts";
import { blankStyle } from "../styleModel.ts";
import type { Character, Location, PromptSettings, Scene } from "../../types/project.ts";
import type { StyleProfile } from "../../types/style.ts";
import { assemblePrompt, finishMotion, needsMotion } from "./assemble.ts";
import { planBatches, storySoFar } from "./batches.ts";
import { clampEmptyLines, copyBlock, copyLines, csvField, timecodeOf, toCsv, toJson } from "./export.ts";
import { generatePrompts, reassemble, type PromptContext } from "./generate.ts";
import { buildBatchPrompt, buildSystemInstruction, parseBatch } from "./gemini.ts";
import { positiveNegatives, shortNegativeLine, splitNegatives } from "./negatives.ts";

const STYLE: StyleProfile = {
  ...blankStyle(),
  id: "cinematic_realism",
  name: "Cinematic Realism",
  category: "Cinematic & Film",
  core_identity: "CORE",
  medium: "MEDIUM",
  lighting: "LIGHTING",
  color_palette: "PALETTE",
  camera: "CAMERA",
  composition: "COMPOSITION",
  texture: "TEXTURE",
  characters: "CHARS",
  mood: "MOOD",
  negative: "cartoon, blurry, extra fingers, text, watermark, odd thing",
  motion_rules: "slow moves only",
  style_lock: "cinematic realism, film still, soft light",
  example_prompt: "EXAMPLE",
};

const MINA: Character = { id: "c1", name: "Mina", role: "girl", appearance: "An 8-year-old girl with a short black bob and a yellow raincoat." };
const GRAN: Character = { id: "c2", name: "Grandmother", role: "elder", appearance: "A 72-year-old woman with grey hair in a bun, deep smile lines." };
const VILLAGE: Location = { id: "l1", name: "Village", description: "A grey-stone harbour village at dawn." };

function scene(n: number, extra: Partial<Scene> = {}): Scene {
  return { ...emptyScene(), id: `S${String(n).padStart(2, "0")}`, index: n, start: (n - 1) * 5, end: n * 5, duration: 5, text: `Narration number ${n}. It goes on.`, ...extra };
}

const SETTINGS: PromptSettings = { outputType: "image", detail: "medium", tool: "generic" };

function context(tool: PromptSettings["tool"] = "generic", outputType: PromptSettings["outputType"] = "image"): PromptContext {
  return { style: STYLE, characters: [MINA, GRAN], locations: [VILLAGE], settings: { ...SETTINGS, tool, outputType }, aspect: "16:9" };
}

test("negatives are split, deduplicated and turned into positive phrases", () => {
  assert.deepEqual(splitNegatives("a, b ; A\n c,, "), ["a", "b", "c"]);
  const positive = positiveNegatives(["text", "watermark", "blurry", "odd thing", "extra fingers"]);
  assert.match(positive, /no text, letters or logos/);
  assert.match(positive, /sharp focus/);
  assert.match(positive, /anatomically correct/);
  assert.match(positive, /free of odd thing/);
  assert.equal((positive.match(/no text, letters or logos/g) ?? []).length, 1);
  assert.equal(shortNegativeLine(["a", "b", "c", "d", "e", "f", "g"]), "Avoid: a, b, c, d, e, f.");
  assert.equal(positiveNegatives([]), "");
});

test("layer 3 puts the exact character text, the location and the style lock into the prompt, lock last", () => {
  for (const tool of ["generic", "stable_diffusion", "flux", "dalle_gemini", "video"] as const) {
    const { prompt } = assemblePrompt({ description: "She walks to the pier", characters: [MINA, GRAN], location: VILLAGE, style: STYLE, aspect: "16:9", tool });
    assert.ok(prompt.includes(MINA.appearance), `${tool}: Mina's text must be exact`);
    assert.ok(prompt.includes(GRAN.appearance));
    assert.ok(prompt.includes(VILLAGE.description));
    assert.ok(prompt.endsWith(STYLE.style_lock), `${tool}: style lock must be last: ${prompt}`);
    assert.ok(prompt.startsWith("She walks to the pier."));
  }
});

test("per tool negatives and aspect ratio", () => {
  const input = { description: "A scene", characters: [], location: null, style: STYLE, aspect: "9:16" as const };
  const mj = assemblePrompt({ ...input, tool: "midjourney" });
  assert.ok(mj.prompt.includes("--ar 9:16"));
  assert.ok(mj.prompt.includes("--no cartoon, blurry"));
  assert.ok(mj.prompt.replace(/ --ar.*$/, "").endsWith(STYLE.style_lock));
  const sd = assemblePrompt({ ...input, tool: "stable_diffusion" });
  assert.equal(sd.negative, "cartoon, blurry, extra fingers, text, watermark, odd thing");
  assert.ok(!sd.prompt.includes("--no") && !sd.prompt.toLowerCase().includes("blurry,"));
  const flux = assemblePrompt({ ...input, tool: "flux" });
  assert.equal(flux.negative, "");
  assert.ok(flux.prompt.includes("sharp focus"));
  assert.ok(!flux.prompt.includes("extra fingers"));
  const video = assemblePrompt({ ...input, tool: "video" });
  assert.match(video.negative, /^Avoid: /);
  assert.ok(video.prompt.includes("Aspect ratio 9:16"));
});

test("a scene without characters or location still gets description and style", () => {
  const { prompt } = assemblePrompt({ description: "Empty beach", characters: [], location: null, style: STYLE, aspect: "1:1", tool: "generic" });
  assert.equal(prompt, `Empty beach. Aspect ratio 1:1. ${STYLE.style_lock}`);
});

test("motion gets a duration and only where it is needed", () => {
  assert.equal(finishMotion("Slow push-in on the girl", 5.4), "Slow push-in on the girl. Duration: 5 seconds.");
  assert.equal(finishMotion("Slow push-in, 6 seconds", 5), "Slow push-in, 6 seconds");
  assert.equal(finishMotion("", 5), "");
  assert.equal(needsMotion({ mediaType: "image" }, "image"), false);
  assert.equal(needsMotion({ mediaType: "video" }, "image"), true);
  assert.equal(needsMotion({ mediaType: "image" }, "image_motion"), true);
  assert.equal(needsMotion({ mediaType: "image" }, "video"), true);
});

test("layer 1 contains every style field, the bible and the rules", () => {
  const system = buildSystemInstruction({ style: STYLE, characters: [MINA], locations: [VILLAGE], detail: "detailed", outputType: "video", aspect: "16:9" });
  for (const part of ["CORE", "MEDIUM", "LIGHTING", "PALETTE", "CAMERA", "COMPOSITION", "TEXTURE", "CHARS", "MOOD", "cartoon, blurry", "slow moves only", STYLE.style_lock, "EXAMPLE", MINA.appearance, VILLAGE.description]) {
    assert.ok(system.includes(part), `missing ${part}`);
  }
  assert.match(system, /about 120 words/);
  assert.match(system, /Do NOT describe how characters look/);
  assert.match(system, /exactly the scene IDs/);
  assert.match(system, /No text, letters, numbers/);
  assert.match(system, /No brand, artist or studio names/);
  assert.match(system, /"motion"/);
});

test("layer 2 lists the scenes with cast and place", () => {
  const batch = [{ scene: scene(1, { mediaType: "video" }), characters: [MINA], location: VILLAGE }];
  const prompt = buildBatchPrompt(batch, "It began.", "image");
  assert.match(prompt, /Story so far: It began\./);
  assert.match(prompt, /S01 \| 5\.0 s \| video\/motion \| cast: Mina \| place: Village \| narration: Narration number 1/);
});

test("the AI answer must contain exactly the wanted ids in order", () => {
  const ids = ["S01", "S02"];
  const ok = '[{"id":"S01","scene":"a","motion":"m"},{"id":"S02","scene":"b"}]';
  assert.deepEqual(parseBatch(ok, ids)?.map((d) => d.scene), ["a", "b"]);
  assert.equal(parseBatch("```json\n" + ok + "\n```", ids)?.length, 2);
  assert.equal(parseBatch('[{"id":"S02","scene":"b"},{"id":"S01","scene":"a"}]', ids), null, "wrong order");
  assert.equal(parseBatch('[{"id":"S01","scene":"a"}]', ids), null, "missing scene");
  assert.equal(parseBatch('[{"id":"S01","scene":""},{"id":"S02","scene":"b"}]', ids), null, "empty description");
  assert.equal(parseBatch("nope", ids), null);
});

test("batches of 20 and a short story summary", () => {
  const batches = planBatches(Array.from({ length: 45 }, (_, i) => i));
  assert.deepEqual(batches.map((b) => b.length), [20, 20, 5]);
  assert.equal(planBatches([]).length, 0);
  assert.equal(storySoFar([]), "This is the beginning of the story.");
  const many = Array.from({ length: 10 }, (_, i) => scene(i + 1));
  const summary = storySoFar(many);
  assert.equal(summary, "Narration number 1. Narration number 10. It goes on.");
});

function fakeAi(failTimes = 0, bad = 0) {
  const log = { calls: 0 };
  const call = async (_system: string, prompt: string): Promise<string> => {
    log.calls += 1;
    if (log.calls <= failTimes) throw new Error("network down");
    if (log.calls <= failTimes + bad) return "this is not json";
    const ids = [...prompt.matchAll(/^(S\d+[a-z]?) \|/gm)].map((m) => m[1]);
    return JSON.stringify(ids.map((id) => ({ id, scene: `Wide shot for ${id} with Mina`, motion: "Slow push-in" })));
  };
  return { call, log };
}

test("generation fills every scene, in batches, with identical character text everywhere", async () => {
  const scenes = Array.from({ length: 45 }, (_, i) => scene(i + 1, { characterIds: i % 2 === 0 ? ["c1"] : ["c1", "c2"], locationId: "l1" }));
  const ai = fakeAi();
  const progress: string[] = [];
  const result = await generatePrompts({ scenes, targetIds: new Set(scenes.map((s) => s.id)), context: context("generic", "image_motion"), call: ai.call, onBatch: (n, t) => progress.push(`${n}/${t}`) });
  assert.equal(result.failed, null);
  assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
  assert.equal(ai.log.calls, 3);
  for (const s of result.scenes) {
    assert.ok(s.prompt.endsWith(STYLE.style_lock));
    assert.ok(s.prompt.includes(MINA.appearance), "Mina's description must be identical everywhere");
    assert.ok(s.motionPrompt.endsWith("Duration: 5 seconds."));
    assert.equal(s.status, "prompt_ready");
    assert.equal(s.edited, false);
  }
  const withGran = result.scenes.filter((s) => s.characterIds.includes("c2"));
  assert.ok(withGran.every((s) => s.prompt.includes(GRAN.appearance)));
  assert.ok(result.scenes.filter((s) => !s.characterIds.includes("c2")).every((s) => !s.prompt.includes(GRAN.appearance)));
});

test("a failing batch is retried twice, then reported with earlier batches kept", async () => {
  const scenes = Array.from({ length: 3 }, (_, i) => scene(i + 1));
  const recovered = fakeAi(1, 1);
  const ok = await generatePrompts({ scenes, targetIds: new Set(scenes.map((s) => s.id)), context: context(), call: recovered.call });
  assert.equal(ok.failed, null, "one network error and one bad answer are survived");
  assert.equal(recovered.log.calls, 3);

  const broken = fakeAi(99);
  const failed = await generatePrompts({ scenes, targetIds: new Set(scenes.map((s) => s.id)), context: context(), call: broken.call });
  assert.equal(failed.failed?.batch, 1);
  assert.equal(broken.log.calls, 3);
  assert.ok(failed.scenes.every((s) => s.prompt === ""));
});

test("only the chosen scenes are written; the rest are untouched", async () => {
  const scenes = [scene(1, { prompt: "old", description: "old", edited: true }), scene(2), scene(3)];
  const ai = fakeAi();
  const result = await generatePrompts({ scenes, targetIds: new Set(["S02", "S03"]), context: context(), call: ai.call });
  assert.equal(result.scenes[0]?.prompt, "old");
  assert.ok(result.scenes[1]?.prompt.includes("Wide shot for S02"));
});

test("cancelling stops at once", async () => {
  const scenes = [scene(1)];
  await assert.rejects(
    generatePrompts({ scenes, targetIds: new Set(["S01"]), context: context(), call: async () => { throw { message: "x", details: "y", code: "cancelled" }; } }),
    (error: { code?: string }) => error.code === "cancelled",
  );
});

test("changing tool or aspect rebuilds prompts without the AI and keeps edited rows", () => {
  const written = [scene(1, { description: "Scene one", characterIds: ["c1"] }), scene(2, { description: "Scene two", edited: true, prompt: "my own words" }), scene(3)];
  const rebuilt = reassemble(written, { ...context("midjourney"), aspect: "9:16" });
  assert.ok(rebuilt[0]?.prompt.includes("--ar 9:16"));
  assert.equal(rebuilt[1]?.prompt, "my own words");
  assert.equal(rebuilt[2]?.prompt, "", "scenes without a description stay empty");
});

test("copy all, CSV and JSON exports", () => {
  const scenes = [
    scene(1, { prompt: "First prompt", motionPrompt: "Slow push-in" }),
    scene(2, { prompt: 'Has "quotes", commas\nand a line break', text: "한국어, 日本語" }),
    scene(3),
  ];
  assert.equal(copyLines(scenes, false), 'S01_000.0-005.0 | First prompt\nS02_005.0-010.0 | Has "quotes", commas and a line break');
  assert.equal(copyLines(scenes, true).split("\n")[1], "MOTION: Slow push-in");
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('a,"b"'), '"a,""b"""');
  const csv = toCsv(scenes);
  assert.ok(csv.startsWith("﻿id,start,end,duration,text,prompt,motion,negative\r\n"));
  assert.ok(csv.includes('"한국어, 日本語"'));
  assert.ok(csv.includes('"Has ""quotes"", commas\nand a line break"'));
  const json = JSON.parse(toJson(scenes)) as { id: string; prompt: string; motion: string }[];
  assert.equal(json.length, 3);
  assert.equal(json[0]?.id, "S01_000.0-005.0");
  assert.equal(json[0]?.motion, "Slow push-in");
});

test("copy all puts 1, 2 or 3 empty lines after every prompt and none at the end", () => {
  const scenes = [scene(1, { prompt: "first" }), scene(2, { prompt: "second" }), scene(3, { prompt: "  " }), scene(4, { prompt: "third" })];
  const base = { withMotion: false, includeIds: true };
  assert.equal(copyLines(scenes, { ...base, emptyLines: 2 }), "S01_000.0-005.0 | first\n\n\nS02_005.0-010.0 | second\n\n\nS04_015.0-020.0 | third");
  assert.equal(copyLines(scenes, { ...base, emptyLines: 1 }), "S01_000.0-005.0 | first\n\nS02_005.0-010.0 | second\n\nS04_015.0-020.0 | third");
  assert.equal(copyLines(scenes, { ...base, emptyLines: 3 }).split("\n").length, 9, "3 prompts, 3 empty lines between each pair");
  assert.ok(!copyLines(scenes, { ...base, emptyLines: 3 }).endsWith("\n"));
  assert.equal(copyLines([], { ...base, emptyLines: 2 }), "");
});

test("Include IDs off copies only the prompt text, still separated", () => {
  const scenes = [scene(1, { prompt: "first" }), scene(2, { prompt: "second" })];
  assert.equal(copyLines(scenes, { withMotion: false, emptyLines: 2, includeIds: false }), "first\n\n\nsecond");
});

test("the MOTION line stays directly under its prompt and the empty lines come after the pair", () => {
  const scenes = [scene(1, { prompt: "image one", motionPrompt: "push in" }), scene(2, { prompt: "image two", motionPrompt: "pan left" })];
  assert.equal(copyLines(scenes, { withMotion: true, emptyLines: 2, includeIds: true }), "S01_000.0-005.0 | image one\nMOTION: push in\n\n\nS02_005.0-010.0 | image two\nMOTION: pan left");
  assert.equal(copyLines(scenes, { withMotion: false, emptyLines: 2, includeIds: true }).includes("MOTION"), false);
});

test("quick prompts without timing use P ids, and a single row copy has no extra lines", () => {
  const quick = { ...scene(1, { prompt: "a cat", motionPrompt: "slow zoom" }), id: "P01", start: 0, end: 0, duration: 0 };
  assert.equal(timecodeOf(quick), "P01");
  assert.equal(copyBlock(quick, true), "P01 | a cat\nMOTION: slow zoom");
  assert.equal(copyBlock(quick, false), "P01 | a cat");
  assert.equal(copyBlock(quick, true, false), "a cat\nMOTION: slow zoom");
  assert.equal(copyLines([quick, { ...quick, id: "P02", prompt: "a dog", motionPrompt: "" }], { withMotion: true, emptyLines: 2, includeIds: true }), "P01 | a cat\nMOTION: slow zoom\n\n\nP02 | a dog");
});

test("the empty-line setting stays between 1 and 3", () => {
  assert.deepEqual([0, 1, 2, 3, 9, Number.NaN].map(clampEmptyLines), [1, 1, 2, 3, 3, 2]);
});
