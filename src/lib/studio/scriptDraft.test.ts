import assert from "node:assert/strict";
import test from "node:test";
import { planScriptDraft, patchFromScriptDraft } from "./scriptDraft.ts";

test("script draft preserves content and generates contiguous estimated scenes", () => {
  const draft = planScriptDraft("Markets crashed overnight. Investors rushed to sell everything.", 150);
  assert.equal(draft.estimated, true);
  assert.equal(draft.words.length, 8);
  assert.equal(draft.scenes.length, 2);
  assert.equal(draft.scenes[0]?.start, 0);
  assert.equal(draft.scenes[0]?.end, draft.scenes[1]?.start);
  assert.equal(draft.scenes[1]?.end, draft.duration);
  assert.equal(draft.scenes[0]?.text, "Markets crashed overnight.");
  assert.equal(draft.scenes[1]?.text, "Investors rushed to sell everything.");
});

test("script draft retains multilingual words and rejects blank input", () => {
  const draft = planScriptDraft("یہ ایک کہانی ہے۔ یہ دوسرا جملہ ہے۔");
  assert.equal(draft.scenes.length, 2);
  assert.match(draft.scenes[0]!.text, /کہانی/);
  assert.throws(() => planScriptDraft(" \n "));
});

test("script draft is marked estimated and leaves script-writer fields untouched", () => {
  const patch = patchFromScriptDraft("A story starts today.");
  assert.equal(patch.script, "A story starts today.");
  assert.equal(patch.timingEstimated, true);
  assert.equal(patch.timingSource, null);
  assert.equal(patch.scenes?.[0]?.status, "pending");
  assert.ok((patch.voiceDuration ?? 0) > 0);
  assert.equal(patch.voicePath, undefined);
  assert.equal(patch.scriptSource, undefined);
});
