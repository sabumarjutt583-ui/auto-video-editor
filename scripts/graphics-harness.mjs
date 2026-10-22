// Bundles the graphics renderer + golden cases into one browser script for the Rust golden-image test.
// Output: src-tauri/target/graphics-harness/harness.js (not committed).
import { build } from "vite";

await build({
  configFile: false,
  logLevel: "warn",
  build: {
    lib: { entry: "src/lib/graphics/render/harness/entry.ts", formats: ["iife"], name: "GraphicsHarness", fileName: () => "harness.js" },
    outDir: "src-tauri/target/graphics-harness",
    emptyOutDir: true,
    minify: false,
    target: "es2022",
  },
});
