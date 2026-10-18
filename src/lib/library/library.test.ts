import assert from "node:assert/strict";
import { test } from "node:test";

import { describeReport, matchesSearch } from "./text.ts";

test("search matches tags, category and name, all words together", () => {
  const s = { id: "whoosh_fast", category: "whoosh", tags: ["air", "swipe"] };
  assert.ok(matchesSearch(s, ""));
  assert.ok(matchesSearch(s, "swipe"));
  assert.ok(matchesSearch(s, "FAST air"));
  assert.ok(!matchesSearch(s, "fast boom"));
  assert.ok(matchesSearch({ id: "soft_swell_a", category: "soft_swell", tags: [] }, "soft swell"));
});

test("the update report is described in plain words", () => {
  const status = [] as never[];
  assert.match(describeReport({ status, outcomes: [{ kind: "sfx", result: "updated", version: 3 }] }), /Sound effects are now version 3/);
  assert.match(describeReport({ status, outcomes: [{ kind: "sfx", result: "up-to-date", version: 3 }] }), /up to date/);
  assert.match(describeReport({ status, outcomes: [{ kind: "sfx", result: "not-published", version: 1 }, { kind: "styles", result: "not-published", version: 1 }] }), /Nothing has been published/);
});
