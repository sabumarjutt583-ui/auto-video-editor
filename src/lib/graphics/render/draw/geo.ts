import type { Area, Canvas2D } from "../context.ts";
import type { MapView } from "../../geo/projections.ts";
import type { Polyline } from "../../geo/route.ts";
import { unwrapRing, type Shape } from "../../geo/topo.ts";
import { roundedRect } from "./path.ts";

/** Drawing helpers for maps and flags (the layers that use them come in phase 5). They draw with the colours they are given. */

function traceShape(ctx: Canvas2D, shape: Shape, view: MapView): void {
  ctx.beginPath();
  const globe = view.kind === "orthographic";
  // A flat map draws each outline three times, shifted by a whole world, so countries that cross the date line show on both edges.
  const shifts = globe ? [0] : [-360, 0, 360];
  const { x: left, w: width } = view.box;
  for (const polygon of shape.polygons) {
    for (const raw of polygon) {
      if (raw.length < 6) continue;
      const ring = globe ? raw : unwrapRing(raw);
      for (const shift of shifts) {
        const points: number[] = [];
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < ring.length; i += 2) {
          const [x, y] = view.projectClamped((ring[i] as number) + shift, ring[i + 1] as number);
          points.push(x, y);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        if (!globe && (maxX < left || minX > left + width)) continue;
        for (let i = 0; i < points.length; i += 2) {
          if (i === 0) ctx.moveTo(points[i] as number, points[i + 1] as number);
          else ctx.lineTo(points[i] as number, points[i + 1] as number);
        }
        ctx.closePath();
      }
    }
  }
}

export interface MapColors {
  /** Sea behind the land (a globe fills its disc). Transparent when empty. */
  sea?: string;
  land: string;
  border: string;
  borderWidth: number;
  /** Upper-case alpha-2 code -> fill colour. */
  highlight?: Readonly<Record<string, string>>;
}

/** Clips to the picture box. Call inside save()/restore(). */
export function clipToMap(ctx: Canvas2D, view: MapView): void {
  const { x, y, w, h } = view.box;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

/** Draws every country, then the highlighted ones on top (so their border is not covered). */
export function drawCountries(ctx: Canvas2D, countries: readonly (Shape & { a2: string })[], view: MapView, colors: MapColors): void {
  ctx.save();
  if (view.kind === "orthographic" && view.radius !== undefined) {
    const cx = view.box.x + view.box.w / 2;
    const cy = view.box.y + view.box.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, view.radius, 0, Math.PI * 2);
    if (colors.sea) {
      ctx.fillStyle = colors.sea;
      ctx.fill();
    }
    ctx.clip();
  } else {
    clipToMap(ctx, view);
    if (colors.sea) {
      ctx.fillStyle = colors.sea;
      ctx.fillRect(view.box.x, view.box.y, view.box.w, view.box.h);
    }
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = colors.borderWidth;
  ctx.strokeStyle = colors.border;
  const lit = colors.highlight ?? {};
  for (const pass of [false, true]) {
    for (const country of countries) {
      const color = lit[country.a2];
      if ((color !== undefined) !== pass) continue;
      traceShape(ctx, country, view);
      ctx.fillStyle = color ?? colors.land;
      ctx.fill("evenodd");
      if (colors.borderWidth > 0) ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawRoutePieces(ctx: Canvas2D, pieces: readonly Polyline[], color: string, width: number, dash?: [number, number]): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (dash) ctx.setLineDash(dash);
  for (const piece of pieces) {
    ctx.beginPath();
    piece.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
}

/** A map pin: a dot with a light ring. */
export function drawPin(ctx: Canvas2D, x: number, y: number, radius: number, color: string, ring: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.35);
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a flag picture (4:3). "rect" keeps the whole flag inside the box with softly rounded corners; "circle" crops the middle
 * of the flag to a disc.
 */
export function drawFlagPicture(ctx: Canvas2D, flag: CanvasImageSource & { width: number; height: number }, area: Area, shape: "rect" | "circle"): void {
  ctx.save();
  if (shape === "circle") {
    const side = Math.min(area.w, area.h);
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, side / 2, 0, Math.PI * 2);
    ctx.clip();
    // The middle square of the 4:3 flag fills the disc.
    const sourceSide = flag.height;
    ctx.drawImage(flag, (flag.width - sourceSide) / 2, 0, sourceSide, sourceSide, cx - side / 2, cy - side / 2, side, side);
  } else {
    const scale = Math.min(area.w / flag.width, area.h / flag.height);
    const w = flag.width * scale;
    const h = flag.height * scale;
    const x = area.x + (area.w - w) / 2;
    const y = area.y + (area.h - h) / 2;
    roundedRect(ctx, x, y, w, h, Math.min(w, h) * 0.04);
    ctx.clip();
    ctx.drawImage(flag, x, y, w, h);
  }
  ctx.restore();
}
