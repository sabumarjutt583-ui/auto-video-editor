import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../scenes/assemble.ts";
import type { Scene } from "../../types/project.ts";
import { castOnlyPrompt, parseDetected, scenesPrompt } from "./detect.ts";
import { applyCast, newCharacter, removeCharacter, removeLocation, sceneCounts, setSceneLocation, toggleCharacter } from "./edit.ts";

const IDS = ["S01", "S02", "S03"];

const ANSWER = JSON.stringify({
  characters: [
    { id: "c1", name: "Mina", role: "granddaughter", appearance_en: "An 8-year-old Korean girl with a short black bob, round face, yellow raincoat, a small scar on her chin." },
    { id: "c2", name: "할머니", role: "grandmother", appearance_en: "A 72-year-old Korean woman with grey hair in a bun, deep smile lines, a faded blue hanbok." },
  ],
  locations: [{ id: "l1", name: "Fishing village", description_en: "A small grey-stone harbour village at dawn, wooden boats, drifting mist." }],
  scenes: [
    { id: "S01", characters: ["c1"], location: "l1" },
    { id: "S02", characters: ["c1", "c2", "c9"], location: "l1" },
    { id: "S03", characters: [], location: null },
  ],
});

test("the detected bible is read with fixed English descriptions and a cast per scene", () => {
  const result = parseDetected(ANSWER, IDS);
  assert.ok(result);
  assert.equal(result.characters.length, 2);
  assert.equal(result.characters[1]?.name, "할머니");
  assert.match(result.characters[0]?.appearance ?? "", /Korean girl/);
  assert.equal(result.locations[0]?.name, "Fishing village");
  assert.deepEqual(result.cast.S01, { characterIds: ["c1"], locationId: "l1" });
  assert.deepEqual(result.cast.S02?.characterIds, ["c1", "c2"], "unknown ids are dropped");
  assert.deepEqual(result.cast.S03, { characterIds: [], locationId: null });
});

test("answers wrapped in fences or with other key names still work", () => {
  const wrapped = "```json\n" + ANSWER + "\n```";
  assert.equal(parseDetected(wrapped, IDS)?.characters.length, 2);
  const alt = JSON.stringify({ characters: [{ name: "Ali", appearance: "A tall man." }], locations: [], scenes: [] });
  const parsed = parseDetected(alt, IDS);
  assert.equal(parsed?.characters[0]?.id, "c1");
  assert.equal(parsed?.characters[0]?.appearance, "A tall man.");
});

test("a script without people gives no characters but keeps locations", () => {
  const answer = JSON.stringify({ characters: [], locations: [{ id: "l1", name: "Lake", description_en: "A calm alpine lake." }], scenes: [{ id: "S01", characters: [], location: "l1" }] });
  const parsed = parseDetected(answer, IDS);
  assert.equal(parsed?.characters.length, 0);
  assert.equal(parsed?.locations.length, 1);
});

test("unusable answers are refused", () => {
  assert.equal(parseDetected("not json", IDS), null);
  assert.equal(parseDetected("[]", IDS), null);
  assert.equal(parseDetected('{"characters":"x"}', IDS), null);
});

test("duplicate or missing ids are repaired", () => {
  const answer = JSON.stringify({ characters: [{ id: "c1", name: "A", appearance_en: "a" }, { id: "c1", name: "B", appearance_en: "b" }, { name: "C", appearance_en: "c" }], locations: [], scenes: [] });
  const ids = parseDetected(answer, IDS)?.characters.map((c) => c.id) ?? [];
  assert.equal(new Set(ids).size, 3);
});

test("cast-only mode keeps the given bible", () => {
  const known = { characters: [{ id: "c1", name: "Mina", role: "", appearance: "fixed text" }], locations: [] };
  const answer = JSON.stringify({ scenes: [{ id: "S01", characters: ["c1", "zzz"], location: "l5" }] });
  const parsed = parseDetected(answer, IDS, known);
  assert.equal(parsed?.characters[0]?.appearance, "fixed text");
  assert.deepEqual(parsed?.cast.S01, { characterIds: ["c1"], locationId: null });
  assert.equal(parseDetected('{"nothing":1}', IDS, known), null);
});

test("prompts list every scene with its id", () => {
  assert.equal(scenesPrompt([{ id: "S01", text: "Hello\nthere" }, { id: "S02", text: "Bye" }]), "S01: Hello there\nS02: Bye");
  const prompt = castOnlyPrompt([{ id: "c1", name: "Mina", role: "girl", appearance: "SECRET LONG TEXT" }], [], [{ id: "S01", text: "x" }]);
  assert.ok(prompt.includes("Mina") && !prompt.includes("SECRET"), "cast-only prompt needs names, not descriptions");
});

function scenes(): Scene[] {
  return IDS.map((id, i) => ({ ...emptyScene(), id, index: i + 1 }));
}

test("the cast is applied to scenes and edited with chips", () => {
  const parsed = parseDetected(ANSWER, IDS);
  assert.ok(parsed);
  let list = applyCast(scenes(), parsed.cast);
  assert.deepEqual(list[1]?.characterIds, ["c1", "c2"]);
  list = toggleCharacter(list, 2, "c2");
  assert.deepEqual(list[2]?.characterIds, ["c2"]);
  list = toggleCharacter(list, 2, "c2");
  assert.deepEqual(list[2]?.characterIds, []);
  list = setSceneLocation(list, 2, "l1");
  assert.equal(list[2]?.locationId, "l1");
  assert.deepEqual(sceneCounts(list), { c1: 2, c2: 1, l1: 3 });
});

test("deleting a character or location removes it from every scene", () => {
  const parsed = parseDetected(ANSWER, IDS);
  assert.ok(parsed);
  const list = applyCast(scenes(), parsed.cast);
  const withoutC1 = removeCharacter(parsed.characters, list, "c1");
  assert.equal(withoutC1.characters.length, 1);
  assert.ok(withoutC1.scenes.every((s) => !s.characterIds.includes("c1")));
  const withoutL1 = removeLocation(parsed.locations, list, "l1");
  assert.equal(withoutL1.locations.length, 0);
  assert.ok(withoutL1.scenes.every((s) => s.locationId === null));
  assert.equal(newCharacter(parsed.characters).id, "c3");
});
