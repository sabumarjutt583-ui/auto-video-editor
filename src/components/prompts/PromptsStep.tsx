import { Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { copyText } from "../../lib/clipboard";
import { pickSavePath } from "../../lib/dialog";
import { isCancelled, toAppError } from "../../lib/errors";
import { generateText } from "../../lib/ai";
import { writeTextFile } from "../../lib/files";
import { copyLines, timecodeOf, toCsv, toJson } from "../../lib/prompts/export";
import { generatePrompts, reassemble, type PromptContext } from "../../lib/prompts/generate";
import { needsMotion } from "../../lib/prompts/assemble";
import { requestCancel, runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import { useStyleStore } from "../../store/styleStore";
import type { AppError, AspectRatio, Project, PromptSettings, Scene } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { JobBar } from "../voice/JobBar";
import { ExportBar } from "./ExportBar";
import { OptionsCard } from "./OptionsCard";
import { PromptRow } from "./PromptRow";

type Ask = "all" | null;

/** Step 5 of the Prompt Generator: write, edit and export the prompts. */
export function PromptsStep({ project }: { project: Project }) {
  const navigate = useNavigate();
  const update = useProjectStore((state) => state.update);
  const flush = useProjectStore((state) => state.flush);
  const styles = useStyleStore((state) => state.styles);
  const stylesLoaded = useStyleStore((state) => state.loaded);
  const job = useJobStore(selectJob(["ai"]));

  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ number: number; total: number } | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!stylesLoaded) void useStyleStore.getState().load();
  }, [stylesLoaded]);

  const style = styles.find((s) => s.id === project.styleId) ?? null;
  const { scenes, promptSettings: settings } = project;
  const withMotion = settings.outputType !== "image";
  const context: PromptContext | null = useMemo(
    () =>
      style
        ? { style, characters: project.characterBible, locations: project.locationBible, settings, aspect: project.settings.aspectRatio }
        : null,
    [style, project.characterBible, project.locationBible, settings, project.settings.aspectRatio],
  );

  const written = scenes.filter((scene) => scene.prompt.trim() !== "").length;
  const editedCount = scenes.filter((scene) => scene.edited).length;
  const busy = running || job !== null;

  const run = useCallback(
    async (targetIds: ReadonlySet<string>) => {
      if (!context || targetIds.size === 0) return;
      setError(null);
      setNotice(null);
      setAsk(null);
      setRunning(true);
      try {
        const result = await runJob("ai", "Writing prompts with Gemini", (jobId) =>
          generatePrompts({
            scenes: useProjectStore.getState().project?.scenes ?? scenes,
            targetIds,
            context,
            call: async (system, prompt) => (await generateText(prompt, system, true, jobId)).text,
            onBatch: (number, total) => setBatch({ number, total }),
            onScenes: (next) => update({ scenes: next }),
          }),
        );
        update({ scenes: result.scenes });
        if (result.failed) {
          setError(toAppError(result.failed.error, `Batch ${result.failed.batch} failed after 3 tries. The earlier batches were kept.`));
        }
      } catch (caught) {
        if (isCancelled(caught)) setNotice("Cancelled. Prompts that were already written are kept.");
        else setError(toAppError(caught, "The prompts could not be written."));
      } finally {
        setRunning(false);
        setBatch(null);
      }
    },
    [context, scenes, update],
  );

  const generateMissing = () => void run(new Set(scenes.filter((s) => s.prompt.trim() === "" && !s.edited).map((s) => s.id)));
  const regenerateAll = (keepEdited: boolean) => void run(new Set(scenes.filter((s) => !(keepEdited && s.edited)).map((s) => s.id)));

  const patch = (id: string, change: Partial<Scene>) => update({ scenes: scenes.map((s) => (s.id === id ? { ...s, ...change } : s)) });

  function applyOptions() {
    if (!context) return;
    update({ scenes: reassemble(scenes, context) });
    setNotice("The prompts were rebuilt with the new options. Edited rows were not changed.");
  }

  function setSettings(next: PromptSettings) {
    update({ promptSettings: next });
  }
  function setAspect(aspect: AspectRatio) {
    update({ settings: { ...project.settings, aspectRatio: aspect } });
  }

  async function copyAll() {
    const ok = await copyText(copyLines(scenes, withMotion));
    if (!ok) {
      setError({ message: "The text could not be copied. Use Export TXT instead.", details: "Clipboard access was refused." });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function exportAs(kind: "txt" | "csv" | "json") {
    setError(null);
    try {
      const content = kind === "txt" ? copyLines(scenes, withMotion) : kind === "csv" ? toCsv(scenes) : toJson(scenes);
      const path = await pickSavePath(`Export ${kind.toUpperCase()}`, `${project.name || "prompts"}.${kind}`, kind.toUpperCase(), [kind]);
      if (!path) return;
      await writeTextFile(path, content);
      setNotice(`Saved ${path}`);
    } catch (caught) {
      setError(toAppError(caught, "The file could not be saved."));
    }
  }

  async function send() {
    await flush();
    navigate("/auto-editor");
  }

  const hasPrompts = written > 0;
  const missing = scenes.length - written;

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNotice error={error} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}

      <OptionsCard project={project} style={style} onSettings={setSettings} onAspect={setAspect} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Sparkles} disabled={busy || !context || missing === 0} onClick={generateMissing}>
          {hasPrompts ? `Write the ${missing} missing prompts` : "Generate prompts"}
        </Button>
        <Button
          icon={Wand2}
          disabled={busy || !context || !hasPrompts}
          onClick={() => (editedCount > 0 ? setAsk("all") : regenerateAll(false))}
        >
          Regenerate all
        </Button>
        <Button disabled={busy || !context || !hasPrompts} onClick={applyOptions}>
          Apply new options
        </Button>
        <span className="text-sm text-muted">
          {written} of {scenes.length} scenes have a prompt
        </span>
      </div>

      {ask === "all" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Regenerate all prompts">
          <p className="text-sm">
            {editedCount} {editedCount === 1 ? "prompt was" : "prompts were"} edited by you. Replace {editedCount === 1 ? "it" : "them"} too?
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setAsk(null)}>Cancel</Button>
            <Button onClick={() => regenerateAll(true)}>Keep my edits</Button>
            <Button variant="danger" onClick={() => regenerateAll(false)}>
              Replace all
            </Button>
          </div>
        </div>
      )}

      {job && (
        <div className="flex flex-col gap-2">
          {batch && <p className="text-sm font-medium">Batch {batch.number} of {batch.total}</p>}
          <JobBar job={job} />
          <div>
            <Button onClick={() => requestCancel(job.id)}>Cancel</Button>
          </div>
        </div>
      )}

      <Card title="Prompts" description="Every prompt starts with its timecode when copied or exported. Edit any text; edited rows are kept when you regenerate.">
        <ExportBar disabled={!hasPrompts} copied={copied} onCopyAll={() => void copyAll()} onExport={(kind) => void exportAs(kind)} onSend={() => void send()} />
        <ul className="flex flex-col gap-2" aria-label="Prompts">
          {scenes.map((scene) => (
            <PromptRow
              key={scene.id}
              scene={scene}
              showMotion={needsMotion(scene, settings.outputType)}
              busy={busy || !context}
              onPrompt={(text) => patch(scene.id, { prompt: text, edited: true })}
              onMotion={(text) => patch(scene.id, { motionPrompt: text, edited: true })}
              onRegenerate={() => void run(new Set([scene.id]))}
              onCopy={() => void copyText(`${timecodeOf(scene)} | ${scene.prompt}`)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}
