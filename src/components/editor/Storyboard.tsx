import { Clapperboard, Image as ImageIcon, Replace, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/cn";
import { fileOf, sceneStatus, type SceneStatus } from "../../lib/editor/status";
import { overrideOf } from "../../lib/editor/model";
import { formatTimecode } from "../../lib/scenes/timecode";
import type { EditorData, Project } from "../../types";
import { Thumb } from "../media/Thumb";
import { IconButton } from "../ui";

const BADGE: Record<SceneStatus, { text: string; className: string }> = {
  ready: { text: "Ready", className: "bg-success/15 text-success" },
  no_media: { text: "No media", className: "bg-danger/15 text-danger" },
  file_missing: { text: "File deleted", className: "bg-danger/15 text-danger" },
  short: { text: "Clip too short", className: "bg-warning/20 text-warning" },
};

interface StoryboardProps {
  project: Project;
  editor: EditorData;
  exists: Record<string, boolean>;
  selectedId: string | null;
  onSelect: (sceneId: string) => void;
  onReplace: (sceneId: string) => void;
  onMotion: (sceneId: string) => void;
  onRemoveMedia: (sceneId: string) => void;
}

/** One row per scene: picture, time, narration, status and the quick buttons. */
export function Storyboard({ project, editor, exists, selectedId, onSelect, onReplace, onMotion, onRemoveMedia }: StoryboardProps) {
  const selected = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <ul className="flex flex-col gap-2" aria-label="Storyboard">
      {project.scenes.map((scene) => {
        const file = fileOf(scene, editor.media, project.mediaMap);
        const status = sceneStatus(scene, file, exists, overrideOf(editor, scene.id).speed);
        const badge = BADGE[status];
        const Icon = file?.kind === "video" ? Clapperboard : ImageIcon;
        const active = scene.id === selectedId;
        return (
          <li
            key={scene.id}
            ref={active ? selected : undefined}
            data-testid="storyboard-row"
            data-scene={scene.id}
            data-status={status}
            className={cn("flex cursor-pointer items-center gap-3 rounded-xl border bg-surface-2 p-2 transition-colors", active ? "border-accent" : "border-line hover:border-muted")}
            onClick={() => onSelect(scene.id)}
          >
            {file ? <Thumb file={file} /> : <div className="flex aspect-video w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-danger/50 text-xs text-danger">No media</div>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs tabular-nums">{formatTimecode(scene.id, scene.start, scene.end)}</span>
                <span className="text-xs tabular-nums text-muted">{scene.duration.toFixed(1)} s</span>
                <Icon size={12} className="text-muted" aria-label={file?.kind === "video" ? "video" : "picture"} />
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", badge.className)}>{badge.text}</span>
              </div>
              <p dir="auto" className="mt-1 line-clamp-2 text-sm text-muted">
                {scene.text}
              </p>
            </div>
            <div className="flex shrink-0 flex-col">
              <IconButton icon={Replace} label={`Replace the media of ${scene.id}`} onClick={(e) => { e.stopPropagation(); onReplace(scene.id); }} />
              <IconButton icon={Shuffle} label={`Change the motion of ${scene.id}`} onClick={(e) => { e.stopPropagation(); onMotion(scene.id); }} />
              <IconButton icon={Trash2} danger label={`Take the media off ${scene.id}`} disabled={!file} onClick={(e) => { e.stopPropagation(); onRemoveMedia(scene.id); }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
