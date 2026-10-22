import assert from "node:assert/strict";
import { test } from "node:test";

import type { EditorData, MediaFile, SourceMedia } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { readAudio } from "../audio/read.ts";
import { readRender } from "../render/read.ts";
import { readCaptions } from "../captions/read.ts";
import { DEFAULT_OVERRIDE, readEditor } from "../editor/model.ts";
import { naturalCompare, sortSources } from "./files.ts";
import { parseMediaName } from "./parseName.ts";
import { addFiles, assignFile, chooseFor, matchByOrder, placeByName, reconcile, unmatched } from "./place.ts";
import { planRename } from "./rename.ts";
import { validate } from "./validate.ts";

function scenes(): Scene[] {
  const bounds: [string, number, number][] = [["S01", 0, 5.1], ["S02", 5.1, 9.5], ["S03", 9.5, 15], ["S04", 15, 20]];
  return bounds.map(([id, start, end], i) => ({ ...emptyScene(), id, index: i + 1, start, end, duration: end - start, text: `scene ${id}` }));
}

function file(name: string, extra: Partial<MediaFile> = {}): MediaFile {
  return { path: `media/${name}`, name, kind: name.endsWith("mp4") ? "video" : "image", width: 1920, height: 1080, duration: name.endsWith("mp4") ? 5 : 0, modified: 0, sceneId: null, start: null, end: null, how: null, confidence: null, ...extra };
}

function editorOf(media: MediaFile[]): EditorData {
  return { media, motion: [], timeChoices: {}, placeholder: "hold", overrides: {}, captions: readCaptions(null), audio: readAudio(null), render: readRender(null), brandKitId: "" };
}

test("file names: timecode, scene number, bare number, nothing", () => {
  assert.deepEqual(parseMediaName("S01_000.0-005.1.png"), { kind: "timecode", sceneId: "S01", start: 0, end: 5.1 });
  assert.deepEqual(parseMediaName("s05A_020.0-026.0.MP4"), { kind: "timecode", sceneId: "S05a", start: 20, end: 26 });
  assert.deepEqual(parseMediaName("S12_100.5-110.25.webp"), { kind: "timecode", sceneId: "S12", start: 100.5, end: 110.25 });
  assert.deepEqual(parseMediaName("S07_032.4-038.9 (1).jpg"), { kind: "timecode", sceneId: "S07", start: 32.4, end: 38.9 });
  assert.deepEqual(parseMediaName("S01_000.0-005.1"), { kind: "timecode", sceneId: "S01", start: 0, end: 5.1 }, "no extension at all");
  assert.deepEqual(parseMediaName("S01.png"), { kind: "scene", sceneId: "S01", start: null, end: null });
  assert.deepEqual(parseMediaName("s3_final.png").sceneId, "S03");
  assert.deepEqual(parseMediaName("01.png"), { kind: "scene", sceneId: "S01", start: null, end: null });
  assert.equal(parseMediaName("7.jpeg").sceneId, "S07");
  assert.equal(parseMediaName("S01_005.0-000.0.png").kind, "scene", "an end before the start is not a time");
});

test("names that are not scene codes stay unmatched", () => {
  for (const name of ["IMG_2041.png", "2024-01-01.png", "20240101.png", "image (3).png", "scene1.png", "S01apple.png", "Sunset.jpg", "download.webp"]) {
    assert.equal(parseMediaName(name).kind, "none", name);
  }
});

test("natural sorting and date sorting", () => {
  assert.ok(naturalCompare("img2.png", "img10.png") < 0);
  const items = [{ name: "b", modified: 1 }, { name: "a", modified: 3 }, { name: "c", modified: 2 }];
  assert.deepEqual(sortSources(items, "name").map((i) => i.name), ["a", "b", "c"]);
  assert.deepEqual(sortSources(items, "date").map((i) => i.name), ["b", "c", "a"]);
});

test("correctly named files are placed on their scenes at once", () => {
  const list = scenes();
  const files = ["S01_000.0-005.1.png", "S02_005.1-009.5.png", "S03_009.5-015.0.mp4", "S04_015.0-020.0.png"].map((n) => file(n));
  const placed = addFiles(editorOf([]), {}, list, files);
  assert.equal(unmatched(placed.media).length, 0);
  assert.deepEqual(Object.keys(placed.mediaMap), ["S01", "S02", "S03", "S04"]);
  assert.equal(placed.mediaMap["S03"], "media/S03_009.5-015.0.mp4");
  assert.ok(placed.media.every((m) => m.how === "name"));
});

