import { CalendarDays, Clock, Copy, Layers, Pencil, Trash2 } from "lucide-react";

import { cn } from "../../lib/cn";
import { formatDate, formatDuration, formatSceneCount } from "../../lib/projectList";
import type { ProjectSummary } from "../../types";
import { IconButton } from "../ui";
import { ProjectStatusBadge } from "./ProjectStatusBadge";

interface ProjectCardProps {
  project: ProjectSummary;
  /** True for the project that is open right now. */
  isCurrent: boolean;
  /** Name of the channel the video belongs to, or null. */
  channelName?: string | null;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, isCurrent, channelName = null, onOpen, onRename, onDuplicate, onDelete }: ProjectCardProps) {
  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-surface p-5 shadow-card transition-colors hover:border-accent/50",
        isCurrent ? "border-accent/60" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <ProjectStatusBadge status={project.status} />
        <span className="flex items-center gap-2">
          {channelName && <span className="max-w-32 truncate rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-fg" title={`Channel: ${channelName}`}>{channelName}</span>}
          {isCurrent && <span className="text-xs font-medium text-accent-fg">Open now</span>}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpen}
        title={`Open “${project.name}”`}
        className="cursor-pointer text-left text-base font-semibold tracking-tight [overflow-wrap:anywhere] hover:text-accent-fg"
      >
        <span className="line-clamp-2">{project.name}</span>
      </button>

      <dl className="flex flex-col gap-1.5 text-sm text-muted">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Voice-over length</dt>
          <Clock size={14} aria-hidden className="shrink-0" />
          <dd>{formatDuration(project.voiceDuration)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Scenes</dt>
          <Layers size={14} aria-hidden className="shrink-0" />
          <dd>{formatSceneCount(project.sceneCount)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Last changed</dt>
          <CalendarDays size={14} aria-hidden className="shrink-0" />
          <dd>{formatDate(project.updatedAt)}</dd>
        </div>
      </dl>

      <div className="-mb-1 flex justify-end gap-1 border-t border-line pt-3">
        <IconButton icon={Pencil} label="Rename" onClick={onRename} />
        <IconButton icon={Copy} label="Duplicate" onClick={onDuplicate} />
        <IconButton icon={Trash2} label="Delete" danger onClick={onDelete} />
      </div>
    </article>
  );
}
