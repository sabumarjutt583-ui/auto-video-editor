import { useCallback, useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { pickFile } from "../../lib/dialog";
import { fileName } from "../../lib/audioFiles";
import { buildOutcome, parseTimingFile } from "../../lib/timing/build";
import { readTextFile, transcribeVoice } from "../../lib/timing/api";
import { TimingParseError, type ParsedTiming, type TimedWord } from "../../lib/timing/types";
import { checkAgainstVoice } from "../../lib/timing/validate";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { ScriptCard } from "./ScriptCard";
import { SourceCard, type SourceKind } from "./SourceCard";
import { TimingPreview } from "./TimingPreview";

const TIMING_JOBS = ["transcribe"] as const;

/** Step 2 of the Prompt Generator: the script and the time of every word. */
export function TimingStep({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const job = useJobStore(selectJob(TIMING_JOBS));
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState("");
  const [working, setWorking] = useState(false);
  const [confirmRedo, setConfirmRedo] = useState(false);

  const hasTimings = project.words.length > 0;
  const busy = working || job !== null;

  const fail = useCallback((caught: unknown, fallback: string) => {
    if (isCancelled(caught)) {
      setNotice("Cancelled. Nothing was changed.");
      return;
    }
    if (caught instanceof TimingParseError) {
      setError({ message: caught.message, details: "The timing file could not be understood." });
      return;
    }
    setError(toAppError(caught, fallback));
  }, []);

  /** Saves the timed words (combined with the script) in the project. */
  const accept = useCallback(
    (speech: readonly TimedWord[], source: "srt" | "json" | "groq", estimated: boolean) => {
      if (speech.length === 0) {
        setError({
          message: "No words were found. Please check the file or the voice and try again.",
          details: "The timing result was empty.",
        });
        return;
      }
      const check = checkAgainstVoice(speech, project.voiceDuration);
      const outcome = buildOutcome(project.script, speech, project.voiceDuration);
      setWarning(check.ok ? "" : check.message);
      update({
        words: outcome.words,
        timingSource: source,
        timingEstimated: estimated,
        alignmentQuality: outcome.quality,
        unmatchedWords: outcome.unmatched,
        // Scenes were built from the old words.
        scenes: [],
        mediaMap: {},
      });
    },
    [project.script, project.voiceDuration, update],
  );

  const readFile = useCallback(
    async (kind: "srt" | "json") => {
      const extensions = kind === "srt" ? ["srt", "vtt", "txt"] : ["json"];
      const path = await pickFile(kind === "srt" ? "Choose an SRT or VTT file" : "Choose a JSON timing file", "Timing file", extensions);
      if (!path) return;
      const parsed: ParsedTiming = parseTimingFile(fileName(path), await readTextFile(path));
      accept(parsed.words, kind, parsed.estimated);
    },
    [accept],
  );

  async function choose(kind: SourceKind) {
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      if (kind === "groq") {
        const voice = project.voicePath;
        if (!voice) throw new Error("The voice is not ready.");
        const words = await runJob("transcribe", "Preparing the voice", (id) => transcribeVoice(project.id, voice, project.language, id));
        accept(words, "groq", false);
      } else {
        await readFile(kind);
      }
    } catch (caught) {
      fail(caught, kind === "groq" ? "The voice could not be transcribed." : "The file could not be used.");
    } finally {
      setWorking(false);
    }
  }

  function redo() {
    setConfirmRedo(false);
    setWarning("");
    update({
      words: [],
      scenes: [],
      mediaMap: {},
      timingSource: null,
      timingEstimated: false,
      alignmentQuality: null,
      unmatchedWords: [],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNotice error={error} />}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <ScriptCard
        script={project.script}
        language={project.language}
        locked={hasTimings}
        onScript={(script) => update({ script })}
        onLanguage={(language) => update({ language })}
        onError={(message, details) => setError({ message, details })}
      />

      {!hasTimings ? (
        <SourceCard busy={busy} job={job} onChoose={(kind) => void choose(kind)} />
      ) : (
        <>
          <TimingPreview project={project} warning={warning} onRedo={() => setConfirmRedo(true)} />
          {confirmRedo && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Redo the timings">
              <p className="text-sm">
                {project.scenes.length > 0
                  ? "This removes the word timings and also the scenes and prompts built from them. Your script and voice stay."
                  : "This removes the word timings. Your script and voice stay."}
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setConfirmRedo(false)}>Keep them</Button>
                <Button variant="danger" onClick={redo}>
                  Remove timings
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
