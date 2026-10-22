import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { COUNTRY_CODES, defaultCatalog } from "../spec/catalog.ts";
import { repairSpec, validateSpec } from "../spec/index.ts";
import { COUNTRIES, countryByCode, countryByNumeric, countryName, findCountryByName, normalizeName } from "./countries.ts";
import { ensureIcons, hasIcon, iconNames, iconRefsOf, iconShape, iconsOfSpec, searchIcons, type IconSet } from "./icons.ts";

const assetPath = (rel: string): URL => new URL(`../assets/${rel}`, import.meta.url);

test("icons: the index has both sets and Lucide is the default", () => {
  assert.ok(iconNames("lucide").length >= 1800, `lucide ${iconNames("lucide").length}`);
  assert.ok(iconNames("tabler").length >= 5000, `tabler ${iconNames("tabler").length}`);
  assert.equal(hasIcon("lucide", "check"), true);
  assert.equal(hasIcon("tabler", "star-filled"), true);
  assert.equal(hasIcon("fontawesome", "check"), false);
});

test("icons: every icon in the index loads and has valid path data", async () => {
  const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
  for (const set of ["lucide", "tabler"] as IconSet[]) {
    await ensureIcons([{ set, name: "" }]);
    for (const name of iconNames(set)) {
      const shape = iconShape(set, name);
      assert.ok(shape, `${set}:${name} does not load`);
      assert.ok(shape.paths.length + (shape.fillPaths?.length ?? 0) > 0, `${set}:${name} has no paths`);
      for (const d of [...shape.paths, ...(shape.fillPaths ?? [])]) assert.match(d, PATH, `${set}:${name} has odd path data`);
      assert.equal(shape.viewBox, 24);
    }
  }
});

test("icons: solid Tabler icons are filled, outline icons are not, dots of outline icons are fill paths", async () => {
  await ensureIcons([{ set: "tabler", name: "" }, { set: "lucide", name: "" }]);
  assert.equal(iconShape("tabler", "star-filled")?.filled, true);
  assert.equal(iconShape("tabler", "star")?.filled, false);
  assert.ok((iconShape("lucide", "brain-circuit")?.fillPaths?.length ?? 0) > 0);
  assert.equal(iconShape("lucide", "no-such-icon"), undefined);
});

test("icons: unknown names fail validation and are repaired away", () => {
  const spec = { schemaVersion: 1, id: "g", duration: 2, layers: [{ id: "a", type: "icon", box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, icon: { set: "lucide", name: "definitely-not-an-icon" }, color: "accent" }] };
  const strict = validateSpec(spec);
  assert.equal(strict.ok, false);
  const repaired = repairSpec(spec);
  assert.equal(repaired.ok === false || repaired.spec.layers.every((l) => l.type !== "icon"), true);
  assert.equal(defaultCatalog.hasIcon("tabler", "Not A Name!"), false);
  assert.equal(validateSpec({ ...spec, layers: [{ ...spec.layers[0], icon: { set: "lucide", name: "trending-up" } }] }).ok, true);
});

test("icons: a spec's icons are found and handed over as plain data", async () => {
  const spec = {
    layers: [
      { type: "icon", icon: { set: "lucide", name: "check" } },
      { type: "list", items: [{ text: "a", icon: { set: "tabler", name: "flame" } }, { text: "b" }] },
      { type: "lowerThird", icon: { set: "lucide", name: "check" } },
    ],
  };
  assert.deepEqual(iconRefsOf(spec).map((r) => `${r.set}:${r.name}`).sort(), ["lucide:check", "tabler:flame"]);
  const data = await iconsOfSpec(spec);
  assert.deepEqual(Object.keys(data).sort(), ["lucide:check", "tabler:flame"]);
  assert.doesNotThrow(() => structuredClone(data));
});

test("icons: keyword search is stable and finds the obvious icon", async () => {
  const first = await searchIcons("growth chart trending", 30);
  assert.ok(first.length > 5 && first.length <= 30);
  assert.ok(first.some((h) => h.name === "trending-up"), first.map((h) => h.name).join(" "));
  assert.deepEqual(await searchIcons("growth chart trending", 30), first);
  assert.equal(first.some((h) => h.name.endsWith("-filled")), false, "solid duplicates only when asked for");
  assert.ok((await searchIcons("star solid", 10)).some((h) => h.name === "star-filled"));
  assert.deepEqual(await searchIcons("   ", 5), []);
});

test("countries: every code the spec accepts has a country row, a flag picture and names", () => {
  for (const code of COUNTRY_CODES) {
    const row = countryByCode(code);
    assert.ok(row, `${code} is missing from countries.json`);
    assert.ok(row.names.en?.[0], `${code} has no English name`);
    assert.equal(existsSync(assetPath(`flags/${code.toLowerCase()}.webp`)), true, `no flag picture for ${code}`);
  }
  for (const row of COUNTRIES) assert.equal(defaultCatalog.hasCountry(row.a2), true, `${row.a2} is in countries.json but not in the spec catalog`);
});

test("countries: ISO numeric ids and names in other languages", () => {
  assert.equal(countryByNumeric("586")?.a2, "PK");
  assert.equal(countryByNumeric(4)?.a2, "AF");
  assert.equal(countryName("JP", "ja"), "日本");
  assert.equal(findCountryByName("پاکستان")?.a2, "PK");
  assert.equal(findCountryByName("대한민국")?.a2, "KR");
  assert.equal(findCountryByName("Россия")?.a2, "RU");
  assert.equal(findCountryByName("नेपाल")?.a2, "NP");
  assert.equal(findCountryByName("  Côte d’Ivoire ")?.a2, "CI");
  assert.equal(findCountryByName("Narnia"), undefined);
  assert.equal(normalizeName("São  Tomé!"), "sao tome");
});

/** Width and height of a lossless WebP (VP8L) file. */
function webpSize(bytes: Buffer): { w: number; h: number; kind: string } {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8L") {
    assert.equal(bytes[20], 0x2f);
    const bits = bytes.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, kind };
  }
  if (kind === "VP8X") return { w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1, kind };
  return { w: 0, h: 0, kind };
}

test("flags: every flag picture is a 480 x 360 WebP and the set is small", () => {
  let total = 0;
  for (const row of COUNTRIES) {
    const bytes = readFileSync(assetPath(`flags/${row.a2.toLowerCase()}.webp`));
    total += bytes.length;
    const { w, h } = webpSize(bytes);
    assert.deepEqual([w, h], [480, 360], `${row.a2} is ${w}x${h}`);
  }
  assert.ok(total < 2_500_000, `all flags together are ${total} bytes`);
});

test("assets: licences of every bundled package are in THIRD_PARTY_LICENSES.md", () => {
  const text = readFileSync(new URL("../../../../THIRD_PARTY_LICENSES.md", import.meta.url), "utf8");
  for (const word of ["Lucide", "Tabler", "flag-icons", "world-atlas", "Natural Earth", "i18n-iso-countries", "ISC", "MIT"]) assert.ok(text.includes(word), `${word} is not mentioned`);
});
