import { invoke } from "@tauri-apps/api/core";

import type { AnalyzeAnswer, AnalyzeRequest, PreparedImage, StyleProfile, StyleRefs } from "../../types";

/** Checks one picture (PNG, JPG or WebP, at most 10 MB) and makes the shrunk JPEG copy that is sent to the AI. */
export function prepareStyleImage(path: string): Promise<PreparedImage> {
  return invoke<PreparedImage>("prepare_style_image", { path });
}

/** Lets the chosen AI study the pictures and write a style profile. Can be cancelled with the job id. */
export function analyzeStyle(jobId: string, request: AnalyzeRequest): Promise<AnalyzeAnswer> {
  return invoke<AnalyzeAnswer>("analyze_style", { jobId, request });
}

/** Saves the style, keeps its pictures and makes its thumbnail from the first picture. */
export function saveStyleWithRefs(style: StyleProfile, images: string[], description: string, engine: string): Promise<StyleProfile> {
  return invoke<StyleProfile>("save_style_with_refs", { request: { style, images, description, engine } });
}

/** The pictures and notes kept with a custom style, or null when it was written by hand. */
export function loadStyleRefs(id: string): Promise<StyleRefs | null> {
  return invoke<StyleRefs | null>("load_style_refs", { id });
}

/** Saves `style` (with a new id) as a copy of a custom style, including its pictures and thumbnail. */
export function duplicateCustomStyle(sourceId: string, style: StyleProfile): Promise<StyleProfile> {
  return invoke<StyleProfile>("duplicate_custom_style", { sourceId, style });
}

/** Writes a custom style and its pictures into one .avstyle file. Resolves to the path that was written. */
export function exportStylePackage(id: string, dest: string): Promise<string> {
  return invoke<string>("export_style_package", { id, dest });
}

/** Adds the style from an .avstyle file as a new custom style. */
export function importStylePackage(path: string): Promise<StyleProfile> {
  return invoke<StyleProfile>("import_style_package", { path });
}
