import type { SfxCue, SfxSound } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";

/** An id for a sound added from the SFX Library ("A001", "A002"...). It never clashes with planned ("X001") cues. */
export function nextAddedId(cues: readonly SfxCue[]): string {
  let max = 0;
  for (const c of cues) {
    const n = /^A(\d+)$/.exec(c.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `A${String(max + 1).padStart(3, "0")}`;
}

/** The cue for "Add to current scene": the sound starts where the scene starts. */
export function cueForScene(scene: Pick<Scene, "start">, sound: Pick<SfxSound, "id" | "defaultGain">, existing: readonly SfxCue[], voiceDuration: number): SfxCue {
  const latest = voiceDuration > 0 ? voiceDuration : scene.start;
  return {
    id: nextAddedId(existing),
    soundId: sound.id,
    time: Math.min(Math.max(0, scene.start), latest),
    gain: Math.min(1, Math.max(0, sound.defaultGain)),
    reason: "manual",
  };
}
