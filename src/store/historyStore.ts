import { create } from "zustand";

import type { Project, ProjectPatch } from "../types";
import { useProjectStore } from "./projectStore";

/** The parts of a project that the Auto Editor changes, and that Undo and Redo bring back. */
const EDIT_KEYS = ["scenes", "mediaMap", "editor"] as const;
type EditKey = (typeof EDIT_KEYS)[number];
type Snapshot = Pick<Project, EditKey>;

/** How many steps can be undone. */
export const HISTORY_LIMIT = 50;

interface HistoryState {
  projectId: string | null;
  undoStack: Partial<Snapshot>[];
  redoStack: Partial<Snapshot>[];
}

export const useHistoryStore = create<HistoryState>(() => ({ projectId: null, undoStack: [], redoStack: [] }));

function pickKeys(project: Project, keys: readonly EditKey[]): Partial<Snapshot> {
  const picked: Partial<Snapshot> = {};
  for (const key of keys) (picked as Record<string, unknown>)[key] = project[key];
  return picked;
}

function keysOf(patch: ProjectPatch): EditKey[] {
  return EDIT_KEYS.filter((key) => key in patch);
}

function currentProject(): Project | null {
  const project = useProjectStore.getState().project;
  const history = useHistoryStore.getState();
  if (project && history.projectId !== project.id) useHistoryStore.setState({ projectId: project.id, undoStack: [], redoStack: [] });
  return project;
}

/** Changes the project like `update`, and remembers the old values so the change can be undone. */
export function applyEdit(patch: ProjectPatch): void {
  const project = currentProject();
  if (!project) return;
  const keys = keysOf(patch);
  if (keys.length > 0) {
    const before = pickKeys(project, keys);
    useHistoryStore.setState((state) => ({ undoStack: [...state.undoStack, before].slice(-HISTORY_LIMIT), redoStack: [] }));
  }
  useProjectStore.getState().update(patch);
}

function restore(from: "undoStack" | "redoStack", to: "undoStack" | "redoStack"): boolean {
  const project = currentProject();
  const stack = useHistoryStore.getState()[from];
  const entry = stack[stack.length - 1];
  if (!project || !entry) return false;
  const keys = EDIT_KEYS.filter((key) => key in entry);
  const now = pickKeys(project, keys);
  useHistoryStore.setState((state) => ({ [from]: state[from].slice(0, -1), [to]: [...state[to], now].slice(-HISTORY_LIMIT) }) as Partial<HistoryState>);
  useProjectStore.getState().update(entry as ProjectPatch);
  return true;
}

export function undo(): boolean {
  return restore("undoStack", "redoStack");
}

export function redo(): boolean {
  return restore("redoStack", "undoStack");
}

export function clearHistory(): void {
  useHistoryStore.setState({ undoStack: [], redoStack: [] });
}
