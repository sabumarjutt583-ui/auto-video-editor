// Sets one version number everywhere: package.json, package-lock.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml and src-tauri/Cargo.lock.
// Usage: node scripts/set-version.mjs 0.2.0
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { setCargoLockVersion, setCargoTomlVersion } from "./lib/release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function setVersionEverywhere(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Please give a version like 0.2.0");

  const editJson = (file, edit) => {
    const path = join(root, file);
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8"));
    edit(data);
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`${file} -> ${version}`);
  };
  editJson("package.json", (d) => (d.version = version));
  editJson("package-lock.json", (d) => {
    d.version = version;
    if (d.packages?.[""]) d.packages[""].version = version;
  });
  editJson("src-tauri/tauri.conf.json", (d) => (d.version = version));

  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8");
  writeFileSync(cargoPath, setCargoTomlVersion(cargo, version));
  console.log(`src-tauri/Cargo.toml -> ${version}`);
  const name = /^name = "([^"]+)"/m.exec(cargo)?.[1];
  const lockPath = join(root, "src-tauri", "Cargo.lock");
  if (name && existsSync(lockPath)) {
    writeFileSync(lockPath, setCargoLockVersion(readFileSync(lockPath, "utf8"), name, version));
    console.log(`src-tauri/Cargo.lock -> ${version}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    setVersionEverywhere(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
