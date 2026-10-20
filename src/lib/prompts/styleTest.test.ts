import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sampleScenes, styleTestText } from "./styleTest.ts";

test("the sample story has exactly 5 short sentences, one per scene", () => {
  const story = readFileSync(join(process.cwd(), "resources", "style-test", "sample_story.txt"), "utf8");
  const scenes = sampleScenes(story);
  assert.equal(scenes.length, 5);
  assert.deepEqual(scenes.map((s) => s.id), ["S01", "S02", "S03", "S04", "S05"]);
  assert.equal(scenes[4]?.start, 24);
  for (const scene of scenes) assert.ok(scene.text.endsWith("."));
});

test("the export text has one line per written prompt", () => {
  const scenes = sampleScenes("One.\nTwo.").map((s) => ({ ...s, prompt: `prompt ${s.id}` }));
  assert.equal(styleTestText(scenes), "S01_000.0-006.0 | prompt S01\nS02_006.0-012.0 | prompt S02");
});
