import { FolderOpen } from "lucide-react";
import { useLocation } from "react-router-dom";

import { cn } from "../lib/cn";
import { NAV_ITEMS } from "../lib/nav";
import { useProjectStore } from "../store/projectStore";
import { SaveStatus } from "./SaveStatus";
import { ThemeToggle } from "./ThemeToggle";

/** Page title on the left; save status, current project and theme toggle on the right. */
export function TopBar() {
  const { pathname } = useLocation();
  const projectName = useProjectStore((state) => state.project?.name ?? null);
  const saveState = useProjectStore((state) => state.saveState);
  const title = NAV_ITEMS.find((item) => pathname.startsWith(item.path))?.label ?? "Auto Video Editor";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>

      <div className="flex items-center gap-3">
        {projectName && <SaveStatus state={saveState} />}
        <div
          className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-sm"
          title="Current project"
        >
          <FolderOpen size={15} aria-hidden className="text-muted" />
          <span className={cn("max-w-[260px] truncate", projectName ? "text-fg" : "text-muted")}>
            {projectName ?? "No project open"}
          </span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
