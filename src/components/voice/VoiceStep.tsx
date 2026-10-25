import { Lock, LockOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { applySilenceRemoval, importVoice, previewSilence, skipSilenceRemoval } from "../../lib/audio";
import { fileName, isAcceptedAudio, AUDIO_EXTENSIONS } from "../../lib/audioFiles";
import { pickFile } from "../../lib/dialog";
import { isCancelled, toAppError } from "../../lib/errors";
import { unlockPatch } from "../../lib/projectReset";
import { formatClock } from "../../lib/time";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, CleanupParams, Project, SilenceReport, VoiceCleanup } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, SegmentedControl } from "../ui";
import { GenerateVoiceCard } from "./GenerateVoiceCard";
import { JobBar } from "./JobBar";
import { SilencePanel } from "./SilencePanel";
import { UnlockDialog } from "./UnlockDialog";
import { useFileDrop } from "./useFileDrop";
import { VoiceDropzone } from "./VoiceDropzone";
import { WaveformPlayer } from "./WaveformPlayer";

const VOICE_JOBS = ["silence-preview", "silence-apply", "silence-skip"] as const;

type View = "original" | "processed";

function paramsOf(cleanup: VoiceCleanup): CleanupParams {
  return {
    thresholdDb: cleanup.thresholdDb,
    minSilence: cleanup.minSilence,
    padding: cleanup.padding,
    normalize: cleanup.normalize,
  };
}

interface PreviewState {
  report: SilenceReport;
  /** The settings the preview was made with, so it can be hidden once they change. */
  key: string;
}

