import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { groupSentencesWithAi } from "../../lib/scenes/aiGroups";
import { buildBySeconds, buildBySentences, buildFromSentenceGroups, FALLBACK_SECONDS } from "../../lib/scenes/build";
import { setSceneLocation, toggleCharacter } from "../../lib/bible/edit";
import { editText, finishVideo, mergeWithNext, setMediaType, splitAtWord, totals, type Context } from "../../lib/scenes/edit";
import { splitSentences } from "../../lib/sentences";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, MediaType, Project, Scene, SceneSettings } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { JobBar } from "../voice/JobBar";
import { ModeCard } from "./ModeCard";
import { SceneTable } from "./SceneTable";
import { TotalsBar } from "./TotalsBar";

/** Step 3 of the Prompt Generator: cut the narration into scenes. */
export function ScenesStep({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const job = useJobStore(selectJob(["ai"]));
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [pending, setPending] = useState<SceneSettings | null>(null);

  const { words, scenes, voiceDuration, sceneSettings: settings } = project;
  const sentences = useMemo(() => splitSentences(words), [words]);
  const context: Context = useMemo(
    () => ({ words, sentences, voiceDuration, maxVideoSeconds: settings.maxVideoSeconds }),
    [words, sentences, voiceDuration, settings.maxVideoSeconds],
  );
  const stats = useMemo(() => totals(scenes), [scenes]);
  const hasPrompts = scenes.some((scene) => scene.prompt.trim() !== "");

  const apply = useCallback(
    async (next: SceneSettings) => {
      setError(null);
      setNotice(null);
      setPending(null);
      const input = { words, voiceDuration, settings: next };
      try {
        if (next.mode === "ai") {
          setBuilding(true);
          const groups = await groupSentencesWithAi(
            sentences.map((sentence) => sentence.text),
            (start) => runJob("ai", "Asking Gemini to group the sentences", start),
          );
          if (groups) {
            update({ sceneSettings: next, scenes: buildFromSentenceGroups(input, groups), mediaMap: {} });
          } else {
            update({ sceneSettings: next, scenes: buildBySeconds(input, FALLBACK_SECONDS), mediaMap: {} });
            setNotice(`Gemini's grouping could not be used, so the scenes were cut every ${FALLBACK_SECONDS} seconds instead.`);
          }
        } else if (next.mode === "seconds") {
          update({ sceneSettings: next, scenes: buildBySeconds(input), mediaMap: {} });
        } else {
          update({ sceneSettings: next, scenes: buildBySentences(input), mediaMap: {} });
        }
      } catch (caught) {
        if (isCancelled(caught)) setNotice("Cancelled. The scenes were not changed.");
        else setError(toAppError(caught, "The scenes could not be built."));
      } finally {
        setBuilding(false);
      }
    },
    [words, voiceDuration, sentences, update],
  );

  const request = useCallback(
    (next: SceneSettings) => {
      // Rebuilding throws away prompts, so ask first when there are some.
      if (hasPrompts) setPending(next);
      else void apply(next);
    },
    [hasPrompts, apply],
  );

  // Build the first scenes automatically when the step is opened.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || scenes.length > 0 || words.length === 0) return;
    started.current = true;
    void apply({ ...settings, mode: settings.mode === "ai" ? "sentence" : settings.mode });
  }, [scenes.length, words.length, settings, apply]);

  const change = (next: Scene[]) => update({ scenes: next });
  const busy = building || job !== null;

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNotice error={error} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}

      <ModeCard
        settings={settings}
        busy={busy}
        onChange={request}
        onMaxVideo={(seconds) => {
          const next = { ...settings, maxVideoSeconds: seconds };
          update({ sceneSettings: next, scenes: finishVideo([...scenes], { ...context, maxVideoSeconds: seconds }) });
        }}
      />
      {job && <JobBar job={job} />}
      {project.script.trim() === "" && scenes.length > 0 && (
        <p className="text-sm text-muted" role="status">
          No script was given, so the narration text comes from speech recognition (it may contain small mistakes). Paste your script in the Timing step to use your exact words.
        </p>
      )}

      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Rebuild the scenes">
          <p className="text-sm">Rebuilding the scenes removes the prompts that were already written and any scenes you merged, split or edited.</p>
          <div className="flex gap-2">
            <Button onClick={() => setPending(null)}>Keep my scenes</Button>
            <Button variant="danger" onClick={() => void apply(pending)}>
              Rebuild
            </Button>
          </div>
        </div>
      )}

      <Card title="Scenes" description="Each scene is one picture or clip. Pauses belong to the scene before them, so there are no gaps. Edit a text freely: its timing does not change.">
        {scenes.length === 0 ? (
          <p className="text-sm text-muted">{busy ? "Building the scenes…" : "No scenes yet."}</p>
        ) : (
          <>
            <TotalsBar totals={stats} />
            <SceneTable
              scenes={scenes}
              words={words}
              sentences={sentences}
              characters={project.characterBible}
              locations={project.locationBible}
              onToggleCharacter={(index, id) => change(toggleCharacter(scenes, index, id))}
              onLocation={(index, id) => change(setSceneLocation(scenes, index, id))}
              onMedia={(index, type: MediaType) => change(setMediaType(scenes, index, type, context))}
              onMerge={(index) => change(mergeWithNext(scenes, index, context))}
              onSplit={(index, wordIndex) => change(splitAtWord(scenes, index, wordIndex, context))}
              onText={(index, text) => change(editText(scenes, index, text))}
            />
          </>
        )}
      </Card>
    </div>
  );
}
