import assert from "node:assert/strict";
import { test } from "node:test";

import type { Scene } from "../../types/project.ts";
import type { EditorData } from "../../types/editor.ts";
import type { ImageJob } from "../../types/imagegen.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { readEditor } from "../editor/model.ts";
import { CONSENT_POINTS, consentGiven, majorOf } from "./consent.ts";
import { accountStatusLabel, canRetry, counters } from "./format.ts";
import { buildJobs, pictureFileName } from "./mapping.ts";
import { registerImage, unregisteredFiles } from "./register.ts";

function scene(index: number, start: number, end: number, extra: Partial<Scene> = {}): Scene {
  return { ...emptyScene(), id: `S${String(index).padStart(2, "0")}`, index, start, end, duration: end - start, prompt: `prompt ${index}`, ...extra };
}

const SCENES: Scene[] = [scene(1, 0, 5.1), scene(2, 5.1, 9.5), scene(3, 9.5, 15, { prompt: "   " }), scene(4, 15, 20, { mediaType: "video" })];

test("prompt to job: one job per scene with the timecode name, the final prompt and the project's aspect", () => {
  const { jobs, skipped } = buildJobs(SCENES, "9:16");
  assert.deepEqual(jobs.map((j) => [j.sceneId, j.fileName, j.prompt, j.aspect]), [
    ["S01", "S01_000.0-005.1.png", "prompt 1", "9:16"],
    ["S02", "S02_005.1-009.5.png", "prompt 2", "9:16"],
  ]);
  assert.deepEqual(skipped, [
    { sceneId: "S03", reason: "no_prompt" },
    { sceneId: "S04", reason: "video" },
  ]);
});

test("only the chosen scenes become jobs, in scene order", () => {
  const { jobs } = buildJobs([...SCENES].reverse(), "16:9", ["S02", "S01"]);
  assert.deepEqual(jobs.map((j) => j.sceneId), ["S01", "S02"]);
});

test("timecode names never contain a colon and keep three digits for long videos", () => {
  assert.equal(pictureFileName({ id: "S07", start: 32.44, end: 38.9 }), "S07_032.4-038.9.png");
  assert.equal(pictureFileName({ id: "S99", start: 1234.5, end: 1240 }), "S99_1234.5-1240.0.png");
  assert.ok(!pictureFileName({ id: "S01", start: 0, end: 1 }).includes(":"));
});

function project(extra: { mediaMap?: Record<string, string>; scenes?: Scene[]; media?: EditorData["media"] } = {}) {
  const editor = { media: extra.media ?? [] };
  return { scenes: extra.scenes ?? SCENES, mediaMap: extra.mediaMap ?? {}, editor: editor as unknown as Record<string, unknown> };
}

const SAVED = { sceneId: "S01", path: "media/S01_000.0-005.1.png", name: "S01_000.0-005.1.png", width: 1920, height: 1080, modified: 100 };

test("a saved picture is matched to its scene by name and becomes its chosen file", () => {
  const patch = registerImage(project(), SAVED);
  assert.ok(patch);
  const media = readEditor({ editor: patch.editor ?? {} }).media;
  assert.equal(media.length, 1);
  assert.equal(media[0]?.sceneId, "S01");
  assert.equal(media[0]?.how, "name");
  assert.equal(patch.mediaMap?.S01, "media/S01_000.0-005.1.png");
  const first = patch.scenes?.find((s) => s.id === "S01");
  assert.equal(first?.matchedFile, "media/S01_000.0-005.1.png");
  assert.equal(first?.status, "matched");
  assert.equal(patch.scenes?.find((s) => s.id === "S02")?.matchedFile, null, "other scenes are untouched");
});

test("registering the same picture twice changes nothing the second time", () => {
  const patch = registerImage(project(), SAVED);
  assert.ok(patch);
  const again = registerImage({ scenes: patch.scenes ?? [], mediaMap: patch.mediaMap ?? {}, editor: patch.editor ?? {} }, SAVED);
  assert.equal(again, null);
});

test("a regenerated picture replaces the chosen one but keeps the old file listed", () => {
  const first = registerImage(project(), SAVED);
  assert.ok(first);
  const second = registerImage(
    { scenes: first.scenes ?? [], mediaMap: first.mediaMap ?? {}, editor: first.editor ?? {} },
    { ...SAVED, path: "media/S01_000.0-005.1 (2).png", name: "S01_000.0-005.1 (2).png", regenerated: true },
  );
  assert.ok(second);
  assert.equal(second.mediaMap?.S01, "media/S01_000.0-005.1 (2).png");
  const media = readEditor({ editor: second.editor ?? {} }).media;
  assert.deepEqual(media.map((m) => m.sceneId), ["S01", "S01"]);
});

test("a picture for an unknown scene is ignored", () => {
  assert.equal(registerImage(project(), { ...SAVED, sceneId: "S42" }), null);
});

test("finished jobs that are missing in the media list are found for re-registering", () => {
  const first = registerImage(project(), SAVED);
  const jobs = [
    { id: "S01", status: "completed", file: "media/S01_000.0-005.1.png" },
    { id: "S02", status: "completed", file: "media/S02_005.1-009.5.png" },
    { id: "S03", status: "failed", file: null },
    { id: "S04", status: "queued", file: null },
  ];
  assert.deepEqual(unregisteredFiles({ editor: first?.editor ?? {} }, jobs), [{ sceneId: "S02", path: "media/S02_005.1-009.5.png" }]);
});

test("account status lines", () => {
  assert.equal(accountStatusLabel({ status: "ready", cooldownUntil: 0 }), "Ready");
  assert.equal(accountStatusLabel({ status: "signed_out", cooldownUntil: 0 }), "Signed out");
  assert.match(accountStatusLabel({ status: "limit_reached", cooldownUntil: Date.now() + 60_000 }), /^Limit reached until \d/);
  assert.equal(accountStatusLabel({ status: "limit_reached", cooldownUntil: 0 }), "Limit reached");
});

test("counters and retry", () => {
  const jobs: Pick<ImageJob, "status">[] = [{ status: "queued" }, { status: "queued" }, { status: "completed" }, { status: "failed" }, { status: "generating" }];
  assert.deepEqual(counters(jobs), { queued: 2, generating: 1, completed: 1, failed: 1 });
  assert.equal(canRetry({ status: "failed" }), true);
  assert.equal(canRetry({ status: "completed" }), false);
});

test("consent is asked again when the engine settings get a new major version", () => {
  assert.equal(consentGiven({ consent: null }, 1), false);
  assert.equal(consentGiven({ consent: { acceptedAt: "2026-10-21", configMajor: 1 } }, 1), true);
  assert.equal(consentGiven({ consent: { acceptedAt: "2026-10-21", configMajor: 1 } }, 2), false);
  assert.equal(majorOf("2.3"), 2);
  assert.equal(majorOf("garbage"), 1);
});

test("the consent notice says the important things in simple words", () => {
  const text = CONSENT_POINTS.join(" ").toLowerCase();
  for (const word of ["own google account", "terms of service", "suspend", "separate", "youtube", "adsense", "api"]) assert.ok(text.includes(word), word);
});
