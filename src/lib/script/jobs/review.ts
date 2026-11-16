import type { DurableScriptJobV1, ImportedScriptRevisionRef, ScriptApprovalRecord } from "./types.ts";

/** Older Phase 03D/E jobs have an implicit first-and-only selected revision. */
export function currentSelectedScriptRevision(job: DurableScriptJobV1): ImportedScriptRevisionRef | undefined {
  const selectedId = job.selectedRevisionId ?? job.revisions[0]?.revisionId;
  return job.revisions.find(revision => revision.revisionId === selectedId);
}

/** Historical evidence is not automatically active when an old revision is reselected. */
export function savedScriptApprovalHistory(job: DurableScriptJobV1): readonly ScriptApprovalRecord[] {
  const history = job.approvalHistory ?? [];
  return job.approvalRecord && !history.some(item =>
    item.revisionId === job.approvalRecord?.revisionId
    && item.approvedAt === job.approvalRecord?.approvedAt)
    ? [...history, job.approvalRecord] : history;
}

/** UI guard only. Rust rechecks everything at the durable approval boundary. */
export function canApproveScriptJob(job: DurableScriptJobV1): boolean {
  const reference = currentSelectedScriptRevision(job);
  const report = job.reviewReport;
  if (job.state !== "review_pending" || !reference || !report
      || job.approvalRecord || job.approvedRevisionId) return false;
  return report.validationVersion === "script-rules-v1"
    && report.revisionId === reference.revisionId
    && report.contentDigest === reference.contentDigest
    && report.requestedWordCount === job.request.requestedWords
    && report.findings.every(finding => finding.severity !== "error");
}

export function reviewFindingCounts(job: DurableScriptJobV1): { technicalErrors: number; warnings: number } {
  const findings = job.reviewReport?.findings ?? [];
  return {
    technicalErrors: findings.filter(f => f.severity === "error").length,
    warnings: findings.filter(f => f.severity === "warning").length,
  };
}
