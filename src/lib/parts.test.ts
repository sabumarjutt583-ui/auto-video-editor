import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "../types/project.ts";
import { addPartPatch, nextPartName, partTabs, removePartPatch, renamePartPatch, switchPartPatch } from "./parts.ts";

function base(): Project {
  return { activePartId: "", partName: "", parts: [], voicePath: "audio/processed.wav", voiceDuration: 60, script: "one", scenes: [], words: [], mediaMap: {}, editor: null } as unknown as Project;
}
const apply = (p: Project, patch: object): Project => ({ ...p, ...patch }) as Project;

test("a project starts with one part called Part 1", () => {
  assert.deepEqual(partTabs(base()), [{ id: "p1", name: "Part 1", active: true }]);
  assert.equal(nextPartName(base()), "Part 2");
});

test("adding a part keeps the old one and opens an empty one", () => {
  const two = apply(base(), addPartPatch(base(), "  "));
  assert.equal(two.activePartId, "p2");
  assert.equal(two.partName, "Part 2");
  assert.equal(two.voicePath, null);
  assert.equal(two.script, "");
  assert.equal(two.parts.length, 1);
  assert.equal(two.parts[0]?.id, "p1");
  assert.equal(two.parts[0]?.snapshot["script"], "one");
  assert.deepEqual(partTabs(two).map((t) => t.name), ["Part 1", "Part 2"]);
});

test("switching brings the other part back and nothing is lost", () => {
  let p = apply(base(), addPartPatch(base(), "Intro two"));
  p = apply(p, { script: "two", voicePath: "audio/processed.wav" });
  const back = switchPartPatch(p, "p1");
  assert.ok(back);
  p = apply(p, back);
  assert.equal(p.script, "one");
  assert.equal(p.partName, "Part 1");
  assert.equal(p.activePartId, "p1");
  assert.equal(p.parts.find((x) => x.id === "p2")?.snapshot["script"], "two");
  assert.equal(p.parts.find((x) => x.id === "p2")?.name, "Intro two");
  assert.equal(switchPartPatch(p, "p9"), null);
});

test("rename and remove", () => {
  let p = apply(base(), addPartPatch(base(), ""));
  p = apply(p, renamePartPatch(p, "p1", "Beginning"));
  p = apply(p, renamePartPatch(p, "p2", "Ending"));
  assert.deepEqual(partTabs(p).map((t) => t.name), ["Beginning", "Ending"]);
  assert.equal(removePartPatch(p, "p2"), null, "the open part cannot be removed");
  p = apply(p, removePartPatch(p, "p1") ?? {});
  assert.equal(p.parts.length, 0);
});
