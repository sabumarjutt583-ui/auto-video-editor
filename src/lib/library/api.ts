import { invoke } from "@tauri-apps/api/core";

export type LibraryKind = "sfx" | "styles";

export interface LibraryStatus {
  kind: LibraryKind;
  version: number;
  /** "built-in" or "downloaded" */
  source: "built-in" | "downloaded";
  date: string;
  count: number;
  hasPrevious: boolean;
}

export interface UpdateOutcome {
  kind: LibraryKind;
  result: "updated" | "up-to-date" | "not-published";
  version: number;
}

export interface UpdateReport {
  outcomes: UpdateOutcome[];
  status: LibraryStatus[];
}

export function libraryStatus(): Promise<LibraryStatus[]> {
  return invoke<LibraryStatus[]>("library_status");
}
export function updateLibraries(jobId: string): Promise<UpdateReport> {
  return invoke<UpdateReport>("update_libraries", { jobId });
}
export function rollbackLibrary(kind: LibraryKind): Promise<LibraryStatus[]> {
  return invoke<LibraryStatus[]>("rollback_library", { kind });
}
