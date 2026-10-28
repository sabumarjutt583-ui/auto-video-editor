import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AddReport, ImageGenSettings, ImageGenSnapshot, MediaInfo, NewImageJob, SavedImage, TestImage, VideoResult, VideoSource, VideoStatus } from "../../types/imagegen";

export const imagegenState = () => invoke<ImageGenSnapshot>("imagegen_state");
export const imagegenSetSettings = (settings: ImageGenSettings) => invoke<void>("imagegen_set_settings", { settings });
export const imagegenAcceptConsent = () => invoke<void>("imagegen_accept_consent");
export const imagegenDetectBrowser = () => invoke<string | null>("imagegen_detect_browser");

export const imagegenAddAccount = (name: string) => invoke<string>("imagegen_add_account", { name });
export const imagegenUpdateAccount = (id: string, name?: string, enabled?: boolean) => invoke<void>("imagegen_update_account", { id, name: name ?? null, enabled: enabled ?? null });
export const imagegenRemoveAccount = (id: string) => invoke<void>("imagegen_remove_account", { id });
export const imagegenSignIn = (id: string) => invoke<void>("imagegen_sign_in", { id });
export const imagegenFinishSignIn = (id: string) => invoke<void>("imagegen_finish_sign_in", { id });
export const imagegenVerify = (id: string) => invoke<void>("imagegen_verify", { id });
export const imagegenTestImage = (id: string) => invoke<TestImage>("imagegen_test_image", { id });
export const imagegenBackgroundSnapshot = (id: string) => invoke<string | null>("imagegen_background_snapshot", { id });
export const imagegenShowBrowser = (id: string) => invoke<boolean>("imagegen_show_browser", { id });

export const imagegenStart = (projectId: string, jobs: NewImageJob[], force: boolean, start: boolean) => invoke<AddReport>("imagegen_start", { projectId, jobs, force, start });
/** "Only images": prompts typed by the person, saved in `<folder>/media`. An empty list only opens the folder's queue. */
export const imagegenStartFolder = (folder: string, jobs: NewImageJob[], force: boolean, start: boolean) => invoke<AddReport>("imagegen_start_folder", { folder, jobs, force, start });
/** A small WebP preview (data address) of a picture in the folder the queue works on, or null. */
export const imagegenPreview = (folder: string, path: string, width: number) => invoke<string | null>("imagegen_preview", { folder, path, width });
export const imagegenPause = () => invoke<void>("imagegen_pause");
export const imagegenResume = () => invoke<void>("imagegen_resume");
export const imagegenRetryFailed = (ids: string[]) => invoke<number>("imagegen_retry_failed", { ids });
export const imagegenRemoveJobs = (ids: string[]) => invoke<number>("imagegen_remove_jobs", { ids });
export interface DeleteItem {
  id: string;
  file: string | null;
}
export interface DeleteReport {
  trashed: string[];
  missing: string[];
  failed: string[];
}
/** Moves pictures to the Recycle Bin / Trash and removes their queue entries. `target` is the project or the "Only images" folder. */
export const imagegenDeleteImages = (target: { projectId: string } | { folder: string }, items: DeleteItem[]) =>
  invoke<DeleteReport>("imagegen_delete_images", { projectId: "projectId" in target ? target.projectId : null, folder: "folder" in target ? target.folder : null, items });
export const imagegenReloadConfig = () => invoke<string>("imagegen_reload_config");
export const imagegenMediaInfo = (projectId: string, paths: string[]) => invoke<(MediaInfo | null)[]>("imagegen_media_info", { projectId, paths });

export function listenImageGenState(handler: (snapshot: ImageGenSnapshot) => void): Promise<UnlistenFn> {
  return listen<ImageGenSnapshot>("imagegen-state", (event) => handler(event.payload));
}

export function listenSavedImage(handler: (image: SavedImage) => void): Promise<UnlistenFn> {
  return listen<SavedImage>("imagegen-image", (event) => handler(event.payload));
}

