import type { MediaFile } from "../../types/editor.ts";
import type { AppError } from "../../types/error.ts";
import type { VideoResult, VideoSource, VideoStatus } from "../../types/imagegen.ts";
import type { Project, ProjectPatch, Scene } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";
import { fromImported } from "../media/files.ts";
import { addFiles, chooseFor } from "../media/place.ts";
import { formatTimecode } from "../scenes/timecode.ts";

/** One video to make. */
export interface VideoItem {
  sceneId: string;
  /** `S01_000.0-005.1.mp4`. */
  fileName: string;
  prompt: string;
  /** The scene's picture (project-relative) when the video animates it, else null. */
  image: string | null;
}

export function videoFileName(scene: Pick<Scene, "id" | "start" | "end">): string {
  return `${formatTimecode(scene.id, scene.start, scene.end)}.mp4`;
}

const FALLBACK_MOTION = "Slow, smooth cinematic camera movement with subtle natural motion. Keep the same look, colours and subjects. No text on screen.";

/** The words sent to Gemini: for a picture only the motion; for a video from words alone the whole scene prompt plus the motion. */
export function videoPrompt(scene: Pick<Scene, "prompt" | "motionPrompt">, animatesPicture: boolean): string {
  const motion = scene.motionPrompt.trim();
  if (animatesPicture) return `Animate this picture into a short video. ${motion !== "" ? motion : FALLBACK_MOTION}`;
  return [scene.prompt.trim(), motion].filter((part) => part !== "").join(" ");
}

export function isVideoPath(path: string | undefined): boolean {
  return path !== undefined && /\.(mp4|mov|webm)$/i.test(path);
}

/** True when the scene already uses a video file. */
export function hasVideo(scene: Pick<Scene, "id">, mediaMap: Readonly<Record<string, string>>): boolean {
  return isVideoPath(mediaMap[scene.id]);
}

export interface BuildOptions {
  /** Only these scenes (null = all). */
  only: ReadonlySet<string> | null;
  /** A scene that has a picture is animated (true) or made from words alone (false). */
  animatePictures: boolean;
  /** Scenes that already use a video are left out. */
  skipDone: boolean;
}

/** The pictures a scene could be animated from: its own picture file (not a video). */
function pictureOf(scene: Pick<Scene, "id" | "matchedFile">, mediaMap: Readonly<Record<string, string>>): string | null {
  const chosen = mediaMap[scene.id] ?? scene.matchedFile;
  return chosen !== undefined && chosen !== null && !isVideoPath(chosen) && chosen.startsWith("media/") ? chosen : null;
}

/** Which scenes get a video, in scene order. Scenes without anything to say are left out. */
export function buildVideoItems(scenes: readonly Scene[], mediaMap: Readonly<Record<string, string>>, options: BuildOptions): VideoItem[] {
  const items: VideoItem[] = [];
  for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
    if (options.only && !options.only.has(scene.id)) continue;
    if (options.skipDone && hasVideo(scene, mediaMap)) continue;
    const picture = options.animatePictures ? pictureOf(scene, mediaMap) : null;
    const prompt = videoPrompt(scene, picture !== null);
    if (prompt.trim() === "") continue;
    items.push({ sceneId: scene.id, fileName: videoFileName(scene), prompt, image: picture });
  }
  return items;
}

/** Puts a made video into the project so the Auto Editor's timeline uses it for its scene. */
export function registerVideo(project: Pick<Project, "scenes" | "mediaMap" | "editor">, sceneId: string, video: VideoResult): ProjectPatch | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const editor = readEditor(project);
  const name = video.path.split("/").pop() ?? video.path;
  const file: MediaFile = fromImported({ source: "", name, path: video.path, kind: "video", width: video.width, height: video.height, duration: video.duration, modified: video.modified });
  const placed = addFiles(editor, project.mediaMap, project.scenes, [file]);
  const mediaMap = chooseFor(placed.mediaMap, sceneId, video.path);
  const scenes = project.scenes.map((s) => (s.id === sceneId ? { ...s, matchedFile: video.path, status: "matched" as const } : s));
  return { editor: { ...editor, media: placed.media }, mediaMap, scenes };
}

