import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { StyleProfile } from "../types/style.ts";
import { BANNED_NAMES, bannedHits, completeProblems, formatReportTable, normalizeStyle, reportStyles, splitList } from "./styleChecks.ts";
import { isComplete, STYLE_ORDER } from "./styleModel.ts";

/** Add more names here (lower case). They are checked together with BANNED_NAMES. */
const EXTRA_BANNED: readonly string[] = [];
const BANNED = [...BANNED_NAMES, ...EXTRA_BANNED];

const DIR = join(process.cwd(), "resources", "styles");
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".json") && name !== "package.json")
  .sort()
  .map((fileName) => ({ fileName, style: normalizeStyle(JSON.parse(readFileSync(join(DIR, fileName), "utf8")) as Partial<StyleProfile>) }));
const complete = files.filter(({ style }) => isComplete(style));

test("ids are unique and match the file names", () => {
  const ids = files.map(({ style }) => style.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  for (const { fileName, style } of files) assert.equal(`${style.id}.json`, fileName);
});

test("cinematic_realism is complete", () => {
  assert.ok(complete.some(({ style }) => style.id === "cinematic_realism"));
});

for (const { fileName, style } of complete) {
  test(`complete style ${style.id} follows the writing rules`, () => {
    assert.deepEqual(completeProblems(style, fileName, BANNED), []);
  });
}

test("rules catch bad styles", () => {
  const good = complete[0]?.style;
  assert.ok(good);
  const lock = splitList(good.style_lock);
  assert.ok(completeProblems({ ...good, style_lock: `${good.style_lock}, 16:9`, example_prompt: `${good.example_prompt}, 16:9` }, `${good.id}.json`, BANNED).some((p) => p.includes("aspect")));
  assert.ok(completeProblems({ ...good, style_lock: lock.slice(0, 5).join(", ") }, `${good.id}.json`, BANNED).some((p) => p.includes("style_lock has 5")));
  assert.ok(completeProblems({ ...good, negative: `${good.negative}, ${lock[0]}` }, `${good.id}.json`, BANNED).some((p) => p.includes("share")));
  assert.ok(completeProblems({ ...good, example_prompt: "A man at a table." }, `${good.id}.json`, BANNED).some((p) => p.includes("does not end")));
  assert.ok(completeProblems(good, "other.json", BANNED).some((p) => p.includes("file name")));
  assert.ok(bannedHits({ ...good, texture: "Looks like a PIXAR film" }, BANNED).length > 0);
  assert.ok(bannedHits({ ...good, name: "Disney look" }, BANNED).length > 0);
  assert.ok(bannedHits({ ...good, id: "pixar_inspired_3d" }, BANNED).length > 0);
});

test("the report lists every style", () => {
  const reports = reportStyles(files, BANNED);
  assert.equal(reports.length, files.length);
  assert.ok(formatReportTable(reports).includes("incomplete"));
});

test("the picker order lists every shipped style exactly once", () => {
  assert.deepEqual([...STYLE_ORDER].sort(), files.map(({ style }) => style.id).sort());
});

test("every shipped style is complete (no 'Incomplete' badge in the picker)", () => {
  assert.equal(complete.length, files.length);
  assert.equal(files.length, 51);
});

test("no two styles of one category share more than half of their style_lock words", () => {
  const STOP = new Set(["a", "an", "and", "of", "on", "in", "with", "the", "to", "for", "or", "no", "by", "at", "per"]);
  const words = (lock: string) => new Set(lock.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w !== "" && !STOP.has(w)));
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i]?.style;
      const b = files[j]?.style;
      if (!a || !b || a.category !== b.category) continue;
      const wa = words(a.style_lock);
      const wb = words(b.style_lock);
      const shared = [...wa].filter((w) => wb.has(w)).length;
      assert.ok(shared / Math.min(wa.size, wb.size) <= 0.5, `${a.id} and ${b.id} are too similar`);
    }
  }
});
