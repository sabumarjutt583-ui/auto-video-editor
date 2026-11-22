import { readEditor } from "../editor/model.ts";
import type { Project } from "../../types/project.ts";

export type QualitySeverity = "error" | "warning" | "info";
export interface StudioQualityIssue {
  severity: QualitySeverity;
  sceneId: string | null;
  time: number;
  message: string;
}

export function checkStudioQuality(project: Project, present: Readonly<Record<string, boolean>> = {}): StudioQualityIssue[] {
  const issues: StudioQualityIssue[] = [];
  const editor = readEditor(project);
  if (project.scenes.length === 0) {
    issues.push({ severity: "error", sceneId: null, time: 0, message: "Timeline is empty. Import media or build script scenes first." });
    return issues;
  }
  let nextStart = 0;
  for (const scene of project.scenes) {
    if (!Number.isFinite(scene.duration) || scene.duration <= 0 || !Number.isFinite(scene.start) || !Number.isFinite(scene.end)) {
      issues.push({ severity: "error", sceneId: scene.id, time: scene.start, message: "Clip timing is invalid." });
      continue;
    }
    if (Math.abs(scene.start - nextStart) > 0.05 || Math.abs(scene.end - scene.start - scene.duration) > 0.05) {
      issues.push({ severity: "error", sceneId: scene.id, time: scene.start, message: "Clip starts, ends or durations have gaps/overlaps." });
    }
    nextStart = scene.end;
    const path = project.mediaMap[scene.id];
    const file = editor.media.find((asset) => asset.path === path);
    if (!file) {
      issues.push({ severity: "error", sceneId: scene.id, time: scene.start, message: "No image or video is assigned to this scene." });
      continue;
    }
    if (present[file.path] === false) {
      issues.push({ severity: "error", sceneId: scene.id, time: scene.start, message: `Missing source file: ${file.name}` });
    }
    if (file.kind === "video") {
      const sourceIn = editor.studioSourceIn[scene.id] ?? 0;
      if (sourceIn < 0 || sourceIn >= file.duration) {
        issues.push({ severity: "error", sceneId: scene.id, time: scene.start, message: "Video in-point is outside the source footage." });
      } else if (sourceIn + scene.duration > file.duration + 0.05) {
        issues.push({ severity: "warning", sceneId: scene.id, time: scene.start,
          message: "Video scene outlasts available footage: loop, slowdown or hold may be required." });
      }
    }
  }
  if (Math.abs(nextStart - project.voiceDuration) > 0.1) {
    issues.push({ severity: "error", sceneId: null, time: nextStart, message: "Timeline end differs from the project render duration." });
  }
  if (!project.voicePath) {
    issues.push({ severity: "info", sceneId: null, time: 0, message: "No voiceover is attached. Export will contain silent narration unless music/SFX are configured." });
  } else if (project.timingEstimated) {
    issues.push({ severity: "warning", sceneId: null, time: 0, message: "Script timing is estimated, not verified against voiceover word timestamps." });
  }
  return issues.sort((a, b) => ({ error: 0, warning: 1, info: 2 })[a.severity] - ({ error: 0, warning: 1, info: 2 })[b.severity] || a.time - b.time);
}
