import { useState } from "react";

import { generateAss } from "../../lib/captions/api";
import { buildAssRequest } from "../../lib/captions/assRequest";
import { removeLine, withText, withTimes } from "../../lib/captions/edit";
import { toSrt, toVtt } from "../../lib/captions/exportSubtitles";
import { applyPreset } from "../../lib/captions/presets";
import { pickSavePath } from "../../lib/dialog";
import { readEditor } from "../../lib/editor/model";
import { toAppError } from "../../lib/errors";
import { writeTextFile } from "../../lib/files";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, CaptionLine, CaptionPreset, CaptionStyle, Project } from "../../types";
import type { CaptionsView } from "./useCaptions";

export interface CaptionActions {
  error: AppError | null;
  notice: string | null;
  setStyle: (patch: Partial<CaptionStyle>) => void;
  setPreset: (preset: CaptionPreset) => void;
  editText: (index: number, text: string) => void;
  editTimes: (index: number, start: number, end: number) => void;
  remove: (index: number) => void;
  rebuild: () => void;
  exportFile: (kind: "srt" | "vtt") => Promise<void>;
  makeAss: () => Promise<void>;
}

/** Everything the Captions panel changes. Each change can be undone with Ctrl+Z. */
export function useCaptionActions(project: Project, view: CaptionsView): CaptionActions {
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commit = (make: (lines: CaptionLine[], style: CaptionStyle) => { lines?: CaptionLine[] | null; style?: CaptionStyle }) => {
    const current = useProjectStore.getState().project;
    if (!current) return;
    const data = readEditor(current);
    const baseLines = data.captions.lines ?? view.build();
    const change = make(baseLines, data.captions.style);
    applyEdit({
      editor: {
        ...data,
        captions: {
          style: change.style ?? data.captions.style,
          lines: change.lines === undefined ? data.captions.lines : change.lines,
        },
      },
    });
  };

  const setStyle = (patch: Partial<CaptionStyle>) => commit((_l, style) => ({ style: { ...style, ...patch } }));
  const setPreset = (preset: CaptionPreset) => commit((_l, style) => ({ style: applyPreset(style, preset) }));
  const editText = (index: number, text: string) =>
    commit((lines) => {
      const line = lines[index];
      if (!line || withText(line, text, view.maxChars).text === line.text) return {};
      return { lines: lines.map((l, i) => (i === index ? withText(l, text, view.maxChars) : l)) };
    });
  const editTimes = (index: number, start: number, end: number) => commit((lines) => ({ lines: withTimes(lines, index, start, end, project.voiceDuration) }));
  const remove = (index: number) => commit((lines) => ({ lines: removeLine(lines, index) }));
  const rebuild = () => commit(() => ({ lines: null }));

  const exportFile = async (kind: "srt" | "vtt") => {
    setError(null);
    setNotice(null);
    try {
      const path = await pickSavePath(`Export ${kind.toUpperCase()}`, `${project.name || "captions"}.${kind}`, kind.toUpperCase(), [kind]);
      if (!path) return;
      await writeTextFile(path, kind === "srt" ? toSrt(view.lines) : toVtt(view.lines));
      setNotice(`Saved ${path}`);
    } catch (caught) {
      setError(toAppError(caught, "The caption file could not be saved."));
    }
  };

  const makeAss = async () => {
    setError(null);
    setNotice(null);
    try {
      const path = await generateAss(project.id, buildAssRequest(project.settings.aspectRatio, project.settings.quality, view.style, view.font, view.lines));
      setNotice(`Caption file (ASS) saved: ${path}`);
    } catch (caught) {
      setError(toAppError(caught, "The caption file could not be made."));
    }
  };

  return { error, notice, setStyle, setPreset, editText, editTimes, remove, rebuild, exportFile, makeAss };
}
