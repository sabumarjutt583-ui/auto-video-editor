import { Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { copyText } from "../../lib/clipboard";
import { pickSavePath } from "../../lib/dialog";
import { isCancelled, toAppError } from "../../lib/errors";
import { generateText } from "../../lib/ai";
import { writeTextFile } from "../../lib/files";
import { clampEmptyLines, copyBlock, copyLines, toCsv, toJson } from "../../lib/prompts/export";
import { generatePrompts, reassemble, type PromptContext } from "../../lib/prompts/generate";
import { runChatPrompts } from "../../lib/prompts/chat/runner";
import { loadThread, saveThread } from "../../lib/prompts/chat/threadStore";
import { webChatTransport } from "../../lib/prompts/chat/tauriTransport";
import { needsMotion } from "../../lib/prompts/assemble";
import { requestCancel, runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useStyleStore } from "../../store/styleStore";
import type { AppError, AspectRatio, Project, PromptSettings, Scene } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { JobBar } from "../voice/JobBar";
import { ExportBar } from "./ExportBar";
import { OptionsCard } from "./OptionsCard";
import { PromptRow } from "./PromptRow";
import { ManualPanel } from "./ManualPanel";
import { clearPrompts, restorePrompts, withoutDeleted, type RemovedPrompt } from "../../lib/prompts/delete";
import { EngineSwitch } from "../quick/EngineSwitch";

type Ask = "all" | "clear" | null;

/** Step 5 of the Prompt Generator: write, edit and export the prompts. */
export function PromptsStep({ project, quick = false }: { project: Project; quick?: boolean }) {
  const navigate = useNavigate();
  const update = useProjectStore((state) => state.update);
  const flush = useProjectStore((state) => state.flush);
  const styles = useStyleStore((state) => state.styles);
  const stylesLoaded = useStyleStore((state) => state.loaded);
  const job = useJobStore(selectJob(["ai"]));
  const appSettings = useSettingsStore((state) => state.settings);
  const updateAppSettings = useSettingsStore((state) => state.update);
  const emptyLines = clampEmptyLines(appSettings?.exportEmptyLines ?? 2);
  const includeIds = appSettings?.exportIncludeIds ?? true;

  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ number: number; total: number; account?: string } | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<{ removed: RemovedPrompt[]; count: number } | null>(null);
  const deletedRef = useRef<Set<string>>(new Set());
  const undoTimer = useRef<number | null>(null);

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
  const manual = appSettings?.textManual === true;

  const run = useCallback(
    async (targetIds: ReadonlySet<string>) => {
      if (!context || targetIds.size === 0) return;
      setError(null);
      setNotice(null);
      setAsk(null);
      setRunning(true);
      deletedRef.current = new Set();
      try {
        const viaChat = appSettings?.textViaChat === true;
        const result = await runJob("ai", "Writing prompts with Gemini", async (jobId) => {
          const current = useProjectStore.getState().project?.scenes ?? scenes;
          if (viaChat) {
            const chatResult = await runChatPrompts({
              scenes: current,
              targetIds,
              context,
              transport: webChatTransport(jobId),
              tag: project.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "P",
              batchSize: Math.min(25, Math.max(5, appSettings?.chatBatchSize ?? 20)),
              thread: loadThread(project.id),
              onThread: (thread) => saveThread(project.id, thread),
              onBatch: ({ batch: number, total, account }) => setBatch({ number, total, account }),
              onScenes: (next) => update({ scenes: withoutDeleted(next, useProjectStore.getState().project?.scenes ?? next, deletedRef.current) }),
            });
            return { scenes: chatResult.scenes, failed: chatResult.failed ? { batch: chatResult.failed.batch, error: chatResult.failed.error } : null };
          }
          return generatePrompts({
            scenes: useProjectStore.getState().project?.scenes ?? scenes,
            targetIds,
            context,
            resendOnError: !appSettings?.textViaChat,
            call: async (system, prompt) => (await generateText(prompt, system, true, jobId)).text,
            onBatch: (number, total) => setBatch({ number, total }),
            onScenes: (next) => update({ scenes: withoutDeleted(next, useProjectStore.getState().project?.scenes ?? next, deletedRef.current) }),
          });
        });
        update({ scenes: withoutDeleted(result.scenes, useProjectStore.getState().project?.scenes ?? result.scenes, deletedRef.current) });
        if (result.failed) {
          setError(toAppError(result.failed.error, `Batch ${result.failed.batch} failed. The earlier batches were kept.`));
        }
      } catch (caught) {
        if (isCancelled(caught)) setNotice("Cancelled. Prompts that were already written are kept.");
        else setError(toAppError(caught, "The prompts could not be written."));
      } finally {
        setRunning(false);
        setBatch(null);
      }
    },
    [context, scenes, update, appSettings?.textViaChat, appSettings?.chatBatchSize, project.id],
  );

  const generateMissing = () => void run(new Set(scenes.filter((s) => s.prompt.trim() === "" && !s.edited).map((s) => s.id)));
  const regenerateAll = (keepEdited: boolean) => void run(new Set(scenes.filter((s) => !(keepEdited && s.edited)).map((s) => s.id)));

  function deletePrompts(ids: ReadonlySet<string> | null) {
    const current = useProjectStore.getState().project?.scenes ?? scenes;
    const { scenes: next, removed } = clearPrompts(current, ids);
    if (removed.length === 0) return;
    for (const r of removed) deletedRef.current.add(r.id);
    update({ scenes: next });
    setSelected(new Set());
    setAsk(null);
    setUndo({ removed, count: removed.length });
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 10_000);
  }

  function undoDelete() {
    if (!undo) return;
    const current = useProjectStore.getState().project?.scenes ?? scenes;
    for (const r of undo.removed) deletedRef.current.delete(r.id);
    update({ scenes: restorePrompts(current, undo.removed) });
    setUndo(null);
  }

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
    const ok = await copyText(copyLines(scenes, { withMotion, emptyLines, includeIds }));
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
      const content = kind === "txt" ? copyLines(scenes, { withMotion, emptyLines, includeIds }) : kind === "csv" ? toCsv(scenes) : toJson(scenes);
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

      {!quick && <EngineSwitch />}
      {manual && <ManualPanel scenes={scenes} context={context} tag={project.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "P"} batchSize={Math.min(25, Math.max(5, appSettings?.chatBatchSize ?? 20))} onScenes={(next) => update({ scenes: next })} deleted={deletedRef.current} />}

      <div className={manual ? "hidden" : "flex flex-wrap items-center gap-2"}>
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
        <Button variant="danger" disabled={busy || !hasPrompts} onClick={() => setAsk("clear")}>
          Clear all prompts
        </Button>
        <Button disabled={busy || !context || !hasPrompts} onClick={applyOptions}>
          Apply new options
        </Button>
        <span className="text-sm text-muted">
          {written} of {scenes.length} scenes have a prompt
        </span>
      </div>

      {ask === "clear" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Clear all prompts">
          <p className="text-sm">Delete all {written} prompts? Your script, scenes and settings stay. You can undo for 10 seconds.</p>
          <div className="flex gap-2">
            <Button onClick={() => setAsk(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deletePrompts(null)}>
              Delete all prompts
            </Button>
          </div>
        </div>
      )}

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
          {batch && <p className="text-sm font-medium">Batch {batch.number} of {batch.total}{batch.account ? ` - account: ${batch.account}` : ""}</p>}
          <JobBar job={job} />
          <div>
            <Button onClick={() => requestCancel(job.id)}>Cancel</Button>
          </div>
        </div>
      )}

      {undo && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm" role="status">
          <span>{undo.count} {undo.count === 1 ? "prompt" : "prompts"} deleted.</span>
          <Button onClick={undoDelete}>Undo</Button>
        </div>
      )}

      <Card title="Prompts" description="Every prompt starts with its ID (timecode) when copied or exported, and prompts are separated by empty lines. Edit any text; edited rows are kept when you regenerate.">
        <ExportBar
          disabled={!hasPrompts}
          copied={copied}
          onCopyAll={() => void copyAll()}
          onExport={(kind) => void exportAs(kind)}
          onSend={() => void send()}
          emptyLines={emptyLines}
          includeIds={includeIds}
          onEmptyLines={(count) => updateAppSettings({ exportEmptyLines: count })}
          onIncludeIds={(on) => updateAppSettings({ exportIncludeIds: on })}
          hideSend={quick}
        />
        {selected.size > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span>{selected.size} selected</span>
            <Button variant="danger" disabled={busy} onClick={() => deletePrompts(selected)}>
              Delete selected
            </Button>
            <Button onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
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
              onCopy={() => void copyText(copyBlock(scene, withMotion, includeIds))}
              selected={selected.has(scene.id)}
              onSelect={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(scene.id); else n.delete(scene.id); return n; })}
              onDelete={() => deletePrompts(new Set([scene.id]))}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}
