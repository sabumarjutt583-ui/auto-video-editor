import { ArrowLeft, ArrowRight, Copy, Scissors, Trash2 } from "lucide-react";
import { useState } from "react";
import { editStudioTimeline, type StudioOperation } from "../../lib/studio/edit";
import { readEditor } from "../../lib/editor/model";
import { toAppError } from "../../lib/errors";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import { usePlaybackStore } from "../../store/playbackStore";
import type { AppError, Project, Scene } from "../../types";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";

interface Props {
  project: Project;
  scene: Scene;
  onSelect: (id: string) => void;
}

/** Real non-destructive clip operations, independent of the Script Writer scene engine. */
export function StudioClipTools({ project, scene, onSelect }: Props) {
  const [error, setError] = useState<AppError | null>(null);
  const index = project.scenes.findIndex((s) => s.id === scene.id);
  const media = readEditor(project).media.find((file) => file.path === project.mediaMap[scene.id]);
  const inPoint = readEditor(project).studioSourceIn[scene.id] ?? 0;

  function run(operation: StudioOperation): void {
    setError(null);
    try {
      const current = useProjectStore.getState().project;
      if (!current || current.id !== project.id) return;
      const patch = editStudioTimeline(current, operation);
      if (!patch) return;
      applyEdit(patch);
      if (operation.kind === "delete") {
        const next = patch.scenes?.[Math.min(index, patch.scenes.length - 1)];
        if (next) onSelect(next.id);
      } else if ((operation.kind === "split" || operation.kind === "duplicate")) {
        const next = patch.scenes?.[index + 1];
        if (next) onSelect(next.id);
      }
    } catch (caught) {
      setError(toAppError(caught, "The clip could not be edited."));
    }
  }

  const splitAt = () => {
    const time = usePlaybackStore.getState().time - scene.start;
    run({ kind: "split", id: scene.id, at: time });
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Studio clip operations">
      <h3 className="text-sm font-semibold">Clip editing — {scene.id}</h3>
      <p className="text-xs text-muted">Edits update the real scene timeline and are undoable. Source media is never modified.</p>
      {error && <ErrorNotice error={error} />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Clip duration (seconds)
          <input key={`duration-${scene.id}-${scene.duration}`} type="number" min={0.25} max={14400} step={0.25}
            defaultValue={scene.duration.toFixed(2)}
            className="w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 text-fg"
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (value !== scene.duration) run({ kind: "duration", id: scene.id, seconds: value });
            }} />
        </label>
        {media?.kind === "video" && (
          <label className="flex flex-col gap-1 text-xs">
            Video source start (seconds)
            <input key={`source-${scene.id}-${inPoint}`} type="number" min={0} max={Math.max(0, media.duration - 0.25)} step={0.25}
              defaultValue={inPoint.toFixed(2)}
              className="w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 text-fg"
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (value !== inPoint) run({ kind: "source-in", id: scene.id, seconds: value });
              }} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={ArrowLeft} disabled={index <= 0} onClick={() => run({ kind: "move", id: scene.id, index: index - 1 })}>Move left</Button>
        <Button icon={ArrowRight} disabled={index >= project.scenes.length - 1} onClick={() => run({ kind: "move", id: scene.id, index: index + 1 })}>Move right</Button>
        <Button icon={Scissors} onClick={splitAt}>Split at playhead</Button>
        <Button icon={Copy} onClick={() => run({ kind: "duplicate", id: scene.id })}>Duplicate clip</Button>
        <Button icon={Trash2} onClick={() => run({ kind: "delete", id: scene.id })}>Remove from timeline</Button>
      </div>
    </section>
  );
}
