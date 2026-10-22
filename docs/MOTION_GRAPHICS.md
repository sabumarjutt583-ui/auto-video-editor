# Motion graphics: audit and plan (Phase 0)

Status: Phase 0 of the master task "Professional motion graphics system". This file describes what exists today, what is wrong with it, and how the new system (GraphicSpec + a deterministic renderer) is built without breaking old projects. It is updated at the end of every phase; Phase 13 turns it into the final architecture reference.

## 1. How it works today

**Choosing.** The person selects a scene in Auto Editor > Motion and presses "Make a motion graphic" (optionally with an idea in words). Nothing is chosen automatically: no detection of numbers, places or lists, no density setting, no "generate for the whole project".

**Generating.** `src-tauri/src/motion/contract.rs` builds one long prompt (narration, language, length, canvas size, look = style name, rules). The prompt goes through the web chat (`ImageGen::chat_ask`, Google accounts). The AI answers with ONE complete HTML file (CSS `@keyframes` or `window.renderFrame(t)`). `generate.rs` wraps it (`wrap_html`: CSP with no network, error collector, transparent background) and tries up to 3 times: problems found by the checker are sent back to the AI as text.

**Checking.** `capture.rs` opens the page in a hidden, offline, temp-profile Chromium (own CDP client) at the video size and takes 3 test frames (start, 50 %, 85 %). Rejected when: script error, nothing animated, blank, covers the screen, no movement.

**Rendering.** `draw_all` sets time `t = frame / fps` (animations paused at `t`), takes one PNG screenshot per frame (transparent background override) and writes `motion/<id>/frames/00000.png ...` plus `motion.html`. Default 30 fps, 1080p-class size of the project aspect ratio, 0.8 to 12 s.

**Storing.** `EditorData.motion: MotionGraphic[]` in project.json (id, sceneId, start, duration, idea, framesDir, htmlPath, fps, frames, width, height, enabled). Edits go through `applyEdit` (undo/redo).

**Compositing.** `lib/render/request.ts::buildOverlays` keeps enabled graphics whose picture shape matches the video; Rust `render/plan.rs::overlay_graph` adds every frame folder as an extra image2 input, scales it to the output size and overlays it with `setpts` at its start time, below the captions (captions are burned in afterwards).

**Preview.** `MotionPanel.tsx` loops the PNG frames on a checkerboard at 15 fps. There is no preview over the scene, no scrubbing, and the Auto Editor player does not show graphics.

## 2. What works and must be kept

- The transparent-PNG-frames-in-folder -> FFmpeg overlay path in `render/plan.rs`, including the order video -> graphics -> captions. It already survived the smoke test and frame-exact total length rules.
- `MotionGraphic` records, `readEditor` normalisation, undo/redo through `applyEdit`.
- The offline rule (no network while drawing) and the checks that reject blank / full-screen / static graphics (reused as the "legacy" validator).
- Background jobs with progress + Cancel; job kind `motion`.
- The AI-writes-HTML path stays available as the **"Custom (AI HTML)"** graphic type for ideas the fixed layer types cannot express. It is not removed.

## 3. Weaknesses and bugs found while reading the code

1. **Fonts are not bundled into the drawing page.** The prompt asks for `font-family: 'Noto Sans', 'Noto Sans CJK KR' ...`, but `wrap_html` does not inject `@font-face` rules pointing at `resources/fonts`. The result depends on fonts installed on the person's PC: Korean, Devanagari or Arabic text may draw as boxes, and two computers give different pictures. Breaks determinism (R3) and R4.
2. **No protection of subjects or captions except a sentence in the prompt** ("keep the bottom 20 % empty", "5 % margin"). Nothing measures where the face or main subject is.
3. **Quality is whatever the AI writes.** No brand colours/fonts, no consistent look across graphics, no density control; the checker only catches blank / full-screen / static.
4. **Not deterministic by construction.** `Math.random` and `Date` are forbidden only by a prompt sentence, not enforced.
5. **Slow and heavy.** One Chromium start per try; one CDP screenshot + one PNG file per frame (a 12 s graphic at 30 fps is 360 PNGs at video size); frames are decoded again by FFmpeg for every render. No cache: changing nothing still re-reads everything; deleting a graphic only removes the JSON entry, so `motion/<id>/` stays on disk forever (orphans).
6. **Cancel leaves `frames.tmp`.** The temp profile folder is removed, but `motion/<id>/frames.tmp` stays after Cancel (it is only cleaned at the start of the next run of the same id).
7. **Picture shape mismatch is silent.** A 16:9 graphic is skipped for a 9:16 render (`buildOverlays`) without any message to the person.
8. **No timing intelligence.** The graphic starts at the scene start, not on the spoken word; length is the scene length (max 12 s).
9. **Alpha edges.** Screenshots with a transparent override are straight alpha PNGs; FFmpeg `format=rgba` + `overlay format=auto` is correct in principle, but no test checks halos on white/black backgrounds.
10. **Preview is not the final result.** Preview = PNG frames of the same pipeline, but the editor player never shows graphics, so the person only sees the real result after rendering.
11. **Only one engine path:** needs the Google-account chat. With no account, nothing works and there is no fallback graphic.

