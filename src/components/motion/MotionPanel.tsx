import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { frameAt } from "../../lib/motion/request";
import { requestCancel } from "../../store/jobStore";
import type { MotionGraphic, Project, Scene } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { GraphicLab, GraphicPreview, useGraphicExport } from "../graphics";
import { Button, Checkbox, Field, TextInput } from "../ui";
import type { MotionView } from "./useMotion";

interface MotionPanelProps {
  project: Project;
  dir: string | null;
  graphics: readonly MotionGraphic[];
  scene: Scene | undefined;
  view: MotionView;
  /** A picture of the selected scene (shown behind the graphic preview). */
  backgroundUrl?: string | null;
}

/** A looping preview of the drawn frames on a checkerboard (so the transparent parts show). */
function Preview({ dir, graphic }: { dir: string; graphic: MotionGraphic }) {
  const [progress, setProgress] = useState(0.5);
  useEffect(() => {
    const total = Math.max(1, graphic.duration + 0.6);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const t = ((performance.now() - startedAt) / 1000) % total;
      setProgress(Math.min(1, t / Math.max(0.1, graphic.duration)));
    }, 1000 / 15);
    return () => window.clearInterval(timer);
  }, [graphic.id, graphic.duration]);
  const src = convertFileSrc(`${dir}/${graphic.framesDir}/${frameAt(graphic, progress)}`.replace(/\\/g, "/"));
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-[conic-gradient(#2a2a35_25%,#1c1c25_0_50%,#2a2a35_0_75%,#1c1c25_0)] [background-size:16px_16px]">
      <img src={src} alt="Motion graphic preview" className="h-full w-full object-contain" />
    </div>
  );
}

/** Motion graphics written by the AI for the selected scene. */
export function MotionPanel({ project, dir, graphics, scene, view, backgroundUrl }: MotionPanelProps) {
  const [idea, setIdea] = useState("");
  const exporter = useGraphicExport(project, dir);
  const busy = view.job !== null;
  const mine = scene ? graphics.filter((g) => g.sceneId === scene.id) : [];
  const others = graphics.filter((g) => g.sceneId !== scene?.id);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Motion graphics">
      <h3 className="text-sm font-semibold">Motion graphics{scene ? ` for ${scene.id}` : ""}</h3>
      <p className="text-xs text-muted">Gemini writes a new animation for this scene: a chart, a title, a highlight, a map, anything that fits the words. It uses your Google accounts (Settings, Image Generator). The result is laid over the video when you render.</p>
      {scene && (
        <>
          <Field label="What should it show? (optional, leave empty to let the AI decide)" htmlFor="motion-idea">
            <TextInput id="motion-idea" value={idea} placeholder="For example: a bar falling from 100 to 50" onChange={(e) => setIdea(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Sparkles} loading={busy} disabled={!scene.text.trim() && !idea.trim()} onClick={() => void view.make(scene, idea, null)}>
              Make a motion graphic
            </Button>
            {busy && <Button onClick={() => view.job && requestCancel(view.job.id)}>Cancel</Button>}
          </div>
        </>
      )}
      {view.job && (
        <div role="status" className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{view.job.stage}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(view.job.percent)}%` }} /></div>
        </div>
      )}
      {view.cancelled && <p className="text-xs text-muted" role="status">Cancelled.</p>}
      {view.error && <ErrorNotice error={view.error} />}
      {[...mine, ...others].map((g) => (
        <div key={g.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
          {g.kind === "spec" && g.spec ? <GraphicPreview spec={g.spec} aspect={project.settings.aspectRatio} backgroundUrl={backgroundUrl ?? null} /> : dir && g.frames > 0 && <Preview dir={dir} graphic={g} />}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{g.sceneId} · from {g.start.toFixed(1)} s · {g.duration.toFixed(1)} s{g.kind === "spec" ? " · drawn by the app" : g.idea ? ` · ${g.idea}` : ""}</span>
            <span className="flex gap-1">
              {g.kind !== "spec" && <button type="button" className="cursor-pointer rounded p-1 hover:text-fg disabled:opacity-40" aria-label="Make it again" disabled={busy} onClick={() => { const s: Scene | undefined = project.scenes.find((x) => x.id === g.sceneId); if (s) void view.make(s, g.idea, g.id); }}><RefreshCw className="h-4 w-4" /></button>}
              <button type="button" className="cursor-pointer rounded p-1 hover:text-danger" aria-label="Delete" onClick={() => view.remove(g.id)}><Trash2 className="h-4 w-4" /></button>
            </span>
          </div>
          <Checkbox label="Show it in the video" checked={g.enabled} onChange={(e) => view.change(g.id, { enabled: e.target.checked })} />
          <Field label={`Starts at ${g.start.toFixed(1)} s`} htmlFor={`motion-start-${g.id}`}>
            <input id={`motion-start-${g.id}`} type="range" min={0} max={Math.max(1, Math.floor((project.voiceDuration - g.duration) * 10) / 10)} step={0.1} value={Math.min(g.start, Math.max(1, project.voiceDuration))} onChange={(e) => view.change(g.id, { start: Number(e.target.value) })} className="accent-[var(--accent)]" />
          </Field>
        </div>
      ))}
      {graphics.length === 0 && !view.job && <p className="text-xs text-muted">No motion graphics yet.</p>}
      <GraphicLab aspect={project.settings.aspectRatio} backgroundUrl={backgroundUrl ?? null} {...(scene ? { scene } : {})} exporter={exporter} />
    </section>
  );
}
