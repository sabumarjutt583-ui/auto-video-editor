import { invoke } from "@tauri-apps/api/core";

import type { SfxSound } from "../types";

export interface SoundHit {
  id: number;
  name: string;
  username: string;
  tags: string[];
  duration: number;
  license: string;
  previewUrl: string;
}
export interface SearchPage {
  total: number;
  hits: SoundHit[];
}
export interface StyleRow {
  id: string;
  name: string;
}
export interface AdminOverview {
  keySet: boolean;
  sfxDir: string;
  packagesDir: string;
  nextSfxVersion: number;
  nextStylesVersion: number;
  sounds: { sounds: SfxSound[]; warnings: string[] };
  styles: StyleRow[];
}
export interface AddSoundRequest {
  freesoundId: number;
  name: string;
  username: string;
  license: string;
  previewUrl: string;
  category: string;
  tags: string[];
  trimStart: number;
  trimEnd: number | null;
}
export interface BuiltPackage {
  zipPath: string;
  manifestPath: string;
  version: number;
  count: number;
  sha256: string;
  sizeBytes: number;
}

export const adminOverview = () => invoke<AdminOverview>("admin_overview");
export const adminSaveKey = (key: string) => invoke<void>("admin_save_key", { key });
export const adminDeleteKey = () => invoke<void>("admin_delete_key");
export const adminSearch = (query: string, page: number) => invoke<SearchPage>("admin_search", { query, page });
export const adminAddSound = (request: AddSoundRequest, jobId: string) => invoke<SfxSound>("admin_add_sound", { request, jobId });
export const adminUpdateSound = (id: string, category: string, tags: string[], gain: number) => invoke<void>("admin_update_sound", { id, category, tags, gain });
export const adminRemoveSound = (id: string) => invoke<void>("admin_remove_sound", { id });
export const adminImportCurrent = () => invoke<AdminOverview>("admin_import_current");
export const adminSaveStyle = (text: string) => invoke<string>("admin_save_style", { text });
export const adminReadStyle = (id: string) => invoke<string>("admin_read_style", { id });
export const adminRemoveStyle = (id: string) => invoke<void>("admin_remove_style", { id });
export const adminBuildPackage = (kind: "sfx" | "styles", outDir: string | null) => invoke<BuiltPackage>("admin_build_package", { kind, outDir });
