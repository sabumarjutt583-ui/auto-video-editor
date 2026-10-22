// Bundles the graphics renderer + golden cases into one browser script for the Rust golden-image test.
// Output: src-tauri/target/graphics-harness/harness.js (not committed).
import { build } from "vite";

// The drawing worker of the export (a separate script, as the browser starts workers from a file).
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    lib: { entry: "src/lib/graphics/export/renderWorker.ts", formats: ["iife"], name: "GraphicsWorker", fileName: () => "worker.js" },
    outDir: "src-tauri/target/graphics-harness",
    emptyOutDir: true,
    minify: false,
    target: "es2022",
  },
});

await build({
  configFile: false,
  logLevel: "warn",
  build: {
    // Icons, flags and map data are inlined into the one script.
    assetsInlineLimit: 1e9,
    lib: { entry: "src/lib/graphics/render/harness/entry.ts", formats: ["iife"], name: "GraphicsHarness", fileName: () => "harness.js" },
    outDir: "src-tauri/target/graphics-harness",
    emptyOutDir: false,
    minify: false,
    target: "es2022",
  },
});
