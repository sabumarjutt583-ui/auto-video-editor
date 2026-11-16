import { useRef, useState } from "react";

import type { ChannelProfile } from "../../lib/pipeline/profile.ts";
import { prepareLegacyScriptPrompt } from "../../lib/script/compatibility.ts";
import { compileScriptPrompt } from "../../lib/script/core/compiler.ts";
import {
  createScriptJob, getScriptJob, importScriptResponse, listScriptJobs, recoverScriptJobs,
  parseScriptJobCommandError, prepareScriptJob, readImportedScript, transitionScriptJob,
  startScriptValidation, completeScriptValidation, beginScriptReview, approveScriptRevision,
} from "../../lib/script/jobs/api.ts";
import type { DurableScriptJobV1, JobTransitionIdentity, LocalScriptJobAction } from "../../lib/script/jobs/types.ts";
import { copyPreparedPromptWithCheckpoint, validateManualResponse } from "../../lib/script/jobs/manual.ts";
import { canApproveScriptJob, currentSelectedScriptRevision } from "../../lib/script/jobs/review.ts";
import { ScriptRevisionManager } from "./ScriptRevisionManager";
import { ScriptRecoveryPanel } from "./ScriptRecoveryPanel";
import { copyScriptPreviewText } from "../../lib/script/previewSafety.ts";
import { Button } from "../ui";

interface Props {
  profile: ChannelProfile | null;
  title: string;
  topic: string;
  wordCountText: string;
  script: string;
}
const stableId = (prefix: string): string => prefix + "_" + crypto.randomUUID().replace(/-/g, "");
const identity = (job: DurableScriptJobV1): JobTransitionIdentity => ({
  jobId: job.jobId, channelId: job.channelId, requestId: job.requestId,
  expectedRevision: job.stateRevision, operationId: stableId("op"),
});
function safeError(error: unknown): string {
  const known = parseScriptJobCommandError(error);
  return known ? known.code + ": " + known.message
    : "Local job operation failed. Reopen the saved job to inspect its committed state.";
}

