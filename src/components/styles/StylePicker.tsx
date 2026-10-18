import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { groupStyles, isComplete } from "../../lib/styleModel";
import type { StyleProfile } from "../../types";
import { INPUT_CLASSES } from "../ui";

interface StylePickerProps {
  styles: readonly StyleProfile[];
  /** The style being looked at. */
  value: string | null;
  onChange: (id: string) => void;
}

/** A dropdown with a search box. Styles are grouped by category; unfinished ones show "Incomplete". */
export function StylePicker({ styles, value, onChange }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupStyles(styles, query), [styles, query]);
  const current = styles.find((style) => style.id === value);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        className={cn(INPUT_CLASSES, "flex cursor-pointer items-center justify-between text-left")}
      >
        <span className={current ? "" : "text-muted"}>{current ? current.name : `Choose a style (${styles.length} available)`}</span>
        <ChevronDown size={16} aria-hidden className="text-muted" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-line bg-surface shadow-card">
          <div className="relative border-b border-line p-2">
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted" />
            <input
              ref={search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search styles…"
              aria-label="Search styles"
              className={cn(INPUT_CLASSES, "h-9 pl-8")}
            />
          </div>
          <div role="listbox" aria-label="Styles" className="max-h-80 overflow-y-auto p-1.5">
            {groups.length === 0 && <p className="p-3 text-sm text-muted">No style matches “{query}”.</p>}
            {groups.map((group) => (
              <div key={group.category} role="group" aria-label={group.category} className="mb-1">
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{group.category}</p>
                {group.styles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    role="option"
                    aria-selected={style.id === value}
                    onClick={() => {
                      onChange(style.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2",
                      style.id === value && "bg-accent-soft text-accent-fg",
                    )}
                  >
                    <span>{style.name}</span>
                    <span className="flex gap-1.5">
                      {!style.builtin && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">Custom</span>}
                      {!isComplete(style) && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">Incomplete</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
