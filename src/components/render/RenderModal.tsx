import { Clapperboard, Smartphone } from "lucide-react";

import { selectBestEncoder, timeLeft } from "../../lib/render/request";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import { useSettingsStore } from "../../store/settingsStore";
import { readEditor } from "../../lib/editor/model";
import { outputSize } from "../../lib/editor/size";
import type { AspectRatio, Project, Quality, RenderData, RenderFps, ShortClipMode, TransitionMode } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { JobBar } from "../voice/JobBar";
import { RenderCheck } from "../graphics";
import { Button, Checkbox, Field, Modal, SegmentedControl } from "../ui";
import { ResultCard } from "./ResultCard";
import type { RenderView } from "./useRender";

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];
const QUALITIES: { value: Quality; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4K", label: "4K" },
];
const FPS: { value: `${RenderFps}`; label: string }[] = [
  { value: "24", label: "24" },
  { value: "30", label: "30" },
  { value: "60", label: "60" },
];
const SHORT: { value: ShortClipMode; label: string }[] = [
  { value: "smart", label: "Slow, then repeat" },
  { value: "loop", label: "Repeat" },
  { value: "hold", label: "Hold last picture" },
  { value: "ping_pong", label: "Ping-pong (forward, then back)" },
];
const MODES: { value: TransitionMode; label: string }[] = [
  { value: "cut", label: "Cut" },
  { value: "fade", label: "Fade" },
  { value: "mixed", label: "Mixed" },
];

/** Output settings, the Render buttons, progress with Cancel, and the finished video. */
export function RenderModal({ project, editor, view, onClose }: { project: Project; editor: ReturnType<typeof readEditor>; view: RenderView; onClose: () => void }) {
  const forceCpu = useSettingsStore((s) => s.settings?.forceCpuEncoding ?? false);
  const busy = view.job !== null;
  const size = outputSize(project.settings.aspectRatio, project.settings.quality);
  const best = selectBestEncoder(view.encoders, forceCpu);

  const setRender = (patch: Partial<RenderData>) => {
    const current = useProjectStore.getState().project;
    if (!current) return;
    const data = readEditor(current);
    applyEdit({ editor: { ...data, render: { ...data.render, ...patch } } });
  };
  const setSettings = (patch: Partial<Project["settings"]>) => applyEdit({ settings: { ...project.settings, ...patch } });

  return (
    <Modal title="Render video" wide onClose={() => { if (!busy) onClose(); }}>
      <div className="grid gap-4 sm:grid-cols-2" data-testid="render-settings">
        <Field label="Aspect ratio"><SegmentedControl<AspectRatio> label="Aspect ratio" value={project.settings.aspectRatio} onChange={(aspectRatio) => setSettings({ aspectRatio })} options={ASPECTS} /></Field>
        <Field label="Quality" hint={`${size.width} × ${size.height}`}><SegmentedControl<Quality> label="Quality" value={project.settings.quality} onChange={(quality) => setSettings({ quality })} options={QUALITIES} /></Field>
        <Field label="Frames per second"><SegmentedControl<`${RenderFps}`> label="Frames per second" value={`${editor.render.fps}`} onChange={(v) => setRender({ fps: Number(v) as RenderFps })} options={FPS} /></Field>
        <Field label="Transitions" hint="Cut: none. Fade: cross-fades. Mixed: mostly cuts, some fades and slides. A choice made for one scene always wins."><SegmentedControl<TransitionMode> label="Transitions" value={editor.render.transitions} onChange={(transitions) => setRender({ transitions })} options={MODES} /></Field>
        <Field label="Short video clips" hint="When a video clip is shorter than its scene. A clip that is too long is cut at the end of the scene."><SegmentedControl<ShortClipMode> label="Short video clips" value={editor.render.shortClip} onChange={(shortClip) => setRender({ shortClip })} options={SHORT} /></Field>
        <Checkbox label="Ken Burns (slow zoom and pan on pictures)" checked={editor.render.kenBurns} onChange={(e) => setRender({ kenBurns: e.target.checked })} />
        <p className="text-xs text-muted">Format: MP4 (H.264 + AAC). {best ? `Encoder: ${best.label}.` : view.encoders === null ? "Checking encoders…" : "No H.264 encoder found."}{forceCpu ? " (CPU only, set in Settings)" : ""}</p>
      </div>
      <RenderCheck project={project} />
      {view.problems.map((p) => (
        <p key={p} className="text-sm text-danger">{p}</p>
      ))}
      {view.job ? (
        <div className="flex flex-col gap-1">
          <JobBar job={view.job} />
          <p className="text-xs text-muted" data-testid="render-eta">{timeLeft(view.job.percent, view.elapsed)}</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Clapperboard} disabled={view.problems.length > 0} onClick={() => void view.start(false)} data-testid="start-render">Render video</Button>
          <Button icon={Smartphone} disabled={view.problems.length > 0} onClick={() => void view.start(true)} data-testid="start-shorts" title="The same video in 9:16, with the captions moved to the safe area">Render Shorts version (9:16)</Button>
        </div>
      )}
      {view.cancelled && <p className="text-sm text-muted" role="status">The render was cancelled. Nothing was saved.</p>}
      {view.error && <ErrorNotice error={view.error} />}
      {view.result && <ResultCard projectId={project.id} result={view.result} />}
      <div className="flex justify-end"><Button onClick={onClose} disabled={busy}>Close</Button></div>
    </Modal>
  );
}
