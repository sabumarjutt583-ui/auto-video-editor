import { convertFileSrc } from "@tauri-apps/api/core";

/** The address the webview can load a project file from (the folder comes from `project_dir_path`). */
export function projectFileUrl(projectDir: string, relative: string): string {
  const separator = projectDir.includes("\\") ? "\\" : "/";
  const parts = relative.split("/").filter((part) => part !== "");
  return convertFileSrc(`${projectDir.replace(/[\\/]+$/, "")}${separator}${parts.join(separator)}`);
}
