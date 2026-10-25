import type { Project, ProjectPatch, VoicePart } from "../types/project.ts";

/** The project fields that belong to ONE part of the voice-over. All other fields are shared by all parts. */
export const PART_FIELDS = [
  "voicePath",
  "voiceLocked",
  "voiceDuration",
  "timingSource",
  "words",
  "scenes",
  "voiceOriginalPath",
  "voiceOriginalDuration",
  "voiceSampleRate",
  "voiceChannels",
  "voiceCleanup",
  "cutMap",
  "script",
  "timingEstimated",
  "alignmentQuality",
  "unmatchedWords",
  "mediaMap",
  "renderedAt",
  "editor",
] as const;

export const FIRST_PART_ID = "p1";
export const MAX_PARTS = 50;

/** The fields of an empty part (no voice yet). */
function emptyPart(): ProjectPatch {
  return {
    voicePath: null,
    voiceLocked: false,
    voiceDuration: 0,
    timingSource: null,
    words: [],
    scenes: [],
    voiceOriginalPath: null,
    voiceOriginalDuration: 0,
    voiceSampleRate: 0,
    voiceChannels: 0,
    cutMap: [],
    script: "",
    timingEstimated: false,
    alignmentQuality: null,
    unmatchedWords: [],
    mediaMap: {},
    renderedAt: null,
    editor: null,
  };
}

export function activeId(project: Pick<Project, "activePartId">): string {
  return project.activePartId === "" ? FIRST_PART_ID : project.activePartId;
}

export function activeName(project: Pick<Project, "partName" | "activePartId">): string {
  return project.partName.trim() === "" ? (activeId(project) === FIRST_PART_ID ? "Part 1" : "Part") : project.partName;
}

export interface PartTab {
  id: string;
  name: string;
  active: boolean;
}

/** All parts in order of creation, with the open one marked. */
export function partTabs(project: Project): PartTab[] {
  const tabs: PartTab[] = [{ id: activeId(project), name: activeName(project), active: true }, ...project.parts.map((p) => ({ id: p.id, name: p.name, active: false }))];
  return tabs.sort((a, b) => numberOf(a.id) - numberOf(b.id));
}

function numberOf(id: string): number {
  const n = Number.parseInt(id.replace(/^p/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function nextPartId(project: Project): string {
  return `p${Math.max(...partTabs(project).map((t) => numberOf(t.id))) + 1}`;
}

export function nextPartName(project: Project): string {
  return `Part ${partTabs(project).length + 1}`;
}

/** Copies the open part's own fields. */
export function snapshotOf(project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = project as unknown as Record<string, unknown>;
  for (const key of PART_FIELDS) out[key] = source[key];
  return out;
}

function stashed(project: Project): VoicePart {
  return { id: activeId(project), name: activeName(project), snapshot: snapshotOf(project) };
}

/** Starts a new, empty part after the open one. The open part is kept as it is. */
export function addPartPatch(project: Project, name: string): ProjectPatch {
  if (project.parts.length + 1 >= MAX_PARTS) return {};
  const id = nextPartId(project);
  return { ...emptyPart(), parts: [...project.parts, stashed(project)], activePartId: id, partName: cleanName(name, nextPartName(project)) };
}

/** Opens another part: the open one is put aside, the chosen one comes back. Null when it does not exist. */
export function switchPartPatch(project: Project, targetId: string): ProjectPatch | null {
  const target = project.parts.find((p) => p.id === targetId);
  if (!target) return null;
  const rest = project.parts.filter((p) => p.id !== targetId);
  return { ...emptyPart(), ...(target.snapshot as ProjectPatch), parts: [...rest, stashed(project)], activePartId: target.id, partName: target.name };
}

export function renamePartPatch(project: Project, id: string, name: string): ProjectPatch {
  if (id === activeId(project)) return { partName: cleanName(name, activeName(project)), activePartId: id };
  return { parts: project.parts.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p)) };
}

/** Removes a part that is not open. */
export function removePartPatch(project: Project, id: string): ProjectPatch | null {
  if (id === activeId(project) || !project.parts.some((p) => p.id === id)) return null;
  return { parts: project.parts.filter((p) => p.id !== id) };
}

function cleanName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 40);
  return trimmed === "" ? fallback : trimmed;
}
