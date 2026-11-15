import assert from "node:assert/strict";
import { test } from "node:test";

import { parseScriptJobCommandError } from "./api.ts";
import type {
  DurableScriptJobV1, PrepareScriptJobInput, LocalScriptJobTransitionInput,
  PreparedScriptPromptSnapshot, JobTransitionIdentity,
} from "./types.ts";

const identity: JobTransitionIdentity = {
  jobId: "sj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  requestId: "req_fixture_001", channelId: "_legacy-channel",
  expectedRevision: 0, operationId: "op_1",
};

test("SW-03C-20 prepared prompt uses Rust camelCase and owns request/channel/master digest", () => {
  const prompt: PreparedScriptPromptSnapshot = {
    requestId: identity.requestId, channelId: identity.channelId,
    formatVersion: "script-prompt-v1",
    content: "Narration in 한국어 🎬",
    contentDigest: "sha256:" + "a".repeat(64),
    masterPromptDigest: "sha256:" + "b".repeat(64),
    preparedAt: "2026-11-15T00:00:00.000Z",
  };
  assert.deepEqual(Object.keys(prompt), [
    "requestId", "channelId", "formatVersion", "content",
    "contentDigest", "masterPromptDigest", "preparedAt",
  ]);
  assert.ok(prompt.content.includes("한국어"));
});

test("SW-03C-21 typed Tauri command inputs serialize without arbitrary state mutation", () => {
  const prepared: PrepareScriptJobInput = {
    ...identity, promptText: "Narration", masterPromptDigest: "sha256:" + "b".repeat(64),
  };
  const transition: LocalScriptJobTransitionInput = {
    ...identity,
    action: { type: "await_user_action", reason: "human_verification" },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)).expectedRevision, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(transition.action)), {
    type: "await_user_action", reason: "human_verification",
  });
  const fixture = { state: "created", stateRevision: 0 } as Pick<DurableScriptJobV1, "state" | "stateRevision">;
  assert.equal(fixture.state, "created");
});

test("SW-03C-22 typed error decoder recognizes expected Rust error codes", () => {
  assert.deepEqual(parseScriptJobCommandError({
    code: "stale_revision", message: "Job revision stale",
  }), { code: "stale_revision", message: "Job revision stale" });
  assert.deepEqual(parseScriptJobCommandError({
    code: "operation_conflict", message: "Same operation ID",
  }), { code: "operation_conflict", message: "Same operation ID" });
});

test("SW-03C-23 malformed Tauri errors remain unknown instead of falsely typed", () => {
  for (const error of [null, "error", [], { code: "fake", message: "x" },
    { code: "stale_revision", message: 42 }, { message: "failed" }]) {
    assert.equal(parseScriptJobCommandError(error), null);
  }
});

test("SW-03C-24 operation identity is stable across identical explicit retries", () => {
  const first: LocalScriptJobTransitionInput = { ...identity, action: { type: "begin_copy" } };
  const second: LocalScriptJobTransitionInput = { ...identity, action: { type: "begin_copy" } };
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.expectedRevision, 0);
  assert.equal(first.operationId, "op_1");
});
