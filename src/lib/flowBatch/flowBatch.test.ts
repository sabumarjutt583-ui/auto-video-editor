import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkFlowVideoCredits,
  flowClipsNeeded,
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

test("seconds format, credit guard and clip count", () => {
  assert.equal(formatFlowSeconds(0), "000.0");
  assert.equal(formatFlowSeconds(3992), "3992.0");
  assert.equal(checkFlowVideoCredits(10, 7, 20), 70);
  assert.throws(() => checkFlowVideoCredits(1, 21, 20), /over the cap/);
  assert.equal(flowClipsNeeded(8, 4), 2);
  assert.equal(flowClipsNeeded(16.5, 4), 5);
  assert.equal(flowClipsNeeded(0, 4), 0);
});
