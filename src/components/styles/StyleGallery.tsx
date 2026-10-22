import { ArrowLeft, FileUp, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "../../lib/cn";
import { galleryTabs, moveFocus, TAB_ALL, TAB_FAVORITES, TAB_MINE, TAB_RECENT, visibleStyles } from "../../lib/styleGallery";
import { toAppError } from "../../lib/errors";
import { isComplete } from "../../lib/styleModel";
import type { AppError, StyleProfile } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, IconButton, INPUT_CLASSES } from "../ui";
import { StyleCard } from "./StyleCard";
import { StyleDetails } from "./StyleDetails";

interface StyleGalleryProps {
  styles: readonly StyleProfile[];
  selectedId: string | null;
  favorites: readonly string[];
  recent: readonly string[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCreate: () => void;
  /** Adds a style from an .avstyle file; resolves to a sentence for the person, rejects with the error. */
  onImport: () => Promise<string>;
  onClose: () => void;
}

const EMPTY_TEXT: Record<string, string> = {
  [TAB_FAVORITES]: "No favorites yet. Click the star on a style to keep it here.",
  [TAB_RECENT]: "Styles you use will show up here.",
  [TAB_MINE]: "You have not made a style of your own yet.",
};

/** The Style Gallery: a big window with every style as a picture card. Click a card to use that style. */
export function StyleGallery({ styles, selectedId, favorites, recent, onSelect, onToggleFavorite, onCreate, onImport, onClose }: StyleGalleryProps) {
  const [tab, setTab] = useState(TAB_ALL);
  const [query, setQuery] = useState("");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<AppError | null>(null);
  const grid = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const tabs = useMemo(() => galleryTabs(styles), [styles]);
  const shown = useMemo(() => visibleStyles({ styles, tab, query, favorites, recent }), [styles, tab, query, favorites, recent]);
  const details = detailsId ? (styles.find((s) => s.id === detailsId) ?? null) : null;
  const withCreate = tab === TAB_MINE && query.trim() === "";
  const total = shown.length + (withCreate ? 2 : 0);

  useEffect(() => {
    search.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (detailsId) setDetailsId(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailsId, onClose]);

  async function importStyle() {
    setImporting(true);
    setImportNotice(null);
    setImportError(null);
    try {
      setImportNotice(await onImport());
    } catch (caught) {
      setImportError(toAppError(caught, "The style file could not be imported."));
    } finally {
      setImporting(false);
    }
  }

  function focusCard(index: number) {
    grid.current?.querySelector<HTMLElement>(`[data-card-index="${index}"]`)?.focus();
  }

  function onGridKey(event: KeyboardEvent<HTMLUListElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-card-index]");
    if (!target || !grid.current) return;
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const columns = getComputedStyle(grid.current).gridTemplateColumns.split(" ").filter(Boolean).length;
    const next = moveFocus(Number(target.dataset.cardIndex), total, columns, event.key);
    if (next >= 0) focusCard(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Style Gallery" className="flex h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold tracking-tight">Style Gallery</h2>
          <IconButton icon={X} label="Close the gallery" onClick={onClose} />
        </div>

        {details ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button icon={ArrowLeft} onClick={() => setDetailsId(null)}>
                Back to the gallery
              </Button>
              {isComplete(details) && (
                <Button variant="primary" onClick={() => onSelect(details.id)}>
                  Use this style
                </Button>
              )}
            </div>
            <StyleDetails style={details} inUse={details.id === selectedId} readOnly onDuplicate={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-line px-5 py-3">
              <div className="relative">
                <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && total > 0) {
                      event.preventDefault();
                      focusCard(0);
                    }
                  }}
                  placeholder="Search by name, category or mood…"
                  aria-label="Search styles"
                  className={cn(INPUT_CLASSES, "h-10 pl-9")}
                />
              </div>
              <div role="tablist" aria-label="Style categories" className="flex gap-1.5 overflow-x-auto pb-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors",
                      tab === t.id ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-muted hover:border-accent/50 hover:text-fg",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {importNotice && (
                <p className="mb-3 text-sm text-success" role="status">
                  {importNotice}
                </p>
              )}
              {importError && (
                <div className="mb-3">
                  <ErrorNotice error={importError} />
                </div>
              )}
              {total === 0 && (
                <p className="py-10 text-center text-sm text-muted">{query.trim() !== "" ? `No style matches “${query}”.` : (EMPTY_TEXT[tab] ?? "No styles here.")}</p>
              )}
              <ul ref={grid} role="list" aria-label="Styles" onKeyDown={onGridKey} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {shown.map((style, index) => (
                  <StyleCard
                    key={style.id}
                    style={style}
                    index={index}
                    selected={style.id === selectedId}
                    favorite={favorites.includes(style.id)}
                    onSelect={() => onSelect(style.id)}
                    onFavorite={() => onToggleFavorite(style.id)}
                    onDetails={() => setDetailsId(style.id)}
                  />
                ))}
                {withCreate && (
                  <li className="flex">
                    <button
                      type="button"
                      data-card-index={shown.length}
                      onClick={onCreate}
                      className="flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-muted outline-none transition-colors hover:border-accent hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Plus size={26} aria-hidden />
                      <span className="text-sm font-medium">Create style</span>
                    </button>
                  </li>
                )}
                {withCreate && (
                  <li className="flex">
                    <button
                      type="button"
                      data-card-index={shown.length + 1}
                      onClick={() => void importStyle()}
                      disabled={importing}
                      className="flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-muted outline-none transition-colors hover:border-accent hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      <FileUp size={26} aria-hidden />
                      <span className="text-sm font-medium">{importing ? "Importing…" : "Import style file"}</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
