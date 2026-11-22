import assert from "node:assert/strict";
import test from "node:test";

import { appendStudioMedia } from "./mediaTimeline.ts";
import { readEditor } from "../editor/model.ts";
import { invalidateProject } from "../pipeline/invalidate.ts";
import type { MediaFile, Project } from "../../types/index.ts";

function file(name: string, kind: "image" | "video", duration = 0): MediaFile {
  return { name, kind, duration, path: `media/${name}`, width: 1280, height: 720, modified: 1,
    sceneId: null, start: null, end: null, how: null, confidence: null };
}

function example(media: MediaFile[]): Project {
  return { id: "studio-test", name: "Studio", scriptSource: "video_studio",
    voicePath: null, voiceDuration: 0, words: [], scenes: [], mediaMap: {},
    editor: { media } } as unknown as Project;
}

test("builds editable scenes from imported pictures and videos with deterministic order", () => {
  const project = example([file("image10.png", "image"), file("clip2.mp4", "video", 7.5), file("image2.png", "image")]);
  const patch = appendStudioMedia(project, 4)!;
  assert.equal(patch.voiceDuration, 15.5);
  assert.deepEqual(patch.scenes?.map((x) => x.id), ["S01", "S02", "S03"]);
  assert.deepEqual(patch.scenes?.map((x) => x.duration), [7.5, 4, 4]);
  assert.deepEqual(patch.scenes?.map((x) => x.mediaType), ["video", "image", "image"]);
  assert.deepEqual(patch.scenes?.map((x) => x.start), [0, 7.5, 11.5]);
  assert.deepEqual(patch.scenes?.map((x) => x.end), [7.5, 11.5, 15.5]);
  assert.equal(patch.words?.length, 3);
  assert.equal(readEditor({ editor: patch.editor ?? null }).captions.style.preset, "none");
  assert.equal(readEditor({ editor: patch.editor ?? null }).media.every((x) => x.sceneId !== null), true);
});

test("does not create duplicate scenes for already assigned clips", () => {
  const first = appendStudioMedia(example([file("one.png", "image")]))!;
  const existing = { ...example([file("one.png", "image")]), ...first };
  assert.equal(appendStudioMedia(existing), null);
});

test("appends footage without losing prior timelines or motion overrides", () => {
  const first = appendStudioMedia(example([file("one.png", "image")]))!;
  const editor = readEditor({ editor: first.editor ?? null });
  editor.overrides.S01 = { kenBurns: "zoom_in", videoFit: "crop", speed: 1, transition: "cut", emphasis: true };
  const existing = { ...example([file("one.png", "image"), file("two.mp4", "video", 8)]), ...first,
    editor: { ...editor, media: [...editor.media, file("two.mp4", "video", 8)] } };
  const appended = appendStudioMedia(existing)!;
  assert.deepEqual(appended.scenes?.map((x) => x.id), ["S01", "S02"]);
  assert.equal(appended.mediaMap?.S01, "media/one.png");
  const afterInvalidation = invalidateProject(existing, appended);
  assert.equal(readEditor({ editor: afterInvalidation.editor ?? null }).overrides.S01?.kenBurns, "zoom_in");
});

test("clamps image lengths and short videos to a safe minimum", () => {
  const patch = appendStudioMedia(example([file("a.png", "image"), file("b.mp4", "video", 0.2)]), 0.1)!;
  assert.deepEqual(patch.scenes?.map((s) => s.duration), [0.5, 0.5]);
});
