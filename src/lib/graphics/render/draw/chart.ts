import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, RenderContext } from "../context.ts";
import { formatChartValue } from "../format.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, lerp, phase, withAlpha, withLayerAlpha } from "./common.ts";
import { drawLabel, textWidth } from "./label.ts";
import { roundedRect } from "./path.ts";

type ChartLayer = Extract<Layer, { type: "chart" }>;
type Row = ChartLayer["rows"][number];

const paletteColor = (rc: RenderContext, i: number): string => rc.theme.palette[i % rc.theme.palette.length] ?? rc.theme.colors.primary;

/** A value as shown on a chart, with its unit. */
const valueText = (value: number, unit: string | undefined): string => formatChartValue(value, unit);

/** The chart title above the plot; returns the area left for the plot. */
function drawTitle(ctx: Canvas2D, layer: ChartLayer, area: Area, env: DrawEnv): Area {
  if (!layer.title) return area;
  const h = Math.min(area.h * 0.14, env.rc.height * 0.075);
  withLayerAlpha(ctx, phase(env.timing.local, 0, 0.4), () => {
    drawLabel(ctx, layer.title ?? "", { x: area.x, y: area.y, w: area.w, h }, { size: h / 1.25, weight: 700, color: resolveColor("text", env.rc.theme), align: "left", valign: "middle", shadow: true }, layer.id, env.rc, env.note);
  });
  return { x: area.x, y: area.y + h * 1.25, w: area.w, h: area.h - h * 1.25 };
}

