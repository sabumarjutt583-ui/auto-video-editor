import { convertFileSrc } from "@tauri-apps/api/core";

import { makeThumbnails } from "../../../lib/media/api";
import { resolveMotion } from "../../../lib/editor/motion";
import { fileOf } from "../../../lib/editor/status";
import { overrideOf } from "../../../lib/editor/model";
import { findSubject, frameToSource, grayOf, parseSubjects, SUBJECT_SYSTEM, subjectQuestion, subjectsOnScreen, frameSize, type Box, type Subject } from "../../../lib/graphics/placement";
import { placementAsk } from "../../../lib/graphics/placement/api";
import { runJob } from "../../../store/jobStore";
import type { EditorData, MediaFile, Project } from "../../../types";

const THUMB_WIDTH = 256;
const GRAY_WIDTH = 64;
const PER_QUESTION = 4;

interface SceneLook {
  file: MediaFile;
  /** Subject boxes in the source, one per preview frame (pictures: one). */
  saliency: Array<Box | null>;
  ai: Box | null;
  /** The middle preview picture as small colour pixels (for the contrast check). */
  pixels: Small | null;
  /** The preview picture sent to the AI (project-relative). */
  forAi: string;
}

interface Small { gray: Uint8Array; rgba: Uint8ClampedArray; width: number; height: number }

async function grayOfFile(url: string): Promise<Small | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = GRAY_WIDTH;
    const height = Math.max(8, Math.round((GRAY_WIDTH * image.naturalHeight) / Math.max(1, image.naturalWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    return { gray: grayOf(rgba, width, height), rgba, width, height };
  } catch {
    return null;
  }
}

export interface SubjectFinder {
  /** Where the subject is in the frame while a graphic of this scene is on screen (empty = unknown or none). */
  subjectsFor: (item: { sceneId: string; start: number; duration: number }) => Box[];
  /** Average colour of the picture under a box of the frame (null = no picture, so not known). */
  colorUnder: (sceneId: string, box: Box) => [number, number, number] | null;
  /** One plain sentence about how the subjects were found (empty when all went well). */
  note: string;
}

/**
 * Finds the subject of every scene that has a picture or clip: the AI looks at one preview picture per scene (four per question)
 * with the current engine; a scene the AI could not answer, or the whole run when the AI is unavailable, gets the local saliency
 * estimate instead. Never throws; a scene without media has no subject.
 */
export async function findSubjects(project: Project, editor: EditorData, dir: string, sceneIds: readonly string[], useAi = true): Promise<SubjectFinder> {
  const looks = new Map<string, SceneLook>();
  const wanted = [...new Set(sceneIds)].flatMap((id) => {
    const scene = project.scenes.find((s) => s.id === id);
    const file = scene ? fileOf(scene, editor.media, project.mediaMap) : undefined;
    return scene && file ? [{ scene, file }] : [];
  });
  let note = "";
  if (wanted.length > 0) {
    try {
      const thumbs = await runJob("placement", "Looking at the pictures", (jobId) =>
        makeThumbnails(project.id, wanted.map((w) => ({ path: w.file.path, kind: w.file.kind, duration: w.file.duration })), THUMB_WIDTH, 3, jobId),
      );
      for (const { scene, file } of wanted) {
        const made = thumbs.find((t) => t.path === file.path)?.thumbs ?? [];
        if (made.length === 0) continue;
        const saliency: Array<Box | null> = [];
        let pixels: Small | null = null;
        for (const [at, rel] of made.entries()) {
          const g = await grayOfFile(convertFileSrc(`${dir}/${rel}`.replace(/\\/g, "/")));
          saliency.push(g ? (findSubject(g.gray, g.width, g.height)?.box ?? null) : null);
          if (at === Math.floor(made.length / 2)) pixels = g;
        }
        looks.set(scene.id, { file, saliency, ai: null, pixels, forAi: made[Math.floor(made.length / 2)] as string });
      }
    } catch {
      note = "The preview pictures could not be made, so graphics were not checked against the picture.";
    }
  }
  if (useAi && looks.size > 0) {
    const entries = [...looks.entries()];
    try {
      for (let i = 0; i < entries.length; i += PER_QUESTION) {
        const group = entries.slice(i, i + PER_QUESTION);
        const text = await runJob("placement", "Asking the AI where the subject is", (jobId) =>
          placementAsk(project.id, SUBJECT_SYSTEM, subjectQuestion(group.map(([id]) => `scene ${id}`)), group.map(([, l]) => l.forAi), jobId),
        );
        const found: Map<number, Subject> = parseSubjects(text, group.length);
        group.forEach(([, look], k) => { look.ai = found.get(k + 1)?.box ?? null; });
      }
    } catch {
      note = "The AI could not look at the pictures, so a simple local estimate was used to keep graphics off the subject.";
    }
  }

  const { aspectRatio } = project.settings;
  const frame = frameSize(aspectRatio);
  return {
    note,
    colorUnder: (sceneId, box) => {
      const look = looks.get(sceneId);
      const scene = project.scenes.find((x) => x.id === sceneId);
      if (!look?.pixels || !scene) return null;
      const overridden = overrideOf(editor, scene.id);
      const region = frameToSource(box, { width: look.file.width, height: look.file.height }, frame, overridden.videoFit);
      const { rgba, width: w, height: h } = look.pixels;
      const x0 = Math.floor(region.x * w), x1 = Math.max(x0 + 1, Math.ceil((region.x + region.w) * w));
      const y0 = Math.floor(region.y * h), y1 = Math.max(y0 + 1, Math.ceil((region.y + region.h) * h));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < Math.min(h, y1); y++) for (let x = x0; x < Math.min(w, x1); x++) { const i = (y * w + x) * 4; r += rgba[i] as number; g += rgba[i + 1] as number; b += rgba[i + 2] as number; n++; }
      return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
    },
    subjectsFor: (item) => {
      const scene = project.scenes.find((s) => s.id === item.sceneId);
      const look = looks.get(item.sceneId);
      if (!scene || !look) return [];
      const length = Math.max(0.001, scene.end - scene.start);
      const boxes = look.ai ? [look.ai] : look.saliency.filter((b): b is Box => b !== null);
      const overridden = overrideOf(editor, scene.id);
      return subjectsOnScreen({
        kind: look.file.kind, source: { width: look.file.width, height: look.file.height }, frame, boxes,
        motion: resolveMotion(overridden.kenBurns, scene.index), fit: overridden.videoFit,
        from: (item.start - scene.start) / length, to: (item.start + item.duration - scene.start) / length,
      });
    },
  };
}
