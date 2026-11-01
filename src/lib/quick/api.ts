import { invoke } from "@tauri-apps/api/core";
import { assertProjectDeletable } from "../pipeline/activity.ts";
import { QUICK_ID } from "./textScenes.ts";

import type { Project, ProjectSummary } from "../../types";

export interface QuickOpen {
  project: Project;
  /** An earlier session with content was found. */
  restored: boolean;
}

/** Opens the quick session (made empty the first time). */
export function quickOpen(): Promise<QuickOpen> {
  return invoke<QuickOpen>("quick_open");
}

/** A new, empty session. The style and options of the old one stay; its files (voice too) are deleted. */
export function quickReset(): Promise<Project> {
  assertProjectDeletable(QUICK_ID);
  return invoke<Project>("quick_reset");
}

/** Moves the session into a normal project and returns its summary. */
export function quickSaveAsProject(name: string): Promise<ProjectSummary> {
  assertProjectDeletable(QUICK_ID);
  return invoke<ProjectSummary>("quick_save_as_project", { name });
}
