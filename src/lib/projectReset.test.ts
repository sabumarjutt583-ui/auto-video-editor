import assert from "node:assert/strict";
import { test } from "node:test";

import { unlockPatch } from "./projectReset.ts";

test("unlocking clears timing, scenes and media but keeps the user's own work", () => {
  const patch = unlockPatch();
  assert.equal(patch.voiceLocked, false);
  assert.deepEqual(patch.words, []);
  assert.deepEqual(patch.scenes, []);
  assert.deepEqual(patch.mediaMap, {});
  assert.equal(patch.timingSource, null);
  assert.equal(patch.renderedAt, null);
  for (const kept of ["script", "styleId", "characterBible", "locationBible", "settings", "voicePath", "cutMap"]) {
    assert.ok(!(kept in patch), `${kept} must not be touched`);
  }
});

test("each call gives fresh arrays", () => {
  assert.notEqual(unlockPatch().words, unlockPatch().words);
});
