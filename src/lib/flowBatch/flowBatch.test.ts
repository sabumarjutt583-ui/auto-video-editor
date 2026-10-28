import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkFlowVideoCredits,
  checkFlowVideoCreditsFor,
  flowClipsNeeded,
  flowQueueProgress,
  flowVideoCreditsPerVideo,
  formatFlowBatchPrompts,
  formatFlowSeconds,
  parseFlowFilename,
  renameFlowFile,
} from "./flowBatch.ts";

test("paragraphs have no blank line inside and one blank line between", () => {
  const text = formatFlowBatchPrompts(["First line of scene one.\nSecond line of scene one.", "Scene two, one paragraph."]);
  assert.equal(text, "First line of scene one. Second line of scene one.\n\nScene two, one paragraph.");
  assert.equal(text.split("\n\n").length, 2);
});

test("empty prompts and empty batches are refused", () => {
  assert.throws(() => formatFlowBatchPrompts([]), /no prompts/);
  assert.throws(() => formatFlowBatchPrompts(["  \n "]), /empty/);
});

test("flow names parse and S001 is not rewritten to S01", () => {
  assert.deepEqual(parseFlowFilename("S01.png"), ["S01", "png"]);
  assert.deepEqual(parseFlowFilename("S100.mp4"), ["S100", "mp4"]);
  assert.deepEqual(parseFlowFilename("S05b.png"), ["S05b", "png"]);
  assert.deepEqual(parseFlowFilename("S001.png"), ["S001", "png"]);
  assert.equal(parseFlowFilename("01.png"), null);
  assert.equal(parseFlowFilename("S01.jpg"), null);
  assert.equal(parseFlowFilename("S1.png"), null);
});

test("rename uses the scene record times and refuses mismatches", () => {
  assert.equal(renameFlowFile("S01.png", "S01", 0, 8, "images"), "S01_000.0-008.0.png");
  assert.equal(renameFlowFile("S01.mp4", "S01", 0, 8, "videos"), "S01_000.0-008.0.mp4");
  assert.equal(renameFlowFile("S500.png", "S500", 3992, 4000, "images"), "S500_3992.0-4000.0.png");
  assert.equal(renameFlowFile("S001.png", "S01", 0, 8, "images"), null);
  assert.equal(renameFlowFile("S02.png", "S01", 0, 8, "images"), null);
  assert.equal(renameFlowFile("S01.mp4", "S01", 0, 8, "images"), null);
});

test("live video credit table by model and duration", () => {
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 4, "720p"), 7);
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 4, "360p"), 4);
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 6, "720p"), 10);
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 8, "720p"), 12);
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 10, "720p"), 15);
  assert.equal(flowVideoCreditsPerVideo("Veo 3.1 Series (Lite)", 8, "720p"), 10);
  assert.equal(flowVideoCreditsPerVideo("Veo 3.1 Series (Fast)", 8, "720p"), 20);
  assert.equal(flowVideoCreditsPerVideo("Veo 3.1 Series (Quality)", 8, "720p"), 100);
  // Veo costs for other durations were never verified: never guessed.
  assert.equal(flowVideoCreditsPerVideo("Veo 3.1 Series (Lite)", 4, "720p"), null);
  assert.equal(flowVideoCreditsPerVideo("Omni 1.1 Flash", 5, "720p"), null);
  assert.equal(checkFlowVideoCreditsFor("Omni 1.1 Flash", 4, "720p", 10, 20), 70);
  // Veo Quality (100 credits) is refused by the default cap of 20, with the reason.
  assert.throws(() => checkFlowVideoCreditsFor("Veo 3.1 Series (Quality)", 8, "720p", 1, 20), /over the cap/);
  assert.throws(() => checkFlowVideoCreditsFor("Veo 3.1 Series (Lite)", 4, "720p", 1, 20), /not known/);
});

test("queue progress keeps failed scenes on their own numbers", () => {
  const progress = flowQueueProgress(["S01", "S02", "S03"], ["Download S01.png", "Download S03.png"], 2, 3, true);
  assert.equal(progress.total, 3);
  assert.equal(progress.done, 2);
  assert.equal(progress.remaining, 1);
  assert.equal(progress.completedPercent, 67);
  assert.deepEqual(progress.readySceneIds, ["S01", "S03"]);
  // S02 failed: it stays S02, S03 is never renumbered to S02.
  assert.deepEqual(progress.failedSceneIds, ["S02"]);
  const clean = flowQueueProgress(["S01", "S02"], ["Download S01.png", "Download S02.png"], 2, 2, false);
  assert.deepEqual(clean.failedSceneIds, []);
  assert.equal(clean.completedPercent, 100);
});

test("seconds format, credit guard and clip count", () => {
  assert.equal(formatFlowSeconds(0), "000.0");
  assert.equal(formatFlowSeconds(3992), "3992.0");
  assert.equal(checkFlowVideoCredits(10, 7, 20), 70);
  assert.throws(() => checkFlowVideoCredits(1, 21, 20), /over the cap/);
  assert.equal(flowClipsNeeded(8, 4), 2);
  assert.equal(flowClipsNeeded(16.5, 4), 5);
  assert.equal(flowClipsNeeded(0, 4), 0);
});
