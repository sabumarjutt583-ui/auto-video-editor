import { useEffect, useState } from "react";

import {
  inspectScriptJobRecovery, inspectScriptOrphanText, parseScriptJobCommandError,
} from "../../lib/script/jobs/api.ts";
import type {
  DurableScriptJobV1, ScriptJobRecoveryInspection, ScriptRecoveryArtifactText,
} from "../../lib/script/jobs/types.ts";
import { canInspectUnverifiedOrphan, recoveryArtifactCounts } from "../../lib/script/jobs/recovery.ts";
import { Button } from "../ui";

interface Props { readonly job: DurableScriptJobV1; }
function safeMessage(error: unknown): string {
  const typed = parseScriptJobCommandError(error);
  return typed ? typed.code + ": " + typed.message
    : "Local recovery inspection could not finish; no saved text was changed.";
}

/** This panel has NO recovery mutations and NO provider or browser interfaces.
 * Orphan bytes may be displayed only after a direct user acknowledgment. */
export function ScriptRecoveryPanel({ job }: Props) {
  const [report, setReport] = useState<ScriptJobRecoveryInspection | null>(null);
  const [artifactId, setArtifactId] = useState("");
  const [consent, setConsent] = useState(false);
  const [inspected, setInspected] = useState<ScriptRecoveryArtifactText | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setReport(null); setArtifactId(""); setConsent(false);
    setInspected(null); setError(""); setNotice("");
  }, [job.jobId, job.channelId, job.requestId, job.stateRevision]);

  if (!import.meta.env.DEV) return null;

  async function inspect(): Promise<void> {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); setInspected(null);
    try {
      const next = await inspectScriptJobRecovery({
        jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
      });
      setReport(next);
      setArtifactId(""); setConsent(false);
      setNotice(next.blocked
        ? "Unresolved recovery issues. Job mutations remain blocked; all files are preserved."
        : "No blocking recovery issue detected. Diagnostic inspection changed no files.");
    } catch (caught) { setError(safeMessage(caught)); }
    finally { setBusy(false); }
  }

  async function readOrphan(): Promise<void> {
    const artifact = report?.artifacts.find(item => item.artifactId === artifactId);
    if (!artifact || !canInspectUnverifiedOrphan(report, artifactId, consent) || busy) return;
    setBusy(true); setError(""); setInspected(null);
    try {
      const text = await inspectScriptOrphanText({
        jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
        artifactId: artifact.artifactId,
      });
      setInspected(text);
      setNotice("Viewed unverified orphaned text. It was NOT attached, approved, rewritten or sent.");
    } catch (caught) { setError(safeMessage(caught)); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-dashed border-line p-3 space-y-3"
      aria-label="Recovery diagnostics — Development Only">
      <h4 className="text-sm font-semibold">Recovery Diagnostics — Development Only</h4>
      <p className="text-xs text-muted">
        Explicit local inspection only. Phase 03F revision filenames do not prove
        request or operation provenance, so automatic reattachment is disabled.
        Nothing is deleted, approved, sent to AI or passed to video production.
      </p>
      <Button disabled={busy} onClick={() => void inspect()}>Inspect this job for recovery issues</Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
      {report && (
        <div className="space-y-2 text-xs">
          <p className="break-all"><strong>Job:</strong> {report.jobId} · <strong>Channel:</strong> {report.channelId}
            {" · "}<strong>Request:</strong> {report.requestId} ·
            <strong> Last verified checkpoint:</strong> {report.lastVerifiedStateRevision}
          </p>
          <p><strong>Status:</strong> {report.blocked
            ? "BLOCKED — unresolved evidence remains" : "No blocking findings in current scan"}
            {" · "}Safe automatic reattachment: {report.reconciliationSupported ? "Available" : "Not available"}
          </p>
          {report.issues.length === 0 && <p>No current recovery issues.</p>}
          {report.issues.map((issue, index) => (
            <p key={index} className="rounded border border-line p-2 break-words">
              <strong>{issue.kind}</strong> · {issue.message}
            </p>
          ))}
          <p className="font-medium">Artifacts in this job's revisions directory</p>
          <p>
            Orphan files: {recoveryArtifactCounts(report.artifacts).orphaned} ·
            Incomplete files: {recoveryArtifactCounts(report.artifacts).incomplete} ·
            Unsafe or ambiguous: {recoveryArtifactCounts(report.artifacts).unsafeOrAmbiguous}
          </p>
          {report.artifacts.length === 0 && <p>No unreferenced or temporary revision artifacts.</p>}
          {report.artifacts.map(item => (
            <div key={item.artifactId} className="rounded border border-line p-2 break-all">
              <p><strong>{item.kind}</strong> · {item.artifactId}</p>
              <p>{item.explanation}</p>
              <p>Size: {item.byteLength === null ? "Unknown" : item.byteLength + " bytes"} ·
                Digest: {item.contentDigest ?? "Unavailable"} ·
                Text inspection: {item.canReadText ? "Available on explicit request" : "Not safe"}
              </p>
              <p>Attachment provenance proven: <strong>No</strong></p>
            </div>
          ))}
          <div className="space-y-2 rounded border border-line p-2">
            <label htmlFor="recovery-artifact-select" className="text-xs font-medium">
              Select a readable orphan (inspection does not change the job)
            </label>
            <select id="recovery-artifact-select" value={artifactId}
              onChange={event => { setArtifactId(event.target.value); setInspected(null); setConsent(false); }}
              className="w-full rounded border border-line bg-surface p-2 text-xs">
              <option value="">Select an orphan revision</option>
              {report.artifacts.filter(item => item.kind === "orphan_revision" && item.canReadText)
                .map(item => <option key={item.artifactId} value={item.artifactId}>{item.artifactId}</option>)}
            </select>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>
              I understand this text is unverified, is not being reattached and must not inherit an old approval.
            </label>
            <Button disabled={busy || !canInspectUnverifiedOrphan(report, artifactId, consent)} onClick={() => void readOrphan()}>
              Read unverified orphan text (no write)
            </Button>
            {inspected && (
              <div className="space-y-2">
                <p className="break-all">Read-only SHA-256: {inspected.contentDigest}
                  {" · "}{inspected.byteLength} bytes</p>
                <textarea aria-label="Unverified orphan recovery text" readOnly rows={8} value={inspected.text}
                  className="w-full resize-y rounded border border-line bg-surface p-2 text-sm" />
                <p className="text-muted">
                  You may manually copy this text for safekeeping. No automatic export, revision attachment,
                  or approval is performed. Retain the original file for future verified reconciliation.
                </p>
              </div>
            )}
          </div>
          <p className="text-muted">
            Previously committed versions and historical approvals are not altered by inspection.
            Damaged checkpoints or unknown future schemas require separate, verified repair planning.
          </p>
        </div>
      )}
    </section>
  );
}
