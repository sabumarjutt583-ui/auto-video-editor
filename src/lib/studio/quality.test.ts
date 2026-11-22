import assert from "node:assert/strict";
import test from "node:test";
import { checkStudioQuality } from "./quality.ts";
import { appendStudioMedia } from "./mediaTimeline.ts";
import type { Project } from "../../types/project.ts";
import type { MediaFile } from "../../types/editor.ts";

function project(): Project {
  const media: MediaFile[] = [
    { name: "one.mp4", path: "media/one.mp4", kind: "video", duration: 6,
      width: 1920, height: 1080, modified: 1, sceneId: null, start: null, end: null, how: null, confidence: null },
  ];
  const base = { id: "quality", name: "Quality", scriptSource: "video_studio",
    voicePath: null, scenes: [], words: [], voiceDuration: 0, mediaMap: {},
    editor: { media } } as unknown as Project;
  return { ...base, ...appendStudioMedia(base, 5)! };
}

test("quality checker reports missing source on real timeline and does not alter data", () => {
  const p = project();
  const before = JSON.stringify(p);
  const issues = checkStudioQuality(p, { "media/one.mp4": false });
  assert.equal(issues[0]?.severity, "error");
  assert.match(issues[0]!.message, /Missing source/);
  assert.equal(JSON.stringify(p), before);
});

test("quality checker diagnoses in-point exceeding video duration and gaps", () => {
  const p = project();
  const broken = { ...p, voiceDuration: 10, scenes: p.scenes.map((s) => ({ ...s, start: 1, end: 7 })),
    editor: { ...p.editor, studioSourceIn: { S01: 8 } } };
  const issues = checkStudioQuality(broken);
  assert.ok(issues.some((i) => i.message.includes("gaps/overlaps")));
  assert.ok(issues.some((i) => i.message.includes("outside the source")));
  assert.ok(issues.some((i) => i.message.includes("render duration")));
});

test("quality checker distinguishes informative silent output from blocking errors", () => {
  const p = project();
  const issues = checkStudioQuality(p, { "media/one.mp4": true });
  assert.equal(issues.filter((i) => i.severity === "error").length, 0);
  assert.ok(issues.some((i) => i.severity === "info" && i.message.includes("No voiceover")));
});
