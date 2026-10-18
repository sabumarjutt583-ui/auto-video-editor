import { invoke } from "@tauri-apps/api/core";

import type { FileMatch, ImportItem, ImportResult, MediaKind, ScanResult, ThumbItem, ThumbResult } from "../../types/editor";

/** Finds the pictures and clips in dropped files and folders and reads their details. Nothing is copied. */
export function scanMedia(paths: string[], jobId: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_media", { paths, jobId });
}

/** Copies files into the project's media folder (the originals are never changed). */
export function importMedia(projectId: string, items: ImportItem[], jobId: string): Promise<ImportResult> {
  return invoke<ImportResult>("import_media", { projectId, items, jobId });
}

export function makeThumbnails(projectId: string, items: ThumbItem[], width: number, frames: number, jobId: string): Promise<ThumbResult[]> {
  return invoke<ThumbResult[]>("make_thumbnails", { projectId, items, width, frames, jobId });
}

/** For each path: is the file still in the project folder? */
export function checkMedia(projectId: string, paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("check_media", { projectId, paths });
}

export function removeMedia(projectId: string, paths: string[]): Promise<void> {
  return invoke<void>("remove_media", { projectId, paths });
}

export interface MatchFileInput {
  name: string;
  path: string;
  kind: MediaKind;
  duration: number;
}

export function matchMediaWithGemini(projectId: string, files: MatchFileInput[], scenes: { id: string; text: string }[], jobId: string): Promise<FileMatch[]> {
  return invoke<FileMatch[]>("match_media_with_gemini", { projectId, files, scenes, jobId });
}

export function projectDirPath(projectId: string): Promise<string> {
  return invoke<string>("project_dir_path", { projectId });
}
