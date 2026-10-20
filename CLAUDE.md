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
- Video/audio engine: FFmpeg + FFprobe bundled as Tauri sidecar binaries (LGPL build)
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
src-tauri/binaries/: ffmpeg, ffprobe sidecars
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
- Rules for every new style profile: docs/STYLE_GUIDE.md. Reference: resources/styles/cinematic_realism.json. ALL 51 built-in styles are complete (batches 1-5); the list is docs/STYLES_LIST.md (generated by `npm run styles:list`). Bundled styles package version: resources/styles/package.json (integer, now 6; skipped by the style loader and tests). Use the existing stub ids (black_and_white_photography, 2d_animation, 2d_cartoon, japanese_ukiyo_e, sci_fi_concept_art, hyper_realistic_3d_render).
- Picker order inside a category: `STYLE_ORDER` in src/lib/styleModel.ts (most popular first; custom styles after, by name). A test makes sure every shipped style is listed once.
- Checks: src/lib/styleChecks.ts (pure rules, `BANNED_NAMES`) + src/lib/styleProfiles.test.ts (`EXTRA_BANNED` list). `npm run styles:check` prints a table (style, complete/incomplete, problems) and runs the tests. A style is "complete" when all text fields are filled; complete styles must pass all rules (style_lock 12-25 items, no aspect ratio; negative 12-25 items, nothing shared with style_lock; example_prompt 60-100 words ending with style_lock; mood 4-6 items; no banned names; id = file name). Also tested: all 51 are complete, and no two styles of one category share more than 50% of their style_lock words.
- Style Test (Admin only): src/admin/StyleTestCard.tsx runs generatePrompts on resources/style-test/sample_story.txt (5 lines, imported with `?raw` into the lazy admin chunk); logic in src/lib/prompts/styleTest.ts.
- Renamed style: `pixar_inspired_3d` is now `animated_film_3d` ("3D Animated Film"); project schema v3 (src-tauri/src/project/migrate.rs `v2_to_v3`) maps old `styleId` values. No brand names anywhere.

## Style Gallery (thumbnails)
- Picker is a modal gallery: src/components/styles/{StyleGallery,StyleCard,StyleCurrentCard,StyleThumbnail}.tsx; pure logic src/lib/{styleGallery,styleThumbnails}.ts (+tests). Favorites and last-6 recents live in settings (`styleFavorites`, `recentStyles`).
- Thumbnails: resources/styles/thumbnails/<id>.webp (480x360), converted by Rust src-tauri/src/thumbnails.rs with the bundled FFmpeg; missing file -> colour placeholder. Packages may carry `thumbnails/<id>.webp`. Custom styles: `set_custom_style_thumbnail`.
- Admin: src/admin/ThumbnailsCard.tsx (export prompts / import pictures, `admin_import_thumbnails`). `npm run styles:thumbnails` writes docs/thumbnail-prompts.txt. `styles:check` only WARNS about missing thumbnails.
