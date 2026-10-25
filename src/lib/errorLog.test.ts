import assert from "node:assert/strict";
import { test } from "node:test";

import { createErrorDeduper, errorLogText } from "./errorLog.ts";

test("the same error is logged once", () => {
  const first = createErrorDeduper();
  assert.equal(first("a"), true);
  assert.equal(first("a"), false);
  assert.equal(first("b"), true);
});

test("only the last 50 errors are remembered", () => {
  const first = createErrorDeduper();
  for (let i = 0; i < 60; i += 1) first(`e${i}`);
  assert.equal(first("e59"), false);
  assert.equal(first("e0"), true);
});

test("log text has the message and the technical details", () => {
  assert.equal(errorLogText({ message: "Could not save.", details: "disk full" }), "Could not save. | disk full");
  assert.equal(errorLogText({ message: "Could not save.", details: "  " }), "Could not save.");
});
