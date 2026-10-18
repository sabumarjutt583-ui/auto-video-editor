import { Clapperboard, Redo2, Undo2 } from "lucide-react";

import { formatClock } from "../../lib/time";
import { redo, undo, useHistoryStore } from "../../store/historyStore";
import type { Project } from "../../types";
import { Button, IconButton } from "../ui";
import { outputSize } from "./preview/frameSize";

/** Length, scene count, output size, Undo / Redo and the Render button. */
export function EditorTopBar({ project, onRender, rendering }: { project: Project; onRender: () => void; rendering: boolean }) {
  const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0);
  const size = outputSize(project.settings.aspectRatio, project.settings.quality);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-2.5" data-testid="editor-topbar">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1.5"><dt className="text-muted">Length</dt><dd className="font-medium tabular-nums">{formatClock(project.voiceDuration)}</dd></div>
        <div className="flex gap-1.5"><dt className="text-muted">Scenes</dt><dd className="font-medium tabular-nums">{project.scenes.length}</dd></div>
        <div className="flex gap-1.5"><dt className="text-muted">Video size</dt><dd className="font-medium tabular-nums">{size.width} × {size.height}</dd></div>
      </dl>
      <div className="ml-auto flex items-center gap-1">
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo()} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => redo()} />
        <Button variant="primary" icon={Clapperboard} onClick={onRender} loading={rendering} data-testid="open-render">
          Render video
        </Button>
      </div>
    </header>
  );
}
