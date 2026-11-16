import { useEffect, useRef, useState } from "react";

import {
  compareSavedScriptRevisions, createManualRevision, listSavedScriptRevisions,
  parseScriptJobCommandError, readImportedScript, selectScriptRevision,
} from "../../lib/script/jobs/api.ts";
import { validateManualResponse } from "../../lib/script/jobs/manual.ts";
import {
  canCreateScriptRevision, canSelectScriptRevision, summarizeScriptRevisionDiff,
} from "../../lib/script/jobs/revisions.ts";
import {
  currentSelectedScriptRevision, savedScriptApprovalHistory,
} from "../../lib/script/jobs/review.ts";
import type {
  DurableScriptJobV1, ImportedScriptRevisionRef, ScriptRevisionComparison,
} from "../../lib/script/jobs/types.ts";
import { Button } from "../ui";

interface Props {
  job: DurableScriptJobV1;
  onCommitted: (next: DurableScriptJobV1) => void;
}
type PendingEdit = {
  readonly key: string;
  readonly operationId: string;
};
const newOperationId = (): string => "op_" + crypto.randomUUID().replace(/-/g, "");
function identity(job: DurableScriptJobV1, operationId: string) {
  return {
    jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
    expectedRevision: job.stateRevision, operationId,
  };
}
const canEdit = (state: DurableScriptJobV1["state"]): boolean =>
  ["response_received", "validating", "draft_saved", "review_pending", "approved"].includes(state);

