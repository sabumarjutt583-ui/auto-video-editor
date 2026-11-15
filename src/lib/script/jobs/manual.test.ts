import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { copyPreparedPromptWithCheckpoint, validateManualResponse, MAX_MANUAL_RESPONSE_BYTES } from "./manual.ts";
import { parseScriptJobCommandError } from "./api.ts";
import type { DurableScriptJobV1, LocalScriptJobAction, ImportedScriptResponse } from "./types.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/job-v1.json", import.meta.url)), "utf8")) as DurableScriptJobV1;
function prepared(): DurableScriptJobV1 {
  return {
    ...fixture,
    state: "prepared",
    stateRevision: 1,
    preparedPrompt: {
      requestId: fixture.requestId, channelId: fixture.channelId,
      formatVersion: "script-prompt-v1", content: "Write\n한국어 🎬",
      contentDigest: "sha256:" + "a".repeat(64),
      masterPromptDigest: fixture.request.masterPrompt.contentDigest,
      preparedAt: "2026-11-15T00:00:00.000Z",
    },
  };
}
function fakeTransition(log: string[]) {
  return async (current: DurableScriptJobV1, action: LocalScriptJobAction): Promise<DurableScriptJobV1> => {
    log.push(action.type);
    return { ...current, state: action.type === "begin_copy" ? "copy_intent" : "copied",
      stateRevision: current.stateRevision + 1 };
  };
}

test("SW-03D-TS-01 clipboard call cannot start before durable copy_intent checkpoint", async () => {
  const log: string[] = [];
  const result = await copyPreparedPromptWithCheckpoint(prepared(), fakeTransition(log), async text => {
    log.push("clipboard");
    assert.equal(text, "Write\n한국어 🎬");
    return "copied";
  });
  assert.deepEqual(log, ["begin_copy", "clipboard", "confirm_copy"]);
  assert.equal(result.saved.state, "copied");
  assert.equal(result.copied, true);
});

test("SW-03D-TS-02 failed checkpoint prevents touching clipboard", async () => {
  let copied = false;
  await assert.rejects(copyPreparedPromptWithCheckpoint(prepared(), async () => {
    throw new Error("Disk failure");
  }, async () => { copied = true; return "copied"; }));
  assert.equal(copied, false);
});

test("SW-03D-TS-03 denied clipboard preserves copy_intent and never claims copied", async () => {
  const log: string[] = [];
  const result = await copyPreparedPromptWithCheckpoint(prepared(), fakeTransition(log), async () => "manual");
  assert.deepEqual(log, ["begin_copy"]);
  assert.equal(result.saved.state, "copy_intent");
  assert.equal(result.copied, false);
});

test("SW-03D-TS-04 thrown clipboard error also remains unconfirmed", async () => {
  const log: string[] = [];
  const result = await copyPreparedPromptWithCheckpoint(prepared(), fakeTransition(log), async () => {
    throw new Error("Clipboard blocked");
  });
  assert.deepEqual(log, ["begin_copy"]);
  assert.equal(result.copied, false);
});

test("SW-03D-TS-05 unprepared, cancelled or already-submitted prompts cannot be copied", async () => {
  for (const state of ["created", "cancelled", "submission_uncertain"] as const) {
    await assert.rejects(copyPreparedPromptWithCheckpoint(
      { ...prepared(), state }, async () => { throw new Error("unexpected state transition"); },
      async () => { throw new Error("unexpected clipboard call"); },
    ));
  }
});

test("SW-03D-TS-06 valid mixed-language text is not normalized or trimmed", () => {
  const original = "\n한국어 🎬\r\nاردو ‘quotes’ \n ";
  assert.equal(validateManualResponse(original).valid, true);
  assert.equal(original.startsWith("\n"), true);
});

test("SW-03D-TS-07 reject empty, malformed, and NUL-containing inputs", () => {
  assert.deepEqual(validateManualResponse(" \n\t"), { valid: false, code: "empty_response" });
  assert.deepEqual(validateManualResponse(null), { valid: false, code: "invalid_response" });
  assert.deepEqual(validateManualResponse("a\u0000b"), { valid: false, code: "invalid_response" });
});

test("SW-03D-TS-08 enforce byte-size limit with multibyte UTF-8", () => {
  assert.equal(validateManualResponse("a".repeat(MAX_MANUAL_RESPONSE_BYTES)).valid, true);
  assert.deepEqual(validateManualResponse("a".repeat(MAX_MANUAL_RESPONSE_BYTES + 1)),
    { valid: false, code: "response_too_large" });
  assert.equal(validateManualResponse("🎬".repeat(MAX_MANUAL_RESPONSE_BYTES / 4)).valid, true);
  assert.equal(validateManualResponse("🎬".repeat(MAX_MANUAL_RESPONSE_BYTES / 4 + 1)).valid, false);
});

test("SW-03D-TS-09 TypeScript contract preserves import metadata and user evidence", () => {
  const saved: DurableScriptJobV1 = {
    ...prepared(), state: "response_received", submissionEvidence: "user_confirmed",
    revisions: [{ revisionId: "rev_" + "a".repeat(64), contentDigest: "sha256:" + "b".repeat(64),
      byteLength: 34, createdAt: "2026-11-15T00:00:00.000Z", source: "manual_import" }],
  };
  const result: ImportedScriptResponse = { revision: saved.revisions[0]!, text: "Exact\n한국어" };
  assert.equal(JSON.parse(JSON.stringify(saved)).submissionEvidence, "user_confirmed");
  assert.equal(result.revision.source, "manual_import");
  assert.equal(result.text, "Exact\n한국어");
});

test("SW-03D-TS-10 new Rust error codes parse without leaking private content", () => {
  assert.deepEqual(parseScriptJobCommandError({ code: "invalid_response", message: "Response invalid." }),
    { code: "invalid_response", message: "Response invalid." });
  assert.deepEqual(parseScriptJobCommandError({ code: "revision_not_found", message: "Revision absent." }),
    { code: "revision_not_found", message: "Revision absent." });
});

test("SW-03D-TS-11 pure manual checks work offline without browser, Claude or network", () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network not allowed"); }) as typeof fetch;
  try {
    assert.equal(validateManualResponse("Offline script").valid, true);
    assert.equal(prepared().state, "prepared");
  } finally { globalThis.fetch = original; }
});


test("SW-03D-TS-12 shared imported Rust fixture preserves exact revision fields and content digest", () => {
  const imported = JSON.parse(readFileSync(fileURLToPath(
    new URL("./fixtures/imported-job-v1.json", import.meta.url)), "utf8")) as DurableScriptJobV1;
  assert.equal(imported.schemaVersion, 1);
  assert.equal(imported.state, "response_received");
  assert.equal(imported.stateRevision, 2);
  assert.equal(imported.revisions[0]?.source, "manual_import");
  assert.equal(imported.revisions[0]?.byteLength, new TextEncoder().encode("A complete imported response.\nاردو 🎬").length);
  assert.deepEqual(Object.keys(imported.revisions[0] ?? {}), [
    "revisionId", "contentDigest", "byteLength", "createdAt", "source",
  ]);
  assert.deepEqual(Object.keys(imported.preparedPrompt ?? {}), [
    "requestId", "channelId", "formatVersion", "content", "contentDigest",
    "masterPromptDigest", "preparedAt",
  ]);
  assert.equal(imported.approvedRevisionId, null);
});
