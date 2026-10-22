import type { Layer } from "../../spec/schema.ts";
import { cameraAt } from "../../geo/camera.ts";
import type { CountryShape, MapData } from "../../geo/mapData.ts";
import { makeView, REGION_BOUNDS } from "../../geo/projections.ts";
import { routePixels, trimPolylines } from "../../geo/route.ts";
import { labelPoint } from "../../geo/topo.ts";
import type { Area, Canvas2D } from "../context.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, phase, withAlpha, withLayerAlpha } from "./common.ts";
import { drawCountries, drawPin, drawRoutePieces } from "./geo.ts";
import { drawLabel, textWidth } from "./label.ts";
import { roundedRect } from "./path.ts";

type MapLayer = Extract<Layer, { type: "map" }>;

/** Highlight colours in order: the first country gets the accent, the second the main colour, then the chart palette. */
function highlightColors(env: DrawEnv): string[] {
  const { theme } = env.rc;
  return [theme.colors.accent, theme.colors.primary, ...theme.palette.slice(2)];
}

/** Picks the detailed (50 m) outlines for regions and for any country that is too small for the world map. */
function dataFor(layer: MapLayer, env: DrawEnv): MapData | undefined {
  const { rc } = env;
  const light = rc.map?.("110m");
  const detailed = rc.map?.("50m");
  if (layer.region !== "world") return detailed ?? light;
  const missing = layer.countries.some((c) => light && !light.countries.some((s) => s.a2 === c.code));
  return missing ? (detailed ?? light) : (light ?? detailed);
}

/**
 * A map of the world or one region with highlighted countries (names fade in), pins and routes that draw themselves on
 * (one after the other), and a camera that can zoom and pan over time. Outlines come from the bundled Natural Earth data.
 */
export function drawMap(ctx: Canvas2D, layer: MapLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const data = dataFor(layer, env);
  if (!data) {
    note({ layerId: layer.id, kind: "missing-map", message: "The map outlines are not loaded." });
    return;
  }
  const local = timing.local;
  const radius = Math.min(area.h * 0.05, 22);
  const unit = rc.height / 1080;
  const palette = highlightColors(env);

  // Panel and map area.
  ctx.save();
  roundedRect(ctx, area.x, area.y, area.w, area.h, radius);
  ctx.fillStyle = withAlpha(resolveColor("background", rc.theme), 0.9);
  ctx.fill();
  ctx.clip();
  const inner: Area = { x: area.x + area.w * 0.015, y: area.y + area.h * 0.03, w: area.w * 0.97, h: area.h * 0.94 };
  const view = makeView(layer.projection, REGION_BOUNDS[layer.region] ?? REGION_BOUNDS.world!, inner, cameraAt(layer.camera, local));

  const byCode = new Map<string, CountryShape>();
  for (const country of data.countries) if (country.a2 && !byCode.has(country.a2)) byCode.set(country.a2, country);
  const highlight: Record<string, string> = {};
  layer.countries.forEach((c, i) => {
    if (!byCode.has(c.code)) {
      note({ layerId: layer.id, kind: "missing-map", message: `${c.code} has no outline on the map.` });
      return;
    }
    const p = phase(local, 0.25 + i * 0.15, 0.5);
    highlight[c.code] = withAlpha(palette[i % palette.length] ?? rc.theme.colors.accent, p);
  });
  drawCountries(ctx, data.countries, view, { land: withAlpha(resolveColor("muted", rc.theme), 0.26), border: withAlpha(resolveColor("background", rc.theme), 0.85), borderWidth: Math.max(0.5, 1.1 * unit), highlight });

  // Routes: each one draws on after the one before it.
  const ink = resolveColor("text", rc.theme);
  const routeWidth = Math.max(2, 3.5 * unit);
  layer.routes.forEach((route, k) => {
    const full = routePixels(view, route.from, route.to);
    const p = phase(local, 0.9 + k * 1.3, 1.2, "easeInOut");
    drawRoutePieces(ctx, full, withAlpha(ink, 0.22), routeWidth * 0.6, [routeWidth * 1.5, routeWidth * 2]);
    if (p <= 0) return;
    const { pieces, end } = trimPolylines(full, p);
    drawRoutePieces(ctx, pieces, ink, routeWidth);
    for (const point of [route.from, route.to]) {
      const xy = view.project(point.lon, point.lat);
      if (xy && (point === route.from || p >= 1)) drawPin(ctx, xy[0], xy[1], routeWidth * 1.3, resolveColor("accent", rc.theme), ink);
    }
    if (end && p < 1) drawPin(ctx, end[0], end[1], routeWidth * 1.1, ink, resolveColor("accent", rc.theme));
  });

  // Names are moved down a little when they would sit on another name.
  const placed: Area[] = [];
  const place = (x: number, y: number, w: number, h: number): number => {
    let top = y;
    for (let tries = 0; tries < 5; tries++) {
      const hit = placed.some((p) => x < p.x + p.w && x + w > p.x && top < p.y + p.h && top + h > p.y);
      if (!hit) break;
      top += h * 1.05;
    }
    placed.push({ x, y: top, w, h });
    return top;
  };

  // Pins with their names.
  const labelSize = Math.max(8, Math.min(rc.height * 0.034, area.h * 0.07));
  layer.pins.forEach((pin, i) => {
    const xy = view.project(pin.lon, pin.lat);
    if (!xy) return;
    const p = phase(local, 0.4 + i * 0.2, 0.45, "easeOutBack");
    withLayerAlpha(ctx, p * 2, () => {
      drawPin(ctx, xy[0], xy[1], Math.max(3, 6.5 * unit) * Math.min(1, 0.4 + 0.6 * p), resolveColor("accent", rc.theme), ink);
      const w = Math.min(area.w * 0.3, labelSize * 10);
      const x = Math.max(inner.x, Math.min(inner.x + inner.w - w, xy[0] - w / 2));
      drawLabel(ctx, pin.name, { x, y: place(x + (w - Math.min(w, textWidth(ctx, pin.name, labelSize, 700, rc))) / 2, xy[1] - labelSize * 2.5, Math.min(w, textWidth(ctx, pin.name, labelSize, 700, rc)), labelSize * 1.6), w, h: labelSize * 1.6 }, { size: labelSize, weight: 700, color: ink, align: "center", valign: "bottom", shadow: true, minScale: 0.6 }, layer.id, rc, note);
    });
  });

  // Names of highlighted countries.
  layer.countries.forEach((c, i) => {
    const shape = byCode.get(c.code);
    if (!c.label || !shape) return;
    const [lon, lat] = labelPoint(shape);
    const xy = view.project(lon, lat);
    if (!xy) return;
    const w = Math.min(area.w * 0.34, labelSize * 12);
    const x = Math.max(inner.x, Math.min(inner.x + inner.w - w, xy[0] - w / 2));
    const tw = Math.min(w, textWidth(ctx, c.label ?? "", labelSize, 700, rc));
    const top = place(x + (w - tw) / 2, xy[1] - labelSize * 0.8, tw, labelSize * 1.6);
    withLayerAlpha(ctx, phase(local, 0.55 + i * 0.15, 0.4), () => {
      drawLabel(ctx, c.label ?? "", { x, y: top, w, h: labelSize * 1.6 }, { size: labelSize, weight: 700, color: ink, align: "center", valign: "middle", shadow: true, minScale: 0.6 }, layer.id, rc, note);
    });
  });
  ctx.restore();
}