/** No background commands or provider imports. All actions require an explicit click. */
export function ScriptRevisionManager({ job, onCommitted }: Props) {
  const selected = currentSelectedScriptRevision(job);
  const [draftText, setDraftText] = useState("");
  const [originId, setOriginId] = useState("");
  const [selectionId, setSelectionId] = useState("");
  const [readId, setReadId] = useState("");
  const [readText, setReadText] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [comparison, setComparison] = useState<ScriptRevisionComparison | null>(null);
  const [listedRevisions, setListedRevisions] = useState<readonly ImportedScriptRevisionRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingEdit = useRef<PendingEdit | null>(null);

  useEffect(() => {
    setComparison(null);
    setReadText("");
    setListedRevisions(null);
  }, [job.jobId, job.stateRevision]);

  if (!import.meta.env.DEV || !selected) return null;

  async function execute<T>(operation: () => Promise<T>, accepted: (result: T) => void): Promise<void> {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { accepted(await operation()); }
    catch (caught) {
      const recognized = parseScriptJobCommandError(caught);
      setError(recognized
        ? recognized.code + ": " + recognized.message
        : "Local revision operation failed. Reopen the job to check committed state.");
    } finally { setBusy(false); }
  }

  async function createRevision(): Promise<void> {
    if (!selected || !canEdit(job.state)) return;
    const validity = validateManualResponse(draftText);
    if (!validity.valid) {
      setError(validity.code === "response_too_large" ? "Maximum response size is 2 MiB."
        : "Provide a nonempty edited script without null characters.");
      return;
    }
    const parent = originId || selected.revisionId;
    if (!canCreateScriptRevision(job, parent, draftText)) {
      setError("The manual edit requires a valid saved source and an editable job state."); return;
    }
    const key = JSON.stringify([job.jobId, job.stateRevision, parent, draftText]);
    if (pendingEdit.current?.key !== key) {
      pendingEdit.current = { key, operationId: newOperationId() };
    }
    const operationId = pendingEdit.current.operationId;
    await execute(
      () => createManualRevision({
        ...identity(job, operationId),
        originRevisionId: parent, text: draftText,
      }),
      next => {
        onCommitted(next);
        pendingEdit.current = null;
        setDraftText("");
        setNotice("New immutable manual revision saved. Prior approval was archived, not inherited.");
      },
    );
  }

  async function selectRevision(): Promise<void> {
    if (!canSelectScriptRevision(job, selectionId)) return;
    await execute(
      () => selectScriptRevision({ ...identity(job, newOperationId()), revisionId: selectionId }),
      next => {
        onCommitted(next);
        setNotice("Selected version requires fresh validation, review and explicit approval.");
      },
    );
  }

  async function listRevisions(): Promise<void> {
    await execute(
      () => listSavedScriptRevisions({
        jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
      }),
      list => { setListedRevisions(list); setNotice("Verified committed revision list."); },
    );
  }

  async function openRevision(): Promise<void> {
    const id = readId || selected.revisionId;
    await execute(
      () => readImportedScript({
        jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
        revisionId: id,
      }),
      result => {
        setReadId(id);
        setReadText(result.text);
        setNotice("Exact saved UTF-8 text read with SHA-256 integrity check.");
      },
    );
  }

  async function compare(): Promise<void> {
    const a = compareA || job.revisions[0]?.revisionId;
    const b = compareB || job.revisions[job.revisions.length - 1]?.revisionId;
    if (!a || !b || a === b) {
      setError("Choose two different committed revisions."); return;
    }
    await execute(
      () => compareSavedScriptRevisions({
        jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
        revisionA: a, revisionB: b,
      }),
      report => {
        setComparison(report);
        setNotice("Local line comparison completed without changing saved text.");
      },
    );
  }

  const approvals = savedScriptApprovalHistory(job);
  return (
    <section aria-label="Manual script revisions — Development Only"
      className="mt-4 space-y-3 rounded-lg border border-line p-3">
      <h4 className="font-semibold text-sm">Revision History — Development Only</h4>
      <p className="text-xs text-muted">
        Every version is an immutable manual import. Choosing an old version does not restore approval.
        No AI provider or video pipeline is invoked.
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
      <p className="break-all text-xs">
        Current selected revision: <strong>{selected.revisionId}</strong>
        {" · "}{job.state === "approved" && job.approvedRevisionId === selected.revisionId
          ? "CURRENTLY APPROVED" : "NOT CURRENTLY APPROVED"}
      </p>
      <Button disabled={busy} onClick={() => void listRevisions()}>Verify revision history from disk</Button>
      <div className="space-y-1 text-xs">
        {(listedRevisions ?? job.revisions).map((revision, index) => (
          <div key={revision.revisionId} className="break-all rounded border border-line p-2">
            <strong>Version {index + 1}</strong>{" · "}{revision.createdAt}
            {" · "}{revision.source}
            {" · "}{revision.byteLength.toLocaleString()} bytes
            {" · SHA-256 "}{revision.contentDigest}
            {revision.originRevisionId && <p>Based on: {revision.originRevisionId}</p>}
            {revision.revisionId === selected.revisionId && <p><strong>Selected for review</strong></p>}
            {(job.validationHistory ?? []).filter(report => report.revisionId === revision.revisionId)
              .map((report, i) => <p key={i}>
                Saved validation: {report.actualWordCount} words · {report.findings.length} findings · {report.validationVersion}
              </p>)}
          </div>
        ))}
      </div>

      <div className="rounded border border-line p-3 space-y-2">
        <label htmlFor="script-read-revision" className="text-xs">Read any saved version</label>
        <select id="script-read-revision" value={readId} onChange={event => {
          setReadId(event.target.value); setReadText("");
        }} className="w-full rounded border border-line bg-surface p-2 text-xs">
          <option value="">Current selected version</option>
          {job.revisions.map((revision, index) =>
            <option key={revision.revisionId} value={revision.revisionId}>Version {index + 1} · {revision.createdAt}</option>)}
        </select>
        <Button disabled={busy} onClick={() => void openRevision()}>Read and verify text</Button>
        {readText && <textarea aria-label="Verified immutable revision text" value={readText} readOnly rows={7}
          className="w-full rounded border border-line bg-surface p-2 text-sm"/>}
      </div>

      {canEdit(job.state) && job.revisions.length < 64 && (
        <div className="rounded border border-line p-3 space-y-2">
          <h5 className="text-xs font-semibold">Create a new manually edited version</h5>
          <label htmlFor="script-revision-parent" className="text-xs">Based on existing version</label>
          <select id="script-revision-parent" value={originId} onChange={event => setOriginId(event.target.value)}
            className="w-full rounded border border-line bg-surface p-2 text-xs">
            <option value="">Current selected version</option>
            {job.revisions.map((revision, index) =>
              <option key={revision.revisionId} value={revision.revisionId}>Version {index + 1}</option>)}
          </select>
          <label htmlFor="script-revision-text" className="text-xs">Paste complete manually edited script</label>
          <textarea id="script-revision-text" value={draftText} rows={8}
            onChange={event => setDraftText(event.target.value)}
            placeholder="Paste the full revised script here. Existing versions will not be overwritten."
            className="w-full rounded border border-line bg-surface p-2 text-sm"/>
          <Button disabled={busy || !canCreateScriptRevision(job, originId || selected.revisionId, draftText)}
            onClick={() => void createRevision()}>
            Save new immutable revision (not approved)
          </Button>
        </div>
      )}

      {canEdit(job.state) && job.revisions.length > 1 && (
        <div className="rounded border border-line p-3 space-y-2">
          <label htmlFor="script-reselect-revision" className="text-xs">Select earlier version for new review</label>
          <select id="script-reselect-revision" value={selectionId} onChange={event => setSelectionId(event.target.value)}
            className="w-full rounded border border-line bg-surface p-2 text-xs">
            <option value="">Choose a saved version</option>
            {job.revisions.map((revision, index) =>
              <option key={revision.revisionId} value={revision.revisionId}>Version {index + 1}</option>)}
          </select>
          <Button disabled={busy || !canSelectScriptRevision(job, selectionId)}
            onClick={() => void selectRevision()}>
            Select for fresh validation and review
          </Button>
        </div>
      )}

      {job.revisions.length > 1 && (
        <div className="rounded border border-line p-3 space-y-2">
          <h5 className="text-xs font-semibold">Compare two immutable versions (offline)</h5>
          <label htmlFor="revision-compare-a" className="text-xs">Revision A</label>
          <select id="revision-compare-a" value={compareA} onChange={e => setCompareA(e.target.value)}
            className="w-full rounded border border-line bg-surface p-2 text-xs">
            <option value="">First version</option>
            {job.revisions.map((rev, i) =>
              <option key={rev.revisionId} value={rev.revisionId}>Version {i + 1}</option>)}
          </select>
          <label htmlFor="revision-compare-b" className="text-xs">Revision B</label>
          <select id="revision-compare-b" value={compareB} onChange={e => setCompareB(e.target.value)}
            className="w-full rounded border border-line bg-surface p-2 text-xs">
            <option value="">Latest version</option>
            {job.revisions.map((rev, i) =>
              <option key={rev.revisionId} value={rev.revisionId}>Version {i + 1}</option>)}
          </select>
          <Button disabled={busy} onClick={() => void compare()}>Compare verified texts</Button>
          {comparison && (
            <div aria-label="Saved revision text comparison" className="space-y-2">
              <p className="break-all text-xs">
                A: {comparison.revisionA.revisionId} · {comparison.revisionA.createdAt}
                {" · "}{comparison.wordCountA} words
              </p>
              <p className="break-all text-xs">
                B: {comparison.revisionB.revisionId} · {comparison.revisionB.createdAt}
                {" · "}{comparison.wordCountB} words
              </p>
              <p className="text-xs">
                {summarizeScriptRevisionDiff(comparison).addedLines} added lines ·
                {" "}{summarizeScriptRevisionDiff(comparison).removedLines} removed lines ·
                {" "}{summarizeScriptRevisionDiff(comparison).unchangedLines} unchanged lines
              </p>
              <div className="max-h-96 overflow-y-auto rounded border border-line p-2 text-xs">
                {comparison.lines.map((line, i) => (
                  <pre key={i} className={"whitespace-pre-wrap break-words " +
                    (line.kind === "added" ? "bg-green-500/10" :
                      line.kind === "removed" ? "bg-red-500/10" : "")}>
                    {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.text}
                  </pre>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded border border-line p-3 space-y-1 text-xs">
        <h5 className="font-semibold">Approval history (not automatically active)</h5>
        {approvals.length === 0 && <p>No revisions have ever been approved.</p>}
        {approvals.map((proof, i) =>
          <p key={proof.revisionId + proof.approvedAt + i} className="break-all">
            {proof.revisionId} · {proof.approvedAt} · {proof.source}
            {job.state === "approved" && job.approvedRevisionId === proof.revisionId
              ? " · ACTIVE" : " · historical only"}
          </p>)}
      </div>
    </section>
  );
}
