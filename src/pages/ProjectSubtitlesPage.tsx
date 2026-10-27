import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorNotice } from "../components/ErrorNotice";
import { Button, Card } from "../components/ui";
import { toAppError } from "../lib/errors";
import type { AppError } from "../types";
import { useProjectStore } from "../store/projectStore";

/** Project subtitles, one per scene: edit the caption text that the next render shows.
 * Edits are saved as per-scene caption overrides on the project; the video is not
 * rebuilt here — the next render (Auto Editor or Make Video) uses the edited text. */
export function ProjectSubtitlesPage() {
  const project = useProjectStore((s) => s.project);
  const update = useProjectStore((s) => s.update);
  const flush = useProjectStore((s) => s.flush);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    setEdits(project?.captionOverrides ?? {});
    setSaved(false);
  }, [project?.id]);

  if (!project) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <p className="text-sm text-muted">Open a project first. These subtitles belong to the open project.</p>
        <Link to="/projects" className="text-sm text-accent underline">Back to projects</Link>
      </section>
    );
  }

  async function save() {
    setError(null);
    try {
      const cleaned: Record<string, string> = {};
      for (const [id, text] of Object.entries(edits)) {
        if (text.trim() !== "") cleaned[id] = text;
      }
      update({ captionOverrides: cleaned });
      await flush();
      setSaved(true);
    } catch (caught) {
      setError(toAppError(caught, "The subtitles could not be saved."));
    }
  }

  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <h2 className="text-lg font-semibold">Project subtitles — {project.name}</h2>
      <p className="text-sm text-muted">Edit the caption text for a scene. The next render shows the edited text for that scene's caption span; the voice audio and word timings do not change, and the video is not rebuilt here.</p>
      {error && <ErrorNotice error={error} />}
      {saved && <p className="text-sm text-success">Saved. The next render will use the edited subtitles.</p>}
      {scenes.length === 0 && <p className="text-sm text-muted">This project has no scenes yet.</p>}
      {scenes.map((scene) => (
        <Card key={scene.id} title={`${scene.id} · ${scene.start.toFixed(1)}–${scene.end.toFixed(1)} s`} description="Spoken text for this scene (shown when no override is set):">
          <p className="text-xs text-muted">{scene.text}</p>
          <textarea
            value={edits[scene.id] ?? ""}
            onChange={(e) => setEdits((prev) => ({ ...prev, [scene.id]: e.target.value }))}
            placeholder="Edited caption for this scene (leave empty to use the spoken text)"
            rows={2}
            className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm"
          />
        </Card>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void save()}>
          Save subtitles
        </Button>
      </div>
    </div>
  );
}
