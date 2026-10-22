import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../scenes/assemble.ts";
import type { Project, Scene } from "../../types/project.ts";
import { pictureItems, unlinkPictures } from "./unlink.ts";

const scene = (n: number, matched: string | null): Scene => ({ ...emptyScene(), id: `S0${n}`, index: n, prompt: `p${n}`, matchedFile: matched, status: matched ? "matched" : "prompt_ready" });
const media = (path: string, sceneId: string) => ({ path, name: path, kind: "image", width: 1, height: 1, duration: 0, modified: 0, sceneId, start: null, end: null, how: null, confidence: null });
const project = {
  scenes: [scene(1, "media/a.png"), scene(2, "media/b.png")],
  mediaMap: { S01: "media/a.png", S02: "media/b.png" },
  editor: { media: [media("media/a.png", "S01"), media("media/b.png", "S02")] },
} as unknown as Pick<Project, "scenes" | "mediaMap" | "editor">;

test("a deleted picture is unlinked from its scene, the media list and the chosen files", () => {
  const patch = unlinkPictures(project, new Set(["media/a.png"]));
  assert.ok(patch);
  assert.equal(patch.scenes?.[0]?.matchedFile, null);
  assert.equal(patch.scenes?.[0]?.status, "prompt_ready");
  assert.equal(patch.scenes?.[1]?.matchedFile, "media/b.png");
  assert.deepEqual(patch.mediaMap, { S02: "media/b.png" });
  assert.deepEqual((patch.editor as { media: { path: string }[] }).media.map((m) => m.path), ["media/b.png"]);
});

test("nothing to unlink gives no patch; pictureItems takes only finished jobs with a file", () => {
  assert.equal(unlinkPictures(project, new Set()), null);
  assert.equal(unlinkPictures(project, new Set(["media/zzz.png"])), null);
  const jobs = [{ id: "S01", file: "media/a.png", status: "completed" }, { id: "S02", file: null, status: "queued" }, { id: "S03", file: "media/c.png", status: "completed" }];
  assert.deepEqual(pictureItems(jobs).map((i) => i.id), ["S01", "S03"]);
  assert.deepEqual(pictureItems(jobs, new Set(["S03"])).map((i) => i.id), ["S03"]);
});
