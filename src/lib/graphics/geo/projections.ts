/**
 * Map projections written out by hand (no d3 dependency): equirectangular, Mercator, Natural Earth (Šavrič et al.) and orthographic.
 * Every function is pure, so a map is drawn the same way in the preview and in the export.
 */
export type ProjectionKind = "naturalEarth" | "mercator" | "equirectangular" | "orthographic";
export type Bounds = readonly [lonMin: number, latMin: number, lonMax: number, latMax: number];

const RAD = Math.PI / 180;
/** Mercator cannot show the poles. */
const MAX_MERCATOR_LAT = 85.0511287798;

/** Position on the flat plane in "projection units"; y grows to the north. */
export function planar(kind: Exclude<ProjectionKind, "orthographic">, lon: number, lat: number): [number, number] {
  const lambda = lon * RAD;
  switch (kind) {
    case "equirectangular":
      return [lambda, lat * RAD];
    case "mercator": {
      const phi = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * RAD;
      return [lambda, Math.atanh(Math.sin(phi))];
    }
    case "naturalEarth": {
      const phi = lat * RAD;
      const p2 = phi * phi;
      const p4 = p2 * p2;
      return [
        lambda * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
        phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
      ];
    }
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pan and zoom of the map camera: zoom 1 shows the whole region, pan is in box widths/heights (positive = content moves right/down). */
export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}
export const NO_CAMERA: Camera = { zoom: 1, panX: 0, panY: 0 };

export interface MapView {
  kind: ProjectionKind;
  /** Pixel position of a point, or null when it is on the far side of a globe. */
  project: (lon: number, lat: number) => [number, number] | null;
  /** Like `project` but a hidden point is moved onto the edge of the globe (so outlines still close). */
  projectClamped: (lon: number, lat: number) => [number, number];
  /** The box all drawing is limited to (the globe is a circle inside it). */
  box: Box;
  /** Radius in pixels of the globe's disc (orthographic only). */
  radius?: number;
}

export const REGION_BOUNDS: Record<string, Bounds> = {
  world: [-180, -58, 180, 84],
  europe: [-25, 34, 45, 72],
  asia: [26, -11, 146, 58],
  africa: [-20, -36, 55, 38],
  northAmerica: [-170, 5, -50, 75],
  southAmerica: [-83, -57, -33, 14],
  oceania: [110, -48, 180, -2],
  middleEast: [24, 10, 64, 43],
};

function sampleEdges(bounds: Bounds, steps = 12): Array<[number, number]> {
  const [lonMin, latMin, lonMax, latMax] = bounds;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) out.push([lonMin + ((lonMax - lonMin) * i) / steps, latMin + ((latMax - latMin) * j) / steps]);
  }
  return out;
}

function orthographicRaw(lon: number, lat: number, lon0: number, lat0: number): { x: number; y: number; z: number } {
  const lambda = (lon - lon0) * RAD;
  const phi = lat * RAD;
  const phi0 = lat0 * RAD;
  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
  return {
    x: Math.cos(phi) * Math.sin(lambda),
    y: Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda),
    z: cosc,
  };
}

/** Makes the view that shows `bounds` as large as possible inside `box`, then applies the camera. */
export function makeView(kind: ProjectionKind, bounds: Bounds, box: Box, camera: Camera = NO_CAMERA): MapView {
  const cx = box.x + box.w / 2 + camera.panX * box.w;
  const cy = box.y + box.h / 2 + camera.panY * box.h;
  const zoom = Math.max(0.1, camera.zoom);
  if (kind === "orthographic") {
    const lon0 = (bounds[0] + bounds[2]) / 2;
    const lat0 = (bounds[1] + bounds[3]) / 2;
    const half = Math.max(10, Math.min(90, Math.max(((bounds[2] - bounds[0]) / 2) * Math.cos(lat0 * RAD), (bounds[3] - bounds[1]) / 2)));
    const radius = ((Math.min(box.w, box.h) / 2) / Math.sin(half * RAD)) * zoom;
    const at = (lon: number, lat: number) => orthographicRaw(lon, lat, lon0, lat0);
    return {
      kind,
      box,
      radius,
      project: (lon, lat) => {
        const p = at(lon, lat);
        return p.z < 0 ? null : [cx + p.x * radius, cy - p.y * radius];
      },
      projectClamped: (lon, lat) => {
        const p = at(lon, lat);
        if (p.z >= 0) return [cx + p.x * radius, cy - p.y * radius];
        const length = Math.hypot(p.x, p.y) || 1;
        return [cx + (p.x / length) * radius, cy - (p.y / length) * radius];
      },
    };
  }
  const points = sampleEdges(bounds).map(([lon, lat]) => planar(kind, lon, lat));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(box.w / (maxX - minX), box.h / (maxY - minY)) * zoom;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const toPixel = (lon: number, lat: number): [number, number] => {
    const [x, y] = planar(kind, lon, lat);
    return [cx + (x - midX) * scale, cy - (y - midY) * scale];
  };
  return { kind, box, project: toPixel, projectClamped: toPixel };
}