test("scene-number names use the project time; unknown scenes and codes stay unmatched", () => {
  const list = scenes();
  const placed = addFiles(editorOf([]), {}, list, [file("S02.png"), file("04.png"), file("S09.png"), file("random.png")]);
  assert.deepEqual(placed.media.map((m) => [m.name, m.sceneId, m.how]), [["S02.png", "S02", "number"], ["04.png", "S04", "number"], ["S09.png", null, null], ["random.png", null, null]]);
  assert.equal(placed.media[0]?.start, null);
});

test("two files for one scene: the first stays chosen, the user can pick the other", () => {
  const list = scenes();
  const a = file("S01_000.0-005.1.png");
  const b = file("S01.png");
  const placed = addFiles(editorOf([]), {}, list, [a, b]);
  assert.equal(placed.mediaMap["S01"], a.path);
  const changed = chooseFor(placed.mediaMap, "S01", b.path);
  assert.equal(changed["S01"], b.path);
  const issues = validate(list, editorOf(placed.media), changed, {});
  assert.ok(issues.some((i) => i.kind === "duplicate" && i.severity === "orange"));
});

test("match by order fills only the empty scenes", () => {
  const list = scenes();
  const placed = addFiles(editorOf([]), {}, list, [file("S02.png"), file("x1.png"), file("x2.png"), file("x3.png"), file("x4.png")]);
  const order = sortSources(placed.media.map((m) => ({ ...m })), "name");
  const pairs = matchByOrder(placed.media, list, order);
  assert.deepEqual(pairs, [{ sceneId: "S01", path: "media/x1.png" }, { sceneId: "S03", path: "media/x2.png" }, { sceneId: "S04", path: "media/x3.png" }]);
  let state = placed;
  for (const pair of pairs) state = assignFile(editorOf(state.media), state.mediaMap, list, pair.path, pair.sceneId, "order");
  assert.equal(unmatched(state.media).length, 1);
  assert.equal(state.mediaMap["S04"], "media/x3.png");
});

test("manual and Gemini choices survive a rebuild while the scene exists", () => {
  const list = scenes();
  let state = addFiles(editorOf([]), {}, list, [file("x1.png"), file("S02.png")]);
  state = assignFile(editorOf(state.media), state.mediaMap, list, "media/x1.png", "S04", "gemini", 0.8);
  const shorter = list.slice(0, 3);
  const again = reconcile(editorOf(state.media), state.mediaMap, shorter);
  assert.equal(again.media.find((m) => m.name === "x1.png")?.sceneId, null, "S04 no longer exists");
  assert.equal(again.media.find((m) => m.name === "S02.png")?.sceneId, "S02");
  assert.equal(placeByName(state.media[0] as MediaFile, list).sceneId, "S04");
});

test("bulk rename: random names become timecode names in order, copies only", () => {
  const list = scenes();
  const sources: SourceMedia[] = ["zebra.PNG", "apple.jpg", "clip.mp4"].map((name, i) => ({ path: `/x/${name}`, name, kind: name.endsWith("mp4") ? "video" : "image", width: 1, height: 1, duration: 0, modified: i, size: 1 }));
  const rows = planRename(sources, list);
  assert.deepEqual(rows.map((r) => r.newName), ["S01_000.0-005.1.png", "S02_005.1-009.5.jpg", "S03_009.5-015.0.mp4"]);
  assert.equal(planRename(sources, list, 3)[1]?.newName, null, "more files than scenes");
  assert.equal(planRename(sources.slice(0, 1), list, 1)[0]?.sceneId, "S02");
});