/** Axis line along the bottom/left of a plot. */
function line(ctx: Canvas2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function valueRange(rows: readonly Row[]): { min: number; max: number } {
  const values = rows.map((r) => r.value);
  return { min: Math.min(0, ...values), max: Math.max(0, ...values) };
}

function drawBars(ctx: Canvas2D, layer: ChartLayer, plot: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const rows = layer.rows;
  const horizontal = rows.length > 6 || rows.some((r) => r.label.length > 14);
  const { min, max } = valueRange(rows);
  const span = max - min || 1;
  const muted = resolveColor("muted", rc.theme);
  const text = resolveColor("text", rc.theme);
  const bar = (i: number): string => (layer.highlight === undefined ? resolveColor("primary", rc.theme) : i === layer.highlight ? resolveColor("accent", rc.theme) : withAlpha(resolveColor("primary", rc.theme), 0.55));
  const grow = (i: number): number => phase(timing.local, 0.15 + i * 0.09, 0.8, "easeOutExpo");

  if (!horizontal) {
    const labelH = plot.h * 0.2;
    const valueH = plot.h * 0.12;
    // With negative bars the value labels also need room below the lowest bar.
    const bodyTop = plot.y + valueH;
    const bodyH = plot.h - labelH - valueH * (min < 0 ? 2 : 1);
    const slot = plot.w / rows.length;
    const bw = slot * 0.62;
    const zeroY = bodyTop + (max / span) * bodyH;
    const size = Math.max(8, Math.min(slot * 0.26, rc.height * 0.045, valueH / 1.25 * 1.4));
    line(ctx, plot.x, zeroY, plot.x + plot.w, zeroY, withAlpha(muted, 0.45), 1.5);
    rows.forEach((row, i) => {
      const p = grow(i);
      const x = plot.x + slot * i + (slot - bw) / 2;
      const h = (Math.abs(row.value) / span) * bodyH * p;
      const y = row.value >= 0 ? zeroY - h : zeroY;
      ctx.save();
      roundedRect(ctx, x, y, bw, Math.max(h, 0.0001), Math.min(bw * 0.18, 10));
      ctx.fillStyle = bar(i);
      ctx.fill();
      ctx.restore();
      const labelY = row.value >= 0 ? y - valueH : y + h;
      withLayerAlpha(ctx, p, () => drawLabel(ctx, valueText(row.value * p, layer.unit), { x: x - slot * 0.2, y: labelY, w: bw + slot * 0.4, h: valueH }, { size, weight: 700, color: text, align: "center", valign: "middle", shadow: true, minScale: 0.5 }, layer.id, rc, note));
      withLayerAlpha(ctx, phase(timing.local, 0.1 + i * 0.09, 0.4), () => drawLabel(ctx, row.label, { x: plot.x + slot * i + slot * 0.04, y: plot.y + plot.h - labelH + labelH * 0.1, w: slot * 0.92, h: labelH * 0.9 }, { size: size * 0.95, weight: 400, color: muted, align: "center", valign: "top", maxLines: 2, shadow: false, minScale: 0.55 }, layer.id, rc, note));
    });
    return;
  }

  // Horizontal bars: labels on the left, the value at the end of the bar.
  const n = rows.length;
  const slot = plot.h / n;
  const bh = slot * 0.62;
  const size = Math.max(8, Math.min(slot * 0.56, rc.height * 0.045));
  let labelW = 0;
  for (const row of rows) labelW = Math.max(labelW, textWidth(ctx, row.label, size, 400, rc));
  labelW = Math.min(labelW + size * 0.6, plot.w * 0.34);
  const valueW = Math.min(plot.w * 0.2, size * 5.5);
  const bodyX = plot.x + labelW;
  const bodyW = plot.w - labelW - valueW;
  const zeroX = bodyX + (-min / span) * bodyW;
  line(ctx, zeroX, plot.y, zeroX, plot.y + plot.h, withAlpha(muted, 0.45), 1.5);
  rows.forEach((row, i) => {
    const p = grow(i);
    const y = plot.y + slot * i + (slot - bh) / 2;
    const w = (Math.abs(row.value) / span) * bodyW * p;
    const x = row.value >= 0 ? zeroX : zeroX - w;
    ctx.save();
    roundedRect(ctx, x, y, Math.max(w, 0.0001), bh, Math.min(bh * 0.3, 8));
    ctx.fillStyle = bar(i);
    ctx.fill();
    ctx.restore();
    withLayerAlpha(ctx, phase(timing.local, 0.1 + i * 0.09, 0.4), () => drawLabel(ctx, row.label, { x: plot.x, y: plot.y + slot * i, w: labelW - size * 0.4, h: slot }, { size, weight: 400, color: muted, align: "right", valign: "middle", shadow: false, minScale: 0.55 }, layer.id, rc, note));
    withLayerAlpha(ctx, p, () => drawLabel(ctx, valueText(row.value * p, layer.unit), { x: (row.value >= 0 ? x + w : x - w) + (row.value >= 0 ? size * 0.4 : 0), y: plot.y + slot * i, w: valueW, h: slot }, { size, weight: 700, color: text, align: "left", valign: "middle", shadow: true, minScale: 0.5 }, layer.id, rc, note));
  });
}

function drawLineChart(ctx: Canvas2D, layer: ChartLayer, plot: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const rows = layer.rows;
  const muted = resolveColor("muted", rc.theme);
  const text = resolveColor("text", rc.theme);
  const accent = resolveColor("accent", rc.theme);
  const color = resolveColor("primary", rc.theme);
  const values = rows.map((r) => r.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.18;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const labelH = plot.h * 0.16;
  const body = { x: plot.x + plot.w * 0.04, y: plot.y + plot.h * 0.1, w: plot.w * 0.92, h: plot.h - labelH - plot.h * 0.1 };
  const n = rows.length;
  const px = (i: number): number => (n === 1 ? body.x + body.w / 2 : body.x + (body.w * i) / (n - 1));
  const py = (v: number): number => body.y + body.h * (1 - (v - yMin) / (yMax - yMin));
  for (let g = 0; g <= 3; g++) line(ctx, plot.x, body.y + (body.h * g) / 3, plot.x + plot.w, body.y + (body.h * g) / 3, withAlpha(muted, 0.18), 1);
  const size = Math.max(8, Math.min(rc.height * 0.042, plot.w / Math.max(n, 4) * 0.3));

  // The line is drawn on from left to right along its length.
  const points = rows.map((r, i) => ({ x: px(i), y: py(r.value) }));
  const progress = phase(timing.local, 0.1, Math.max(0.6, Math.min(1.6, timing.length * 0.55)), "easeInOut");
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    cumulative.push((cumulative[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1] as number;
  let remaining = total * progress;
  const reached = cumulative.map((d) => d <= total * progress + 1e-6);
  ctx.save();
  ctx.lineWidth = Math.max(2.5, rc.height * 0.008);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) {
      ctx.moveTo(p.x, p.y);
      return;
    }
    const prev = points[i - 1] as { x: number; y: number };
    const length = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (remaining <= 0) return;
    const t = length === 0 ? 1 : Math.min(1, remaining / length);
    ctx.lineTo(lerp(prev.x, p.x, t), lerp(prev.y, p.y, t));
    remaining -= length;
  });
  ctx.stroke();
  ctx.restore();
  // Points, the value of the highlighted (or last) point, and the labels under the axis.
  const emphasised = layer.highlight ?? n - 1;
  const every = Math.max(1, Math.ceil((n * size * 4.2) / plot.w));
  points.forEach((p, i) => {
    const seen = reached[i] ?? false;
    if (!seen) return;
    const strong = i === emphasised;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * (strong ? 0.42 : 0.28), 0, Math.PI * 2);
    ctx.fillStyle = strong ? accent : resolveColor("background", rc.theme);
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.strokeStyle = strong ? text : color;
    ctx.stroke();
    if (strong) drawLabel(ctx, valueText(rows[i]?.value ?? 0, layer.unit), { x: p.x - plot.w * 0.15, y: p.y - size * 2.2, w: plot.w * 0.3, h: size * 1.6 }, { size, weight: 700, color: text, align: "center", valign: "middle", shadow: true }, layer.id, rc, note);
    if (i % every === 0 || strong) drawLabel(ctx, rows[i]?.label ?? "", { x: p.x - (body.w / Math.max(1, n - 1)) * 0.5 * every, y: plot.y + plot.h - labelH * 0.9, w: (body.w / Math.max(1, n - 1)) * every, h: labelH * 0.9 }, { size: size * 0.95, weight: 400, color: muted, align: "center", valign: "top", maxLines: 2, shadow: false, minScale: 0.55 }, layer.id, rc, note);
  });
}

