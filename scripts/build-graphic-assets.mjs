// Builds the small data files of the motion graphics renderer from public packages (one-off, committed output).
//
//   node scripts/build-graphic-assets.mjs <work-dir>
//
// <work-dir> holds the unpacked npm packages (`npm pack <name>` then `tar xzf`) in these folders:
//   lucide-static/  @tabler/icons -> tabler/  i18n-iso-countries -> iso/  world-atlas/  and the file ne_50m_populated_places.geojson
// Output goes to src/lib/graphics/assets/. The packages are NOT dependencies of the app: only these generated files ship.
// Flags are made by scripts/build-flags.mjs (needs a Chromium).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "src/lib/graphics/assets");
const work = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node scripts/build-graphic-assets.mjs <work-dir>");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(work, p), "utf8"));
const writeJson = (name, value) => {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  fs.writeFileSync(path.join(out, name), JSON.stringify(value));
};
const num = (v) => Number(v);

/** One SVG node of an icon -> path data (or null when it draws nothing). */
function nodeToPath(tag, a) {
  switch (tag) {
    case "path": return a.d;
    case "circle": { const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)]; return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`; }
    case "ellipse": { const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)]; return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`; }
    case "line": return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case "polyline": return `M${a.points.trim().replace(/\s+/g, " L")}`;
    case "polygon": return `M${a.points.trim().replace(/\s+/g, " L")}z`;
    case "rect": {
      const [x, y, w, h] = [num(a.x ?? 0), num(a.y ?? 0), num(a.width), num(a.height)];
      const rx = Math.min(num(a.rx ?? a.ry ?? 0), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx ?? 0), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`;
    }
    default: throw new Error(`unknown icon element ${tag}`);
  }
}

/** [tag, attributes][] -> { p: stroke paths, f?: paths drawn filled inside an outline icon } */
function convertIcon(nodes, allFilled) {
  const p = [];
  const f = [];
  for (const [tag, a] of nodes) {
    if (a.stroke === "none" && a.fill === "none") continue; // Tabler's invisible bounding box
    const d = nodeToPath(tag, a);
    if (!d) continue;
    const solid = a.fill !== undefined && a.fill !== "none";
    (allFilled || solid ? f : p).push(d);
  }
  return allFilled ? { p: f, a: 1 } : f.length ? { p, f } : { p };
}

function buildIcons() {
  const lucide = readJson("lucide-static/package/icon-nodes.json");
  const lucideTags = readJson("lucide-static/package/tags.json");
  const tablerOutline = readJson("tabler/package/tabler-nodes-outline.json");
  const tablerFilled = readJson("tabler/package/tabler-nodes-filled.json");
  const tablerInfo = readJson("tabler/package/icons.json");

  const lucideOut = {};
  for (const [name, nodes] of Object.entries(lucide)) lucideOut[name] = convertIcon(nodes, false);
  const tablerOut = {};
  for (const [name, nodes] of Object.entries(tablerOutline)) tablerOut[name] = convertIcon(nodes, false);
  for (const [name, nodes] of Object.entries(tablerFilled)) {
    if (tablerOut[`${name}-filled`]) throw new Error(`name clash ${name}-filled`);
    tablerOut[`${name}-filled`] = convertIcon(nodes, true);
  }
  writeJson("icons/lucide.json", lucideOut);
  writeJson("icons/tabler.json", tablerOut);

  // Names are always loaded (validation); keywords only for search (phase 7).
  const names = { lucide: Object.keys(lucideOut).sort(), tabler: Object.keys(tablerOut).sort() };
  writeJson("icons/names.json", names);
  const words = (list) => [...new Set(list.map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 8).join(",");
  const tags = { lucide: {}, tabler: {} };
  for (const n of names.lucide) tags.lucide[n] = words(lucideTags[n] ?? []);
  for (const n of names.tabler) {
    const base = n.endsWith("-filled") ? n.slice(0, -7) : n;
    const info = tablerInfo[base];
    tags.tabler[n] = words([...(info?.tags ?? []), info?.category ?? ""]);
  }
  writeJson("icons/tags.json", tags);
  console.log(`icons: lucide ${names.lucide.length}, tabler ${names.tabler.length}`);
}

const LANGS = ["en", "ur", "ko", "ja", "ru", "hi", "zh", "ar", "fa"];

function buildCountries() {
  const codes = readJson("iso/package/codes.json");
  const langs = Object.fromEntries(LANGS.map((l) => [l, readJson(`iso/package/langs/${l}.json`).countries]));
  const rows = [];
  for (const [a2, a3, numeric] of codes) {
    const names = {};
    for (const l of LANGS) {
      const v = langs[l][a2];
      if (v) names[l] = (Array.isArray(v) ? v : [v]).slice(0, 3);
    }
    if (!names.en) continue;
    rows.push({ a2, a3, n: numeric, names });
  }
  // Kosovo has no ISO code; the flag and map data use XK.
  rows.push({ a2: "XK", a3: "XKX", n: "", names: { en: ["Kosovo"], ru: ["Косово"], ko: ["코소보"], ja: ["コソボ"], ur: ["کوسوو"], hi: ["कोसोवो"], zh: ["科索沃"], ar: ["كوسوفو"], fa: ["کوزوو"] } });
  rows.sort((a, b) => a.a2.localeCompare(b.a2));
  writeJson("countries.json", rows);
  console.log(`countries: ${rows.length}`);
}

function buildMaps() {
  for (const res of ["110m", "50m"]) {
    const topo = readJson(`world-atlas/package/countries-${res}.json`);
    delete topo.objects.land;
    writeJson(`maps/countries-${res}.json`, topo);
  }
}

function buildCities() {
  const geo = readJson("ne_50m_populated_places.geojson");
  const rows = [];
  for (const f of geo.features) {
    const p = f.properties;
    const cc = p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : "";
    if (!cc || !p.NAME) continue;
    const names = {};
    for (const l of ["UR", "KO", "JA", "RU", "HI", "ZH", "AR", "FA"]) if (p[`NAME_${l}`] && p[`NAME_${l}`] !== p.NAME) names[l.toLowerCase()] = p[`NAME_${l}`];
    rows.push({
      name: p.NAME, cc, lat: Math.round(p.LATITUDE * 1e4) / 1e4, lon: Math.round(p.LONGITUDE * 1e4) / 1e4,
      pop: p.POP_MAX, capital: p.ADM0CAP === 1 ? 1 : 0, ...(Object.keys(names).length ? { names } : {}),
    });
  }
  rows.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
  writeJson("cities.json", rows);
  console.log(`cities: ${rows.length}`);
}

buildIcons();
buildCountries();
buildMaps();
buildCities();