## 4. Target architecture

```
Scene text + word timings
   -> deterministic detection (numbers, money, %, dates, places, lists, quotes)        [phase 7]
   -> AI picks WHAT: GraphicSpec JSON or "none" (validated, repaired, retried once)     [phases 1, 7]
   -> placement solver (subject box, caption zone, safe area)                           [phase 8]
   -> quality checks + auto-fix                                                         [phase 9]
   -> TypeScript renderer renderFrame(spec, frame, ctx)  (Canvas 2D, seeded, t=frame/30) [phases 2, 5]
        live preview: normal canvas       export: OffscreenCanvas in Web Workers
   -> raw RGBA frames streamed to Rust -> FFmpeg rawvideo -> transparent clip           [phase 3]
   -> render overlay (existing overlay_graph), captions on top                          [kept]
```

One renderer for preview and export (R5). Cache key = hash(spec + rendererVersion + brand kit + fonts + assets + resolution + fps) (phase 12).

### Decisions made now (so later phases do not stall)

- **Validator without a new library.** The task allows "zod or equivalent". CLAUDE.md says "ask before adding a dependency", so the validator is hand-written (`src/lib/graphics/spec/`), same style as `normalizeStyle` / `readEditor`. Rust gets matching serde structs.
- **Transparent format.** The bundled LGPL FFmpeg (see `scripts/ci/ffmpeg-components.sh`) has the `png` encoder and `mov` muxer, but NO `prores_ks` and NO `libvpx-vp9`. Plan: **MOV with the PNG codec, `rgba`, lossless**. Zero new FFmpeg parts, decodes with the existing `png` decoder, alpha is exact. Cost: big files, so they live in the cache folder with a size limit (phase 12). If phase 3 measurements show it is too slow or too large, adding `prores_ks` to the component list is the fallback (needs a CI FFmpeg rebuild; will be asked first).
- **Where golden-image tests run.** Node's test runner has no Canvas. The renderer's pure parts (timing, layout, text measuring rules, validation, detection, placement, checks) are tested in Node (`npm run test:ts`). Pixel tests draw the same renderer bundle inside the hidden Chromium that the motion tests already use (`testserver::test_browser`, skipped when no browser) and compare PNGs with stored golden files. No new test dependency.
- **Fonts.** The renderer loads the bundled Noto fonts with `FontFace` from `resources/fonts` (asset scope already allows it) and waits for `document.fonts.ready` before frame 0.
- **Assets without runtime dependencies.** Icons (Lucide ISC, Tabler MIT), flags (flag-icons MIT) and world-atlas TopoJSON are copied as plain files by a developer script that uses `npm pack` into a temp folder; they are NOT added to package.json. The projections needed (equirectangular, Mercator, natural earth) and the TopoJSON decoder are small hand-written modules. **Needs your OK** before phase 4 downloads anything (licence text goes into THIRD_PARTY_LICENSES.md).
- **Frames to Rust.** Phase 3 sends raw RGBA over a Tauri channel/binary invoke body to a Rust writer that pipes into FFmpeg. Frames are never all in memory (R8).

## 5. Migration of existing projects

