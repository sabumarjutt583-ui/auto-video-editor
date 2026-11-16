import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseScriptJobCommandError } from "./api.ts";
import { currentSelectedScriptRevision, canApproveScriptJob, savedScriptApprovalHistory } from "./review.ts";
import {
  canCreateScriptRevision, canSelectScriptRevision, summarizeScriptRevisionDiff,
} from "./revisions.ts";
import type {
  DurableScriptJobV1, ImportedScriptRevisionRef, ScriptRevisionComparison,
  CreateManualRevisionInput, SelectScriptRevisionInput,
} from "./types.ts";

function fixture(name: string): DurableScriptJobV1 {
  return JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/" + name, import.meta.url)), "utf8")) as DurableScriptJobV1;
}
const initial = fixture("imported-job-v1.json");
const approved = fixture("approved-job-v1.json");
const original = approved.revisions[0]!;
const improved: ImportedScriptRevisionRef = {
  revisionId: "rev_" + "4".repeat(64),
  contentDigest: "sha256:" + "5".repeat(64),
  byteLength: 31, createdAt: "2026-11-16T12:00:00.000Z",
  source: "manual_import", originRevisionId: original.revisionId,
};
const revision2: DurableScriptJobV1 = {
  ...approved,
  state: "response_received",
  stateRevision: approved.stateRevision + 1,
  revisions: [original, improved],
  selectedRevisionId: improved.revisionId,
  approvedRevisionId: null, approvalRecord: null, reviewReport: null,
  approvalHistory: [approved.approvalRecord!],
  validationHistory: [approved.reviewReport!],
};

test("SW-03F-TS-01 old Phase 03D/E fixtures remain readable without a selected revision field", () => {
  assert.equal(initial.selectedRevisionId, undefined);
  assert.equal(approved.selectedRevisionId, undefined);
  assert.equal(currentSelectedScriptRevision(initial)?.revisionId, initial.revisions[0]?.revisionId);
  assert.equal(currentSelectedScriptRevision(approved)?.revisionId, approved.revisions[0]?.revisionId);
});

test("SW-03F-TS-02 selected revision is explicit and independent of original ordering", () => {
  assert.equal(currentSelectedScriptRevision(revision2)?.revisionId, improved.revisionId);
  assert.equal(revision2.revisions[0], original);
  assert.equal(revision2.revisions[1]?.originRevisionId, original.revisionId);
  assert.equal(revision2.revisions.length, 2);
});

test("SW-03F-TS-03 newly selected revision cannot inherit an earlier approval", () => {
  assert.equal(revision2.approvedRevisionId, null);
  assert.equal(revision2.approvalRecord, null);
  assert.equal(canApproveScriptJob(revision2), false);
  assert.equal(savedScriptApprovalHistory(revision2).length, 1);
  assert.equal(savedScriptApprovalHistory(revision2)[0]?.revisionId, original.revisionId);
});

test("SW-03F-TS-04 old review findings do not authorize approval of a new version", () => {
  const mismatched: DurableScriptJobV1 = {
    ...revision2, state: "review_pending", reviewReport: approved.reviewReport,
  };
  assert.equal(canApproveScriptJob(mismatched), false);
});

test("SW-03F-TS-05 fresh matching version review is eligible for human approval only", () => {
  const reviewed: DurableScriptJobV1 = {
    ...revision2, state: "review_pending",
    reviewReport: {
      ...approved.reviewReport!, revisionId: improved.revisionId, contentDigest: improved.contentDigest,
    },
  };
  assert.equal(canApproveScriptJob(reviewed), true);
  assert.equal(reviewed.approvedRevisionId, null);
});

test("SW-03F-TS-06 explicit selection requires a different existing version", () => {
  assert.equal(canSelectScriptRevision(revision2, original.revisionId), true);
  assert.equal(canSelectScriptRevision(revision2, improved.revisionId), false);
  assert.equal(canSelectScriptRevision(revision2, "rev_" + "f".repeat(64)), false);
  assert.equal(canSelectScriptRevision({ ...revision2, state: "created" }, original.revisionId), false);
});

test("SW-03F-TS-07 edit eligibility checks source, state, text and size limits", () => {
  assert.equal(canCreateScriptRevision(revision2, original.revisionId, "\nFull revised script. \r\n"), true);
  assert.equal(canCreateScriptRevision(revision2, "rev_" + "f".repeat(64), "Text"), false);
  assert.equal(canCreateScriptRevision(revision2, original.revisionId, "\r\n  "), false);
  assert.equal(canCreateScriptRevision(revision2, original.revisionId, "Text\u0000"), false);
  assert.equal(canCreateScriptRevision(revision2, original.revisionId, "x".repeat(2_097_153)), false);
  assert.equal(canCreateScriptRevision({ ...revision2, state: "cancelled" }, original.revisionId, "Text"), false);
});

