import { Copy, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent } from "react";

import { readEditor } from "../../../lib/editor/model";
import {
  animationOf, COLOR_ROLES, dragGraphic, fieldsOf, setEnter, setExit, setField, themeWith,
  type ColorOverrides, type ColorRole, type Field as FieldInfo, type MoveLimits,
} from "../../../lib/graphics/editing";
import { captionZone, safeArea } from "../../../lib/graphics/placement";
import { ENTER_PRESETS, EXIT_PRESETS, type GraphicSpec } from "../../../lib/graphics/spec";
import type { BrandKit } from "../../../lib/graphics/brand";
import type { Theme } from "../../../lib/graphics/render/theme";
import type { MotionGraphic, Project } from "../../../types";
import { ErrorNotice } from "../../ErrorNotice";
import { Button, Field, Select, TextInput } from "../../ui";
import { GraphicPreview } from "../GraphicPreview";
import type { GraphicEditing } from "./useGraphicEditing";

interface InspectorProps {
  project: Project;
  graphic: MotionGraphic;
  kit: BrandKit;
  theme: Theme;
  editing: GraphicEditing;
  backgroundUrl: string | null;
  /** Draws an automatic graphic again with the AI director (only for graphics it made). */
  onRegenerate?: () => void;
  onRemoved: () => void;
}

const nice = (name: string): string => name.replace(/([A-Z])/g, " $1").toLowerCase();

