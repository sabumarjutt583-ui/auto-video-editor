/** What the audio and render steps work out from a project (the same as the Auto Editor panels do). */

import { listSfx } from "../../audio/api.ts";
import { activeCues } from "../../audio/mixRequest.ts";
import { planGraphicSfx, withGraphicSfx } from "../../audio/graphicSfx.ts";
import { planSfx } from "../../audio/sfxPlan.ts";
import { resolveFont, type FontInfo } from "../../captions/fonts.ts";
import { buildLines } from "../../captions/lines.ts";
import { detectScript, maxCharsPerLine } from "../../captions/script.ts";
import { readEditor } from "../../editor/model.ts";
import type { CaptionLine, CaptionStyle, EditorData, SfxCue } from "../../../types/editor.ts";
import type { Project } from "../../../types/project.ts";

export interface EditorState {
  editor: EditorData;
  captionLines: CaptionLine[];
  captionStyle: CaptionStyle;
  font: FontInfo;
  cues: SfxCue[];
}

export async function editorStateOf(project: Project): Promise<EditorState> {
  const editor = readEditor(project);
  const style = editor.captions.style;
  const script = detectScript(project.words.map((w) => w.text).join(" "));
  const captionLines = editor.captions.lines ?? buildLines(project.words, project.voiceDuration, { maxChars: maxCharsPerLine(script) });
  const font = resolveFont(style.font, script);
  const { sounds } = await listSfx();
  const { audio } = editor;
  const planned =
    sounds.length === 0
      ? []
      : withGraphicSfx(
          planSfx({
            scenes: project.scenes,
            overrides: editor.overrides,
            locations: project.locationBible,
            words: project.words,
            captionLines: style.preset === "none" ? [] : captionLines,
            captionPreset: style.preset,
            intensity: audio.intensity,
            transitionMode: editor.render.transitions,
            sounds,
          }),
          audio.graphicSfx ? planGraphicSfx({ graphics: editor.motion, sounds, intensity: audio.intensity }) : [],
        );
  return { editor, captionLines, captionStyle: style, font, cues: activeCues(audio, planned) };
}
