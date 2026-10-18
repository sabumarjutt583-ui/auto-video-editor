import assert from "node:assert/strict";
import { test } from "node:test";

import { blankStyle, CATEGORIES, duplicateStyle, groupStyles, isComplete, missingFields, newCustomId, REQUIRED_FIELDS } from "./styleModel.ts";
import type { StyleProfile } from "../types/style.ts";

function style(id: string, name: string, category: string, filled = false): StyleProfile {
  const base = { ...blankStyle(), id, name, category };
  if (filled) for (const { key } of REQUIRED_FIELDS) base[key] = "text";
  return base;
}

test("a placeholder is incomplete and lists what is missing", () => {
  const placeholder = style("anime", "Anime", "Animation & Cartoon");
  assert.equal(isComplete(placeholder), false);
  assert.equal(missingFields(placeholder).length, REQUIRED_FIELDS.length);
  assert.equal(isComplete(style("a", "A", "Painting", true)), true);
  const almost = { ...style("a", "A", "Painting", true), style_lock: "   " };
  assert.deepEqual(missingFields(almost), ["Style lock"]);
});

test("styles are grouped by the 11 categories in order, and search narrows them", () => {
  assert.equal(CATEGORIES.length, 11);
  const all = [style("b", "Zeta", "Painting"), style("a", "Alpha", "Painting"), style("c", "Noir", "Cinematic & Film"), style("d", "Mine", "My own")];
  const groups = groupStyles(all);
  assert.deepEqual(groups.map((g) => g.category), ["Cinematic & Film", "Painting", "My own"]);
  assert.deepEqual(groups[1]?.styles.map((s) => s.name), ["Alpha", "Zeta"]);
  assert.deepEqual(groupStyles(all, "noir").map((g) => g.styles.length), [1]);
  assert.deepEqual(groupStyles(all, "paint al").flatMap((g) => g.styles.map((s) => s.name)), ["Alpha"]);
  assert.equal(groupStyles(all, "nothing like this").length, 0);
});

test("custom ids are safe and unique", () => {
  assert.equal(newCustomId("My Style!", []), "custom_my_style");
  assert.equal(newCustomId("My Style", ["custom_my_style"]), "custom_my_style_2");
  assert.equal(newCustomId("My Style", ["custom_my_style", "custom_my_style_2"]), "custom_my_style_3");
  assert.equal(newCustomId("한국어", []), "custom_style");
  assert.match(newCustomId("a/b ../c", []), /^custom_[a-z0-9_]+$/);
});

test("duplicating makes an editable custom copy", () => {
  const original = { ...style("cinematic_realism", "Cinematic Realism", "Cinematic & Film", true), builtin: true };
  const copy = duplicateStyle(original, ["cinematic_realism"]);
  assert.equal(copy.builtin, false);
  assert.equal(copy.id, "custom_cinematic_realism_copy");
  assert.equal(copy.name, "Cinematic Realism (copy)");
  assert.equal(copy.lighting, original.lighting);
});
