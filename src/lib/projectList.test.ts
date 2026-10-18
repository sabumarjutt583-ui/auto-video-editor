import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterAndSort,
  formatDate,
  formatDuration,
  formatSceneCount,
  validateProjectName,
} from "./projectList.ts";
import type { ProjectSummary } from "../types/project.ts";

function summary(id: string, name: string, updatedAt: string): ProjectSummary {
  return { id, name, createdAt: updatedAt, updatedAt, voiceDuration: 0, sceneCount: 0, status: null };
}

const projects = [
  summary("a", "Korean story", "2026-10-02T10:00:00.000Z"),
  summary("b", "roblox Episode 10", "2026-10-03T10:00:00.000Z"),
  summary("c", "Roblox Episode 2", "2026-10-01T10:00:00.000Z"),
];

const ids = (list: ProjectSummary[]) => list.map((project) => project.id);

test("newest and oldest sort by the last change", () => {
  assert.deepEqual(ids(filterAndSort(projects, "", "newest")), ["b", "a", "c"]);
  assert.deepEqual(ids(filterAndSort(projects, "", "oldest")), ["c", "a", "b"]);
});

test("name sort ignores case and understands numbers", () => {
  assert.deepEqual(ids(filterAndSort(projects, "", "name")), ["a", "c", "b"]);
});

test("search ignores case and spaces around the text", () => {
  assert.deepEqual(ids(filterAndSort(projects, "  ROBLOX ", "name")), ["c", "b"]);
  assert.deepEqual(ids(filterAndSort(projects, "zzz", "name")), []);
});

test("sorting does not change the list it was given", () => {
  const before = ids(projects);
  filterAndSort(projects, "", "name");
  assert.deepEqual(ids(projects), before);
});

test("projects changed at the same moment keep a steady order", () => {
  const same = [summary("y", "B", "2026-01-01T00:00:00.000Z"), summary("x", "A", "2026-01-01T00:00:00.000Z")];
  assert.deepEqual(ids(filterAndSort(same, "", "newest")), ["x", "y"]);
});

test("names are checked", () => {
  assert.equal(validateProjectName("My video"), null);
  assert.equal(validateProjectName("한국어 이야기"), null);
  assert.notEqual(validateProjectName("   "), null);
  assert.equal(validateProjectName("x".repeat(100)), null);
  assert.notEqual(validateProjectName("x".repeat(101)), null);
});

test("durations are easy to read", () => {
  assert.equal(formatDuration(0), "No voice-over");
  assert.equal(formatDuration(Number.NaN), "No voice-over");
  assert.equal(formatDuration(7.4), "0:07");
  assert.equal(formatDuration(75), "1:15");
  assert.equal(formatDuration(3725), "1:02:05");
});

test("scene counts use the right word", () => {
  assert.equal(formatSceneCount(0), "0 scenes");
  assert.equal(formatSceneCount(1), "1 scene");
  assert.equal(formatSceneCount(12), "12 scenes");
});

test("a date that cannot be read gives empty text", () => {
  assert.equal(formatDate("not a date"), "");
  assert.notEqual(formatDate("2026-10-18T12:00:00.000Z"), "");
});
