import type { DurableScriptJobV1 } from "./types.ts";

/** UI guard only. Rust rechecks everything at the durable approval boundary. */
export function canApproveScriptJob(job: DurableScriptJobV1): boolean {
  const reference = job.revisions[0];
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
