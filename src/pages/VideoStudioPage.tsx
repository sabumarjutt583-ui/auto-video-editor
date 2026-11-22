import { Clapperboard, FolderOpen, Film, Layers, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EditorStep } from "../components/editor/EditorStep";
import { MediaStep } from "../components/media";
import { NameDialog } from "../components/projects/NameDialog";
import { Button, SegmentedControl } from "../components/ui";
import { toAppError } from "../lib/errors";
import { readEditor } from "../lib/editor/model";
import { createProject } from "../lib/projects";
import { appendStudioMedia } from "../lib/studio/mediaTimeline";
import { applyEdit } from "../store/historyStore";
import { useProjectStore } from "../store/projectStore";
import type { AppError, Project } from "../types";
import { ErrorNotice } from "../components/ErrorNotice";

type Tab = "media" | "timeline";

/** Standalone editor: no channel, script-writer, or production-pipeline setup required. */
export function VideoStudioPage() {
  const project = useProjectStore((state) => state.project);
  const [newOpen, setNewOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("media");
  const [problem, setProblem] = useState<AppError | null>(null);
  const [imageSeconds, setImageSeconds] = useState(5);
  const navigate = useNavigate();

  async function create(name: string): Promise<void> {
    // The normal Tauri project store is already durable, and supports reopening.
    const made = await createProject(name);
    await useProjectStore.getState().open(made.id);
    useProjectStore.getState().update({ scriptSource: "video_studio" });
    await useProjectStore.getState().flush();
    setNewOpen(false);
    setTab("media");
    setProblem(null);
  }

  function buildTimeline(current: Project) {
    setProblem(null);
    try {
      // A non-studio production project may still be opened here for manual editing,
      // but we do not rewrite its scene plan with synthetic media anchors.
      if (current.scriptSource !== "video_studio") {
        setProblem({ message: "To create a media-first timeline, start a New Studio Edit. Existing production project scenes remain protected.", details: "The open project belongs to the existing production pipeline." });
        return;
      }
      const patch = appendStudioMedia(current, imageSeconds);
      if (!patch) {
        setProblem({ message: "No unassigned media found. Import pictures or video clips first.", details: "Every imported file is already assigned, or there are no imported files." });
        return;
      }
      applyEdit(patch);
      setTab("timeline");
    } catch (error) {
      setProblem(toAppError(error, "Could not add the media to the timeline."));
    }
  }

  const available = project ? readEditor(project).media.filter((file) =>
    !Object.values(project.mediaMap).includes(file.path)
    && !project.scenes.some((scene) => scene.id === file.sceneId)
  ).length : 0;

  return (
    <div className="flex w-full flex-col gap-5" data-testid="video-studio-page">
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-5">
        <span className="rounded-xl bg-accent-soft p-3 text-accent-fg"><Film size={24} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">Video Editing Studio</h1>
          <p className="text-sm text-muted">Create and edit videos independently of the Script Writer and Auto Pipeline.</p>
        </div>
        <Button icon={FolderOpen} onClick={() => navigate("/projects")}>My Projects</Button>
        <Button icon={Plus} variant="primary" onClick={() => setNewOpen(true)}>New Studio Edit</Button>
      </header>
      {newOpen && (
        <NameDialog title="New Studio Edit" confirmLabel="Create Edit" initialName="Untitled video edit"
          onSubmit={async (name) => create(name)} onClose={() => setNewOpen(false)} />
      )}
      {problem && <ErrorNotice error={problem} />}
      {!project ? (
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
          <Clapperboard size={32} className="text-muted" />
          <h2 className="font-semibold">Your editing workspace is ready</h2>
          <p className="max-w-lg text-sm text-muted">Create a studio edit, import pictures and videos, then build a timeline. You do not need a script or voiceover.</p>
          <Button icon={Plus} variant="primary" onClick={() => setNewOpen(true)}>Create Blank Edit</Button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{project.name}</p>
              <p className="text-xs text-muted">{project.scenes.length} scenes · {available} unassigned media · Auto-save enabled</p>
            </div>
            <SegmentedControl<Tab> label="Studio view" value={tab} onChange={setTab}
              options={[{ value: "media", label: "1  Import Media" }, { value: "timeline", label: "2  Edit Timeline" }]} />
          </div>
          {tab === "media" ? (
            <div className="flex flex-col gap-4">
              <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-surface p-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Image length (seconds)</span>
                  <input type="number" min={0.5} max={120} step={0.5}
                    className="w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 text-fg"
                    value={imageSeconds} onChange={(event) => setImageSeconds(Number(event.target.value))} />
                </label>
                <Button icon={Layers} variant="primary" disabled={available === 0}
                  onClick={() => buildTimeline(project)}>
                  {project.scenes.length ? `Append ${available} Clips to Timeline` : `Build Timeline from ${available} Files`}
                </Button>
                <p className="max-w-lg text-xs text-muted">
                  Videos use up to 30 seconds each; images use your chosen length. Existing timeline clips are preserved.
                  Imported originals are copied into this project.
                </p>
              </section>
              <MediaStep project={project} />
            </div>
          ) : project.scenes.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
              <p className="mb-3 text-sm text-muted">No timeline scenes yet. Import footage and build your first sequence.</p>
              <Button onClick={() => setTab("media")}>Import Media</Button>
            </section>
          ) : (
            <EditorStep project={project} />
          )}
        </>
      )}
    </div>
  );
}
