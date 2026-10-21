import { Image as ImageIcon, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { imagegenPreview } from "../../lib/imagegen/api";
import { jobStatusLabel } from "../../lib/imagegen/format";
import type { ImageJob } from "../../types/imagegen";
import { IconButton } from "../ui";

const STATUS_CLASSES = {
  queued: "bg-surface-2 text-muted",
  generating: "bg-accent-soft text-accent-fg",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
} as const;

interface FolderPictureCardProps {
  job: ImageJob;
  folder: string;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onRegenerate: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

/** One picture of the "Only images" list: preview, status, prompt. */
export function FolderPictureCard({ job, folder, selected, onSelect, onRegenerate, onEdit, onRemove }: FolderPictureCardProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const file = job.status === "completed" ? job.file : null;

  useEffect(() => {
    let live = true;
    setPreview(null);
    if (file) {
      imagegenPreview(folder, file, 360)
        .then((url) => live && setPreview(url))
        .catch(() => live && setPreview(null));
    }
    return () => {
      live = false;
    };
  }, [folder, file]);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted">
        {preview ? (
          <img src={preview} alt={`Picture ${job.fileName}`} className="h-full w-full object-contain" />
        ) : job.status === "generating" ? (
          <Loader2 size={20} aria-hidden className="animate-spin" />
        ) : (
          <ImageIcon size={20} aria-hidden />
        )}
        <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${job.fileName}`} className="absolute top-2 left-2 h-4 w-4 cursor-pointer accent-accent" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs" title={job.fileName}>
          {job.fileName}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[job.status]}`}>{jobStatusLabel(job.status)}</span>
      </div>
      <p className="line-clamp-2 text-xs text-muted" title={job.prompt}>
        {job.prompt}
      </p>
      {job.status === "failed" && job.error && <p className="text-xs text-danger">{job.error}</p>}
      <div className="flex justify-end gap-1">
        <IconButton icon={Pencil} label={`Edit prompt ${job.fileName}`} onClick={onEdit} />
        <IconButton icon={RefreshCw} label={`Make ${job.fileName} again`} disabled={job.status === "generating"} onClick={onRegenerate} />
        <IconButton icon={Trash2} label={`Remove ${job.fileName} from the list`} danger disabled={job.status === "generating"} onClick={onRemove} />
      </div>
    </li>
  );
}
