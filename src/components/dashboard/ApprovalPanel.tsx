import { AlertTriangle, Play } from "lucide-react";

import { approvalFromView, stagesNeedingAttention } from "../../lib/pipeline/approval";
import { MAX_SCENE_RETRIES, type FailedScene } from "../../lib/pipeline/failedScenes";
import { runSummary } from "../../lib/pipeline/runSummary";
import { stageLabel, type Pauses, type StageId } from "../../lib/pipeline/stages";
import { sevenStepForStage, sevenStepLabel, REVIEW_TOGGLES, reviewToggleChecked, setReviewToggle } from "../../lib/pipeline/sevenSteps";
import type { RunView } from "../../lib/pipeline/view";
import type { Finished } from "../../store/pipelineStore";
import { Button, Card, Checkbox } from "../ui";

interface Props {
  /** The run that is going on (or went on last), from the pipeline store. */
  view: RunView;
  /** The step that waits for "Continue", or null. */
  waiting: StageId | null;
  /** The finished video of this run, or null. */
  finished: Finished | null;
  /** The channel's pauses, or null when the run's channel is not known. */
  pauses: Pauses | null;
  /** Called when a pause toggle changes. The change applies to the NEXT video, not the running one. */
  onPausesChange?: (pauses: Pauses) => void;
  /** Wired straight to the store's answer: true = Approve & Continue, false = Stop. */
  onAnswer: (go: boolean) => void;
  /** The existing resume path, or null when the video card's resume must be used instead. */
  onResume: (() => void) | null;
  /** Failed or missing scenes of the run's project, from the open project when it matches the run. */
  failedScenes: FailedScene[];
  /** The name of the project the failed list belongs to, or null when it is not available. */
  failedProjectName: string | null;
}

/** Pause for review for the video that is being made: the step that waits, what needs a look,
which scenes failed, and the five pause toggles. Nothing here runs a step: Approve & Continue
and Stop go to the store's existing answer, and Resume is the store's existing resume path
(finished steps are skipped, missing scenes are sent again). */
export function ApprovalPanel({ view, waiting, finished, pauses, onPausesChange, onAnswer, onResume, failedScenes, failedProjectName }: Props) {
  const summary = runSummary(view, finished);
  const approvals = approvalFromView(view);
  const attention = stagesNeedingAttention(approvals);
  const waitingDisplay = waiting ? sevenStepLabel(sevenStepForStage(waiting)) : null;

  return (
    <Card title="Pause for my review" description="Steps that wait for your Approve & Continue, and what needs a look before the video goes on.">
      <p className="text-sm text-muted" role="status">
        {summary.nextAction} ({summary.percent}% of the steps are finished.)
      </p>

      {waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <p className="text-sm font-medium">
            Waiting at {waitingDisplay} ({stageLabel(waiting)}). Check it, then press Approve &amp; Continue — or Stop to end the run here and resume later.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" icon={Play} onClick={() => onAnswer(true)}>
              Approve &amp; Continue
            </Button>
            <Button onClick={() => onAnswer(false)}>Stop</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">No step is waiting for you right now.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold">Needs a look</h3>
        {attention.length === 0 ? (
          <p className="text-sm text-muted">No step needs a look.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {attention.map((stage) => (
              <li key={stage} className="flex items-center gap-2 text-sm">
                <AlertTriangle size={14} className="text-danger" aria-hidden />
                {stageLabel(stage)} failed and needs a look before it runs again.
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Scenes that failed</h3>
        {failedProjectName === null ? (
          <p className="text-sm text-muted">Open the project to see which scenes failed — the list comes from the open project.</p>
        ) : failedScenes.length === 0 ? (
          <p className="text-sm text-muted">No scene of “{failedProjectName}” is missing a picture.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {failedScenes.map((scene) => (
                <li key={scene.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{scene.id}</span> — {scene.reason}
                  </span>
                  <span className="text-xs text-muted">{scene.retryable ? "Can be tried again" : `Needs a look first (tried ${MAX_SCENE_RETRIES} times)`}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Resume tries only the missing scenes — finished steps are skipped, so nothing is paid for twice.</p>
            {onResume && (
              <div className="mt-2">
                <Button variant="primary" onClick={onResume}>
                  Resume video
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {pauses !== null && onPausesChange && (
        <div>
          <h3 className="text-sm font-semibold">Pause for review</h3>
          <p className="text-xs text-muted">Tick a step to check it before it starts. These change the next video, not the one running now — the running video already took its pauses when it started.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {REVIEW_TOGGLES.map((toggle) => (
              <Checkbox
                key={toggle.id}
                label={toggle.label}
                checked={reviewToggleChecked(pauses, toggle)}
                onChange={(event) => onPausesChange(setReviewToggle(pauses, toggle, event.target.checked))}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
