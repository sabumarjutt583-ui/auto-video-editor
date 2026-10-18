import { NavLink } from "react-router-dom";

import { cn } from "../lib/cn";
import { NAV_ITEMS } from "../lib/nav";
import { EngineStatus } from "./EngineStatus";
import { Logo } from "./Logo";

/** Fixed 240px navigation column. */
export function Sidebar() {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <Logo size={30} />
        <span className="text-[15px] font-semibold tracking-tight">Auto Video Editor</span>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent-soft text-accent-fg"
                  : "text-muted hover:bg-surface-2 hover:text-fg",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-accent"
                  />
                )}
                <Icon size={18} aria-hidden />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <EngineStatus />
    </aside>
  );
}
