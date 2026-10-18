import { FileText, FileType, RotateCcw } from "lucide-react";

import { usePlaybackStore } from "../../store/playbackStore";
import type { Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { CaptionRows } from "./CaptionRows";
import { PresetPicker } from "./PresetPicker";
import { StyleControls } from "./StyleControls";
import { useCaptionActions } from "./useCaptionActions";
import type { CaptionsView } from "./useCaptions";
import { usePlaybackControls } from "../editor/usePlayback";

/** Auto Editor: the caption look, the caption list, and the exports. */
export function CaptionsPanel({ project, view }: { project: Project; view: CaptionsView }) {
  const actions = useCaptionActions(project, view);
  const controls = usePlaybackControls();
  const time = usePlaybackStore((s) => s.time);
  return (
    <div className="flex flex-col gap-4" data-testid="captions-panel">
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold">Caption style</h3>
        <PresetPicker value={view.style.preset} onChange={actions.setPreset} />
        {view.style.preset !== "none" && <StyleControls style={view.style} autoFont={view.font.family} uppercaseOk={view.uppercaseOk} onChange={actions.setStyle} />}
        <p className="text-xs text-muted">
          Language found: <b>{view.script}</b>. Up to {view.maxChars} letters per line, two lines at most. Font: {view.font.family}
          {view.fontReady ? "" : " (loading)"}.
        </p>
      </section>
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-semibold">Captions ({view.lines.length})</h3>
          <Button icon={RotateCcw} disabled={!view.edited} onClick={actions.rebuild} title="Throw away your changes and build the captions from the voice again">
            Build again
          </Button>
          <Button icon={FileText} onClick={() => void actions.exportFile("srt")}>
            Export SRT
          </Button>
          <Button icon={FileText} onClick={() => void actions.exportFile("vtt")}>
            Export VTT
          </Button>
          <Button icon={FileType} disabled={view.style.preset === "none"} onClick={() => void actions.makeAss()} title="The subtitle file the video render uses">
            Make ASS file
          </Button>
        </div>
        {actions.error && <ErrorNotice error={actions.error} />}
        {actions.notice && <p className="text-xs text-muted" role="status">{actions.notice}</p>}
        <CaptionRows lines={view.lines} rtl={view.rtl} time={time} onSeek={controls.seek} onText={actions.editText} onTimes={actions.editTimes} onRemove={actions.remove} />
      </section>
    </div>
  );
}
