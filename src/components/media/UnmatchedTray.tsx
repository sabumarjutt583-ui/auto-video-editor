import { Sparkles, ListOrdered } from "lucide-react";
import { useState } from "react";

import type { SortBy } from "../../lib/media/files";
import { sortSources } from "../../lib/media/files";
import type { MediaFile, Scene } from "../../types";
import { Button, Card, Select } from "../ui";
import { Thumb } from "./Thumb";

interface UnmatchedTrayProps {
  files: MediaFile[];
  scenes: Scene[];
  emptyCount: number;
  busy: boolean;
  onAssign: (path: string, sceneId: string | null) => void;
  onByOrder: (sort: SortBy) => void;
  onGemini: () => void;
}

/** Files whose names say nothing about a scene. */
export function UnmatchedTray({ files, scenes, emptyCount, busy, onAssign, onByOrder, onGemini }: UnmatchedTrayProps) {
  const [sort, setSort] = useState<SortBy>("name");
  const shown = sortSources(files, sort);
  return (
    <Card title={`Unmatched (${files.length})`} description="These file names have no scene code. Match them by order, with Gemini, or pick a scene for each one." icon={ListOrdered}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select aria-label="Order of the files" value={sort} onChange={(event) => setSort(event.target.value as SortBy)}>
            <option value="name">Order: by file name</option>
            <option value="date">Order: oldest first</option>
          </Select>
        </div>
        <Button icon={ListOrdered} disabled={busy || emptyCount === 0} onClick={() => onByOrder(sort)}>
          Match by order
        </Button>
        <Button icon={Sparkles} disabled={busy || emptyCount === 0} onClick={onGemini}>
          Match with Gemini
        </Button>
        <span className="text-xs text-muted">{emptyCount} scenes still have no file.</span>
      </div>
      <ul className="grid gap-2 md:grid-cols-2" aria-label="Unmatched files">
        {shown.map((file) => (
          <li key={file.path} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2">
            <Thumb file={file} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={file.name}>
                {file.name}
              </p>
              <p className="mb-1 text-xs text-muted">
                {file.width}×{file.height}
                {file.kind === "video" ? `, ${file.duration.toFixed(1)} s` : ""}
              </p>
              <Select aria-label={`Scene for ${file.name}`} value="" onChange={(event) => event.target.value !== "" && onAssign(file.path, event.target.value)}>
                <option value="">Choose a scene…</option>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.id}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
