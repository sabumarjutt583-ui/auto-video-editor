import assert from "node:assert/strict";
import test from "node:test";

import { appendStudioMedia } from "./mediaTimeline.ts";
import { editStudioTimeline, preserveStudioMediaMap } from "./edit.ts";
import { readEditor } from "../editor/model.ts";
import { invalidateProject } from "../pipeline/invalidate.ts";
import type { Project } from "../../types/project.ts";
import type { MediaFile } from "../../types/editor.ts";

function media(name: string, duration = 0): MediaFile {
  return { name, path: `media/${name}`, kind: duration > 0 ? "video" : "image",
    duration, width: 1280, height: 720, modified: 1,
    sceneId: null, start: null, end: null, how: null, confidence: null };
}

function studio(): Project {
  const files = [media("a.mp4", 12), media("b.png"), media("c.mp4", 8)];
  const base = { id: "studio-1", name: "Standalone", scriptSource: "video_studio",
    voicePath: null, voiceDuration: 0, scenes: [], words: [], mediaMap: {},
    editor: { media: files } } as unknown as Project;
  return { ...base, ...appendStudioMedia(base, 4)! };
}

function apply(project: Project, operation: Parameters<typeof editStudioTimeline>[1]): Project {
  const patch = editStudioTimeline(project, operation);
  assert.ok(patch);
  return { ...project, ...invalidateProject(project, patch) };
}

test("move reorders clips, preserves their sources and recalculates all timestamps", () => {
  const a = studio();
  const b = apply(a, { kind: "move", id: "S01", index: 2 });
  assert.deepEqual(b.scenes.map((s) => [s.id, s.start, s.end]), [
    ["S02", 0, 4], ["S03", 4, 12], ["S01", 12, 24],
  ]);
  assert.equal(b.mediaMap.S01, "media/a.mp4");
  assert.equal(b.mediaMap.S02, "media/b.png");
  assert.equal(b.mediaMap.S03, "media/c.mp4");
  assert.equal(b.voiceDuration, 24);
  assert.equal(b.words.length, 3);
});

test("duration edits keep originals and update the actual project duration", () => {
  const b = apply(studio(), { kind: "duration", id: "S02", seconds: 2.5 });
  assert.deepEqual(b.scenes.map((s) => s.duration), [12, 2.5, 8]);
  assert.equal(b.voiceDuration, 22.5);
  assert.equal(b.scenes[2]?.start, 14.5);
});

test("split video keeps two independently addressable scenes pointing to one original", () => {
  const b = apply(studio(), { kind: "split", id: "S01", at: 5 });
  assert.deepEqual(b.scenes.map((s) => s.duration), [5, 7, 4, 8]);
  assert.equal(b.scenes[1]?.id, "S04");
  assert.equal(b.mediaMap.S01, b.mediaMap.S04);
  assert.equal(readEditor(b).studioSourceIn.S04, 5);
  assert.equal(b.voiceDuration, 24);
  assert.equal(b.words.length, 4);
});

test("duplicate clip preserves its source, trim and manual styling without modifying the original", () => {
  const original = studio();
  const editor = readEditor(original);
  const modified = { ...original, editor: {
    ...editor,
    studioSourceIn: { S01: 2 },
    overrides: { ...editor.overrides, S01: { kenBurns: "zoom_in", transition: "cut" } },
  } } as Project;
  const duplicated = apply(modified, { kind: "duplicate", id: "S01" });
  assert.equal(duplicated.scenes.length, 4);
  assert.equal(duplicated.scenes[1]?.id, "S04");
  assert.equal(duplicated.mediaMap.S04, duplicated.mediaMap.S01);
  assert.equal(readEditor(duplicated).studioSourceIn.S04, 2);
  assert.equal(readEditor(duplicated).studioSourceIn.S01, 2);
  assert.equal(readEditor(duplicated).overrides.S04?.kenBurns, "zoom_in");
  assert.equal(duplicated.voiceDuration, 36);
  assert.equal(original.scenes.length, 3);
});

test("splitting a styled clip keeps the manual scene override on both halves", () => {
  const original = studio();
  const editor = readEditor(original);
  const modified = { ...original, editor: { ...editor,
    overrides: { ...editor.overrides, S01: { kenBurns: "pan_left", transition: "cut" } },
  } } as Project;
  const result = apply(modified, { kind: "split", id: "S01", at: 5 });
  assert.equal(readEditor(result).overrides.S01?.kenBurns, "pan_left");
  assert.equal(readEditor(result).overrides.S04?.kenBurns, "pan_left");
});

test("source-in trim survives save-model normalization and does not rewrite source paths", () => {
  const b = apply(studio(), { kind: "source-in", id: "S01", seconds: 3.25 });
  assert.equal(readEditor(b).studioSourceIn.S01, 3.25);
  assert.equal(b.mediaMap.S01, "media/a.mp4");
  assert.throws(() => editStudioTimeline(b, { kind: "source-in", id: "S01", seconds: 12 }));
});

test("delete removes only selected timeline clip without deleting the imported original", () => {
  const a = studio();
  const b = apply(a, { kind: "delete", id: "S02" });
  assert.deepEqual(b.scenes.map((s) => s.id), ["S01", "S03"]);
  assert.equal(b.mediaMap.S02, undefined);
  assert.equal(readEditor(b).media.some((x) => x.path === "media/b.png"), true);
  assert.equal(b.voiceDuration, 20);
});

test("source media mappings survive unrelated additional asset imports", () => {
  const p = studio();
  const files = readEditor(p).media.concat(media("four.png"));
  const saved = preserveStudioMediaMap(p, files, { S01: "media/b.png" });
  assert.equal(saved.S01, "media/a.mp4");
  assert.equal(saved.S02, "media/b.png");
});

test("scripted production projects are never edited by standalone operations", () => {
  const p = { ...studio(), scriptSource: "claude" };
  assert.throws(() => editStudioTimeline(p, { kind: "delete", id: "S01" }));
});
