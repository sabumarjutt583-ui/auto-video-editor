import { Image as ImageIcon, Loader2, Pencil, RefreshCw } from "lucide-react";

import { jobStatusLabel, viaLabel } from "../../lib/imagegen/format";
import { projectFileUrl } from "../../lib/media/urls";
import type { Scene } from "../../types";
import type { ImageJob } from "../../types/imagegen";
import { IconButton } from "../ui";

interface SceneCardProps {
  scene: Scene;
  job: ImageJob | undefined;
  projectDir: string | null;
  timecode: string;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onRegenerate: () => void;
  onEdit: () => void;
}

const STATUS_CLASSES = {
  queued: "bg-surface-2 text-muted",
  generating: "bg-accent-soft text-accent-fg",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
} as const;

export function SceneCard({ scene, job, projectDir, timecode, selected, onSelect, onRegenerate, onEdit }: SceneCardProps) {
  const url = job?.file && projectDir ? projectFileUrl(projectDir, job.file) : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted">
        {url ? (
          <img src={url} alt={`Picture for ${scene.id}`} loading="lazy" decoding="async" className="h-full w-full object-contain" />
        ) : job?.status === "generating" ? (
          <Loader2 size={20} aria-hidden className="animate-spin" />
        ) : (
          <ImageIcon size={20} aria-hidden />
        )}
        <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${scene.id}`} className="absolute top-2 left-2 h-4 w-4 cursor-pointer accent-accent" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs" title={timecode}>
          {timecode}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[job?.status ?? "queued"]}`}>{job ? jobStatusLabel(job.status) : "No picture"}</span>
      </div>
      <p className="line-clamp-2 text-xs text-muted" title={scene.prompt}>
        {scene.prompt || "No prompt yet. Write the prompts in the Prompt Generator first."}
      </p>
      {job?.status === "failed" && job.error && <p className="text-xs text-danger">{job.error}</p>}
      {job?.status === "completed" && job.via && <p className="text-xs text-muted">Made with {viaLabel(job.via)}</p>}
      <div className="flex justify-end gap-1">
        <IconButton icon={Pencil} label={`Edit prompt ${scene.id}`} onClick={onEdit} />
        <IconButton icon={RefreshCw} label={`Regenerate ${scene.id}`} disabled={scene.prompt.trim() === "" || scene.mediaType === "video"} onClick={onRegenerate} />
      </div>
    </li>
  );
}
