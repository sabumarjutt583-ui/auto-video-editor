# PROJECT: Auto Video Editor (desktop app)

## What it is
A Windows-first desktop app (also builds for macOS/Linux) for faceless YouTube creators who make narration videos in many languages (Korean, Japanese, Russian, Nepali, English, Urdu, etc.) that they may not understand themselves.

Two main modules:
1. PROMPT GENERATOR: user uploads a voice-over + script (or SRT/JSON timing file). The app gets exact word timings, splits the narration into scenes, and generates detailed, style-locked image/video prompts. Every prompt starts with a timecode like S01_000.0-005.1.
2. AUTO EDITOR: user drops a folder of images/videos named with those timecodes (e.g. S01_000.0-005.1.png). The app builds the timeline automatically, adds captions, Ken Burns motion, transitions, music with ducking, sound effects, and renders the final MP4.

## Tech stack (do not change without asking)
- Desktop shell: Tauri 2
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- State: Zustand
- UI helpers: wavesurfer.js (waveform), dnd-kit (drag), lucide-react (icons)
- Backend: Rust (Tauri commands), tokio, serde, reqwest, keyring, tauri-plugin-dialog (native file/folder pickers, approved in Phase 2)
- Video/audio engine: a small custom FFmpeg (LGPL, only the parts the app uses) bundled as a Tauri sidecar. NO FFprobe: files are read with `ffmpeg -i` (src-tauri/src/probe.rs)
- NO Python anywhere. NO Electron.

## External APIs (user brings own keys, entered in Settings)
- Groq API: Whisper (whisper-large-v3-turbo) for word-level timestamps. Backup text model.
- Google Gemini API: scene splitting, character bible, prompt generation, fallback image matching.
- Keys are stored ONLY in the OS keychain via the Rust keyring crate. Never in files, never in localStorage, never hardcoded, never logged.
- Every API call must handle: invalid key (401), rate limit (429), network error, and show a clear message in simple English.

## Core data model (TypeScript, mirror in Rust with serde)
- Project: id, name, createdAt, voicePath, voiceLocked, voiceDuration, language, timingSource ('srt'|'json'|'groq'), words[], scenes[], settings, characterBible[], locationBible[], styleId, mediaMap
- Word: text, start, end (seconds, float)
- Scene: id ('S01'), index, start, end, duration, text (from user script, exact wording), mediaType ('image'|'video'), prompt, motionPrompt, matchedFile, status
- Timecode format: S{2-digit index}_{start 000.0}-{end 000.0}, e.g. S07_032.4-038.9. Never use ':' in file names.

## Folder structure
src/ (React): pages/, components/, store/, lib/ (api clients, parsers), types/
src-tauri/src/: main.rs, commands/, api/ (HTTP helper with retry, typed errors, Groq and Gemini calls), settings.rs (non-secret settings JSON), audio.rs, timing.rs, render.rs, ffmpeg.rs, keys.rs, project/ (model, migrate, store)
src-tauri/binaries/: ffmpeg sidecar (no ffprobe: src-tauri/src/probe.rs reads `ffmpeg -i`)
resources/styles/: one JSON style profile per style
resources/sfx/: built-in sound effects library + index.json
resources/fonts/: Noto Sans, Noto Sans CJK, Noto Sans Devanagari, Noto Sans Arabic

## UI rules
- Dark theme by default, purple accent, clean modern look, rounded cards.
- Left sidebar: Projects, Prompt Generator, Auto Editor, SFX Library, Settings.
- All long tasks run in the background with a progress bar and a Cancel button. The UI must never freeze.
- Every error shows a friendly message plus a 'Details' toggle with the technical error.

## Coding rules
- TypeScript strict mode. No 'any'.
- Small files, one responsibility each.
- Heavy work (FFmpeg, file IO, API calls with big payloads) happens in Rust, not in the frontend.
- Write unit tests for pure logic (parsers, alignment, timecode, scene splitting).
- After each phase: run the app, fix all TypeScript and Rust warnings, and list what was built and how to test it.
- Never remove or break a feature from an earlier phase.
- Ask before adding any new dependency not listed here.