function drawPie(ctx: Canvas2D, layer: ChartLayer, plot: Area, env: DrawEnv, donut: boolean): void {
  const { rc, note, timing } = env;
  const rows = layer.rows.map((r) => ({ ...r, value: Math.max(0, r.value) }));
  const sum = rows.reduce((s, r) => s + r.value, 0);
  if (sum <= 0) {
    note({ layerId: layer.id, kind: "not-drawn", message: "A pie chart needs at least one value above zero." });
    return;
  }
  const side = Math.min(plot.h, plot.w * 0.52);
  const radius = side / 2 * 0.92;
  const cx = plot.x + side / 2;
  const cy = plot.y + plot.h / 2;
  const sweep = phase(timing.local, 0.1, Math.max(0.6, Math.min(1.4, timing.length * 0.5)), "easeInOut") * Math.PI * 2;
  const text = resolveColor("text", rc.theme);
  const muted = resolveColor("muted", rc.theme);
  let angle = -Math.PI / 2;
  rows.forEach((row, i) => {
    const slice = (row.value / sum) * Math.PI * 2;
    const from = angle;
    const to = Math.min(angle + slice, -Math.PI / 2 + sweep);
    angle += slice;
    if (to <= from + 1e-6) return;
    const out = layer.highlight === i ? radius * 0.07 : 0;
    const mid = (from + angle) / 2;
    const ox = Math.cos(mid) * out;
    const oy = Math.sin(mid) * out;
    ctx.beginPath();
    if (donut) {
      // A ring segment: along the outside, then back along the inside.
      ctx.arc(cx + ox, cy + oy, radius, from, to);
      ctx.arc(cx + ox, cy + oy, radius * 0.56, to, from, true);
    } else {
      ctx.moveTo(cx + ox, cy + oy);
      ctx.arc(cx + ox, cy + oy, radius, from, to);
    }
    ctx.closePath();
    ctx.fillStyle = paletteColor(rc, i);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(resolveColor("background", rc.theme), 0.9);
    ctx.stroke();
  });
  if (donut) {
    const centre = layer.highlight !== undefined && rows[layer.highlight] ? `${Math.round(((rows[layer.highlight]?.value ?? 0) / sum) * 100)}%` : valueText(sum, layer.unit);
    withLayerAlpha(ctx, phase(timing.local, 0.6, 0.5), () => drawLabel(ctx, centre, { x: cx - radius * 0.5, y: cy - radius * 0.3, w: radius, h: radius * 0.6 }, { size: radius * 0.3, weight: 700, color: text, align: "center", valign: "middle", shadow: true }, layer.id, rc, note));
  }
  // Legend: a colour swatch, the label and the share.
  const lx = plot.x + side + plot.w * 0.06;
  const lw = plot.x + plot.w - lx;
  const rowH = Math.min(plot.h / rows.length, rc.height * 0.085);
  const top = plot.y + (plot.h - rowH * rows.length) / 2;
  const size = Math.max(8, Math.min(rowH * 0.6, rc.height * 0.045));
  rows.forEach((row, i) => {
    withLayerAlpha(ctx, phase(timing.local, 0.3 + i * 0.1, 0.4), () => {
      const y = top + i * rowH;
      roundedRect(ctx, lx, y + rowH / 2 - size * 0.4, size * 0.8, size * 0.8, size * 0.2);
      ctx.fillStyle = paletteColor(rc, i);
      ctx.fill();
      const share = `${Math.round((row.value / sum) * 100)}%`;
      const shareW = size * 2.6;
      drawLabel(ctx, row.label, { x: lx + size * 1.2, y, w: lw - size * 1.2 - shareW, h: rowH }, { size, weight: layer.highlight === i ? 700 : 400, color: layer.highlight === i ? text : muted, align: "left", valign: "middle", shadow: true, minScale: 0.55 }, layer.id, rc, note);
      drawLabel(ctx, share, { x: lx + lw - shareW, y, w: shareW, h: rowH }, { size, weight: 700, color: text, align: "right", valign: "middle", shadow: true, minScale: 0.6 }, layer.id, rc, note);
    });
  });
}

/** Bar (vertical or, with many or long labels, horizontal), line, pie and donut charts that build up as they come on screen. */
export function drawChart(ctx: Canvas2D, layer: ChartLayer, area: Area, env: DrawEnv): void {
  const plot = drawTitle(ctx, layer, area, env);
  if (layer.kind === "bar") drawBars(ctx, layer, plot, env);
  else if (layer.kind === "line") drawLineChart(ctx, layer, plot, env);
  else drawPie(ctx, layer, plot, env, layer.kind === "donut");
}
