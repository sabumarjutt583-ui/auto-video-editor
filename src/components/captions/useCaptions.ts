import { useEffect, useMemo, useState } from "react";

import { drawCaption } from "../../lib/captions/canvas";
import { fontById, resolveFont, type FontInfo } from "../../lib/captions/fonts";
import { buildLines } from "../../lib/captions/lines";
import { loadFont } from "../../lib/captions/loadFonts";
import { detectScript, isRtl, maxCharsPerLine, supportsUppercase } from "../../lib/captions/script";
import type { CaptionLine, CaptionScript, CaptionStyle, EditorData, Project } from "../../types";
import type { Overlay } from "../editor/preview/useCanvasPreview";

export interface CaptionsView {
  style: CaptionStyle;
  /** The lines in use: the edited ones, or the ones built from the voice. */
  lines: CaptionLine[];
  /** True while the lines are the user's own. */
  edited: boolean;
  script: CaptionScript;
  maxChars: number;
  rtl: boolean;
  uppercaseOk: boolean;
  font: FontInfo;
  fontReady: boolean;
  overlay: Overlay | null;
  /** The lines built from the voice (used by "Build again"). */
  build: () => CaptionLine[];
}

/** The captions of a project: lines, font, and the function that draws them on the preview. */
export function useCaptions(project: Project, editor: EditorData): CaptionsView {
  const { style } = editor.captions;
  const script = useMemo(() => detectScript(project.words.map((w) => w.text).join(" ")), [project.words]);
  const maxChars = maxCharsPerLine(script);
  const auto = useMemo(() => buildLines(project.words, project.voiceDuration, { maxChars }), [project.words, project.voiceDuration, maxChars]);
  const lines = editor.captions.lines ?? auto;
  const font = resolveFont(style.font, script);
  const fallback = fontById("noto_sans");

  // The preview can only draw a font after the webview has loaded it.
  const [ready, setReady] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let stale = false;
    for (const f of [font, fallback]) {
      void loadFont(f).then((ok) => {
        if (!stale && ok) setReady((r) => (r[f.id] ? r : { ...r, [f.id]: true }));
      });
    }
    return () => {
      stale = true;
    };
  }, [font, fallback]);
  const fontReady = ready[font.id] === true;

  const rtl = isRtl(script);
  const aspect = project.settings.aspectRatio;
  const overlay = useMemo<Overlay | null>(() => {
    if (style.preset === "none" || lines.length === 0) return null;
    return (ctx, width, height, time) => drawCaption(ctx, width, height, time, lines, { style, font, rtl, aspect });
    // `fontReady` makes the preview draw again once the font has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, style, font, rtl, aspect, fontReady]);

  return { style, lines, edited: editor.captions.lines !== null, script, maxChars, rtl, uppercaseOk: supportsUppercase(script), font, fontReady, overlay, build: () => auto };
}
