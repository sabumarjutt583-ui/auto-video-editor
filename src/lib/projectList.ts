import type { ProjectStatus, ProjectSummary } from "../types/project.ts";

export const MAX_PROJECT_NAME_LENGTH = 100;

export type ProjectSort = "newest" | "oldest" | "name";

export const SORT_OPTIONS: readonly { value: ProjectSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name (A–Z)" },
];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  prompts_ready: "Prompts ready",
  media_matched: "Media matched",
  rendered: "Rendered",
};

/** Returns a friendly problem with the name, or null when it is fine. */
export function validateProjectName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Please type a name for the project.";
  if ([...name].length > MAX_PROJECT_NAME_LENGTH) {
    return `Please use a shorter name (up to ${MAX_PROJECT_NAME_LENGTH} letters).`;
  }
  return null;
}

/** Keeps projects whose name contains the search text, then sorts them. */
export function filterAndSort(
  projects: readonly ProjectSummary[],
  query: string,
  sort: ProjectSort,
): ProjectSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  const matching = projects.filter(
    (project) => needle === "" || project.name.toLocaleLowerCase().includes(needle),
  );
  return matching.sort((a, b) => {
    // Dates are ISO text, so comparing as text compares as time.
    const byDate = (x: ProjectSummary, y: ProjectSummary) => x.updatedAt.localeCompare(y.updatedAt);
    const order =
      sort === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
        : sort === "oldest"
          ? byDate(a, b)
          : byDate(b, a);
    return order !== 0 ? order : a.id.localeCompare(b.id);
  });
}

/** 75 -> "1:15", 3725 -> "1:02:05". Nothing recorded yet gives "No voice-over". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "No voice-over";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatSceneCount(count: number): string {
  return count === 1 ? "1 scene" : `${count} scenes`;
}

/** "18 Oct 2026" in the user's language. Empty text for a date that cannot be read. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
