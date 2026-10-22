import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, hash32, mulberry32, wrap } from "./common.ts";

type ParticlesLayer = Extract<Layer, { type: "particles" }>;

interface Seed {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
  spin: number;
  swing: number;
  tone: number;
}

/** Random numbers for every particle, made once from the layer id: the same layer always has the same particles. */
function seeds(layer: ParticlesLayer): Seed[] {
  const random = mulberry32(hash32(`${layer.id}:${layer.kind}`));
  return Array.from({ length: layer.count }, () => ({ x: random(), y: random(), speed: 0.5 + random(), size: 0.5 + random(), phase: random() * Math.PI * 2, spin: (random() - 0.5) * 2, swing: 0.4 + random() * 0.6, tone: random() }));
}

/**
 * Confetti, sparks, dust, snow and bubbles. Every position is a plain function of the time (no stored state, no Math.random),
 * so any frame can be drawn on its own and a re-render gives the same pixels.
 */
export function drawParticles(ctx: Canvas2D, layer: ParticlesLayer, area: Area, env: DrawEnv): void {
  const { rc, timing } = env;
  const t = timing.local;
  const list = seeds(layer);
  const unit = rc.height / 1080;
  const base = layer.color !== undefined ? resolveColor(layer.color, rc.theme) : undefined;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  switch (layer.kind) {
    case "confetti":
      for (const s of list) {
        const w = (10 + 10 * s.size) * unit;
        const h = w * 0.5;
        const margin = w * 2;
        const y = area.y - margin + wrap(s.y * (area.h + 2 * margin) + t * (110 + 140 * s.speed) * unit, area.h + 2 * margin);
        const x = area.x + s.x * area.w + Math.sin(t * (1.2 + s.swing) + s.phase) * 40 * unit * s.swing;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(s.phase + t * s.spin * 4);
        // A tumbling piece shows its edge now and then.
        ctx.scale(1, Math.cos(t * (2 + s.speed * 3) + s.phase));
        ctx.fillStyle = base ?? rc.theme.palette[Math.floor(s.tone * 5) % 5] ?? "#fff";
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }
      break;
    case "sparks": {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h * 0.62;
      const color = base ?? rc.theme.colors.accent;
      ctx.lineCap = "round";
      for (const s of list) {
        const life = 0.9 + s.size * 0.8;
        const age = wrap(t + s.phase, life);
        const k = age / life;
        const angle = -Math.PI / 2 + (s.x - 0.5) * Math.PI * 1.5;
        const speed = (160 + 330 * s.speed) * unit;
        const reach = speed * (1 - Math.exp(-age * 2.4)) / 2.4;
        const x = cx + Math.cos(angle) * reach;
        const y = cy + Math.sin(angle) * reach + 0.5 * 520 * unit * age * age;
        const tail = Math.max(2, (1 - k) * speed * 0.05);
        ctx.globalAlpha = Math.max(0, 1 - k) * Math.min(1, age * 12);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 3.2 * unit * s.size);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail + 0.0001);
        ctx.stroke();
      }
      break;
    }
    case "dust": {
      const color = base ?? rc.theme.colors.text;
      for (const s of list) {
        const x = area.x + wrap(s.x * area.w + Math.sin(t * 0.35 * s.speed + s.phase) * 40 * unit + t * 6 * unit * (s.swing - 0.5) * 4, area.w);
        const y = area.y + wrap(s.y * area.h - t * (14 + 22 * s.speed) * unit, area.h);
        ctx.globalAlpha = 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * (0.8 + s.speed) + s.phase));
        ctx.beginPath();
        ctx.arc(x, y, (1.5 + 3.5 * s.size) * unit, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      break;
    }
    case "snow": {
      const color = base ?? "#ffffff";
      for (const s of list) {
        const r = (2.5 + 6 * s.size) * unit;
        const y = area.y - r + wrap(s.y * (area.h + 2 * r) + t * (50 + 70 * s.speed) * unit, area.h + 2 * r);
        const x = area.x + wrap(s.x * area.w + Math.sin(t * (0.7 + s.swing) + s.phase) * 26 * unit, area.w);
        ctx.globalAlpha = 0.55 + 0.4 * s.tone;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      break;
    }
    case "bubbles": {
      const color = base ?? rc.theme.colors.text;
      for (const s of list) {
        const r = (8 + 26 * s.size) * unit;
        const y = area.y - r + wrap(s.y * (area.h + 2 * r) - t * (40 + 60 * s.speed) * unit, area.h + 2 * r);
        const x = area.x + wrap(s.x * area.w + Math.sin(t * (0.9 + s.swing) + s.phase) * 18 * unit, area.w);
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = Math.max(1.2, 2 * unit);
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
