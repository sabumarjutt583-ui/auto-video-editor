import type { ImportedMedia, MediaFile, SourceMedia } from "../../types/editor.ts";

/** Compares names the way people read them: "img2" before "img10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export type SortBy = "name" | "date";

/** The files in name order, or oldest first (the order an AI tool usually made them in). */
export function sortSources<T extends Pick<SourceMedia, "name" | "modified">>(files: readonly T[], by: SortBy): T[] {
  return [...files].sort((a, b) => (by === "date" ? a.modified - b.modified || naturalCompare(a.name, b.name) : naturalCompare(a.name, b.name)));
}

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? (match[1] ?? "").toLowerCase() : "";
}

export function fromImported(item: ImportedMedia): MediaFile {
  return {
    path: item.path,
    name: item.name,
    kind: item.kind,
    width: item.width,
    height: item.height,
    duration: item.duration,
    modified: item.modified,
    sceneId: null,
    start: null,
    end: null,
    how: null,
    confidence: null,
  };
}
