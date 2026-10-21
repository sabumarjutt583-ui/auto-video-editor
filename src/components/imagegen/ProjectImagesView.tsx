import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { toAppError } from "../../lib/errors";
import { imagegenPause, imagegenResume, imagegenRetryFailed, imagegenStart } from "../../lib/imagegen/api";
import { buildJobs } from "../../lib/imagegen/mapping";
import { projectDirPath } from "../../lib/media/api";
import { formatTimecode } from "../../lib/scenes/timecode";
import { useImageGenStore } from "../../store/imagegenStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { Controls } from "./Controls";
import { PromptEditModal } from "./PromptEditModal";
import { SceneCard } from "./SceneCard";
import { useConsent } from "./useConsent";

function NeedsProject({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
      <h2 className="text-base font-semibold tracking-tight">Image Generator</h2>
      <p className="text-sm text-muted">{message}</p>
      <Button variant="primary" icon={FolderOpen} onClick={() => navigate("/projects")}>
        Go to Projects
      </Button>
    </section>
  );
}

/** "Project scenes" mode: one picture per scene of the open project. */
export function ProjectImagesView() {
  const navigate = useNavigate();
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const snapshot = useImageGenStore((state) => state.snapshot);
  const storeError = useImageGenStore((state) => state.error);
  const { ensure, dialog } = useConsent();

  const [error, setError] = useState<AppError | null>(null);
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);

  const projectId = project?.id ?? null;

  // Attach the open project to the engine (without starting) and show where its folder is.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void (async () => {
      try {
        await useImageGenStore.getState().init();
        const folder = await projectDirPath(projectId);
        if (!live) return;
        setDir(folder);
        if (useImageGenStore.getState().snapshot?.projectDir !== folder) await imagegenStart(projectId, [], false, false);
        await useImageGenStore.getState().reconcile();
      } catch (failure) {
        if (live) setError(toAppError(failure, "The Image Generator could not open this project."));
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  // Pictures that finished while this page was closed or after an Undo are put back into the project.
  const completed = snapshot?.stats.completed ?? 0;
  useEffect(() => {
    void useImageGenStore.getState().reconcile();
  }, [completed]);

  const jobs = useMemo(() => new Map((snapshot?.jobs ?? []).map((job) => [job.id, job])), [snapshot?.jobs]);
  const forThisProject = snapshot !== null && dir !== null && snapshot.projectDir === dir;

  if (!project) return <NeedsProject message="Open a project first. The Image Generator makes a picture for every scene of a project." />;
  if (project.scenes.length === 0) return <NeedsProject message="This project has no scenes yet. Build the scenes and write the prompts in the Prompt Generator first." />;
  if (!snapshot) return storeError ? <ErrorNotice error={storeError} /> : <p className="text-sm text-muted">Loading…</p>;

  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  const ratio = project.settings.aspectRatio;
  const ready = buildJobs(scenes, ratio).jobs.length;
  const editingScene = scenes.find((s) => s.id === editing) ?? null;

  async function guarded(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (failure) {
      setError(toAppError(failure, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  async function needsConsent(): Promise<boolean> {
    // Google accounts need the one-time notice.
    return ensure();
  }

  function begin(only: string[] | undefined, force: boolean) {
    void guarded(async () => {
      if (!project || !(await needsConsent())) return;
      const { jobs, skipped } = buildJobs(scenes, ratio, only);
      const report = await imagegenStart(project.id, jobs, force, true);
      const parts = [`${report.added} added`];
      if (report.regenerating > 0) parts.push(`${report.regenerating} will be made again`);
      if (report.skipped > 0) parts.push(`${report.skipped} already have a picture`);
      if (skipped.length > 0) parts.push(`${skipped.length} without a prompt or with a video`);
      setInfo(parts.join(", ") + ".");
      setSelected(new Set());
    });
  }

  function savePrompt(sceneId: string, prompt: string, regenerate: boolean) {
    update({ scenes: project?.scenes.map((s) => (s.id === sceneId ? { ...s, prompt, edited: true } : s)) ?? [] });
    setEditing(null);
    if (regenerate) {
      // The scene list in the store is updated at once, so the new prompt is read from there.
      const fresh = useProjectStore.getState().project;
      if (!fresh) return;
      void guarded(async () => {
        if (!(await needsConsent())) return;
        await imagegenStart(fresh.id, buildJobs(fresh.scenes, ratio, [sceneId]).jobs, true, true);
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <Controls
        stats={forThisProject ? snapshot.stats : { total: 0, queued: 0, generating: 0, completed: 0, failed: 0 }}
        running={forThisProject && snapshot.running}
        selected={selected.size}
        scenesReady={ready}
        busy={busy}
        onGenerateAll={() => begin(undefined, false)}
        onPause={() => void guarded(imagegenPause)}
        onResume={() => void guarded(async () => ((await needsConsent()) ? imagegenResume() : undefined))}
        onRetryFailed={() => void guarded(async () => ((await needsConsent()) ? void (await imagegenRetryFailed([])) : undefined))}
        onRegenerateSelected={() => begin([...selected], true)}
        onOpenEditor={() => navigate("/auto-editor")}
      />
      {info && <p role="status" className="text-sm text-muted">{info}</p>}
      {error && <ErrorNotice error={error} />}
      {storeError && <ErrorNotice error={storeError} />}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            job={forThisProject ? jobs.get(scene.id) : undefined}
            projectDir={dir}
            timecode={formatTimecode(scene.id, scene.start, scene.end)}
            selected={selected.has(scene.id)}
            onSelect={(on) =>
              setSelected((current) => {
                const next = new Set(current);
                if (on) next.add(scene.id);
                else next.delete(scene.id);
                return next;
              })
            }
            onRegenerate={() => begin([scene.id], true)}
            onEdit={() => setEditing(scene.id)}
          />
        ))}
      </ul>
      {editingScene && <PromptEditModal sceneId={editingScene.id} prompt={editingScene.prompt} onSave={(text, again) => savePrompt(editingScene.id, text, again)} onClose={() => setEditing(null)} />}
    </div>
  );
}