## Built so far (Phases 1-16)
- Frontend: src/lib/{timing,scenes,bible,prompts}/ hold pure logic with tests (`npm run test:ts`, Node test runner, `.ts` import suffixes); src/components/{voice,timing,scenes,styles,bible,prompts}/ hold the Prompt Generator steps (Voice, Timing, Scenes, Style & cast, Prompts).
- Rust: audio/ (silence, voice), jobs (cancel + `job-progress` events), timing.rs (Groq chunked transcription), styles.rs, api/{groq,gemini}.rs, commands/{timing,ai,styles,files}.rs.
- Styles: resources/styles/*.json (built-in), custom styles in app_data/styles (ids start `custom_`).
- Prompts: 3 layers (Gemini system instruction -> JSON per batch of 20 -> code assembles character + location + style lock + aspect). Stored `scene.prompt` has no timecode; exports prepend it.
- New project fields need serde `default` in Rust model.rs AND the TS type.

## Phases 10-13 (Auto Editor)
- Media (10): src/lib/media + src/components/media; Rust media/ (scan, import, thumbnails, Gemini matching). Step 1 "Media" of Auto Editor page.
- Editor (11): src/components/editor (storyboard, preview player, overrides, timeline/ tracks), src/lib/editor (boundaries, motion, transitions, timeline). Edits go through `applyEdit` (undo/redo, 50). `Project.editor` JSON is normalized by `readEditor` in TS.
- Captions (12): src/lib/captions + src/components/captions; Rust captions/ makes the ASS file (karaoke `\k`). Fonts in resources/fonts (Noto Sans, KR, JP, SC, Devanagari, Arabic). Urdu uses Noto Sans Arabic because libass cannot draw Nastaliq (shows boxes).
- Audio (13): src/lib/audio (SFX planner, mix request, segments, tests) + src/components/audio (Audio tab). Rust: sfx.rs, audio/mix.rs (sidechaincompress ducking, two-pass loudnorm -14 LUFS / -1 dBTP), commands/{sfx,music,mix}.rs. SFX library: resources/sfx (generated by scripts/make-sfx.mjs) with index.json. Location has optional `mood` (calm/tense/nature) for ambience. Mix output: exports/audio_mix.wav.

## Phases 14-16 (Render, Library, Release)
- Render (14): Rust src-tauri/src/render/{model,plan,encoder,pipeline}.rs + commands/render.rs; TS src/lib/render + src/components/render (RenderModal, ResultCard). Per-scene clips (mpeg4 intermediates) -> joined with transitions that are the first frames of the incoming scene (as in the preview) -> one final encode with ASS captions + mixed audio. Frame-exact total = round(duration*fps). The LGPL FFmpeg has no libx264: the CPU encoder is libopenh264 (bitrate based); GPU encoders (nvenc/qsv/amf/videotoolbox) are test-encoded at startup, any failure retries on the CPU. `Job::set_range` maps a step into part of the progress bar. Settings: `forceCpuEncoding`.
- Library updates (15): src-tauri/src/library/{hash,zip,manifest,store,update}.rs (SHA-256, CRC-32, inflate, zip are hand-written: no new dependencies). Packages live in app_data/library/<sfx|styles> (+ `.previous` for rollback); the bundled files are used until a downloaded package has a higher version (`package.json` next to the files). Commands library_status / update_libraries / rollback_library. Settings `libraryUpdateUrl` (https or localhost), `sfxFavorites`. The SFX Library page (search, favorites, grid/list, "Add to current scene" via `audio.addedCues`) lives in src/pages/SfxLibraryPage.tsx.
- Admin Edition (15): Cargo feature `admin` (src-tauri/src/admin/) + Vite flag `VITE_ADMIN=true` (`.env.admin`, src/admin/, loaded with a lazy import so the user bundle has none of it). Own identifier (`com.autovideoeditor.admin`, tauri.admin.conf.json). `npm run dev:admin` / `build:admin`. The Freesound key lives in the keychain under the admin service name only. Never ship the admin build; check with the grep commands in TESTING.md section 2.
- Release (16): installers via the Tauri bundler (NSIS + MSI), signed updates with tauri-plugin-updater (key pair outside the repo, steps in RELEASE.md; the pubkey and endpoint in tauri.conf.json are development placeholders), check_app_update / install_app_update commands, banner + Settings card. `scripts/set-version.mjs` sets the version everywhere.
- Support (16): src-tauri/src/logging.rs (rotating logs in app_data/logs, keys hidden, long texts cut unless `debugLogging`), AppError::new writes to the log, panic hook, export_logs command, ErrorBoundary + window error handlers in the frontend, first-run onboarding (3 screens, `onboardingDone`).
- Docs: README.md (developers), USER_GUIDE.md (users), TESTING.md (checklist + last results), RELEASE.md (publishing).

## Style system (writing rules + checks)
- Rules for every new style profile: docs/STYLE_GUIDE.md. Reference: resources/styles/cinematic_realism.json. ALL 51 built-in styles are complete (batches 1-5); the list is docs/STYLES_LIST.md (generated by `npm run styles:list`). Bundled styles package version: resources/styles/package.json (integer, now 7; skipped by the style loader and tests). Use the existing stub ids (black_and_white_photography, 2d_animation, 2d_cartoon, japanese_ukiyo_e, sci_fi_concept_art, hyper_realistic_3d_render).
- Picker order inside a category: `STYLE_ORDER` in src/lib/styleModel.ts (most popular first; custom styles after, by name). A test makes sure every shipped style is listed once.
- Checks: src/lib/styleChecks.ts (pure rules, `BANNED_NAMES`) + src/lib/styleProfiles.test.ts (`EXTRA_BANNED` list). `npm run styles:check` prints a table (style, complete/incomplete, problems) and runs the tests. A style is "complete" when all text fields are filled; complete styles must pass all rules (style_lock 12-25 items, no aspect ratio; negative 12-25 items, nothing shared with style_lock; example_prompt 60-100 words ending with style_lock; mood 4-6 items; no banned names; id = file name). Also tested: all 51 are complete, and no two styles of one category share more than 50% of their style_lock words.
- Style Test (Admin only): src/admin/StyleTestCard.tsx runs generatePrompts on resources/style-test/sample_story.txt (5 lines, imported with `?raw` into the lazy admin chunk); logic in src/lib/prompts/styleTest.ts.
- Renamed style: `pixar_inspired_3d` is now `animated_film_3d` ("3D Animated Film"); project schema v3 (src-tauri/src/project/migrate.rs `v2_to_v3`) maps old `styleId` values. No brand names anywhere.

## Style Gallery (thumbnails)
- Picker is a modal gallery: src/components/styles/{StyleGallery,StyleCard,StyleCurrentCard,StyleThumbnail}.tsx; pure logic src/lib/{styleGallery,styleThumbnails}.ts (+tests). Favorites and last-6 recents live in settings (`styleFavorites`, `recentStyles`).
- Thumbnails: resources/styles/thumbnails/<id>.webp (480x360), converted by Rust src-tauri/src/thumbnails.rs with the bundled FFmpeg; missing file -> colour placeholder. Packages may carry `thumbnails/<id>.webp`. Custom styles: `set_custom_style_thumbnail`.
- Admin: src/admin/ThumbnailsCard.tsx (export prompts / import pictures, `admin_import_thumbnails`). `npm run styles:thumbnails` writes docs/thumbnail-prompts.txt. `styles:check` only WARNS about missing thumbnails.

## Releases (automatic builds)
- `npm run release -- <patch|minor|major>` (scripts/release.mjs, pure helpers in scripts/lib/release.mjs + scripts/release.test.mjs via `npm run test:scripts`): bumps package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock, writes CHANGELOG.md, commits "Release vX.Y.Z", tags, pushes.
- `.github/workflows/release.yml` (tag `v*.*.*` or manual): preflight (RELEASES_REPO variable, RELEASES_TOKEN + signing secrets, repo public) -> small LGPL FFmpeg built from source and cached (Linux + Windows cross-compiled: scripts/ci/build-ffmpeg-cross.sh; macOS: build-ffmpeg-macos.sh; part list in scripts/ci/ffmpeg-components.sh, checked by verify-ffmpeg.sh) -> smoke test (src-tauri/src/smoke_test.rs, 5-second render with every feature) -> tauri-action builds -> scripts/ci/check-bundle.mjs fails on source/maps/env/keys inside installers -> publish job creates ONE draft in the PUBLIC RELEASES_REPO, uploads installers + five fixed-name copies, latest.json LAST, then publishes. Never publishes to the source repo. Helper scripts: scripts/ci/*.
- Updater: pubkey in tauri.conf.json (private key only in GitHub Secrets, never committed), endpoint `https://github.com/<RELEASES_REPO>/releases/latest/download/latest.json` (placeholder replaced by the workflow). A build that still has the placeholder skips the check. UI: store/appUpdateStore.ts, lib/appUpdate/schedule.ts (5 s delay, once per day, `lastAppUpdateCheck` setting), components/support/AppUpdate{Banner,Card}.tsx, Rust commands/app_update.rs, tauri-plugin-process for relaunch.
- New FFmpeg feature in the app? Add the encoder/decoder/muxer/filter to scripts/ci/ffmpeg-components.sh (never GPL parts: boxblur, eq, noise ...). scripts/fetch-ffmpeg.mjs only downloads a big ready-made FFmpeg for local development.
- EULA: LICENSE-EULA.txt (NSIS licence page via bundle.licenseFile, Settings > About). Release profile: lto, codegen-units 1, panic abort, strip. Public releases repo holds only README.md (text in website/RELEASES_README.md). Sizes: docs/SIZE_REPORT.md.
- Website snippet: website/download-buttons.html. Docs: RELEASE.md, USER_GUIDE.md ("Install and update"), CHANGELOG.md.

## Image Generator (page between Prompt Generator and Auto Editor)
- Design + why: docs/IMAGE_ENGINE_DESIGN.md (study of the reference tool: docs/IMAGE_ENGINE_NOTES.md; the reference source is in git-ignored `vendor/`, never commit it).
- Rust src-tauri/src/imagegen/: browser/ (own CDP client over a hand-written WebSocket: chromiumoxide cannot see cross-site iframes; no new crates), tool_page.rs + worker.rs (one tab per account), accounts.rs, queue.rs/recovery.rs/store.rs (`<project>/imagegen/jobs.json`), engine.rs (scheduler, snapshot, `imagegen-state` event), save.rs (durable PNG save, never overwrite), ops.rs (sign-in, verify, test image), config.rs; commands/imagegen.rs.
- Config: resources/image-engine/config.json (`configVersion` major.minor; new major = consent asked again), a library package kind `image_engine`. Admin: src/admin/EngineConfigCard.tsx (editor + "Test free engine").
- Frontend: src/lib/imagegen/{mapping,register,format,consent,api}.ts (+tests), src/store/imagegenStore.ts (listens to `imagegen-state` and `imagegen-image`, started in App.tsx), src/components/imagegen/, src/pages/ImageGeneratorPage.tsx, Settings card ImageGeneratorCard (+ AccountsPanel: Google accounts are managed in Settings too). API engines (Gemini image, Cloudflare) were REMOVED: Google accounts are the only engine. Two modes on the page: Project scenes (ProjectImagesView) and Only images (OnlyImagesView, lib/imagegen/prompts.ts, `imagegen_start_folder`, `imagegen_preview`; pictures in `<folder>/media`).
- The frontend owns project.json: Rust only saves the file and emits `imagegen-image`; `registerImage` sets editor.media, mediaMap and scene.matchedFile (uses `useProjectStore.update`, not `applyEdit`).
- Rules: no user-agent/webdriver masking; captcha / unusual-activity / terms pages pause the account and show the text; never bypass. Keys only in the keychain. Needs `--no-sandbox` for Chromium tests as root.

## Web chat engine + AI motion graphics
- Chat: src-tauri/src/imagegen/chat.rs (`ask`: fresh Gemini chat per question in a new tab of the account's browser, `Input.insertText`, click Send, done = "Good response" button or stable text; limit/error texts judged only on short answers without code). Selectors/timing/limit texts are in resources/image-engine/config.json `chat` block (configVersion 1.1, updatable by library package). Accounts rest per chat (1,2,4,8,16,30 min): `claim_chat/release_chat`. `ImageGen::chat_ask`, command `imagegen_chat_ask`. Settings `textViaChat` routes `generate_text` (scene groups, bible, prompts) through the chat (`chat_question` puts system + JSON rule into the question).
- Motion: src-tauri/src/motion/{contract,png,capture,generate}.rs + commands/motion.rs (`motion_generate`). AI writes one HTML file (CSS @keyframes or `window.renderFrame(t)`); `wrap_html` adds a CSP (no network) and error collector; `capture` draws it in a temp-profile, offline, transparent browser at the video size, frame by frame (animations paused at t), after 3 test frames are checked (script error, nothing animated, blank, covers the screen, does not move); problems are fed back to the AI, 3 tries. Output: `<project>/motion/<id>/{motion.html,frames/00000.png...}`.
- Render: `RenderRequest.overlays` (framesDir, start, fps) -> `plan::overlay_graph` (filter_complex, overlays below captions); frames are extra image2 inputs. TS: src/lib/motion (+tests), src/components/motion (Motion tab), `EditorData.motion` (read by `readEditor`), `buildOverlays` skips graphics of another picture shape.
- Admin: src/admin/ChatTestCard.tsx asks the chat one real question (checks selectors).
- Chromium tests need `--no-sandbox` as root (`testserver::test_args`).

## Quick Prompts (Prompt Generator without a project)
- The quick session is ONE hidden project with id `quick-session` stored in `app_data/quick/quick-session` (not in `projects/`, never listed). `commands/projects.rs` (`QUICK_ID`, `quick_store`, `store_for`, `project_folder`) routes open/save/folder lookups, so every step (voice, timing, scenes, style, bible, prompts) works on it unchanged. Commands in commands/quick.rs: `quick_open` (creates it the first time, `restored` flag), `quick_reset` (deletes files, keeps style + prompt options), `quick_save_as_project` (`ProjectStore::move_to`: copies the folder, new id + name, deletes the quick one, makes a fresh one with the same style/options).
- TS: src/lib/quick/{textScenes,api}.ts (+tests; P01 ids, `splitTextSentences`, per sentence / line / AI groups, `keepFinishedWork`), src/store/quickStore.ts (last project to return to, "restored" note), src/components/quick/{QuickGenerator,QuickScriptStep,useQuickSession,SaveAsProjectDialog,EngineSwitch}.tsx, src/components/prompt/ProjectSteps.tsx (the five steps, shared by project mode and quick "Voice + timing"), src/pages/PromptGeneratorPage.tsx (switch Project / Quick). Scenes without timing have id `P01`, start = end = duration = 0 (`timecodeOf` returns the id; prompts omit the duration). Auto Editor and Image Generator "Project scenes" refuse the quick session (Save as project first).
- Export: src/lib/prompts/export.ts `copyLines(scenes, {withMotion, emptyLines, includeIds})`, `copyBlock` (one row); settings `exportEmptyLines` (1-3, default 2) and `exportIncludeIds`. "Only images" `parsePrompts` reads `ID | prompt` lines (ids kept: `S01_000.0-005.1` -> job `S01`, file `S01_000.0-005.1.png`; `P01` -> `P01.png`; Rust `mapping.rs` `valid_free_id/valid_free_file_name`) and skips `MOTION:` lines.

## Custom styles from reference images
- Rust src-tauri/src/custom_style/: refs.rs (check PNG/JPG/WebP <= 10 MB, shrink to <= 1024 px JPEG with the bundled FFmpeg into `styles/prep/`, keep pictures + meta.json in `styles/refs/<id>/ref1.jpg...`), analyze.rs (`SYSTEM` instructions following docs/STYLE_GUIDE.md, `build_question`, `parse_answer`: the AI never sets id/name/category/version), package.rs (`.avstyle` = zip made with `library::zip::write_stored`: style.json, meta.json, images/), service.rs (`save`: thumbnail first from the first picture, then refs, then profile; `import`: new id, pictures re-checked and shrunk), mod.rs (`new_id`). Commands in commands/custom_style.rs: prepare_style_image, analyze_style (job `style-analysis`, engines gemini | openai | chat), save_style_with_refs, load_style_refs, duplicate_custom_style, export_style_package, import_style_package; `delete_custom_style` also removes the refs folder. Only pictures inside `styles/prep` or `styles/refs` are accepted from the frontend.
- OpenAI is a new optional provider: `Provider::OpenAi` (keychain `openai-api-key`), api/openai.rs (`test_key`, `vision`), setting `openaiModel` (default gpt-4.1-mini), Settings key card, ExternalLink `openai_keys`.
- Web chat pictures: `chat::ask_with_images` / `ImageGen::chat_ask_images` (max 4). The page's `HTMLInputElement.click` is held back so the system file window never opens; the files go to the input with `DOM.setFileInputFiles`, then the previews are counted. Selectors `attach`, `uploadItem`, `fileInput`, `attachment` and timing `uploadMs` in the chat block of resources/image-engine/config.json (configVersion 1.2). The fake page src-tauri/src/imagegen/testdata/gemini_chat.html has an upload menu.
- Frontend: src/lib/customStyle/{model,api}.ts (+model.test.ts: `splitPictures`, `analyzeWithRetry` = validate with `completeProblems`, retry once with the problems, then return what remains), src/components/styles/custom/ (useStyleCreator, AnalyzeForm, ReviewForm, SamplePrompts, ReferencePictures, CreateStyleModal). StyleStep: Create/Edit/Re-analyze open the modal; a style written by hand (no refs) still uses the simple StyleForm. Gallery My Styles has Create and Import tiles; StyleDetails has Re-analyze and Export. Category default `MY_STYLES` ("My Styles").


## Motion graphics system (GraphicSpec + deterministic renderer; plan and status in docs/MOTION_GRAPHICS.md)
- Spec (phase 1-2): src/lib/graphics/spec/ (own tiny schema library `parse.ts`, `schema.ts` with 16 layer types, `validateSpec` strict, `repairSpec` clamps/drops, `describeIssues`; fixtures/*.json are shared with the Rust mirror src-tauri/src/graphics/spec.rs). Positions are 0..1 fractions of the frame, times are seconds, 30 fps fixed. Add a layer type in TS schema + Rust enum + fixture + tests together.
- Renderer (phase 2): src/lib/graphics/render/ (`renderFrame(spec, frame, ctx, rc)`; pure timing/anim/wrap/fit/script modules with Node tests; draw/* for text, richText, shape, icon, image). One renderer for preview and export. No Math.random / Date / network inside it.
- Golden images: `cargo test golden` (Chromium) compares src/lib/graphics/render/golden/*.png; `UPDATE_GOLDEN=1` rewrites them (check by eye). tsconfig.node.json has the DOM lib only for these types.
- Preview UI: src/components/graphics/ (GraphicLab in the Motion tab). The old AI-writes-HTML motion graphics (src/lib/motion, src-tauri/src/motion) stay working.
- Export (phase 3): TS src/lib/graphics/export/ (`exportGraphic` loop, Worker `renderWorker.ts` + `createFrameSource`, fonts per script) -> raw IPC `graphic_export_*` (src-tauri/src/commands/graphics.rs, graphics/export.rs `GraphicExports`) -> FFmpeg rawvideo pipe -> `<project>/graphics/<id>/clip.mov` (PNG codec, rgba, lossless). `RenderRequest.overlays[]` has `clip` (new) or `framesDir` (AI HTML); `plan::overlay_graph_for` starts clips on an exact frame. `MotionGraphic.kind = "spec"` (+ `clipPath`, `spec`). `rawvideo` demuxer is in scripts/ci/ffmpeg-components.sh. Test helpers: `graphics::export::test_support`.
- The harness bundle (scripts/graphics-harness.mjs) also builds the worker; the Rust golden tests also check worker == page pixels and real-renderer frames -> clip.
- Assets (phase 4): plain data in src/lib/graphics/assets/ (icons/{lucide,tabler,names,tags}.json, flags/*.webp, countries.json, maps/countries-{110m,50m}.json, cities.json), made by scripts/build-graphic-assets.mjs + scripts/build-flags.mjs (not dependencies; licences in THIRD_PARTY_LICENSES.md). Code: src/lib/graphics/library/{icons,flags,countries}.ts and src/lib/graphics/geo/{topo,mapData,projections,cities,route}.ts (hand-written projections, no d3), render/draw/geo.ts. Icons are loaded per set on first use (`ensureIcons` before drawing; the export worker gets `iconsOfSpec`); flags are in the picture map as `flag:XX`. The harness bundle inlines all assets (`assetsInlineLimit`).
- Advanced layers (phase 5): src/lib/graphics/render/draw/{counter,chart,timeline,map,cards,list,progress,particles,kinetic,flag,label,format,common}.ts (one file per layer family; `DrawEnv` = rc + note + timing + pose), geo/camera.ts, map layer `camera` keys (TS schema + Rust spec.rs). Details: docs/MOTION_GRAPHICS.md section 5f.
- Brand kit (phase 6): src/lib/graphics/brand/{model,color,repair,builtin,suggest,choose,theme}.ts (+brand.test.ts), `Theme` has radius/strokeWidth/shadow/headingWeight/headingCase/enter/exit (render/theme.ts, render/defaults.ts `withThemeDefaults`), kits in settings (`brandKits`, `brandKitId`; Rust settings.rs) and `editor.brandKitId`, UI src/components/graphics/brand/ (BrandKitPanel in the Motion tab). The export worker gets the theme in its init message. Details: docs/MOTION_GRAPHICS.md section 5g. Chromium golden tests are serialized (`SERIAL` in golden_tests.rs).