test("validation: a missing scene, a deleted file and a short video are caught", () => {
  const list = scenes();
  const media = [
    file("S01_000.0-005.1.png", { sceneId: "S01", start: 0, end: 5.1, how: "name" }),
    file("S02_005.1-009.5.mp4", { sceneId: "S02", start: 5.1, end: 9.5, how: "name", duration: 3.0 }),
    file("S03_009.5-015.0.png", { sceneId: "S03", start: 9.5, end: 15, how: "name" }),
  ];
  const map = { S01: media[0]?.path ?? "", S02: media[1]?.path ?? "", S03: media[2]?.path ?? "" };
  const issues = validate(list, editorOf(media), map, { [media[2]?.path ?? ""]: false });
  const kinds = issues.map((i) => `${i.severity}:${i.kind}:${i.sceneId}`);
  assert.ok(kinds.includes("red:missing:S04"));
  assert.ok(kinds.includes("red:file_missing:S03"));
  assert.ok(kinds.includes("red:missing:S03"), "a deleted file leaves its scene without media");
  const short = issues.find((i) => i.kind === "short");
  assert.equal(short?.severity, "orange");
  assert.ok(Math.abs((short?.seconds ?? 0) - 1.4) < 1e-9);
  assert.equal(issues[0]?.severity, "red", "red problems come first");
});

test("validation: overlaps are red, gaps are grey, time differences ask the user", () => {
  const list = scenes();
  const media = [
    file("S01_000.0-005.1.png", { sceneId: "S01", start: 0, end: 5.1 }),
    file("S02_004.0-009.5.png", { sceneId: "S02", start: 4, end: 9.5 }),
    file("S03_010.5-015.0.png", { sceneId: "S03", start: 10.5, end: 15 }),
  ];
  const map = { S01: media[0]?.path ?? "", S02: media[1]?.path ?? "", S03: media[2]?.path ?? "" };
  const issues = validate(list, editorOf(media), map, {});
  assert.ok(issues.some((i) => i.kind === "overlap" && i.severity === "red" && i.sceneId === "S02"));
  assert.ok(issues.some((i) => i.kind === "gap" && i.severity === "grey" && i.sceneId === "S03"));
  assert.ok(issues.some((i) => i.kind === "time_mismatch" && i.sceneId === "S02"), "4.0 vs 5.1 is more than 0.3 s");
  assert.ok(!issues.some((i) => i.kind === "time_mismatch" && i.sceneId === "S01"));
  // Once the user chose the project time for S02 and S03, the file times no longer count.
  const resolved = { ...editorOf(media), timeChoices: { S02: "project", S03: "project" } as EditorData["timeChoices"] };
  const after = validate(list, resolved, map, {});
  assert.ok(!after.some((i) => ["overlap", "gap", "time_mismatch"].includes(i.kind)));
});

test("a gap is only reported between neighbouring scenes", () => {
  const list = scenes();
  const media = [
    file("S01_000.0-005.1.png", { sceneId: "S01", start: 0, end: 5.1 }),
    file("S03_009.5-015.0.png", { sceneId: "S03", start: 9.5, end: 15 }),
  ];
  const issues = validate(list, editorOf(media), { S01: media[0]?.path ?? "", S03: media[1]?.path ?? "" }, {});
  assert.ok(issues.some((i) => i.kind === "missing" && i.sceneId === "S02"));
  assert.ok(!issues.some((i) => i.kind === "gap"), "S02 is missing, that is not a gap between files");
});

test("the editor data of an old or damaged project is repaired", () => {
  const empty = readEditor({ editor: null });
  assert.deepEqual(empty, { media: [], motion: [], timeChoices: {}, placeholder: "hold", overrides: {}, captions: readCaptions(null), audio: readAudio(null), render: readRender(null), brandKitId: "" });
  const messy = readEditor({ editor: { media: [{ path: "media/a.png", name: "a.png", kind: "video", width: "x" }, 5, { nope: 1 }], placeholder: "nonsense", overrides: { S01: { kenBurns: "pan_left", speed: 7, transition: "bad" } }, timeChoices: { S01: "file", S02: "maybe" } } as never });
  assert.equal(messy.media.length, 1);
  assert.equal(messy.media[0]?.width, 0);
  assert.equal(messy.placeholder, "hold");
  assert.equal(messy.overrides["S01"]?.kenBurns, "pan_left");
  assert.equal(messy.overrides["S01"]?.speed, 1, "speed is kept between 0.25 and 1");
  assert.equal(messy.overrides["S01"]?.transition, DEFAULT_OVERRIDE.transition);
  assert.deepEqual(messy.timeChoices, { S01: "file" });
});
