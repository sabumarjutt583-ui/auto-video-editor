/** A small TopoJSON reader (the world-atlas files only use Polygon and MultiPolygon). Positions come out as longitude, latitude. */
export interface Topology {
  type: "Topology";
  arcs: number[][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, { type: "GeometryCollection"; geometries: TopoGeometry[] }>;
}
export type TopoGeometry =
  | { type: "Polygon"; arcs: number[][]; id?: string | number; properties?: { name?: string } }
  | { type: "MultiPolygon"; arcs: number[][][]; id?: string | number; properties?: { name?: string } }
  | { type: "GeometryCollection" | "Point" | "LineString" | "MultiPoint" | "MultiLineString"; id?: string | number; properties?: { name?: string } };

/** A ring as flat [lon, lat, lon, lat ...]. A polygon is its outer ring first, then holes. */
export type Ring = number[];
export type Polygon = Ring[];

export interface Shape {
  id: string;
  name: string;
  polygons: Polygon[];
}

/** Arcs with their delta coding undone and the transform applied. */
export function decodeArcs(topology: Topology): number[][][] {
  const t = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      if (t) {
        x += dx ?? 0;
        y += dy ?? 0;
        return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
      }
      return [dx ?? 0, dy ?? 0];
    });
  });
}

function ringOf(indexes: number[], arcs: number[][][]): Ring {
  const points: number[][] = [];
  for (const index of indexes) {
    const reversed = index < 0;
    const arc = arcs[reversed ? ~index : index];
    if (!arc) throw new Error(`The map data refers to a missing line (${index}).`);
    const list = reversed ? [...arc].reverse() : arc;
    // The first point of a joined line repeats the last point of the one before.
    for (let i = points.length > 0 ? 1 : 0; i < list.length; i++) points.push(list[i] as number[]);
  }
  const flat: number[] = [];
  for (const p of points) flat.push(p[0] as number, p[1] as number);
  return flat;
}

/** Every Polygon / MultiPolygon of one object of the topology as shapes. */
export function shapesOf(topology: Topology, objectName: string): Shape[] {
  const object = topology.objects[objectName];
  if (!object) throw new Error(`The map data has no "${objectName}" part.`);
  const arcs = decodeArcs(topology);
  const out: Shape[] = [];
  for (const g of object.geometries) {
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
    const polygons: Polygon[] = g.type === "Polygon" ? [g.arcs.map((r) => ringOf(r, arcs))] : g.arcs.map((poly) => poly.map((r) => ringOf(r, arcs)));
    out.push({ id: g.id === undefined ? "" : String(g.id), name: g.properties?.name ?? "", polygons });
  }
  return out;
}

/** Smallest box around a shape: [lonMin, latMin, lonMax, latMax]. */
export function boundsOfShape(shape: Shape): [number, number, number, number] {
  let lonMin = Infinity;
  let latMin = Infinity;
  let lonMax = -Infinity;
  let latMax = -Infinity;
  for (const polygon of shape.polygons) {
    const outer = polygon[0] ?? [];
    for (let i = 0; i < outer.length; i += 2) {
      lonMin = Math.min(lonMin, outer[i] as number);
      lonMax = Math.max(lonMax, outer[i] as number);
      latMin = Math.min(latMin, outer[i + 1] as number);
      latMax = Math.max(latMax, outer[i + 1] as number);
    }
  }
  return [lonMin, latMin, lonMax, latMax];
}

/**
 * Makes the longitudes of a ring continuous: where the outline crosses the date line (a jump of more than 180 degrees) the
 * following points continue past +-180 instead of jumping to the other side. A flat map would otherwise draw a line across the
 * whole picture. A ring that goes all the way round a pole (Antarctica) is closed along the pole.
 */
export function unwrapRing(ring: Ring): Ring {
  if (ring.length < 4) return ring;
  const out = ring.slice();
  let offset = 0;
  for (let i = 2; i < ring.length; i += 2) {
    const jump = (ring[i] as number) - (ring[i - 2] as number);
    if (jump > 180) offset -= 360;
    else if (jump < -180) offset += 360;
    out[i] = (ring[i] as number) + offset;
  }
  const last = out.length - 2;
  if (Math.abs((out[last] as number) - (out[0] as number)) > 180) {
    let sum = 0;
    for (let i = 1; i < ring.length; i += 2) sum += ring[i] as number;
    const pole = sum < 0 ? -90 : 90;
    out.push(out[last] as number, pole, out[0] as number, pole);
  }
  return out;
}

/** A good place for a country's name: the middle of its largest piece (area-weighted centre of the outline), as [lon, lat]. */
export function labelPoint(shape: Shape): [number, number] {
  let best: Ring | null = null;
  let bestSpan = -1;
  for (const polygon of shape.polygons) {
    const outer = polygon[0];
    if (!outer || outer.length < 6) continue;
    const ring = unwrapRing(outer);
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      lonMin = Math.min(lonMin, ring[i] as number);
      lonMax = Math.max(lonMax, ring[i] as number);
      latMin = Math.min(latMin, ring[i + 1] as number);
      latMax = Math.max(latMax, ring[i + 1] as number);
    }
    const span = (lonMax - lonMin) * (latMax - latMin);
    if (span > bestSpan) {
      bestSpan = span;
      best = ring;
    }
  }
  if (!best) return [0, 0];
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i + 3 < best.length; i += 2) {
    const x0 = best[i] as number, y0 = best[i + 1] as number, x1 = best[i + 2] as number, y1 = best[i + 3] as number;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) return [best[0] as number, best[1] as number];
  const lon = cx / (3 * area);
  return [lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon, cy / (3 * area)];
}
