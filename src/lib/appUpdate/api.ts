import { invoke } from "@tauri-apps/api/core";

export interface AppUpdateInfo {
  version: string;
  current: string;
  notes: string;
}

export function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  return invoke<AppUpdateInfo | null>("check_app_update");
}
export function installAppUpdate(jobId: string): Promise<void> {
  return invoke<void>("install_app_update", { jobId });
}
export function exportLogs(dest: string): Promise<string> {
  return invoke<string>("export_logs", { dest });
}
export function logFrontendError(message: string): Promise<void> {
  return invoke<void>("log_frontend_error", { message });
}
