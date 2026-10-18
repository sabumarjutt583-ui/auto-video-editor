import { Trash2, TriangleAlert } from "lucide-react";

import type { UnreadableProject } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { IconButton } from "../ui";

interface UnreadableProjectsProps {
  projects: readonly UnreadableProject[];
  onDelete: (project: UnreadableProject) => void;
}

/** Project folders that could not be read. The others still work. */
export function UnreadableProjects({ projects, onDelete }: UnreadableProjectsProps) {
  if (projects.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Projects that could not be opened">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted">
        <TriangleAlert size={15} aria-hidden className="text-danger" />
        {projects.length === 1 ? "1 project could not be opened" : `${projects.length} projects could not be opened`}
      </h2>
      {projects.map((project) => (
        <div key={project.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="min-w-0 flex-1">
            <ErrorNotice error={{ message: project.message, details: project.details }} />
          </div>
          <IconButton icon={Trash2} label="Delete this project" danger onClick={() => onDelete(project)} />
        </div>
      ))}
    </section>
  );
}
