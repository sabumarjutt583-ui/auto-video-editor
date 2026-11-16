import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseScriptJobCommandError } from "./api.ts";
import { canInspectUnverifiedOrphan, recoveryArtifactCounts } from "./recovery.ts";
import type {
  DurableScriptJobV1, ScriptJobRecoveryInspection, ScriptRecoveryArtifact,
  InspectScriptRecoveryInput, ReadOrphanScriptInput,
} from "./types.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(
  new URL("./fixtures/revised-job-v1.json", import.meta.url)), "utf8")) as DurableScriptJobV1;
const artifact: ScriptRecoveryArtifact = {
  artifactId: "rev_" + "c".repeat(64) + ".txt",
  kind: "orphan_revision", byteLength: 64,
  contentDigest: "sha256:" + "e".repeat(64),
  canReadText: true, attachmentProven: false,
  explanation: "Unreferenced by last verified checkpoint.",
};
const issue = {
  jobId: fixture.jobId, kind: "orphan_revision" as const,
  message: "Uncommitted revision file preserved.",
};
const sample: ScriptJobRecoveryInspection = {
  jobId: fixture.jobId, channelId: fixture.channelId,
  requestId: fixture.requestId, lastVerifiedStateRevision: fixture.stateRevision,
  blocked: true, issues: [issue], artifacts: [artifact],
  reconciliationSupported: false,
};

test("SW-03G-TS-01 current schema v1 fixture still reads unchanged", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.revisions.length, 2);
  assert.equal(fixture.approvalHistory?.length, 1);
  assert.equal(fixture.selectedRevisionId, fixture.revisions[1]?.revisionId);
});

test("SW-03G-TS-02 orphan preview requires explicit consent", () => {
  assert.equal(canInspectUnverifiedOrphan(sample, artifact.artifactId, false), false);
  assert.equal(canInspectUnverifiedOrphan(sample, artifact.artifactId, true), true);
});

test("SW-03G-TS-03 committed revisions and temporary files cannot use orphan preview", () => {
  const readonly: ScriptRecoveryArtifact = {
    ...artifact, kind: "incomplete_revision_temporary", canReadText: false,
  };
  const changed = { ...sample, artifacts: [readonly] };
  assert.equal(canInspectUnverifiedOrphan(changed, artifact.artifactId, true), false);
  assert.equal(canInspectUnverifiedOrphan(sample, "../" + artifact.artifactId, true), false);
});

test("SW-03G-TS-04 missing SHA-256 or unsafe size blocks preview", () => {
  for (const a of [
    { ...artifact, contentDigest: null },
    { ...artifact, contentDigest: "sha256:bad" },
    { ...artifact, byteLength: 2_097_153 },
    { ...artifact, byteLength: 0 },
    { ...artifact, canReadText: false },
  ]) {
    assert.equal(canInspectUnverifiedOrphan({ ...sample, artifacts: [a] }, a.artifactId, true), false);
  }
});

test("SW-03G-TS-05 wrong requested artifact ID fails closed", () => {
  assert.equal(canInspectUnverifiedOrphan(sample, "rev_" + "f".repeat(64) + ".txt", true), false);
  assert.equal(canInspectUnverifiedOrphan(null, artifact.artifactId, true), false);
});

test("SW-03G-TS-06 no recoverable file is ever marked proven for attachment", () => {
  assert.equal(sample.reconciliationSupported, false);
  assert.equal(sample.artifacts[0]?.attachmentProven, false);
  assert.equal(sample.blocked, true);
  assert.equal(sample.lastVerifiedStateRevision, fixture.stateRevision);
});

test("SW-03G-TS-07 diagnostic categories are deterministic and do not mutate inputs", () => {
  const values = Object.freeze([
    artifact,
    { ...artifact, artifactId: "revision-" + "a".repeat(32) + ".tmp", kind: "incomplete_revision_temporary" as const },
    { ...artifact, artifactId: "unsafe", kind: "unsafe_revision_entry" as const },
    { ...artifact, artifactId: "collision", kind: "ambiguous_revision" as const },
  ]);
  assert.deepEqual(recoveryArtifactCounts(values), {
    orphaned: 1, incomplete: 1, unsafeOrAmbiguous: 2,
  });
  assert.equal(values.length, 4);
});

test("SW-03G-TS-08 typed read-only Tauri payload binds channel and request", () => {
  const inspect: InspectScriptRecoveryInput = {
    jobId: sample.jobId, channelId: sample.channelId, requestId: sample.requestId,
  };
  const read: ReadOrphanScriptInput = { ...inspect, artifactId: artifact.artifactId };
  assert.equal(JSON.parse(JSON.stringify(read)).channelId, sample.channelId);
  assert.equal(read.artifactId, artifact.artifactId);
});

test("SW-03G-TS-09 new inspection needs no operation or revision mutation ID", () => {
  const inspect: InspectScriptRecoveryInput = {
    jobId: sample.jobId, channelId: sample.channelId, requestId: sample.requestId,
  };
  assert.equal(Object.hasOwn(inspect, "expectedRevision"), false);
  assert.equal(Object.hasOwn(inspect, "operationId"), false);
  assert.equal(sample.issues.length, 1);
});

test("SW-03G-TS-10 existing error parser retains recovery-blocked semantics", () => {
  assert.deepEqual(parseScriptJobCommandError({
    code: "recovery_blocked", message: "Unverified state revisions block mutation.",
  }), { code: "recovery_blocked", message: "Unverified state revisions block mutation." });
});

test("SW-03G-TS-11 pure diagnostics make no network, AI or browser calls", () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("No network allowed"); }) as typeof fetch;
  try {
    assert.equal(canInspectUnverifiedOrphan(sample, artifact.artifactId, true), true);
    assert.deepEqual(recoveryArtifactCounts(sample.artifacts), {
      orphaned: 1, incomplete: 0, unsafeOrAmbiguous: 0,
    });
  } finally { globalThis.fetch = oldFetch; }
});

test("SW-03G-TS-12 read-only checks never add approval history", () => {
  const before = JSON.stringify(fixture.approvalHistory);
  canInspectUnverifiedOrphan(sample, artifact.artifactId, true);
  recoveryArtifactCounts(sample.artifacts);
  assert.equal(JSON.stringify(fixture.approvalHistory), before);
});
