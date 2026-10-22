import type { Scene } from "../../types/project.ts";

/** What is removed from a scene when its prompt is deleted (kept so Undo can put it back). */
export interface RemovedPrompt {
  id: string;
  prompt: string;
  motionPrompt: string;
  description: string;
  negative: string;
  edited: boolean;
  status: Scene["status"];
  fixNotes: string[];
}

export interface Cleared {
  scenes: Scene[];
  removed: RemovedPrompt[];
}

/** Empties the prompts of the given scenes (all scenes when `ids` is null). The scenes, narration, timing and settings stay. */
export function clearPrompts(scenes: readonly Scene[], ids: ReadonlySet<string> | null): Cleared {
  const removed: RemovedPrompt[] = [];
  const next = scenes.map((scene) => {
    if (ids !== null && !ids.has(scene.id)) return scene;
    const hadSomething = scene.prompt !== "" || scene.motionPrompt !== "" || scene.description !== "";
    if (!hadSomething) return scene;
    removed.push({ id: scene.id, prompt: scene.prompt, motionPrompt: scene.motionPrompt, description: scene.description, negative: scene.negative, edited: scene.edited, status: scene.status, fixNotes: scene.fixNotes ?? [] });
    return { ...scene, prompt: "", motionPrompt: "", description: "", negative: "", edited: false, status: scene.status === "matched" ? "matched" : "pending", fixNotes: [] } satisfies Scene;
  });
  return { scenes: next, removed };
}

/** Puts deleted prompts back (Undo). Scenes that got a new prompt in the meantime are left as they are. */
export function restorePrompts(scenes: readonly Scene[], removed: readonly RemovedPrompt[]): Scene[] {
  const byId = new Map(removed.map((r) => [r.id, r]));
  return scenes.map((scene) => {
    const old = byId.get(scene.id);
    if (!old || scene.prompt.trim() !== "") return scene;
    return { ...scene, prompt: old.prompt, motionPrompt: old.motionPrompt, description: old.description, negative: old.negative, edited: old.edited, status: old.status, fixNotes: old.fixNotes };
  });
}

/** Keeps the scenes the person deleted empty when an answer that was already on its way arrives. */
export function withoutDeleted(incoming: readonly Scene[], current: readonly Scene[], deleted: ReadonlySet<string>): Scene[] {
  if (deleted.size === 0) return [...incoming];
  const now = new Map(current.map((s) => [s.id, s]));
  return incoming.map((scene) => (deleted.has(scene.id) ? (now.get(scene.id) ?? scene) : scene));
}
