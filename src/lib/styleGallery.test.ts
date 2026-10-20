import assert from "node:assert/strict";
import { test } from "node:test";

import type { StyleProfile } from "../types/style.ts";
import { addRecent, firstSentence, galleryTabs, matchesQuery, moveFocus, TAB_ALL, TAB_FAVORITES, TAB_MINE, TAB_RECENT, toggleId, visibleStyles } from "./styleGallery.ts";
import { blankStyle } from "./styleModel.ts";

function style(id: string, name: string, category: string, extra: Partial<StyleProfile> = {}): StyleProfile {
  return { ...blankStyle(), id, name, category, builtin: true, ...extra };
}
const styles = [
  style("watercolor", "Watercolor", "Painting", { mood: "airy, gentle" }),
  style("oil_painting", "Oil Painting", "Painting", { mood: "rich, solemn" }),
  style("noir", "Noir", "Cinematic & Film", { mood: "mysterious, tense" }),
  style("custom_mine", "My Look", "Painting", { builtin: false }),
];
const view = { styles, tab: TAB_ALL, query: "", favorites: [] as string[], recent: [] as string[] };

test("tabs: All, Favorites, Recently used, the categories that have styles, My Styles", () => {
  assert.deepEqual(galleryTabs(styles).map((t) => t.label), ["All", "Favorites", "Recently used", "Cinematic & Film", "Painting", "My Styles"]);
});

test("the All tab keeps the picker order and category tabs narrow it", () => {
  assert.deepEqual(visibleStyles(view).map((s) => s.id), ["noir", "oil_painting", "watercolor", "custom_mine"]);
  assert.deepEqual(visibleStyles({ ...view, tab: "Painting" }).map((s) => s.id), ["oil_painting", "watercolor", "custom_mine"]);
  assert.deepEqual(visibleStyles({ ...view, tab: TAB_MINE }).map((s) => s.id), ["custom_mine"]);
});

test("favorites and recently used tabs", () => {
  assert.deepEqual(visibleStyles({ ...view, tab: TAB_FAVORITES, favorites: ["watercolor", "noir"] }).map((s) => s.id), ["noir", "watercolor"]);
  assert.deepEqual(visibleStyles({ ...view, tab: TAB_RECENT, recent: ["watercolor", "gone", "noir"] }).map((s) => s.id), ["watercolor", "noir"]);
});

test("search looks at name, category and mood", () => {
  assert.equal(matchesQuery(styles[0] as StyleProfile, "WATER"), true);
  assert.equal(matchesQuery(styles[0] as StyleProfile, "painting airy"), true);
  assert.equal(matchesQuery(styles[0] as StyleProfile, "tense"), false);
  assert.deepEqual(visibleStyles({ ...view, query: "mysterious" }).map((s) => s.id), ["noir"]);
});

test("recently used keeps the last 6, newest first, no repeats", () => {
  assert.deepEqual(addRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(addRecent(["a", "b", "c", "d", "e", "f"], "z"), ["z", "a", "b", "c", "d", "e"]);
  assert.deepEqual(toggleId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleId(["a", "b"], "a"), ["b"]);
});

test("arrow keys move between cards and stay inside the grid", () => {
  assert.equal(moveFocus(0, 10, 4, "ArrowRight"), 1);
  assert.equal(moveFocus(0, 10, 4, "ArrowLeft"), 0);
  assert.equal(moveFocus(1, 10, 4, "ArrowDown"), 5);
  assert.equal(moveFocus(7, 10, 4, "ArrowDown"), 7);
  assert.equal(moveFocus(5, 10, 4, "ArrowUp"), 1);
  assert.equal(moveFocus(9, 10, 4, "ArrowRight"), 9);
  assert.equal(moveFocus(3, 10, 4, "End"), 9);
  assert.equal(moveFocus(0, 0, 4, "ArrowRight"), -1);
});

test("the tooltip text is the first sentence", () => {
  assert.equal(firstSentence("Grounded cinema. It feels real."), "Grounded cinema.");
  assert.equal(firstSentence("No full stop"), "No full stop");
});
