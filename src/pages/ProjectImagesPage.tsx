import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { Button, Card } from "../components/ui";
import { toAppError } from "../lib/errors";
import { imagegenPreview, imagegenStart } from "../lib/imagegen/api";
import { buildJobs } from "../lib/imagegen/mapping";
import { projectDirPath } from "../lib/media/api";
import type { AppError } from "../types";
import { useProjectStore } from "../store/projectStore";

/** Project pictures, one per scene: view the picture and re-make just that scene's
 * picture through the existing image engine. The video itself is not rebuilt here. */
export function ProjectImagesPage() {
  const project = useProjectStore((s) => s.project);
  const [dir, setDir] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const { ensure, dialog } = useConsent();

  useEffect(() => {
    if (!project) return;
    let live = true;
    void projectDirPath(project.id).then((folder) => {
      if (live) setDir(folder);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project || !dir) return;
    let live = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const scene of project.scenes) {
        const file = project.mediaMap[scene.id];
        if (!file) continue;
        const preview = await imagegenPreview(dir, file, 320).catch(() => null);
        if (preview) next[scene.id] = preview;
      }
      if (live) setPreviews(next);
    })();
    return () => {
      live = false;
    };
  }, [project, dir]);

  if (!project) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <p className="text-sm text-muted">Open a project first. These pictures belong to the open project.</p>
        <Link to="/projects" className="text-sm text-accent underline">Back to projects</Link>
      </section>
    );
  }

  async function regenerate(sceneId: string) {
    if (!(await ensure())) return;
    setBusy(sceneId);
    setError(null);
    try {
      const fresh = useProjectStore.getState().project;
      if (!fresh) return;
      const { jobs } = buildJobs(fresh.scenes, fresh.settings.aspectRatio, [sceneId]);
      if (jobs.length === 0) throw new Error("That scene has no prompt to make a picture from.");
      const report = await imagegenStart(fresh.id, jobs, true, true);
      setInfo(`${sceneId}: ${report.added} added, ${report.regenerating} will be made again. The video itself is not rebuilt — render again to use the new picture.`);
    } catch (caught) {
      setError(toAppError(caught, "That picture could not be re-made."));
    } finally {
      setBusy(null);
    }
  }

  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <h2 className="text-lg font-semibold">Project images — {project.name}</h2>
      <p className="text-sm text-muted">One picture per scene. Regenerate re-queues only that scene's prompt through the image engine; it does not rebuild the video.</p>
      {dialog}
      {error && <ErrorNotice error={error} />}
      {info && <p className="text-sm text-muted">{info}</p>}
      {scenes.length === 0 && <p className="text-sm text-muted">This project has no scenes yet.</p>}
      {scenes.map((scene) => (
        <Card key={scene.id} title={`${scene.id} · ${scene.start.toFixed(1)}–${scene.end.toFixed(1)} s`} description={scene.prompt || "No prompt yet."}>
          {previews[scene.id] ? <img src={previews[scene.id]} alt={`Picture for ${scene.id}`} className="w-full max-w-md rounded-lg" /> : <p className="text-xs text-muted">{project.mediaMap[scene.id] ?? "No picture yet."}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === scene.id} disabled={busy !== null} onClick={() => void regenerate(scene.id)}>
              Regenerate this picture
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
