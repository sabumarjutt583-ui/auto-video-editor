import { useMemo, useState } from "react";

import { buildAudioMix, importMusic } from "../../lib/audio/api";
import { activeCues, buildMixRequest } from "../../lib/audio/mixRequest";
import { planGraphicSfx, withGraphicSfx } from "../../lib/audio/graphicSfx";
import { nextCueId, planSfx } from "../../lib/audio/sfxPlan";
import { pickMusicFiles } from "../../lib/dialog";
import { readEditor } from "../../lib/editor/model";
import { toAppError } from "../../lib/errors";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../store/jobStore";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, AudioData, CaptionLine, EditorData, Project, SfxCue } from "../../types";
import type { SfxLibraryView } from "./useSfxLibrary";

export interface AudioView {
  audio: AudioData;
  cues: SfxCue[];
  /** True once the person has edited the cues by hand. */
  edited: boolean;
  job: JobInfo | null;
  error: AppError | null;
  notice: string | null;
  selectedCue: string | null;
  selectCue: (id: string | null) => void;
  change: (patch: Partial<AudioData>) => void;
  addMusic: () => Promise<void>;
  deleteMusic: (id: string) => void;
  moveMusic: (id: string, direction: -1 | 1) => void;
  planAgain: () => void;
  editCue: (id: string, patch: Partial<Pick<SfxCue, "soundId" | "time" | "gain">>) => void;
  deleteCue: (id: string) => void;
  addCue: (soundId: string, time: number) => void;
  build: () => Promise<void>;
}

/** Everything the Audio panel and the SFX track change. Every change can be undone with Ctrl+Z. */
export function useAudio(project: Project, editor: EditorData, captionLines: readonly CaptionLine[], library: SfxLibraryView): AudioView {
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCue, selectCue] = useState<string | null>(null);
  const job = useJobStore(selectJob(["audio"]));
  const { audio } = editor;

  const planned = useMemo(
    () =>
      library.sounds.length === 0
        ? []
        : withGraphicSfx(planSfx({
            scenes: project.scenes,
            overrides: editor.overrides,
            locations: project.locationBible,
            words: project.words,
            captionLines: editor.captions.style.preset === "none" ? [] : captionLines,
            captionPreset: editor.captions.style.preset,
            intensity: audio.intensity,
            transitionMode: editor.render.transitions,
            sounds: library.sounds,
          }), audio.graphicSfx ? planGraphicSfx({ graphics: editor.motion, sounds: library.sounds, intensity: audio.intensity }) : []),
    [library.sounds, project.scenes, project.locationBible, project.words, editor.overrides, editor.captions.style.preset, captionLines, audio.intensity, audio.graphicSfx, editor.motion, editor.render.transitions],
  );
  const cues = useMemo(() => activeCues(audio, planned), [audio, planned]);

  const commit = (make: (data: EditorData) => AudioData) => {
    const current = useProjectStore.getState().project;
    if (!current) return;
    const data = readEditor(current);
    applyEdit({ editor: { ...data, audio: make(data) } });
  };
  const change = (patch: Partial<AudioData>) => commit((d) => ({ ...d.audio, ...patch }));
  // Cue edits start from what is shown (planned cues become the person's own list).
  const editCues = (make: (list: SfxCue[]) => SfxCue[]) => commit((d) => ({ ...d.audio, cues: make(d.audio.cues ?? cues) }));

  const addMusic = async () => {
    setError(null);
    setNotice(null);
    try {
      const picked = await pickMusicFiles("Choose music");
      if (picked.length === 0) return;
      const result = await runJob("audio", "Copying music", (id) => importMusic(project.id, picked, id));
      if (result.imported.length > 0) {
        commit((d) => {
          const used = new Set(d.audio.tracks.map((t) => t.id));
          let n = d.audio.tracks.length;
          const added = result.imported.map((m) => {
            do n += 1;
            while (used.has(`m${n}`));
            used.add(`m${n}`);
            return { id: `m${n}`, path: m.path, name: m.name, duration: m.duration };
          });
          return { ...d.audio, tracks: [...d.audio.tracks, ...added] };
        });
      }
      if (result.failed.length > 0) setNotice(result.failed.map((f) => `${f.name}: ${f.reason}`).join(" "));
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const deleteMusic = (id: string) => {
    // The file stays in the project folder, so Undo can bring the track back.
    change({ tracks: audio.tracks.filter((t) => t.id !== id) });
  };

  const moveMusic = (id: string, direction: -1 | 1) => {
    const list = audio.tracks.slice();
    const from = list.findIndex((t) => t.id === id);
    const to = from + direction;
    const item = list[from];
    if (!item || to < 0 || to >= list.length) return;
    list.splice(from, 1);
    list.splice(to, 0, item);
    change({ tracks: list });
  };

  const build = async () => {
    setError(null);
    setNotice(null);
    if (!project.voicePath || project.voiceDuration <= 0) {
      setError({ code: "no_voice", message: "Add a voice-over first (step 1 of the Prompt Generator).", details: "The project has no voice file." });
      return;
    }
    try {
      const request = buildMixRequest(audio, project.voicePath, project.voiceDuration, cues);
      const result = await runJob("audio", "Mixing the audio", (id) => buildAudioMix(project.id, request, id));
      change({ mix: { path: result.path, ...result.loudness, builtAt: new Date().toISOString() } });
      setNotice(`Audio mix is ready: ${result.loudness.integrated.toFixed(1)} LUFS, peak ${result.loudness.truePeak.toFixed(1)} dBTP.`);
    } catch (e) {
      setError(toAppError(e));
    }
  };

  return {
    audio,
    cues,
    edited: audio.cues !== null,
    job,
    error,
    notice,
    selectedCue,
    selectCue,
    change,
    addMusic,
    deleteMusic,
    moveMusic,
    planAgain: () => {
      change({ cues: null, addedCues: [] });
      selectCue(null);
    },
    editCue: (id, patch) =>
      editCues((list) =>
        list.map((c) => (c.id === id ? { ...c, ...patch, time: Math.min(Math.max(0, patch.time ?? c.time), project.voiceDuration), gain: Math.min(1, Math.max(0, patch.gain ?? c.gain)) } : c)).sort((a, b) => a.time - b.time),
      ),
    deleteCue: (id) => {
      editCues((list) => list.filter((c) => c.id !== id));
      selectCue(null);
    },
    addCue: (soundId, time) => {
      const sound = library.sounds.find((s) => s.id === soundId);
      const id = nextCueId(audio.cues ?? cues);
      editCues((list) => [...list, { id, soundId, time: Math.min(Math.max(0, time), project.voiceDuration), gain: sound?.defaultGain ?? 0.8, reason: "manual" as const }].sort((a, b) => a.time - b.time));
      selectCue(id);
    },
    build,
  };
}
