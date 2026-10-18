import { Plus, Search } from "lucide-react";

import { SORT_OPTIONS, type ProjectSort } from "../../lib/projectList";
import { Button, Select, TextInput } from "../ui";

interface ProjectsToolbarProps {
  query: string;
  sort: ProjectSort;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: ProjectSort) => void;
  onNewProject: () => void;
}

export function ProjectsToolbar({ query, sort, onQueryChange, onSortChange, onNewProject }: ProjectsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <TextInput
          type="search"
          aria-label="Search projects"
          placeholder="Search projects"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="pl-9"
        />
      </div>
      <div className="w-44">
        <Select aria-label="Sort projects" value={sort} onChange={(event) => onSortChange(event.target.value as ProjectSort)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="primary" icon={Plus} onClick={onNewProject}>
        New project
      </Button>
    </div>
  );
}
