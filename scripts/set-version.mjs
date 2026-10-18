// Sets one version number everywhere: package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json.
// Usage: node scripts/set-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Please give a version like 0.2.0");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function editJson(file) {
  const path = join(root, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${file} -> ${version}`);
}
editJson("package.json");
editJson("src-tauri/tauri.conf.json");

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(/^version = "[^"]+"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo);
console.log(`src-tauri/Cargo.toml -> ${version}`);
console.log("Also run `cargo check` once so Cargo.lock follows.");