test("SW-03F-TS-08 local UI guard refuses more than 64 saved versions", () => {
  const atLimit: DurableScriptJobV1 = {
    ...revision2, revisions: Array.from({ length: 64 }, (_, i) => ({
      ...improved, revisionId: "rev_" + i.toString(16).padStart(64, "0"),
    })),
  };
  assert.equal(canCreateScriptRevision(atLimit, atLimit.revisions[0]!.revisionId, "New text"), false);
});

test("SW-03F-TS-09 historical approvals remain separate from current approvals", () => {
  assert.equal(savedScriptApprovalHistory(approved).length, 1);
  assert.equal(savedScriptApprovalHistory(revision2).length, 1);
  const withNewApproval: DurableScriptJobV1 = {
    ...revision2, state: "approved", approvedRevisionId: improved.revisionId,
    approvalRecord: {
      ...approved.approvalRecord!, revisionId: improved.revisionId,
      contentDigest: improved.contentDigest,
      approvedAt: "2026-11-16T12:05:00.000Z",
    },
  };
  assert.equal(savedScriptApprovalHistory(withNewApproval).length, 2);
  assert.equal(savedScriptApprovalHistory(withNewApproval)[0]?.revisionId, original.revisionId);
  assert.equal(savedScriptApprovalHistory(withNewApproval)[1]?.revisionId, improved.revisionId);
});

test("SW-03F-TS-10 deterministic line diff statistics do not mutate or normalize source", () => {
  const comparison: ScriptRevisionComparison = {
    revisionA: original, revisionB: improved, wordCountA: 3, wordCountB: 3,
    lines: [
      { kind: "unchanged", text: "Intro\n" },
      { kind: "removed", text: "Old ending\n" },
      { kind: "added", text: "New ending\n" },
    ],
  };
  Object.freeze(comparison.lines);
  assert.deepEqual(summarizeScriptRevisionDiff(comparison),
    { addedLines: 1, removedLines: 1, unchangedLines: 1 });
  assert.equal(comparison.lines[1]?.text, "Old ending\n");
  assert.equal(comparison.lines[2]?.text, "New ending\n");
});

test("SW-03F-TS-11 Rust Tauri create/select payloads require explicit parent and CAS", () => {
  const identity = {
    jobId: revision2.jobId, channelId: revision2.channelId,
    requestId: revision2.requestId, expectedRevision: revision2.stateRevision,
    operationId: "op_stable_manual_revision",
  };
  const create: CreateManualRevisionInput = { ...identity, originRevisionId: original.revisionId, text: "\nOriginal 🎬\r\n" };
  const select: SelectScriptRevisionInput = { ...identity, revisionId: original.revisionId };
  assert.equal(JSON.parse(JSON.stringify(create)).originRevisionId, original.revisionId);
  assert.equal(JSON.parse(JSON.stringify(select)).expectedRevision, revision2.stateRevision);
  assert.equal(select.channelId, revision2.channelId);
});

test("SW-03F-TS-12 bound-comparison backend error is recognized without leaking private text", () => {
  assert.deepEqual(parseScriptJobCommandError({
    code: "comparison_too_large",
    message: "This diff exceeds the safe comparison limit; read versions separately.",
  }), {
    code: "comparison_too_large",
    message: "This diff exceeds the safe comparison limit; read versions separately.",
  });
});

test("SW-03F-TS-13 pure local revision eligibility never contacts AI or browser", () => {
  const fetchPrevious = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network forbidden"); }) as typeof fetch;
  try {
    assert.equal(canCreateScriptRevision(revision2, original.revisionId, "Local edit"), true);
    assert.equal(canSelectScriptRevision(revision2, original.revisionId), true);
  } finally {
    globalThis.fetch = fetchPrevious;
  }
});

test("SW-03F-TS-14 immutable operation inputs are not mutated by read-only guards", () => {
  const source = Object.freeze({ ...revision2, revisions: Object.freeze([...revision2.revisions]) });
  assert.equal(canSelectScriptRevision(source, original.revisionId), true);
  assert.equal(currentSelectedScriptRevision(source)?.revisionId, improved.revisionId);
  assert.equal(source.approvedRevisionId, null);
  assert.equal(source.revisions.length, 2);
});


test("SW-03F-TS-15 shared Rust v1 multi-revision fixture is backwards compatible and never auto-approved", () => {
  const saved = fixture("revised-job-v1.json");
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.state, "response_received");
  assert.equal(saved.stateRevision, saved.appliedOperations?.length);
  assert.equal(saved.revisions.length, 2);
  assert.equal(saved.selectedRevisionId, saved.revisions[1]?.revisionId);
  assert.equal(saved.revisions[1]?.originRevisionId, saved.revisions[0]?.revisionId);
  assert.equal(saved.approvedRevisionId, null);
  assert.equal(saved.approvalRecord, undefined);
  assert.equal(saved.reviewReport, undefined);
  assert.equal(saved.approvalHistory?.length, 1);
  assert.equal(saved.validationHistory?.length, 1);
  assert.equal(saved.approvalHistory?.[0]?.revisionId, saved.revisions[0]?.revisionId);
  assert.equal(canApproveScriptJob(saved), false);
});