- `MotionGraphic` gets an optional `kind: "legacy" | "spec"` (missing = `"legacy"`) and, for spec graphics, `specPath`, `cacheKey`, `warnings`. `readEditor` fills the defaults, so old project.json files load unchanged. serde `default` on the Rust side (same rule as other new project fields).
- **Legacy graphics keep working with the legacy renderer forever:** their PNG frames and `motion.html` stay as they are and go through the same `overlay_graph`. They are shown in the new Graphics track with a "Custom (AI HTML)" badge.
- No automatic conversion: an AI-written HTML file cannot be turned into layers. "Make it again" on a legacy graphic offers "as Custom (AI HTML)" or "with the new engine".
- Orphan folders (`motion/<id>/` without a record) are found and offered for deletion in "Clear cache" (phase 12).

## 5b. GraphicSpec v1 (phase 1)

- Files: `src/lib/graphics/spec/{parse,limits,catalog,schema,index}.ts` (+ `spec.test.ts`, fixtures in `fixtures/*.json`), Rust mirror `src-tauri/src/graphics/spec.rs` (same fixtures are read by a Rust test).
- `parse.ts` is a tiny schema library (no dependency): `num`, `str`, `oneOf`, `obj`, `arr`, `opt`, `variant`, `refine`. Output types are inferred, so the TypeScript types cannot drift from the validator.
- `validateSpec(input)` = strict: every problem is an error with a path (`layers[2].to must be a number`), nothing is changed. `repairSpec(input)` = clamps numbers, cuts text, removes control characters, drops unknown fields and layers that cannot be repaired, moves boxes inside the picture, renames repeated ids, fits layer times into the graphic; it fails only when nothing usable is left. A repaired spec always passes `validateSpec` (tested with 800 random mutations). `describeIssues` makes short lines for the AI retry message.
- Layer types (14): text, icon, shape, counter, chart, timeline, map, lowerThird, quoteCard, list, progressBar, particles, kineticText, flag. Positions are fractions of the frame, times are seconds from the graphic start, frame rate is fixed 30 fps (not in the spec). Limits are in `limits.ts` (max 20 s, 16 layers, 120 characters of text, 12 chart rows, 300 particles ...).
- Icon and country names are checked through `Catalog` (`defaultCatalog` accepts well-formed Lucide/Tabler names and ISO country codes; phase 4 plugs in the real icon index).

## 5c. Renderer core (phase 2)

- Spec additions: layer types `richText` (runs written one after another, separated by a space) and `image` (`src` = relative project path; web addresses, `..` and absolute paths are refused). Now 16 layer types.
- Code: `src/lib/graphics/render/`: `renderFrame(spec, frame, ctx, rc, options)` draws one frame (`frame` / 30 = seconds; 30 fps fixed) onto a cleared transparent Canvas 2D context (`CanvasRenderingContext2D` or `OffscreenCanvasRenderingContext2D`). Pure parts (Node-tested): `timing.ts` (visibility window, enter/exit progress), `easing.ts`, `anim.ts` (9 enter and 7 exit presets to alpha / move / scale / clip / typewriter), `script.ts` (Latin, Cyrillic, Korean, Japanese, Chinese, Devanagari, Arabic/Urdu), `wrap.ts` (word and CJK line breaking, punctuation never starts a line), `fit.ts` (wrap inside the box, shrink to 50 % of the size, then cut with an ellipsis). Drawing: `draw/{text,shape,icon,image}.ts` (`text` also draws `richText`). RTL text uses canvas `direction = "rtl"` with words in logical order.
- Fonts: the bundled Noto fonts of `resources/fonts`, chosen by the detected script (`theme.ts` is a placeholder for the brand kits of phase 6). Icons: `icons.ts` has a tiny hand-drawn set until phase 4 brings Lucide/Tabler. Layer types of phase 5 (counter, chart, ...) report `not-drawn` for now.
- Notes: `renderFrame` returns `{ drawn, notes }`; notes tell when text was shrunk or cut, or an icon / picture is missing. The quality checks of phase 9 will use them.
- Motion blur: `options.motionBlurSamples` (+ `shutter`) draws sub-frames into a scratch canvas and adds them with `lighter` at 1/n (the mean of the premultiplied colours). Off by default.
- Preview: `src/components/graphics/{GraphicPreview,GraphicLab}.tsx`, shown in Auto Editor > Motion as "Graphic preview (new engine)": plays a sample or pasted spec in real time over the scene picture with play/pause and a scrub bar; same renderer as the export.
- Golden tests: `scripts/graphics-harness.mjs` bundles the renderer (Vite API, no new dependency) to `src-tauri/target/graphics-harness/harness.js`; `src-tauri/src/graphics/golden_tests.rs` runs it in the hidden Chromium of the Image Generator code and compares 41 cases (text in 8 scripts, alignment, wrapping, shrink, cut, rich text, shape, icons, images, every enter and exit preset, motion blur) with `src/lib/graphics/render/golden/*.png` (mean error <= 1.5 and <= 0.3 % of pixels far off). `UPDATE_GOLDEN=1 cargo test golden` rewrites the pictures; look at them before committing.

