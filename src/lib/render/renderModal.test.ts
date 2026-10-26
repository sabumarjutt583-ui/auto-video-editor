import assert from "node:assert/strict";
import { test } from "node:test";

import { outputSize } from "../editor/size.ts";
import { buildRenderRequest, renderProblems, selectBestEncoder, shortsAspect, type RenderInput } from "./request.ts";
import { readEditor } from "../editor/model.ts";
import { emptyScene } from "../scenes/assemble.ts";
import type { Project } from "../../types/project.ts";
import type { Scene } from "../../types/project.ts";

// Logic-level tests only: RenderModal itself is a React component and is
// not rendered here (no DOM harness in this repo). Every function tested
// below is the exact function the modal / useRender hook calls, so a
// change to the modal's behaviour that goes through these functions is
// caught here. Button rendering, clicks and the modal layout are NOT
// covered by this file.

function scene(index: number, start: number, end: number): Scene {
  return { ...emptyScene(), id: `S${String(index).padStart(2, "0")}`, index, start, end, duration: end - start };
}

const SCENES = [scene(1, 0, 5), scene(2, 5, 10)];

function projectWith(aspect: "16:9" | "9:16" | "1:1", quality: "720p" | "1080p" | "4K"): Project {
  return {
    name: "Test",
    voiceDuration: 10,
    voicePath: "audio/voice.wav",
    scenes: SCENES,
    settings: { aspectRatio: aspect, quality },
    mediaMap: {},
  } as unknown as Project;
}

test("outputSize: every aspect x quality shown in RenderModal", () => {
  assert.deepEqual(outputSize("16:9", "720p"), { width: 1280, height: 720 });
  assert.deepEqual(outputSize("16:9", "1080p"), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize("16:9", "4K"), { width: 3840, height: 2160 });
  assert.deepEqual(outputSize("9:16", "720p"), { width: 720, height: 1280 });
  assert.deepEqual(outputSize("9:16", "1080p"), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize("9:16", "4K"), { width: 2160, height: 3840 });
  assert.deepEqual(outputSize("1:1", "720p"), { width: 720, height: 720 });
  assert.deepEqual(outputSize("1:1", "1080p"), { width: 1080, height: 1080 });
  assert.deepEqual(outputSize("1:1", "4K"), { width: 2160, height: 2160 });
});

test("renderProblems: one problem at a time, not just both-or-none", () => {
  assert.deepEqual(renderProblems({ voicePath: null, voiceDuration: 10, scenes: SCENES }), [
    "Add a voice-over first (Prompt Generator, step 1).",
  ]);
  assert.deepEqual(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 0, scenes: SCENES }), [
    "Add a voice-over first (Prompt Generator, step 1).",
  ]);
  assert.deepEqual(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 10, scenes: [] }), [
    "There are no scenes yet. Build them in the Prompt Generator.",
  ]);
  assert.deepEqual(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 10, scenes: SCENES }), []);
});

test("RenderModal buttons are disabled exactly when renderProblems is non-empty", () => {
  // The modal does: disabled={view.problems.length > 0} on both buttons.
  // This test pins the rule at the logic level: any non-empty problem list
  // disables, an empty list enables.
  const canStart = (problems: readonly string[]): boolean => problems.length === 0;
  assert.equal(canStart(renderProblems({ voicePath: null, voiceDuration: 0, scenes: [] })), false);
  assert.equal(canStart(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 10, scenes: [] })), false);
  assert.equal(canStart(renderProblems({ voicePath: "audio/voice.wav", voiceDuration: 10, scenes: SCENES })), true);
});

test("shortsAspect: Shorts is always 9:16 with suffix 'shorts', normal keeps the project aspect", () => {
  assert.deepEqual(shortsAspect("16:9", true), { aspect: "9:16", suffix: "shorts" });
  assert.deepEqual(shortsAspect("1:1", true), { aspect: "9:16", suffix: "shorts" });
  assert.deepEqual(shortsAspect("9:16", true), { aspect: "9:16", suffix: "shorts" });
  assert.deepEqual(shortsAspect("16:9", false), { aspect: "16:9", suffix: null });
  assert.deepEqual(shortsAspect("1:1", false), { aspect: "1:1", suffix: null });
});

test("buildRenderRequest: a Shorts request differs from a normal request in size, label and suffix", () => {
  const editor = readEditor({ editor: {} } as never);
  const base: Omit<RenderInput, "project" | "aspect" | "quality" | "suffix"> = {
    editor,
    exists: {},
    captionLines: [],
    captionStyle: { preset: "none", font: "auto", fontSize: 5, primary: "#ffffff", highlight: "#ffff00", outline: 2, shadow: 2, position: "bottom", uppercase: false },
    font: { id: "noto_sans", family: "Noto Sans", label: "Noto Sans", regular: "x", bold: "y" },
    cues: [],
    date: "2026-10-26",
  };
  const normal = buildRenderRequest({ ...base, project: projectWith("16:9", "1080p"), aspect: "16:9", quality: "1080p", suffix: null });
  const shorts = buildRenderRequest({ ...base, project: projectWith("16:9", "1080p"), aspect: "9:16", quality: "1080p", suffix: "shorts" });
  assert.equal(normal.width, 1920);
  assert.equal(normal.height, 1080);
  assert.equal(normal.aspectLabel, "16x9");
  assert.equal(normal.suffix, null);
  assert.equal(shorts.width, 1080);
  assert.equal(shorts.height, 1920);
  assert.equal(shorts.aspectLabel, "9x16");
  assert.equal(shorts.suffix, "shorts");
  assert.equal(shorts.fps, normal.fps);
});

test("selectBestEncoder: the exact encoder line from RenderModal", () => {
  const gpu = { id: "gpu", label: "GPU", gpu: true };
  const cpu = { id: "cpu", label: "CPU", gpu: false };
  assert.equal(selectBestEncoder(null, false), null);
  assert.equal(selectBestEncoder([], false), null);
  assert.equal(selectBestEncoder([cpu, gpu], false), gpu);
  assert.equal(selectBestEncoder([gpu, cpu], false), gpu);
  assert.equal(selectBestEncoder([cpu], false), cpu);
  assert.equal(selectBestEncoder([cpu, gpu], true), cpu);
  assert.equal(selectBestEncoder([gpu], true), null);
  assert.equal(selectBestEncoder([gpu], false), gpu);
});
