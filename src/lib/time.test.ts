import assert from "node:assert/strict";
import { test } from "node:test";

import { formatClock } from "./time.ts";

test("clock text for the player", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(75.4), "1:15");
  assert.equal(formatClock(75.46, 1), "1:15.4");
  assert.equal(formatClock(5, 1), "0:05.0");
  assert.equal(formatClock(3725), "62:05");
});

test("bad numbers show as zero", () => {
  assert.equal(formatClock(-3), "0:00");
  assert.equal(formatClock(Number.NaN, 1), "0:00.0");
});