## 5d. Transparent export and composite (phase 3)

- **Format chosen: MOV with the PNG codec (`rgba`, lossless).** The bundled LGPL FFmpeg has the `png` encoder/decoder and the `mov` muxer/demuxer, but no ProRes 4444 and no VP9 with alpha. PNG-in-MOV keeps the alpha bit for bit (tested: a frame comes back identical to what was sent, every alpha value included), needs no new codec, and the small FFmpeg already decodes it. Cost: bigger files than ProRes (they live in the project's `graphics/<id>/clip.mov`; the cache limit comes in phase 12). The only new FFmpeg part is the **`rawvideo` demuxer** (added to `scripts/ci/ffmpeg-components.sh`, a few KB) so FFmpeg can read the pipe. If a later measurement shows the files are too big, ProRes 4444 (`prores_ks`) needs a CI FFmpeg rebuild and will be asked first.
- **Flow.** TypeScript draws frame after frame (`src/lib/graphics/export/`): `exportGraphic` keeps 3 frames drawn ahead while earlier ones are sent. Drawing runs in a **Web Worker with an OffscreenCanvas** (`renderWorker.ts`, same `renderFrame`); a webview without Worker/OffscreenCanvas draws on the main thread (same pixels, slower). Each frame (RGBA, straight alpha from `getImageData`) goes to Rust as a **raw IPC body** (no JSON, no base64) with the job id in the `x-job-id` header: `graphic_export_start` / `graphic_export_frame` / `graphic_export_finish` / `graphic_export_abort` (`commands/graphics.rs`). `graphics/export.rs` pipes the bytes into `ffmpeg -f rawvideo -pix_fmt rgba -video_size WxH -framerate 30 -i pipe:0 -frames:v N -c:v png -pix_fmt rgba -r 30 -f mov`. One export = one background job (kind `graphic-export`, progress + Cancel through the normal job registry).
- **Checks:** even sides 16..4096, 1..630 frames, graphic id `[A-Za-z0-9_-]{1,40}`, every frame exactly `w*h*4` bytes, all announced frames present before finish. Cancel, a wrong frame, a missing frame, a dead FFmpeg: the process is killed and `clip.mov.tmp` removed.
- **Composite.** `RenderRequest.overlays[]` entries now have `framesDir` (AI HTML graphics, unchanged) or `clip` (a `.mov` inside the project). `plan::overlay_graph_for`: a clip starts on frame `round(start * fps)` of the video, written as the exact fraction `n/(fps*TB)` (no rounded decimals, so it never lags a frame). Order is unchanged: video, graphics, captions on top. Colours: the graphic goes through the same swscale conversion as every picture of the render (test: the same RGB as a graphic and as a picture differ by at most 2 levels). Note: the whole render is untagged (no explicit bt709 flags); a future change should tag all of it at once, not only the graphics.
- **Project data.** `MotionGraphic.kind = "spec"` with `clipPath` and the stored `spec` (the legacy graphics have no `kind`). `readEditor` drops damaged records (path outside the project, not `.mov`, spec that cannot be repaired). The Motion tab's "Graphic preview (new engine)" has **Add to S01**: exports at the project's picture size and puts the graphic at the start of the scene.
- **Tests:** export (90 frames, exact duration 00:00:03.00, bit-exact alpha round trip, 9:16 and 1:1, cancel cleanup, wrong/missing frame), composite (frames 45..74 exactly, 120 frames total, no halo over black/white with synthetic soft edges and with real renderer text, colour match, captions above graphics), worker output byte-identical to the page's (3 graphics x 60 frames), real renderer frames to clip bit-exact. The 5-second smoke test of the installer FFmpeg now includes a graphic clip.
- Not covered by automatic tests: the real Tauri raw-IPC call and the Worker inside the Tauri webviews (Windows WebView2, macOS WKWebView): both need a person to press "Add to scene" once on each system.

## 5e. Bundled assets: icons, flags, maps (phase 4)

Everything is plain data committed under `src/lib/graphics/assets/`; none of the source packages is a dependency of the app (`npm pack` into a temp folder, converted by `scripts/build-graphic-assets.mjs` and `scripts/build-flags.mjs`, licences in `THIRD_PARTY_LICENSES.md`). Nothing is read from the internet; no Google Maps, no map tiles.

| Data | Source (licence) | File(s) | Size (packed) |
|---|---|---|---|
| Icons, default set | Lucide 1.61 (ISC) - 1,903 icons | `icons/lucide.json` (loaded on first use) | 84 kB |
| Icons, second set | Tabler 3.49 (MIT) - 5,184 outline + 1,054 solid (`<name>-filled`) | `icons/tabler.json` (loaded on first use) | 323 kB |
| Icon index | names of both sets (validation, always loaded), keywords (search, loaded on first search) | `icons/names.json`, `icons/tags.json` | 31 kB + 132 kB |
| Flags | flag-icons 7.6 (MIT) - 250 flags, one 480x360 lossless WebP each (`flags/<code>.webp`) | made by headless Chromium + ffmpeg | 1.56 MB |
| Countries | i18n-iso-countries (MIT): alpha-2/3, ISO numeric, names in en ur ko ja ru hi zh ar fa; Kosovo (XK) added by hand | `countries.json` | 72 kB raw |
| Country outlines | world-atlas 2.0 (ISC) from Natural Earth (public domain), TopoJSON 110m and 50m (`land` dropped) | `maps/countries-{110m,50m}.json` | 30 + 228 kB |
| Cities | Natural Earth populated places 1:50m (public domain): 1,248 rows with name, country, lat, lon, population, capital, names in ur ko ja ru hi zh ar fa | `cities.json` | ~100 kB |

- **Icons.** `library/icons.ts`: `hasIcon` (the check every spec goes through: `defaultCatalog.hasIcon`, so an unknown icon fails strict validation and `repairSpec` drops the layer), `ensureIcons`/`iconShape` (sync lookup after the set is loaded), `iconsOfSpec` (plain data for the export worker, which cannot import the sets), `searchIcons(query, limit)` (deterministic keyword score, Lucide first; the director in phase 7 offers the AI the top 30). `IconShape.fillPaths` carries the small solid dots of outline icons. The old 6 hand-drawn placeholder icons are gone.
- **Flags.** Rasters, not vectors: flag SVGs use clip paths, gradients and `<use>`, and a picture keeps preview and export identical. `library/flags.ts` (Vite `import.meta.glob`), key `flag:XX` in the picture map of the render context (`RenderContext.flag`). `draw/geo.ts` `drawFlagPicture(rect | circle)`.
- **Maps.** `geo/topo.ts` (TopoJSON decoder + `unwrapRing`, which makes outlines that cross the date line continuous; a ring around a pole is closed along the pole), `geo/mapData.ts` (`loadMapData("110m" | "50m")`, ids mapped to alpha-2; 110m for the world view, 50m for regions), `geo/projections.ts` (equirectangular, Mercator (clamped at 85.05 deg), Natural Earth I, orthographic globe; `makeView(kind, bounds, box, camera)` fits a region into a box, camera zoom/pan on top; `REGION_BOUNDS` for the 8 regions of the spec), `geo/cities.ts` (`findCity(name, cc?)` in any of the languages, accents and case ignored), `geo/route.ts` (great-circle route, split where it crosses the date line or goes behind the globe, `trimPolylines` for the draw-on). **No d3-geo**: the projections are about 100 lines of pure code, so no new dependency and no floating point differences between machines. `draw/geo.ts`: `drawCountries` (highlight colours, three shifted copies on a flat map), `drawRoutePieces`, `drawPin`.
- **Spec fields they serve** (drawn in phase 5): `flag` layer (`country`), `map` layer (`region`, `projection`, `countries`, `pins`, `routes`), `icon` fields of `icon`, `lowerThird`, `list`.
- **Installer size added (phase 4):** the packed icon sets and index about 0.45 MB, flags 1.56 MB (WebP does not compress further), country table 0.03 MB; maps (0.26 MB) and cities (0.1 MB) are only linked once phase 5 draws maps. About 2.1 MB in the installer now, about 2.5 MB with maps. The unpacked `dist` grows by 3.7 MB.
- **Tests.** `library/library.test.ts` (every icon of both sets loads and has valid path data; unknown names fail validation and are repaired away; icon search; every spec country code has a row and a flag file; all flags are 480x360 WebP; every package is in THIRD_PARTY_LICENSES.md), `geo/geo.test.ts` (both map resolutions decode, test countries have sensible shapes, rings are closed, `unwrapRing`, projections, views fit their box, cities in en/ur/ja/ru, a Karachi-Tokyo route and a Tokyo-Los Angeles route split at the date line). Golden images (browser harness): 10 map/flag pictures (`geo_*`, `flags_*`) and 5 new icon pictures, plus `every_bundled_flag_decodes_and_draws` (all 250 flags draw in Chromium).

## 5f. Advanced layers (phase 5)

All 16 layer types now draw (src/lib/graphics/render/draw/): counter, barChart, lineChart, pieChart (also donut), timeline, map, lowerThird, quoteCard, list, progressBar, particles, kineticText, flag (+ the phase-2 text, richText, shape, icon, image, statCallout).
- Colours and fonts come from the theme (brand kit in phase 6); charts use `theme.palette` (12 colours). Everything is a pure function of the frame number: particles use a seeded PRNG (mulberry32 from the layer id), no Math.random, Date or network.
- Numbers: `format.ts` formats plain / grouped (1,200,000) / compact (3.5M, 45%, "-$3.5M"; 999999 shows as 1M). Digits are Western digits in every language; locale-specific digit shapes (Arabic-Indic, Devanagari) are not used. Not `Intl`, so the same text is drawn on every computer.
- Map: `camera` (up to 8 keys: t, zoom 0.5-8, panX/panY -2..2, log-zoom blend) moves the view; countries fade in, routes draw on one after the other, labels are moved down a little when they would overlap (measured text width).
- Right-to-left text (Urdu, Arabic) mirrors lower thirds, lists and kinetic text. Kinetic text times each word from the layer duration.
- Limits: charts take at most the values allowed in limits.ts; a chart with no positive pie values draws nothing; a missing flag or map data is reported as a note, not an error.
- Tests: render/layers.test.ts (all types draw, determinism, formatting, camera, notes) and about 70 golden pictures (enter / hold / exit). The worker == page test is exact for most cases; for the map and the flag (clipped shapes) a page canvas and an OffscreenCanvas anti-alias the edge pixels a little differently (at most ~10 % of the pixels, edges only), while the worker equals an OffscreenCanvas on the page exactly.

## 6. Phase checklist (commit per phase)

| Phase | Result | Commit message |
|---|---|---|
| 0 | this document | Motion graphics phase 0: audit and plan |
| 1 (done) | GraphicSpec schema, validator, repairSpec, Rust structs | Motion graphics phase 1: GraphicSpec schema and validation |
| 2 (done) | renderer core (text, richText, shape, icon, image), timing engine, preview panel | Motion graphics phase 2: renderer core |
| 3 (done) | transparent export + composite + alpha tests | Motion graphics phase 3: transparent export and composite |
| 4 (done) | icons, flags, maps | Motion graphics phase 4: icons, flags and maps |
| 5 (done) | advanced layers | Motion graphics phase 5: advanced layers |
| 6 | brand kit | Motion graphics phase 6: brand kit |
| 7 | AI graphics director | Motion graphics phase 7: AI graphics director |
| 8 | placement | Motion graphics phase 8: smart placement |
| 9 | quality checks | Motion graphics phase 9: quality checks |
| 10 | timeline editing + presets | Motion graphics phase 10: editing and presets |
| 11 | SFX for graphics | Motion graphics phase 11: graphic sound effects |
| 12 | cache + parallel | Motion graphics phase 12: cache and parallel render |
| 13 | end-to-end tests + docs | Motion graphics phase 13: end-to-end tests and docs |

Every phase ends with: all old and new tests, `npx tsc -b`, `npm run build`, `cargo build` with zero warnings (also `--features admin`), then commit + push (no force). TESTING.md is run after phases 3, 7 and 13.
