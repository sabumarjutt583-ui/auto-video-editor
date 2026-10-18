import type { LibraryKind, UpdateReport } from "./api.ts";

export const KIND_LABEL: Record<LibraryKind, string> = { sfx: "Sound effects", styles: "Styles" };

/** One plain sentence about what an update check did. */
export function describeReport(report: UpdateReport): string {
  const updated = report.outcomes.filter((o) => o.result === "updated");
  if (updated.length > 0) return `${updated.map((o) => `${KIND_LABEL[o.kind]} are now version ${o.version}`).join(". ")}.`;
  if (report.outcomes.length > 0 && report.outcomes.every((o) => o.result === "not-published")) return "Nothing has been published at the update address yet.";
  return "Everything is up to date.";
}

/** Sounds that match the words typed in the search box (id, tags and category), best effort. */
export function matchesSearch(sound: { id: string; category: string; tags: readonly string[] }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [sound.id.replace(/_/g, " "), sound.category.replace(/_/g, " "), ...sound.tags].join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}
