import { repairSpec } from "../graphics/spec/index.ts";
import type { EditorData, KenBurns, MotionGraphic, MediaFile, Placeholder, SceneOverride, TimeChoice, Transition, VideoFit } from "../../types/editor.ts";
import type { Project } from "../../types/project.ts";
import { readAudio } from "../audio/read.ts";
import { readRender } from "../render/read.ts";
import { readCaptions } from "../captions/read.ts";

export const DEFAULT_OVERRIDE: SceneOverride = { kenBurns: "auto", videoFit: "crop", speed: 1, transition: "auto", emphasis: false };

const KEN_BURNS: readonly KenBurns[] = ["auto", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "none"];
const FITS: readonly VideoFit[] = ["crop", "blur"];
const TRANSITIONS: readonly Transition[] = ["auto", "cut", "fade", "dissolve", "slide", "zoom", "whip"];
const PLACEHOLDERS: readonly Placeholder[] = ["hold", "black", "blur"];

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function text(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOverride(value: unknown): SceneOverride {
  const o = isObject(value) ? value : {};
  return {
    kenBurns: pick(o.kenBurns, KEN_BURNS, DEFAULT_OVERRIDE.kenBurns),
    videoFit: pick(o.videoFit, FITS, DEFAULT_OVERRIDE.videoFit),
    speed: Math.min(1, Math.max(0.25, finite(o.speed, 1))),
    transition: pick(o.transition, TRANSITIONS, DEFAULT_OVERRIDE.transition),
    emphasis: o.emphasis === true,
  };
}

function readMedia(value: unknown): MediaFile | null {
  if (!isObject(value) || typeof value.path !== "string" || typeof value.name !== "string") return null;
  const how = value.how;
  return {
    path: value.path,
    name: value.name,
    kind: value.kind === "video" ? "video" : "image",
    width: finite(value.width, 0),
    height: finite(value.height, 0),
    duration: finite(value.duration, 0),
    modified: finite(value.modified, 0),
    sceneId: text(value.sceneId, null),
    start: typeof value.start === "number" ? value.start : null,
    end: typeof value.end === "number" ? value.end : null,
    how: how === "name" || how === "number" || how === "order" || how === "gemini" || how === "manual" || how === "rename" ? how : null,
    confidence: typeof value.confidence === "number" ? value.confidence : null,
  };
}

/** A path inside the project: relative, no "..", no backslashes. */
function insideProject(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.includes("..") && !path.includes("\\") && !/^[A-Za-z]:/.test(path);
}

function readMotion(value: unknown): MotionGraphic | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.sceneId !== "string") return null;
  const common = {
    id: value.id,
    sceneId: value.sceneId,
    start: Math.max(0, finite(value.start, 0)),
    duration: Math.max(0, finite(value.duration, 0)),
    idea: text(value.idea, "") ?? "",
    fps: Math.min(60, Math.max(12, Math.round(finite(value.fps, 30)))),
    frames: Math.max(0, Math.round(finite(value.frames, 0))),
    width: Math.max(0, Math.round(finite(value.width, 0))),
    height: Math.max(0, Math.round(finite(value.height, 0))),
    enabled: value.enabled !== false,
  };
  if (value.kind === "spec") {
    const clipPath = value.clipPath;
    const repaired = repairSpec(value.spec);
    if (typeof clipPath !== "string" || !insideProject(clipPath) || !clipPath.endsWith(".mov") || !repaired.ok) return null;
    return { ...common, framesDir: "", htmlPath: "", kind: "spec", clipPath, spec: repaired.spec };
  }
  if (typeof value.framesDir !== "string" || !insideProject(value.framesDir)) return null;
  return { ...common, framesDir: value.framesDir, htmlPath: text(value.htmlPath, "") ?? "" };
}

/** The editor data of a project, with every missing or damaged part replaced by its default. */
export function readEditor(project: Pick<Project, "editor">): EditorData {
  const raw = isObject(project.editor) ? project.editor : {};
  const media = Array.isArray(raw.media) ? raw.media.map(readMedia).filter((m): m is MediaFile => m !== null) : [];
  const timeChoices: Record<string, TimeChoice> = {};
  if (isObject(raw.timeChoices)) {
    for (const [id, choice] of Object.entries(raw.timeChoices)) {
      if (choice === "file" || choice === "project") timeChoices[id] = choice;
    }
  }
  const overrides: Record<string, SceneOverride> = {};
  if (isObject(raw.overrides)) {
    for (const [id, value] of Object.entries(raw.overrides)) overrides[id] = readOverride(value);
  }
  const motion = Array.isArray(raw.motion) ? raw.motion.map(readMotion).filter((g): g is MotionGraphic => g !== null) : [];
  return { media, motion, timeChoices, placeholder: pick(raw.placeholder, PLACEHOLDERS, "hold"), overrides, captions: readCaptions(raw.captions), audio: readAudio(raw.audio), render: readRender(raw.render) };
}

/** The override of a scene (the defaults when it has none). */
export function overrideOf(editor: Pick<EditorData, "overrides">, sceneId: string): SceneOverride {
  return editor.overrides[sceneId] ?? DEFAULT_OVERRIDE;
}