export interface ChatAnswer {
  text: string;
  code: string[];
}
/** One question to Gemini's web chat (Google accounts, no API key). */
export const imagegenChatAsk = (prompt: string) => invoke<ChatAnswer>("imagegen_chat_ask", { prompt });

export interface FlowBatchInfo {
  url: string;
  imagesModel: string;
  videosModel: string;
  videoModelOptions: string[];
  videoDurationOptions: string[];
  aspect: string;
  videoSeconds: number;
  videoResolution: string;
  videoCreditsPerVideo: number;
  maxCreditsPerVideo: number;
  batchSize: number;
}

/** Batch Flow Studio defaults (the shared tool link only). */
export const flowBatchConfig = () => invoke<FlowBatchInfo>("flow_batch_config");

export interface FlowBatchRenamePreview {
  flowName: string;
  timecodeName: string;
  sceneId: string;
}

export interface FlowBatchPrepared {
  text: string;
  paragraphCount: number;
  sceneIds: string[];
  estimatedCredits: number;
  perVideoCredits: number;
  maxCreditsPerVideo: number;
  renamePreview: FlowBatchRenamePreview[];
}

/** Validates jobs, formats them as paragraphs, checks the credit guard, and returns the rename preview. */
export const flowBatchPrepare = (jobs: NewImageJob[], generationType: "images" | "videos") =>
  invoke<FlowBatchPrepared>("flow_batch_prepare", { request: { jobs, generationType } });

/** Builds the timecode name for one Flow file from the project scene record. */
export const flowBatchRename = (flowName: string, sceneId: string, start: number, end: number, generationType: "images" | "videos") =>
  invoke<string>("flow_batch_rename", { request: { flowName, sceneId, start, end, generationType } });

export interface FlowBatchSavedFile {
  sceneId: string;
  flowName: string;
  savedName: string;
  path: string;
  width: number;
  height: number;
  duration: number;
  modified: number;
}

export interface FlowBatchRunReport {
  saved: FlowBatchSavedFile[];
  failedSceneIds: string[];
  accountName: string;
  estimatedCredits: number;
  perVideoCredits: number;
}

export interface FlowBatchRunRequest {
  projectId: string;
  accountId?: string;
  jobs: NewImageJob[];
  generationType: "images" | "videos";
  videoModel?: string;
  videoSeconds?: number;
  videoResolution?: string;
  maxCreditsPerVideo?: number;
}

/**
 * The wired run: opens Batch Flow Studio in a tab of a Google
 * account's browser, generates the whole batch, downloads per card
 * in card order, and saves each download renamed from the scene
 * record into the project's media folder. Returns the saved files
 * (and any failed scene ids) so the page can register them.
 */
export const flowBatchRun = (request: FlowBatchRunRequest) =>
  invoke<FlowBatchRunReport>("flow_batch_run", { request });

/** Prepare with an explicit video model/duration (absent = config default). */
export const flowBatchPrepareWith = (
  jobs: NewImageJob[],
  generationType: "images" | "videos",
  videoModel?: string,
  videoSeconds?: number,
  videoResolution?: string,
) =>
  invoke<FlowBatchPrepared>("flow_batch_prepare", {
    request: { jobs, generationType, videoModel, videoSeconds, videoResolution },
  });

/** One video from a prompt (and, with `image`, from that picture of the project's media folder), made by the next Google account that has videos left. */
export const imagegenMakeVideo = (projectId: string, prompt: string, image: string | null, fileName: string, jobId: string, source: VideoSource = "gemini") =>
  invoke<VideoResult>("imagegen_make_video", { projectId, prompt, image, fileName, jobId, source });
export const imagegenVideoStatus = (source: Exclude<VideoSource, "auto"> = "gemini") => invoke<VideoStatus>("imagegen_video_status", { source });