export type WaitSignal = { kind: "wait"; at: number } | { kind: "busy" } | null;

/** The engine says "all accounts are out of videos until ..." or "all busy" in the error's details. */
export function waitSignal(error: Pick<AppError, "details">): WaitSignal {
  const match = /video_wait:(\d+)/.exec(error.details);
  if (match) return { kind: "wait", at: Number(match[1]) };
  if (error.details.includes("video_busy")) return { kind: "busy" };
  return null;
}

export interface QueueDeps {
  make: (item: VideoItem) => Promise<VideoResult>;
  onMade: (item: VideoItem, video: VideoResult) => void;
  onFailed: (item: VideoItem, error: AppError) => void;
  /** Called with the time (epoch ms) the queue waits for, or null when it goes on. */
  onWaiting: (at: number | null) => void;
  /** How many videos may be made at the same time (ready accounts). */
  concurrency: () => number;
  isStopped: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Wait for accounts that are out of videos and then go on (true), or stop at once (false). */
  autoContinue: boolean;
}

export interface QueueReport {
  made: number;
  failed: number;
  /** Items that were not tried (stopped, or waiting for accounts). */
  left: VideoItem[];
}

/** Waits this long after the announced time, so the account is surely back. */
export const WAIT_MARGIN_MS = 60_000;

/**
 * Makes the videos one after another per account: as many at once as there are ready accounts. A scene that
 * fails is reported and the queue goes on. When every account is out of videos the queue either stops (the
 * rest is returned) or waits for the first account to come back.
 */
export async function runVideoQueue(items: readonly VideoItem[], deps: QueueDeps): Promise<QueueReport> {
  const queue = [...items];
  let made = 0;
  let failed = 0;
  let blockedUntil = 0;
  let halted = false;

  async function worker(): Promise<void> {
    while (!halted && !deps.isStopped()) {
      const item = queue.shift();
      if (!item) return;
      const wait = blockedUntil - deps.now();
      if (wait > 0) {
        queue.unshift(item);
        deps.onWaiting(blockedUntil);
        await deps.sleep(Math.min(wait, 1_000));
        continue;
      }
      deps.onWaiting(null);
      try {
        const video = await deps.make(item);
        made += 1;
        deps.onMade(item, video);
      } catch (caught) {
        const error = caught as AppError;
        const signal = waitSignal({ details: typeof error?.details === "string" ? error.details : "" });
        if (signal?.kind === "wait") {
          queue.unshift(item);
          if (deps.autoContinue) blockedUntil = Math.max(blockedUntil, signal.at + WAIT_MARGIN_MS);
          else {
            halted = true;
            deps.onWaiting(signal.at);
          }
        } else if (signal?.kind === "busy") {
          queue.unshift(item);
          blockedUntil = Math.max(blockedUntil, deps.now() + 5_000);
        } else {
          failed += 1;
          deps.onFailed(item, error);
        }
      }
    }
  }

  const count = Math.max(1, Math.min(deps.concurrency(), queue.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
  deps.onWaiting(null);
  return { made, failed, left: queue };
}

/** Joins the status of Flow and Gemini for "Flow first, then Gemini": accounts that can work, and the first return time. */
export function mergeStatus(a: VideoStatus, b: VideoStatus): VideoStatus {
  const times = [a.backAt, b.backAt].filter((t) => t > 0);
  return { ready: a.ready + b.ready, resting: a.resting + b.resting, backAt: times.length > 0 ? Math.min(...times) : 0 };
}

const SOURCES: readonly VideoSource[] = ["gemini", "flow", "auto"];

/** A stored value as a video source ("flow" when it is not one of them: Flow gives the most videos per account). */
export function parseVideoSource(value: string | null): VideoSource {
  return SOURCES.find((s) => s === value) ?? "flow";
}