/** Development-only, explicit actions. No account, provider, browser, or pipeline calls. */
export function ScriptManualJobPanel({ profile, title, topic, wordCountText, script }: Props) {
  const [job, setJob] = useState<DurableScriptJobV1 | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [jobs, setJobs] = useState<DurableScriptJobV1[]>([]);
  const [selected, setSelected] = useState("");
  const [response, setResponse] = useState("");
  const [savedText, setSavedText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Retain a stable request ID across ambiguous create acknowledgement failures.
  // The parent remounts this panel when channel/video inputs change.
  const pendingRequestId = useRef<string | null>(null);
  const activeRevision = job ? currentSelectedScriptRevision(job) : undefined;

  if (!import.meta.env.DEV) return null;

  async function run<T>(action: () => Promise<T>, success: (value: T) => void) {
    if (busy) return;
    setError(""); setNotice(""); setBusy(true);
    try { success(await action()); }
    catch (caught) { setError(safeError(caught)); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!profile) { setError("Choose a channel first."); return; }
    const words = wordCountText.trim() === "" ? null : Number(wordCountText);
    const prepared = prepareLegacyScriptPrompt(profile, { title, topic, wordCount: words, script }, {
      requestId: pendingRequestId.current ?? (pendingRequestId.current = stableId("manual")),
      expectedChannelId: profile.id,
    });
    if (!prepared.ok) {
      setError(prepared.validation.errors.map(issue => issue.message).join(" ")); return;
    }
    await run(async () => {
      const created = await createScriptJob(prepared.request);
      setJob(created); // visible even if a later preparation checkpoint fails
      if (created.state !== "created") return created;
      const result = compileScriptPrompt(created.request);
      if (!result.ok) throw new Error("Invalid saved request");
      return prepareScriptJob({
        ...identity(created), promptText: result.compiled.promptText,
        masterPromptDigest: created.request.masterPrompt.contentDigest,
      });
    }, saved => { setJob(saved); setRecoveryBlocked(false); setNotice("Prompt saved durably. Nothing was sent."); });
  }

  async function loadJobs() {
    if (!profile) return;
    await run(() => listScriptJobs(), report => {
      const list = report.jobs.filter(item => item.channelId === profile.id);
      setJobs(list); setSelected(list[0]?.jobId ?? "");
      setNotice(report.issues.length
        ? "Recovery issues detected. Inspect existing jobs before changing them."
        : String(list.length) + " saved channel job(s) found.");
    });
  }

  async function reopen() {
    if (!profile || !selected) return;
    await run(async () => {
      try {
        return { saved: await getScriptJob(selected), blocked: false };
      } catch (caught) {
        if (parseScriptJobCommandError(caught)?.code !== "recovery_blocked") throw caught;
        // The normal get command correctly fails closed. A recovery report may
        // expose the last VERIFIED checkpoint for read-only diagnostic work.
        const report = await recoverScriptJobs();
        const saved = report.jobs.find(item => item.jobId === selected
          && item.channelId === profile.id);
        if (!saved || !report.issues.some(issue => issue.jobId === selected)) throw caught;
        return { saved, blocked: true };
      }
    }, ({ saved, blocked }) => {
      if (saved.channelId !== profile.id) { setError("Wrong channel ownership."); return; }
      setJob(saved); setRecoveryBlocked(blocked); setResponse(""); setSavedText("");
      setNotice(blocked
        ? "Recovered last verified checkpoint for READ-ONLY diagnosis. Normal job mutations remain blocked."
        : "Job reopened from disk. No provider request was made.");
    });
  }

  async function transition(action: LocalScriptJobAction) {
    if (!job) return;
    await run(() => transitionScriptJob({ ...identity(job), action }), saved => {
      setJob(saved); setNotice("Local state committed: " + saved.state);
    });
  }

  async function copy() {
    if (!job?.preparedPrompt) return;
    await run(() => copyPreparedPromptWithCheckpoint(job,
      async (current, action) => {
        const saved = await transitionScriptJob({ ...identity(current), action });
        setJob(saved);
        return saved;
      },
      async text => copyScriptPreviewText(text, navigator.clipboard, () => {
        const area = promptRef.current;
        if (!area) return false;
        area.focus(); area.select();
        return document.execCommand("copy");
      }),
    ), outcome => {
      setJob(outcome.saved);
      setNotice(outcome.copied
        ? "Clipboard copy confirmed. Submission is NOT confirmed."
        : "Clipboard copy unavailable. Select and manually copy the saved text, then explicitly confirm.");
    });
  }

  async function importText() {
    if (!job) return;
    const check = validateManualResponse(response);
    if (!check.valid) {
      setError(check.code === "response_too_large"
        ? "The maximum response size is 2 MiB."
        : "Paste a valid non-empty response without null characters.");
      return;
    }
    await run(() => importScriptResponse({ ...identity(job), text: response }), saved => {
      setJob(saved); setResponse("");
      setNotice("Immutable response saved locally. It is NOT approved or sent to video production.");
    });
  }


  /** Explicit transitions persist independently so a crash can resume validation. */
  async function advanceReview(step: "start" | "complete" | "review" | "approve") {
    if (!job || !activeRevision) { setError("No selected script revision is available."); return; }
    const reference = activeRevision;
    const data = {
      ...identity(job),
      revisionId: reference.revisionId,
      contentDigest: reference.contentDigest,
    };
    await run(() => {
      switch (step) {
        case "start": return startScriptValidation(data);
        case "complete": return completeScriptValidation(data);
        case "review": return beginScriptReview(data);
        case "approve": return approveScriptRevision({
          ...data, validationVersion: "script-rules-v1",
        });
      }
    }, saved => {
      setJob(saved);
      setNotice(step === "approve"
        ? "This exact script revision was approved by your explicit action. No video generation started."
        : "Durable review state saved: " + saved.state);
    });
  }

  async function showSaved() {
    if (!job || !activeRevision) return;
    const reference = activeRevision;
    await run(() => readImportedScript({
      jobId: job.jobId, channelId: job.channelId,
      requestId: job.requestId, revisionId: reference.revisionId,
    }), result => { setSavedText(result.text); setNotice("Verified saved response; no provider activity."); });
  }

  return (
    <section className="rounded-xl border border-dashed border-line bg-surface-2 p-4"
      aria-label="Manual Script Job — Development Only">
      <h3 className="text-sm font-semibold">Manual Script Job — Development Only</h3>
      <p className="mt-1 text-xs text-muted">
        Opt-in local draft review. Nothing is sent to Claude or Make Video. Approval requires your explicit action.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-muted">{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy || !profile} onClick={() => void create()}>Create and prepare local job</Button>
        <Button disabled={busy || !profile} onClick={() => void loadJobs()}>List saved channel jobs</Button>
      </div>
      {jobs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="manual-job-select" className="text-xs">Saved job</label>
          <select id="manual-job-select" value={selected} onChange={e => setSelected(e.target.value)}
            className="rounded border border-line bg-surface p-2 text-xs">
            {jobs.map(item => <option key={item.jobId} value={item.jobId}>
              {item.request.title || item.request.topic} — {item.state}
            </option>)}
          </select>
          <Button disabled={busy || !selected} onClick={() => void reopen()}>Reopen</Button>
        </div>
      )}
      {job && (
        <div className="mt-3 space-y-3">
          <p className="break-all text-xs">
            <strong>Job:</strong> {job.jobId} · <strong>State:</strong> {job.state} ·
            <strong> Revision:</strong> {job.stateRevision} · <strong>Channel:</strong> {job.channelId}
          </p>
          <ScriptRecoveryPanel job={job} />
          {recoveryBlocked && (
            <p role="alert" className="rounded border border-line p-2 text-xs text-danger">
              Recovery blocked: this is the last verified checkpoint, not an authorization to continue writing.
              No revision, validation or approval mutation is permitted until a separate provable repair is authorized.
            </p>
          )}
          <fieldset disabled={recoveryBlocked} className="space-y-3">
          {job.state === "created" &&
            <Button disabled={busy} onClick={() => {
              const compiled = compileScriptPrompt(job.request);
              if (!compiled.ok) { setError("Saved request failed validation."); return; }
              void run(() => prepareScriptJob({
                ...identity(job), promptText: compiled.compiled.promptText,
                masterPromptDigest: job.request.masterPrompt.contentDigest,
              }), saved => { setJob(saved); setNotice("Prepared from the immutable saved request."); });
            }}>Prepare saved request</Button>}
          {job.preparedPrompt && (
            <div>
              <label htmlFor="manual-job-prompt" className="text-sm font-medium">Saved prompt (read-only)</label>
              <textarea ref={promptRef} id="manual-job-prompt" readOnly value={job.preparedPrompt.content}
                rows={7} className="mt-1 w-full resize-y rounded border border-line bg-surface p-2 font-mono text-xs" />
              <div className="mt-2 flex flex-wrap gap-2">
                {(job.state === "prepared" || job.state === "awaiting_user_action") &&
                  <Button disabled={busy} onClick={() => void copy()}>Copy saved prompt</Button>}
                {job.state === "copy_intent" &&
                  <Button disabled={busy} onClick={() => void transition({ type: "confirm_copy" })}>I manually copied it</Button>}
                {job.state === "copy_intent" &&
                  <Button disabled={busy} onClick={() => void transition({
                    type: "await_user_action", reason: "manual_action",
                  })}>Clipboard unavailable</Button>}
                {(job.state === "copied" || job.state === "awaiting_user_action") &&
                  <Button disabled={busy} onClick={() => void transition({
                    type: "begin_manual_submission",
                  })}>Record submission intent</Button>}
              </div>
            </div>
          )}
          {(job.state === "submission_intent" || job.state === "submission_uncertain") && (
            <div className="space-y-2">
              <p className="text-xs text-muted">Only confirm what you personally know. The provider has not verified delivery.</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void transition({ type: "confirm_submitted" })}>I submitted manually</Button>
                <Button disabled={busy} onClick={() => void transition({ type: "confirm_not_submitted" })}>I did not submit</Button>
                {job.state === "submission_intent" &&
                  <Button disabled={busy} onClick={() => void transition({ type: "mark_submission_uncertain" })}>Unsure</Button>}
              </div>
            </div>
          )}
          {job.state === "submitted" && <p className="text-xs text-muted">Submission evidence: user-confirmed only.</p>}
          {job.preparedPrompt && ["prepared", "copy_intent", "copied", "awaiting_user_action",
            "submission_intent", "submission_uncertain", "submitted"].includes(job.state) && (
            <div>
              <label htmlFor="manual-response-text" className="text-sm font-medium">Paste completed response</label>
              <textarea id="manual-response-text" rows={7} value={response}
                onChange={e => setResponse(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface p-2 text-sm" />
              <div className="mt-2">
                <Button disabled={busy || !response.trim()} onClick={() => void importText()}>
                  Save immutable response (not approved)
                </Button>
              </div>
            </div>
          )}
          {activeRevision && (
            <div className="space-y-2">
              <p className="break-all text-xs text-muted">
                Selected: {activeRevision.revisionId} · Origin: {activeRevision.source} ·
                SHA-256: {activeRevision.contentDigest} ·
                {job.state === "approved" ? " Explicitly approved" : " Not approved"}
              </p>
              <Button disabled={busy} onClick={() => void showSaved()}>Read saved response</Button>
              {job.state === "response_received" &&
                <Button disabled={busy} onClick={() => void advanceReview("start")}>
                  Run validation — save progress
                </Button>}
              {job.state === "validating" &&
                <Button disabled={busy} onClick={() => void advanceReview("complete")}>
                  Finish validation and save findings
                </Button>}
              {job.reviewReport && (
                <div className="rounded border border-line p-3 text-xs" aria-label="Saved technical script validation">
                  <p className="font-semibold">Saved technical validation · {job.reviewReport.validationVersion}</p>
                  <p>Actual words: {job.reviewReport.actualWordCount.toLocaleString()}
                    {" · "}Requested: {job.reviewReport.requestedWordCount === null
                      ? "not specified" : job.reviewReport.requestedWordCount.toLocaleString()}</p>
                  <p>Technical errors: {job.reviewReport.findings.filter(f => f.severity === "error").length}
                    {" · "}Warnings: {job.reviewReport.findings.filter(f => f.severity === "warning").length}</p>
                  <p className="text-muted">Rule-based diagnostics only, not a factual accuracy, originality, storytelling-quality or virality score.</p>
                  {job.reviewReport.findings.length === 0
                    ? <p>No rule-based findings detected; human review is still necessary.</p>
                    : <ul className="mt-2 list-disc space-y-1 pl-4">
                      {job.reviewReport.findings.map(finding =>
                        <li key={finding.code}>
                          <strong>{finding.severity === "error" ? "Technical error" : "Writing warning"}:</strong>
                          {" "}{finding.message}
                        </li>)}
                    </ul>}
                </div>
              )}
              {job.state === "draft_saved" && (
                <Button disabled={busy} onClick={() => void advanceReview("review")}>Open human review</Button>
              )}
              {job.state === "review_pending" && (
                <div className="rounded border border-line p-2">
                  <p className="text-xs text-muted">
                    Approve ONLY after reading the full saved response. Warnings are not a guarantee of accuracy.
                    Approval is final for this immutable revision and will not start Make Video.
                  </p>
                  <Button disabled={busy || !canApproveScriptJob(job)}
                    onClick={() => void advanceReview("approve")}>
                    Explicitly approve this revision
                  </Button>
                </div>
              )}
              {job.state === "approved" && job.approvalRecord && (
                <p role="status" className="text-xs font-semibold">
                  Explicitly approved by user · {job.approvalRecord.approvedAt} ·
                  revision {job.approvalRecord.revisionId} · no pipeline handoff
                </p>
              )}

              {savedText && <textarea aria-label="Saved response" readOnly value={savedText} rows={6}
                className="w-full rounded border border-line bg-surface p-2 text-sm" />}
            </div>
          )}
          <ScriptRevisionManager job={job} onCommitted={next => {
            setJob(next);
            setSavedText("");
          }} />
          </fieldset>
        </div>
      )}
    </section>
  );
}
