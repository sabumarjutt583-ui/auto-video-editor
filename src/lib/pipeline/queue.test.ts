import assert from "node:assert/strict";
import { test } from "node:test";

import { addScripts, clearDone, nextWaiting, parseScripts, queueCounts, readQueue, removeItem, retryFailed, setItem, type QueueItem } from "./queue.ts";

let n = 0;
const id = () => `q${++n}`;

test("pasted text is split on --- lines and # starts a title", () => {
  const found = parseScripts("# First\nHello world.\n\n---\nSecond script here.\n===\n\n  \n---\n# Third\nLast one.");
  assert.deepEqual(found, [
    { name: "First", script: "Hello world." },
    { name: "", script: "Second script here." },
    { name: "Third", script: "Last one." },
  ]);
  assert.deepEqual(parseScripts("   \n"), []);
  assert.equal(parseScripts("one\r\ntwo")[0]?.script, "one\ntwo");
});

test("new videos get numbered names per channel and wait", () => {
  const first = addScripts([], "a", "Farm", [{ name: "", script: "x" }, { name: "Named", script: "y" }], id);
  assert.deepEqual(first.map((i) => i.name), ["Farm 1", "Named"]);
  const second = addScripts(first, "a", "Farm", [{ name: "", script: "z" }], id);
  assert.equal(second[2]?.name, "Farm 3");
  assert.ok(second.every((i) => i.status === "waiting" && i.projectId === null));
});

test("the queue runs in order and retry puts failed videos back", () => {
  let q = addScripts([], "a", "V", [{ name: "", script: "1" }, { name: "", script: "2" }], id);
  assert.equal(nextWaiting(q)?.script, "1");
  q = setItem(q, q[0]?.id ?? "", { status: "failed", note: "x", projectId: "p1" });
  assert.equal(nextWaiting(q)?.script, "2");
  q = setItem(q, q[1]?.id ?? "", { status: "done" });
  assert.equal(nextWaiting(q), null);
  assert.deepEqual(queueCounts(q), { waiting: 0, running: 0, done: 1, failed: 1 });
  q = retryFailed(q);
  assert.equal(nextWaiting(q)?.projectId, "p1");
  assert.equal(clearDone(q).length, 1);
  assert.equal(removeItem(q, q[0]?.id ?? "").length, 1);
});

test("a saved queue is repaired when read", () => {
  const raw: unknown[] = [
    { id: "a", script: "s", status: "running", channelId: "c" },
    { id: "a", script: "dup" },
    { script: "no id" },
    "junk",
    { id: "b", script: "t", status: "bogus", voiceFile: "", projectId: "p" },
  ];
  const q: QueueItem[] = readQueue(raw);
  assert.equal(q.length, 2);
  assert.equal(q[0]?.status, "waiting");
  assert.equal(q[1]?.status, "waiting");
  assert.equal(q[1]?.voiceFile, null);
  assert.deepEqual(readQueue("x"), []);
});
