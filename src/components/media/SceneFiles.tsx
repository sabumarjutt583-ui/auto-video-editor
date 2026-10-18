import { Trash2 } from "lucide-react";

import { cn } from "../../lib/cn";
import { formatTimecode } from "../../lib/scenes/timecode";
import type { MatchHow, MediaFile, Scene } from "../../types";
import { IconButton } from "../ui";
import { Thumb } from "./Thumb";

const HOW: Record<MatchHow, string> = {
  name: "by name",
  number: "by scene number",
  order: "by order",
  gemini: "by Gemini",
  manual: "by you",
  rename: "renamed",
};

interface SceneFilesProps {
  scenes: Scene[];
  media: MediaFile[];
  mediaMap: Record<string, string>;
  exists: Record<string, boolean>;
  onRemove: (path: string) => void;
}

/** Every scene with the file that was placed on it. */
export function SceneFiles({ scenes, media, mediaMap, exists, onRemove }: SceneFilesProps) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Scenes and their files">
      {scenes.map((scene) => {
        const file = media.find((m) => m.path === mediaMap[scene.id] && m.sceneId === scene.id);
        const gone = file !== undefined && exists[file.path] === false;
        return (
          <li key={scene.id} className={cn("flex items-center gap-3 rounded-xl border bg-surface-2 p-2", file && !gone ? "border-line" : "border-danger/40")} data-testid="scene-file-row" data-scene={scene.id} data-state={!file ? "missing" : gone ? "deleted" : "ok"}>
            {file ? <Thumb file={file} /> : <div className="flex aspect-video w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-danger/50 text-xs text-danger">No media</div>}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs tabular-nums">{formatTimecode(scene.id, scene.start, scene.end)}</p>
              <p className="truncate text-sm" title={file?.name}>
                {file ? file.name : "Nothing placed on this scene yet"}
              </p>
              <p className="truncate text-xs text-muted" dir="auto">
                {file && file.how ? `Placed ${HOW[file.how]}` : scene.text}
                {file?.how === "gemini" && file.confidence !== null && (
                  <span className={cn("ml-2 rounded-full px-1.5 py-0.5", file.confidence < 0.5 ? "bg-warning/20 text-warning" : "bg-accent-soft text-accent-fg")}>{file.confidence < 0.5 ? "low confidence" : `${Math.round(file.confidence * 100)}% sure`}</span>
                )}
              </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted">{scene.duration.toFixed(1)} s</span>
            {file && <IconButton icon={Trash2} danger label={`Remove ${file.name} from the project`} onClick={() => onRemove(file.path)} />}
          </li>
        );
      })}
    </ul>
  );
}
