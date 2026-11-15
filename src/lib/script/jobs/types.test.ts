import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { validateScriptRequest } from "../core/request.ts";
import type { DurableScriptJobV1, ScriptJobRecoveryReport } from "./types.ts";

const fixturePath = fileURLToPath(new URL("./fixtures/job-v1.json", import.meta.url));
function fixture(): DurableScriptJobV1 {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as DurableScriptJobV1;
}
const digest = (value: string): string => "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");

test("SW-03B-13 shared Rust/TS fixture uses exact camelCase schema and stable field names", () => {
  const job = fixture();
  assert.deepEqual(Object.keys(job), [
    "schemaVersion", "jobId", "requestId", "channelId", "projectId", "request",
    "requestDigest", "state", "stateRevision", "createdAt", "updatedAt",
    "preparedPrompt", "revisions", "approvedRevisionId", "errorCode", "recoveryAction",
  ]);
  assert.equal(job.schemaVersion, 1);
  assert.equal(job.state, "created");
  assert.equal(job.stateRevision, 0);
  assert.equal(job.projectId, null);
  assert.equal(job.preparedPrompt, null);
  assert.equal(job.approvedRevisionId, null);
  assert.deepEqual(job.revisions, []);
});

test("SW-03B-13 TS Phase 01 validator accepts the Rust request fixture", () => {
  const job = fixture();
  assert.equal(validateScriptRequest(job.request).valid, true);
  assert.equal(job.request.masterPrompt.contentDigest, digest(job.request.masterPrompt.content));
  assert.equal(job.requestDigest, digest(JSON.stringify(job.request)));
});

test("SW-03B-14 ownership and immutable snapshot are consistent in the shared contract", () => {
  const job = fixture();
  assert.equal(job.requestId, job.request.requestId);
  assert.equal(job.channelId, job.request.channelId);
  assert.equal(job.projectId, job.request.projectId);
  assert.equal(job.channelId, job.request.masterPrompt.channelId);
  assert.match(job.jobId, /^sj_[a-f0-9]{32}$/);
  assert.equal(job.request.masterPrompt.content, "Write calm narration.");
});

test("SW-03B recovery issue enum and response are plain serializable data", () => {
  const report: ScriptJobRecoveryReport = {
    jobs: [fixture()],
    issues: [{ jobId: "sj_" + "b".repeat(32), kind: "unsupported_version", message: "Newer schema" }],
  };
  const roundTrip = JSON.parse(JSON.stringify(report)) as ScriptJobRecoveryReport;
  assert.equal(roundTrip.jobs.length, 1);
  assert.equal(roundTrip.issues[0]?.kind, "unsupported_version");
});
