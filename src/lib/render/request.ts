import type { AspectRatio, Quality } from "../../types/settings.ts";
import type { CaptionLine, MotionGraphic, CaptionStyle, EditorData, KenBurns, MediaFile, SceneOverride, SfxCue, VideoFit } from "../../types/editor.ts";
import type { Project, Scene } from "../../types/project.ts";
import { buildMixRequest, type MixRequest } from "../audio/mixRequest.ts";
import { buildAssRequest, type AssRequest } from "../captions/assRequest.ts";
import type { FontInfo } from "../captions/fonts.ts";
import { toSrt } from "../captions/exportSubtitles.ts";
import { resolveMotion } from "../editor/motion.ts";
import { overrideOf } from "../editor/model.ts";
import { outputSize } from "../editor/size.ts";
import { fileOf } from "../editor/status.ts";
import { effectiveTransition, transitionLength, type TransitionKind } from "../editor/transitions.ts";

export type RenderMotion = Exclude<KenBurns, "auto">;

export interface RenderSource {
  kind: "image" | "video" | "black";
  path: string;
  duration: number;
  lastFrame: boolean;
  blurAll: boolean;
}

export interface RenderScene {
  id: string;
  start: number;
  end: number;
  source: RenderSource;
  motion: RenderMotion;
  fit: VideoFit;
  speed: number;
  transition: { kind: TransitionKind; seconds: number };
}

/** A graphic laid over the video: a folder of PNG frames (AI HTML graphics) or one transparent clip (app-drawn graphics). */
export interface RenderOverlay {
  framesDir?: string;
  clip?: string;
  start: number;
  fps: number;
}

/** The motion graphics that are on and fit the picture shape (a 16:9 graphic is not stretched into a 9:16 video). */
export function buildOverlays(motion: readonly MotionGraphic[], width: number, height: number, duration: number): RenderOverlay[] {
  const shape = width / height;
  return motion
    .filter((g) => g.enabled && g.frames > 0 && g.width > 0 && g.height > 0 && Math.abs(g.width / g.height - shape) < 0.02 && g.start < duration)
    .map((g): RenderOverlay => (g.kind === "spec" && g.clipPath ? { clip: g.clipPath, start: g.start, fps: g.fps } : { framesDir: g.framesDir, start: g.start, fps: g.fps }));
}

/** What the Rust renderer needs (see src-tauri/src/render/model.rs). */
export interface RenderRequest {
  projectName: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  scenes: RenderScene[];
  kenBurns: boolean;
  captions: AssRequest | null;
  srt: string | null;
  mix: MixRequest;
  overlays: RenderOverlay[];
  aspectLabel: string;
  suffix: string | null;
  date: string;
}

export interface RenderInput {
  project: Project;
  editor: EditorData;
  /** Result of the last folder check: false for a file that is gone. */
  exists: Readonly<Record<string, boolean>>;
  aspect: AspectRatio;
  quality: Quality;
  captionLines: readonly CaptionLine[];
  captionStyle: CaptionStyle;
  font: FontInfo;
  cues: readonly SfxCue[];
  suffix: string | null;
  /** Today, "2026-10-18". */
  date: string;
}

const BLACK: RenderSource = { kind: "black", path: "", duration: 0, lastFrame: false, blurAll: false };

/** "16:9" becomes "16x9" (a colon is not allowed in file names). */
export function aspectLabel(aspect: AspectRatio): string {
  return aspect.replace(":", "x");
}

function sourceOf(file: MediaFile): RenderSource {
  return { kind: file.kind, path: file.path, duration: file.kind === "video" ? file.duration : 0, lastFrame: false, blurAll: false };
}

/** What a scene without media shows: the scene before it held or blurred, or black. */
function placeholderFor(kind: EditorData["placeholder"], before: RenderSource | null): RenderSource {
  if (kind === "black" || before === null || before.kind === "black") return BLACK;
  return { ...before, lastFrame: before.kind === "video", blurAll: kind === "blur" };
}

export function buildRenderScenes(scenes: readonly Scene[], editor: EditorData, project: Pick<Project, "mediaMap">, exists: Readonly<Record<string, boolean>>): RenderScene[] {
  const result: RenderScene[] = [];
  let lastReal: RenderSource | null = null;
  scenes.forEach((scene, i) => {
    const override: SceneOverride = overrideOf(editor, scene.id);
    const file = fileOf(scene, editor.media, project.mediaMap);
    const real = file !== undefined && exists[file.path] !== false;
    const source = real && file ? sourceOf(file) : placeholderFor(editor.placeholder, lastReal);
    if (real) lastReal = source;
    const previous = scenes[i - 1];
    const kind = previous ? effectiveTransition(override.transition, scene.index, editor.render.transitions) : "cut";
    result.push({
      id: scene.id,
      start: scene.start,
      end: scene.end,
      source,
      motion: real && editor.render.kenBurns ? resolveMotion(override.kenBurns, scene.index) : "none",
      fit: override.videoFit,
      speed: override.speed,
      transition: { kind, seconds: previous ? transitionLength(kind, scene.duration, previous.duration) : 0 },
    });
  });
  return result;
}

/** Everything the renderer needs for one video. */
export function buildRenderRequest(input: RenderInput): RenderRequest {
  const { project, editor, aspect, quality } = input;
  const { width, height } = outputSize(aspect, quality);
  const captionsOn = input.captionStyle.preset !== "none" && input.captionLines.length > 0;
  return {
    projectName: project.name,
    width,
    height,
    fps: editor.render.fps,
    duration: project.voiceDuration,
    scenes: buildRenderScenes(project.scenes, editor, project, input.exists),
    kenBurns: editor.render.kenBurns,
    captions: captionsOn ? buildAssRequest(aspect, quality, input.captionStyle, input.font, input.captionLines) : null,
    srt: input.captionLines.length > 0 ? toSrt(input.captionLines) : null,
    mix: buildMixRequest(editor.audio, project.voicePath ?? "", project.voiceDuration, input.cues),
    overlays: buildOverlays(editor.motion, width, height, project.voiceDuration),
    aspectLabel: aspectLabel(aspect),
    suffix: input.suffix,
    date: input.date,
  };
}

/** What stops a render before it starts, in plain words (empty when it can start). */
export function renderProblems(project: Pick<Project, "voicePath" | "voiceDuration" | "scenes">): string[] {
  const problems: string[] = [];
  if (!project.voicePath || project.voiceDuration <= 0) problems.push("Add a voice-over first (Prompt Generator, step 1).");
  if (project.scenes.length === 0) problems.push("There are no scenes yet. Build them in the Prompt Generator.");
  return problems;
}

/** Today's date as "2026-10-18" in the person's own time zone. */
export function todayStamp(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "about 3 min left", from how far the job is and how long it has run. Empty until the estimate is steady. */
export function timeLeft(percent: number, elapsedSeconds: number): string {
  if (percent < 3 || elapsedSeconds < 5) return "";
  const left = Math.max(0, (elapsedSeconds * (100 - percent)) / percent);
  if (left < 10) return "a few seconds left";
  if (left < 90) return `about ${Math.round(left / 5) * 5} seconds left`;
  if (left < 5400) return `about ${Math.round(left / 60)} min left`;
  return `about ${(left / 3600).toFixed(1)} hours left`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
