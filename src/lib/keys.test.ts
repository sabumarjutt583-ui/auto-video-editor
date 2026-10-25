import assert from "node:assert/strict";
import test from "node:test";

import type { KeySlotInfo } from "../types/keys.ts";
import { restText, slotForNewKey, slotsFull } from "./keys.ts";

const slot = (n: number, set: boolean): KeySlotInfo => ({ slot: n, status: set ? "set" : "not_set", restingSeconds: 0 });

test("a new key goes to the first free place", () => {
  assert.equal(slotForNewKey([slot(1, true), slot(2, false), slot(3, false)]), 2);
  assert.equal(slotForNewKey([slot(1, false), slot(2, true)]), 1);
  assert.equal(slotForNewKey([]), 1);
});

test("when every place is full a new key replaces the last one", () => {
  const full = [slot(1, true), slot(2, true)];
  assert.equal(slotsFull(full), true);
  assert.equal(slotForNewKey(full), 2);
  assert.equal(slotsFull([slot(1, true), slot(2, false)]), false);
  assert.equal(slotsFull([]), false);
});

test("rest time reads in seconds, minutes or hours", () => {
  assert.equal(restText(30), "30 s");
  assert.equal(restText(120), "2 min");
  assert.equal(restText(3600), "60 min");
  assert.equal(restText(7200), "2 h");
});