/** Step 1 of the Prompt Generator: bring in the voice, remove silences, lock it. */
export function VoiceStep({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const job = useJobStore(selectJob(VOICE_JOBS));
  const [view, setView] = useState<View>(project.voicePath ? "processed" : "original");
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const { voiceCleanup: cleanup, voiceLocked } = project;
  const busy = importing || job !== null;
  const paramsKey = JSON.stringify(paramsOf(cleanup));
  const report = preview && preview.key === paramsKey ? preview.report : null;
  const original = project.voiceOriginalPath;
  const hasProcessed = project.voicePath !== null;
  const shownPath = view === "processed" && project.voicePath ? project.voicePath : original;
  const shaded = useMemo(() => (view === "original" && report ? report.removed : []), [view, report]);

  const fail = useCallback((caught: unknown, fallback: string) => {
    if (isCancelled(caught)) {
      setNotice("Cancelled. Nothing was changed.");
      return;
    }
    setError(toAppError(caught, fallback));
  }, []);

  const importFile = useCallback(
    async (path: string) => {
      setError(null);
      setNotice(null);
      if (!isAcceptedAudio(path)) {
        setError({
          message: `${fileName(path)} is not a supported voice file. Please use ${AUDIO_EXTENSIONS.join(", ")}.`,
          details: `Unsupported file type: ${path}`,
        });
        return;
      }
      setImporting(true);
      try {
        const voice = await importVoice(project.id, path);
        update({
          voiceOriginalPath: voice.originalPath,
          voiceOriginalDuration: voice.duration,
          voiceSampleRate: voice.sampleRate,
          voiceChannels: voice.channels,
          voicePath: null,
          voiceDuration: voice.duration,
          cutMap: [],
          voiceCleanup: { ...cleanup, mode: "none" },
        });
        setPreview(null);
        setView("original");
        setVersion((v) => v + 1);
      } catch (caught) {
        fail(caught, "The voice file could not be imported.");
      } finally {
        setImporting(false);
      }
    },
    [project.id, cleanup, update, fail],
  );

  const pickVoice = useCallback(async () => {
    try {
      const path = await pickFile("Choose your voice-over", "Audio", AUDIO_EXTENSIONS);
      if (path) await importFile(path);
    } catch (caught) {
      fail(caught, "The file picker could not be opened.");
    }
  }, [importFile, fail]);

  const { dragging } = useFileDrop((paths) => {
    const first = paths[0];
    if (first) void importFile(first);
  }, !voiceLocked && !busy);

  async function runPreview() {
    if (!original) return;
    setError(null);
    setNotice(null);
    setView("original");
    try {
      const result = await runJob("silence-preview", "Finding silences", (id) =>
        previewSilence(project.id, original, paramsOf(cleanup), id),
      );
      setPreview({ report: result, key: paramsKey });
    } catch (caught) {
      fail(caught, "The silences could not be found.");
    }
  }

  async function finishCleanup(mode: "cut" | "skipped") {
    if (!original) return;
    setError(null);
    setNotice(null);
    try {
      const result =
        mode === "cut"
          ? await runJob("silence-apply", "Cutting silences", (id) =>
              applySilenceRemoval(project.id, original, paramsOf(cleanup), id),
            )
          : await runJob("silence-skip", "Preparing the voice", (id) =>
              skipSilenceRemoval(project.id, original, cleanup.normalize, id),
            );
      update({
        voicePath: result.processedPath,
        voiceDuration: result.duration,
        voiceSampleRate: result.sampleRate,
        voiceChannels: result.channels,
        cutMap: result.removed,
        voiceCleanup: { ...cleanup, mode },
      });
      setPreview(null);
      setView("processed");
      setVersion((v) => v + 1);
    } catch (caught) {
      fail(caught, mode === "cut" ? "The silences could not be removed." : "The voice could not be prepared.");
    }
  }

  const saved = cleanup.mode !== "none" && hasProcessed;
  const removedTotal = project.cutMap.reduce((sum, range) => sum + (range.end - range.start), 0);

  return (
    <div className="flex flex-col gap-6">
      {voiceLocked && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-success/40 bg-success/10 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lock size={16} aria-hidden className="text-success" />
            Voice locked. It cannot be changed or re-cut unless you unlock it.
          </p>
          <Button icon={LockOpen} onClick={() => setConfirmUnlock(true)}>
            Unlock
          </Button>
        </div>
      )}

      {error && <ErrorNotice error={error} />}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      {!voiceLocked && <GenerateVoiceCard project={project} disabled={busy || voiceLocked} onGenerated={importFile} />}

      {!original ? (
        <Card title="Your voice-over" description="Drop the narration here. It is copied into the project, your original stays where it is.">
          <VoiceDropzone dragging={dragging} busy={importing} buttonLabel="Choose voice file" onPick={() => void pickVoice()} />
        </Card>
      ) : (
        <>
          <Card
            title="Voice-over"
            description={`${fileName(original)} · ${formatClock(project.voiceOriginalDuration, 1)} · ${project.voiceSampleRate / 1000} kHz · ${
              project.voiceChannels === 1 ? "mono" : project.voiceChannels === 2 ? "stereo" : `${project.voiceChannels} channels`
            }`}
          >
            {hasProcessed && (
              <SegmentedControl<View>
                label="Which version to show"
                value={view}
                onChange={setView}
                options={[
                  { value: "original", label: "Original" },
                  { value: "processed", label: "Cleaned" },
                ]}
              />
            )}
            {shownPath && <WaveformPlayer projectId={project.id} path={shownPath} version={version} shaded={shaded} />}
            {saved && (
              <p className="text-sm text-muted" role="status">
                {cleanup.mode === "cut"
                  ? `Cleaned: ${project.cutMap.length} silent ${project.cutMap.length === 1 ? "part" : "parts"} removed (${formatClock(removedTotal, 1)}). New length ${formatClock(project.voiceDuration, 1)}.`
                  : `Kept as it is. Length ${formatClock(project.voiceDuration, 1)}.`}
              </p>
            )}
            {!voiceLocked && (
              <VoiceDropzone dragging={dragging} busy={importing} buttonLabel="Replace voice" compact onPick={() => void pickVoice()} />
            )}
          </Card>

          <Card title="Remove silences" description="Cut the long pauses so the video moves faster. Preview first, then Apply, or Skip to keep the voice as it is.">
            <SilencePanel
              cleanup={cleanup}
              report={report}
              disabled={voiceLocked}
              busy={busy}
              onChange={(patch) => update({ voiceCleanup: { ...cleanup, ...patch } })}
              onPreview={() => void runPreview()}
              onApply={() => void finishCleanup("cut")}
              onSkip={() => void finishCleanup("skipped")}
            />
            {job && <JobBar job={job} />}
          </Card>

          {!voiceLocked && (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
              <p className="text-sm text-muted">
                {hasProcessed
                  ? "Happy with the voice? Lock it to move on. After locking, it cannot be changed."
                  : "Apply or Skip first. Then you can lock the voice."}
              </p>
              <Button variant="primary" icon={Lock} disabled={!hasProcessed || busy} onClick={() => update({ voiceLocked: true })}>
                Lock Voice
              </Button>
            </div>
          )}
        </>
      )}

      {confirmUnlock && (
        <UnlockDialog
          onClose={() => setConfirmUnlock(false)}
          onConfirm={() => {
            update(unlockPatch());
            setConfirmUnlock(false);
          }}
        />
      )}
    </div>
  );
}
