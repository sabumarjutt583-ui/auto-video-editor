import { useEffect, useMemo, useRef, useState } from "react";

import { mapDataOfSpec, type MapData, type MapResolution } from "../../../lib/graphics/geo/mapData";
import { ensureIcons, iconRefsOf } from "../../../lib/graphics/library/icons";
import { loadGraphicFonts, previewContext } from "../../../lib/graphics/render/browser";
import { renderFrame } from "../../../lib/graphics/render";
import type { Theme } from "../../../lib/graphics/render/theme";
import { repairSpec, type GraphicSpec } from "../../../lib/graphics/spec";

const FULL = { x: 0.04, y: 0.06, w: 0.92, h: 0.88 };
const SAMPLES: ReadonlyArray<{ label: string; layer: Record<string, unknown> }> = [
  { label: "Lower third", layer: { id: "lt", type: "lowerThird", box: { x: 0.04, y: 0.3, w: 0.92, h: 0.4 }, title: "Dr. Amina Khan", subtitle: "Climate scientist", icon: { set: "lucide", name: "users" } } },
  { label: "Counter", layer: { id: "co", type: "counter", box: FULL, from: 0, to: 1200000, format: "grouped", size: 0.26, label: "Total views" } },
  { label: "List", layer: { id: "li", type: "list", box: FULL, style: "checks", items: [{ text: "Fast to make" }, { text: "Clear to read" }, { text: "Your colours" }] } },
  { label: "Map", layer: { id: "ma", type: "map", box: FULL, region: "world", projection: "naturalEarth", countries: [{ code: "PK", label: "Pakistan" }, { code: "JP", label: "Japan" }], pins: [], routes: [], camera: [] } },
];

function specOf(layer: Record<string, unknown>): GraphicSpec | null {
  const r = repairSpec({ schemaVersion: 1, id: "sample", duration: 3, layers: [{ ...layer }] });
  return r.ok ? r.spec : null;
}

/** One small picture of a sample graphic (fully visible, at 2 s) drawn with the theme. */
function Sample({ label, spec, theme }: { label: string; spec: GraphicSpec; theme: Theme }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(0);
  const maps = useRef<Partial<Record<MapResolution, MapData>>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadGraphicFonts();
      await ensureIcons(iconRefsOf(spec));
      maps.current = await mapDataOfSpec(spec);
      if (alive) setReady((n) => n + 1);
    })();
    return () => { alive = false; };
  }, [spec]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || ready === 0) return;
    renderFrame(spec, 60, ctx, previewContext(el.width, el.height, new Map(), maps.current, theme));
  }, [spec, theme, ready]);

  return (
    <figure className="flex flex-col gap-1">
      <canvas ref={canvas} width={320} height={180} role="img" aria-label={`${label} sample`} className="w-full rounded-lg border border-line bg-[#1b1b22]" />
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

/** Four sample graphics (lower third, counter, list, map) that change as the kit is edited. */
export function KitSamples({ theme }: { theme: Theme }) {
  const specs = useMemo(() => SAMPLES.map((s) => ({ label: s.label, spec: specOf(s.layer) })), []);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Sample graphics with this kit">
      {specs.map((s) => (s.spec ? <Sample key={s.label} label={s.label} spec={s.spec} theme={theme} /> : null))}
    </div>
  );
}
