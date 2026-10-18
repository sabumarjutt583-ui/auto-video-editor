import { invoke } from "@tauri-apps/api/core";

import type { Project, ProjectList, ProjectSummary } from "../types";

/** Makes a new project with the defaults from Settings. Does not open it. */
export function createProject(name: string): Promise<Project> {
  return invoke<Project>("create_project", { name });
}

export function listProjects(): Promise<ProjectList> {
  return invoke<ProjectList>("list_projects");
}

export function openProject(id: string): Promise<Project> {
  return invoke<Project>("open_project", { id });
}

/** Saves the project. Resolves to the new `updatedAt`. */
export function saveProject(project: Project): Promise<string> {
  return invoke<string>("save_project", { project });
}

export function renameProject(id: string, name: string): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("rename_project", { id, name });
}

export function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}

export function duplicateProject(id: string): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("duplicate_project", { id });
}
