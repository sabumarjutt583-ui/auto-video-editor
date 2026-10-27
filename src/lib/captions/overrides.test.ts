import assert from "node:assert/strict";
import test from "node:test";

import type { CaptionLine } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { applyCaptionOverrides } from "./overrides.ts";

const line = (id: string, start: number, end: number, text: string): CaptionLine => ({ id, start, end, text, words: [{ text, start, end }], breakAt: null });
const scene = (id: string, start: number, end: number): Scene => ({ id, start, end } as unknown as Scene);

test("an override replaces the overlapping line's text, other lines stay", () => {
  const out = applyCaptionOverrides([line("l1", 0, 5, "hello world"), line("l2", 5, 10, "next words")], [scene("S01", 0, 5), scene("S02", 5, 10)], { S01: "edited caption" });
  assert.equal(out[0].text, "edited caption");
  assert.equal(out[0].words[0].text, "edited caption");
  assert.equal(out[1].text, "next words");
});

test("no overrides means the lines come back unchanged", () => {
  const lines = [line("l1", 0, 5, "hello")];
  assert.deepEqual(applyCaptionOverrides(lines, [scene("S01", 0, 5)], undefined), lines);
});
