import { invoke } from "@tauri-apps/api/core";

export interface ApiCallEntry {
  timeMs: number;
  provider: string;
  slot: number;
  result: string;
  detail: string;
}

/** Recent API calls: provider, key slot number only, time and result. Never a key value. */
export const apiMonitorList = (): Promise<ApiCallEntry[]> => invoke<ApiCallEntry[]>("api_monitor_list");