/** The editor of one selected graphic: texts and numbers, drag on the preview, entrance and exit, colours, copy, remove and presets. */
export function GraphicInspector({ project, graphic, kit, theme, editing, backgroundUrl, onRegenerate, onRemoved }: InspectorProps) {
  const spec = graphic.spec as GraphicSpec;
  const busy = editing.job !== null;
  const fields = useMemo(() => fieldsOf(spec), [spec]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<GraphicSpec | null>(null);
  const [colors, setColors] = useState<ColorOverrides>(graphic.colors ?? {});
  const [presetName, setPresetName] = useState("");
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const origin = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const shownTheme = useMemo(() => themeWith(theme, colors), [theme, colors]);
  const animation = animationOf(spec);

  const limits = (): MoveLimits => {
    const editor = readEditor(project);
    return { safe: safeArea(kit.safeMargins), caption: captionZone(editor.captions.style, project.settings.aspectRatio) };
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName !== "CANVAS" || busy) return;
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o) return;
    setDraft(dragGraphic(spec, (event.clientX - o.x) / o.width, (event.clientY - o.y) / o.height, limits()));
  };
  const up = () => {
    const made = draft;
    origin.current = null;
    setDraft(null);
    if (made && JSON.stringify(made.layers) !== JSON.stringify(spec.layers)) void editing.commitSpec(graphic.id, made);
  };

  const changed = fields.filter((f) => edits[f.id] !== undefined && edits[f.id] !== String(f.value));
  const apply = () => {
    let current = spec;
    for (const f of changed) {
      const raw = edits[f.id] ?? "";
      const done = setField(current, f, f.kind === "number" ? Number(raw) : raw);
      if (!done.ok) { setProblem(`${f.label}: ${done.error}`); return; }
      current = done.spec;
    }
    setProblem(null);
    setEdits({});
    void editing.commitSpec(graphic.id, current);
  };
  const preset = (kind: "enter" | "exit", value: string) => {
    const done = kind === "enter" ? setEnter(spec, value) : setExit(spec, value);
    if (done.ok) { setProblem(null); void editing.commitSpec(graphic.id, done.spec); } else setProblem(done.error);
  };

  const colorValue = (role: ColorRole): string => colors[role] ?? theme.colors[role];
  const colorsChanged = JSON.stringify(colors) !== JSON.stringify(graphic.colors ?? {});

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/60 bg-surface-2 p-3" data-testid="graphic-inspector">
      <div ref={wrapper} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="touch-none">
        <GraphicPreview spec={draft ?? spec} aspect={project.settings.aspectRatio} backgroundUrl={backgroundUrl} theme={shownTheme} />
      </div>
      <p className="text-xs text-muted">Drag the picture above to move the graphic. It stays inside the safe area and never covers the captions.</p>

      {fields.length > 0 && (
        <div className="flex flex-col gap-2">
          {fields.map((f: FieldInfo) => (
            <Field key={f.id} label={f.label} htmlFor={`gf-${graphic.id}-${f.id}`}>
              <TextInput
                id={`gf-${graphic.id}-${f.id}`}
                type={f.kind === "number" ? "number" : "text"}
                value={edits[f.id] ?? String(f.value)}
                disabled={busy}
                onChange={(e) => setEdits((old) => ({ ...old, [f.id]: e.target.value }))}
              />
            </Field>
          ))}
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={changed.length === 0 || busy} onClick={apply}>Apply changes</Button>
            {changed.length > 0 && <Button onClick={() => { setEdits({}); setProblem(null); }}>Discard</Button>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="How it comes in" htmlFor={`ge-${graphic.id}`}>
          <Select id={`ge-${graphic.id}`} value={animation.enter} disabled={busy} onChange={(e) => preset("enter", e.target.value)}>
            {animation.enter === "" && <option value="">(mixed)</option>}
            {ENTER_PRESETS.map((p) => <option key={p} value={p}>{nice(p)}</option>)}
          </Select>
        </Field>
        <Field label="How it goes out" htmlFor={`gx-${graphic.id}`}>
          <Select id={`gx-${graphic.id}`} value={animation.exit} disabled={busy} onChange={(e) => preset("exit", e.target.value)}>
            {animation.exit === "" && <option value="">(mixed)</option>}
            {EXIT_PRESETS.map((p) => <option key={p} value={p}>{nice(p)}</option>)}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">Colours for this graphic only</legend>
        <div className="flex flex-wrap gap-3">
          {COLOR_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-xs text-muted">
              <input type="color" aria-label={`${role} colour`} value={colorValue(role)} disabled={busy} onChange={(e) => setColors((old) => ({ ...old, [role]: e.target.value }))} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" />
              {role}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button disabled={!colorsChanged || busy} onClick={() => void editing.setColors(graphic.id, colors)}>Apply colours</Button>
          <Button disabled={Object.keys(colors).length === 0 || busy} onClick={() => { setColors({}); if ((graphic.colors && Object.keys(graphic.colors).length > 0)) void editing.setColors(graphic.id, {}); }}>Use the brand kit</Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Copy} disabled={busy} onClick={() => void editing.duplicate(graphic.id)}>Duplicate</Button>
        {onRegenerate && <Button icon={RefreshCw} disabled={busy} onClick={onRegenerate}>Regenerate</Button>}
        <Button icon={Trash2} disabled={busy} onClick={() => { editing.remove(graphic.id); onRemoved(); }}>Remove</Button>
        {busy && <span className="flex items-center gap-1 text-xs text-muted" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{editing.job?.stage}</span>}
      </div>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Save as preset" htmlFor={`gp-${graphic.id}`}>
            <TextInput id={`gp-${graphic.id}`} value={presetName} placeholder="Name, for example Big number" onChange={(e) => setPresetName(e.target.value)} />
          </Field>
        </div>
        <Button icon={Save} disabled={presetName.trim() === ""} onClick={() => {
          const ok = editing.savePreset(graphic.id, presetName);
          setPresetNote(ok ? "Saved in My Presets." : "The preset could not be saved.");
          if (ok) setPresetName("");
        }}>Save</Button>
      </div>
      {presetNote && <p className="text-xs text-muted" role="status">{presetNote}</p>}
      {problem && <p className="text-xs text-danger" role="alert">{problem}</p>}
      {editing.error && <ErrorNotice error={editing.error} />}
    </div>
  );
}
