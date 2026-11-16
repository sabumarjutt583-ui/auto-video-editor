import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canApproveScriptJob, reviewFindingCounts } from "./review.ts";
import type { DurableScriptJobV1, ReviewScriptJobInput, ApproveScriptJobInput } from "./types.ts";

function fixture(name: string): DurableScriptJobV1 {
  return JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/" + name, import.meta.url)), "utf8")) as DurableScriptJobV1;
}
const approved = fixture("approved-job-v1.json");
const imported = fixture("imported-job-v1.json");
const pending: DurableScriptJobV1 = {
  ...approved, state: "review_pending", approvedRevisionId: null, approvalRecord: null,
};

test("SW-03E-TS-01 older version-one imported record requires validation before approval", () => {
  assert.equal(imported.schemaVersion, 1);
  assert.equal(imported.state, "response_received");
  assert.equal(imported.reviewReport, undefined);
  assert.equal(imported.approvalRecord, undefined);
  assert.equal(canApproveScriptJob(imported), false);
});
test("SW-03E-TS-02 saved matching review report and warnings allow explicit user approval", () => {
  assert.equal(canApproveScriptJob(pending), true);
  assert.deepEqual(reviewFindingCounts(pending), { technicalErrors: 0, warnings: 2 });
});
test("SW-03E-TS-03 technical errors block the approval button", () => {
  const blocked: DurableScriptJobV1 = { ...pending, reviewReport: {
    ...pending.reviewReport!, findings: [{ code: "empty_script", severity: "error", message: "No content." }],
  } };
  assert.equal(canApproveScriptJob(blocked), false);
  assert.deepEqual(reviewFindingCounts(blocked), { technicalErrors: 1, warnings: 0 });
});
test("SW-03E-TS-04 wrong revision or tampered digest blocks approval", () => {
  assert.equal(canApproveScriptJob({ ...pending, reviewReport: {
    ...pending.reviewReport!, revisionId: "rev_" + "0".repeat(64),
  }}), false);
  assert.equal(canApproveScriptJob({ ...pending, reviewReport: {
    ...pending.reviewReport!, contentDigest: "sha256:" + "0".repeat(64),
  }}), false);
});
test("SW-03E-TS-05 mismatched requested word target cannot be approved", () => {
  assert.equal(canApproveScriptJob({ ...pending, reviewReport: {
    ...pending.reviewReport!, requestedWordCount: 42,
  }}), false);
});
test("SW-03E-TS-06 only exact review_pending state is eligible", () => {
  for (const state of ["created","prepared","response_received","validating","draft_saved","approved"] as const) {
    assert.equal(canApproveScriptJob({ ...pending, state }), false);
  }
});
test("SW-03E-TS-07 approval cannot be repeated after status becomes approved", () => {
  assert.equal(approved.state, "approved");
  assert.equal(approved.approvalRecord?.source, "user_confirmed");
  assert.equal(approved.approvedRevisionId, approved.revisions[0]?.revisionId);
  assert.equal(canApproveScriptJob(approved), false);
});
test("SW-03E-TS-08 shared version-one approved fixture preserves Rust field names", () => {
  assert.deepEqual(Object.keys(approved.reviewReport ?? {}), [
    "validationVersion","revisionId","contentDigest","actualWordCount",
    "requestedWordCount","findings",
  ]);
  assert.deepEqual(Object.keys(approved.approvalRecord ?? {}), [
    "revisionId","contentDigest","validationVersion","approvedAt","source",
  ]);
  assert.equal(approved.reviewReport?.validationVersion, "script-rules-v1");
  assert.equal(approved.stateRevision, approved.appliedOperations?.length);
});
test("SW-03E-TS-09 approval command is exact-revision and operation-ID bound", () => {
  const target = pending.revisions[0]!;
  const input: ReviewScriptJobInput = {
    jobId: pending.jobId, channelId: pending.channelId, requestId: pending.requestId,
    expectedRevision: pending.stateRevision, operationId: "op_explicit_review",
    revisionId: target.revisionId, contentDigest: target.contentDigest,
  };
  const approval: ApproveScriptJobInput = { ...input, validationVersion: "script-rules-v1" };
  assert.equal(JSON.parse(JSON.stringify(approval)).channelId, pending.channelId);
  assert.equal(approval.revisionId, target.revisionId);
  assert.equal(approval.validationVersion, "script-rules-v1");
});
test("SW-03E-TS-10 frontend review guard makes no provider or browser requests", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network not allowed"); }) as typeof fetch;
  try { assert.equal(canApproveScriptJob(pending), true); }
  finally { globalThis.fetch = originalFetch; }
});
