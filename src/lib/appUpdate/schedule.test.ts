import assert from "node:assert/strict";
import { test } from "node:test";

import { DAY_SECONDS, lastCheckedText, shortNotes, shouldAutoCheck } from "./schedule.ts";

test("the automatic check runs at most once a day and only when switched on", () => {
  const now = 2_000_000_000;
  assert.equal(shouldAutoCheck(false, 0, now), false);
  assert.equal(shouldAutoCheck(true, 0, now), true);
  assert.equal(shouldAutoCheck(true, now - 60, now), false);
  assert.equal(shouldAutoCheck(true, now - DAY_SECONDS + 1, now), false);
  assert.equal(shouldAutoCheck(true, now - DAY_SECONDS, now), true);
  assert.equal(shouldAutoCheck(true, now + 500, now), true);
});

test("release notes are made short and plain", () => {
  assert.equal(shortNotes("### Added\n- Style **Gallery**\n- `Faster` render\n\n- Four\n- Five"), "Added · Style Gallery · Faster render");
  assert.equal(shortNotes(""), "");
  const long = shortNotes("x".repeat(500), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith("…"));
});

test("last checked text", () => {
  assert.equal(lastCheckedText(0), "Never");
  assert.notEqual(lastCheckedText(1_700_000_000, "en-US"), "Never");
});
