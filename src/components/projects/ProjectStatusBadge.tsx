import { cn } from "../../lib/cn";
import { STATUS_LABELS } from "../../lib/projectList";
import type { ProjectStatus } from "../../types";

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  prompts_ready: "bg-accent-soft text-accent-fg",
  media_matched: "bg-success/15 text-success",
  rendered: "bg-success text-app",
};

interface ProjectStatusBadgeProps {
  status: ProjectStatus | null;
}

export function ProjectStatusBadge({ status }: ProjectStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium",
        status ? STATUS_CLASSES[status] : "bg-surface-2 text-muted",
      )}
    >
      {status ? STATUS_LABELS[status] : "New"}
    </span>
  );
}
