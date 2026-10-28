# Changelog

All notable changes to Auto Video Editor are written here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers follow [Semantic Versioning](https://semver.org/).

## [0.7.3] - 2026-10-28

### Fixed
- Rust compile error E0283 in the graphics overlay (commands/graphics.rs, graphics_apply_overlay): the FFmpeg error text was built with `.chars().take(600).collect()`, whose type the compiler could not infer, since AppError::new takes `impl Into<String>`. The line now uses `.collect::<String>()` explicitly. This is a side-effect of the 0.7.2 restructure, which removed the run_blocking wrapper whose final `Ok::<_, AppError>(output)` had given the compiler a type hint; no feature or logic change.

## [0.7.2] - 2026-10-28

### Fixed
- Rust compile errors that stopped the v0.7.1 Windows release build (9 errors, no feature or logic change): Edge TTS now uses std::process::Stdio instead of the private tokio::process::Stdio (api/edge_tts.rs); ChatGPT custom style now wraps to_app_error in a closure at both call sites, as script.rs and chatgpt.rs already do (commands/custom_style.rs); key rest now wraps set_rest_until in Ok(...) for run_blocking (commands/keys.rs); graphics overlay now runs the tokio FFmpeg command directly in the async function with .await instead of inside a synchronous run_blocking closure (commands/graphics.rs); Flow Batch queue progress now reads snapshot["done"] and snapshot["total"] with as_u64() directly, since serde_json::Value has no and_then (imagegen/flow_batch_run.rs); API Monitor now calls VecDeque::new() with parentheses (api/monitor.rs); jobs test now clones the Arc sink before its first use so it is not moved before the second use (jobs.rs)
- Removed a duplicated #[test] attribute warning (imagegen/config.rs)

## [0.7.1] - 2026-10-28

### Fixed
- Graphics font path escapes in src-tauri/src/commands/graphics.rs (find_font): the backslash character literal and the escaped colon string were written with single backslashes, which Rust rejected as error E0762 unterminated character literal and stopped the v0.7.0 Windows release build. The line now uses '\\' for the backslash and "\\:" for the colon, so Windows font paths are converted to slashes and the colon is escaped for FFmpeg drawtext as intended.

## [0.7.0] - 2026-10-28

### Added
- Dashboard page with the 7-step progress bar (Script Writing, Voice Generation, SRT Generation, Image Prompts, Image Generation, Video Editing, Export & Verify), per-project buttons, finished-video duration and size, pause between steps, and Show Live Claude, API Monitor, Open Script and Open Document
- Claude Script Writing as Step 0 of a new video, with per-channel master prompts, multiple Claude accounts with rotation, and per-channel Claude account picks
- Microsoft Edge TTS as a direct, opt-in voice provider (Gemini remains the default), with Korean and Spanish voices
- ChatGPT web chat for custom styles, replacing the OpenAI API-key option (a saved OpenAI key is kept, old openai-engine styles load but return a friendly error)
- Batch Flow Studio in Flow's place: automated batch run loop, live Omni/Veo credit table with a credit guard, default Omni 1.1 Flash, and Flow file renaming to scene timecode names
- Project Images and Project Subtitles pages (project-scoped regenerate and caption overrides)
- Clear bible and Delete unused for the character bible, with an unused-entry notice
- Motion-graphics overlay as a post-render pass for text and lower-third layers only
- Crash resume at stage level, and persistent rest times with user-set back-online times for Groq/Gemini keys and Claude accounts
- API key cap raised from 10 to 50 slots for Groq and Gemini

### Changed
- Prompt generation: parallel batches share one job id safely, and a successful batch is kept even if another parallel batch fails
- Make Video pipeline logic, graphics-director plan, and ping-pong clip fit (the clip fit needs the new sidecar in this release)

### Fixed
- Groq text model replaced with openai/gpt-oss-120b (the old llama-3.3-70b-versatile model is no longer served to free/developer tiers)
- Quick-session voice playback HTTP 403: $APPDATA/quick/** added to the asset protocol scope
- Prompt Generator "That job is already running" error on parallel batches
- Urdu captions stay on Noto Sans Arabic (libass cannot draw Nastaliq, so it showed boxes)

## [0.6.1] - 2026-10-25

### Changed
- Several API keys for Gemini and Groq with automatic switch; Gemini or Groq writes the texts; remove web-chat prompts
- Script writer: Claude web chat for scripts only, per-channel master prompt, topics in the queue
- Batch queue: many scripts, made one after another
- Short video clips: slow down then repeat (or repeat / hold); long clips are cut at the end
- New project asks for a channel and applies its settings
- Channels dashboard: one sidebar item, all-channels page, channel page with video progress
- Make Video: channel profiles and a one-click pipeline (voice to final MP4)
- Flow: scroll the New project tile into view and accept an icon-name prefix (config 1.6)
- Find Gemini's + button by place when its label changes; play the voice sample from a blob address

## [0.6.0] - 2026-10-25

### Changed
- Make the voice-over inside the app with Gemini speech models (30 voices, model choice, listen first)
- Videos with Google Flow next to Gemini Create video
- Web chat waits longer and asks the same batch again by itself; polite pause between batches
- Faster prompts with the Gemini API key: smaller batches, two at a time
- Fix: a browser left open on an account profile is closed and started again
- Images: one Google account at a time (setting)
- Every error is written to the log, with the page it happened on

## [0.5.0] - 2026-10-25

### Changed
- Voice-over in named parts, up to 20 style reference pictures
- Web chat part 9: tests and docs
- Web chat part 8: delete images
- Web chat part 7: delete prompts
- Web chat part 6: manual copy-paste mode
- Web chat part 5: script text and minimum scene length
- Web chat part 4: setup + batches with reminders + verified full prompts
- Web chat part 3: reliable chat driver
- Web chat part 2: hidden shared browser
- Web chat part 1: diagnosis
- Motion graphics phase 13: end-to-end tests and docs
- Motion graphics phase 12: cache and parallel render
- Motion graphics phase 11: graphic sound effects
- Motion graphics phase 10: editing and presets
- Motion graphics phase 9: quality checks
- Motion graphics phase 8: smart placement
- Motion graphics phase 7: AI graphics director
- Motion graphics phase 6: brand kit
- Motion graphics phase 5: advanced layers
- Motion graphics phase 4: icons, flags and maps
- Motion graphics phase 3: transparent export and composite
- Motion graphics phase 2: renderer core
- Motion graphics phase 1: GraphicSpec schema and validation
- Motion graphics phase 0: audit and plan

## [0.4.0] - 2026-10-22

### Added
- Custom styles from reference pictures: Style Gallery > My Styles > Create style. Give a name and 3 or 4 pictures (PNG, JPG, WebP, up to 10 MB, drag and drop), optionally a few words about the look, and press "Analyze with AI". Gemini (your key), OpenAI (your key, new optional key in Settings with its own model setting) or Gemini's web chat (Google accounts, pictures uploaded through the page's own upload) writes the full style profile from what the pictures have in common. The result is checked with the same rules as `npm run styles:check`; if it breaks any, the AI is asked once more with the list of problems, then the remaining errors are shown. Review screen: every field editable, Regenerate, and Test style (3 sample prompts, shows whether each ends with the style lock). The style is saved with its pictures (so it can be re-analyzed), its thumbnail is made from the first picture, and it works everywhere like any other style.
- My Styles: Edit, Duplicate, Re-analyze, Delete, Export and Import. Export writes one `.avstyle` file (a zip with the profile, notes and pictures); Import adds it as a new style and never replaces one.
- Quick Prompts: the Prompt Generator works without a project. Paste a script (any language) and get prompts P01, P02 ... per sentence (1 to 4 per prompt), per line, or per scene (the AI groups sentences). Or add a voice and timing and get timecode ids. The session saves itself and is restored when you reopen the app. "New quick session" clears it; "Save as project" moves everything (script, voice, timing, scenes, cast, style, prompts) into a normal project.
- Copy all and Export TXT put empty lines after every prompt (1, 2 or 3, default 2), with a MOTION line directly under its prompt and an "Include IDs" switch. "Copy row" copies one prompt only.
- Image Generator "Only images": text copied with Copy all can be pasted back (one picture per prompt, ids like S01_000.0-005.1 or P01 become the picture names, MOTION lines are ignored).

### Added
- Web chat engine: Gemini's chat in the browser, through the same Google accounts as the Image Generator. No API key. Accounts that reach a limit rest, the question moves to the next account. Settings > Text engine switches scene groups, characters and prompts between the Gemini API key and the web chat.
- AI motion graphics (Auto Editor > Motion): Gemini writes a new animation for a scene (any kind of graphic, nothing is a fixed template). It is checked in a hidden offline browser (errors, empty, covers the screen, does not move; up to 3 tries), drawn to transparent frames at 1080p / 30 fps and laid over the video when you render, below the captions.

### Changed
- Release workflow: a manual run builds Windows only by default (choose `all` for every platform).

## [0.3.0] - 2026-10-21

### Changed
- Image Generator now uses Google accounts only. The Gemini image API and Cloudflare FLUX engines (and the fallback) were removed; the Gemini key stays for scenes and prompts.
- Google accounts (add, sign in, verify, test) are also in Settings.

### Added
- "Only images" mode: paste your own prompts (`Prompt 1:` blocks or one per line), pick a folder and shape, and the pictures are saved in `<folder>/media` as `Image 001.png`. No project needed. "Project scenes" mode is unchanged.

## [0.2.0] - 2026-10-21

### Added
- Image Generator page (between Prompt Generator and Auto Editor): makes one picture per scene and saves it as `S01_000.0-005.1.png` in the project, so the Auto Editor timeline fills by itself.
- Free engine: Gemini's image tool through your own Google accounts (any number, taken in turn, each with its own usage-limit pause), with a one-time notice. The browser is driven by a small built-in DevTools client (no extra download).
- API engine: Gemini image model (editable name) or Cloudflare FLUX, also as automatic fallback.
- Crash-safe queue: pictures are never made twice, a limit on one account pauses only that account.
- Style gallery now shows a picture for every one of the 51 styles (styles package version 7).
- Engine settings are a library package (`resources/image-engine/config.json`); the Admin Edition can edit and test them.

### Changed
- Image Generator: makes a picture for every scene with your own Google accounts (free) or an API key, and puts it in the Auto Editor timeline
- Style gallery now shows a picture for all 51 styles

## [0.1.2] - 2026-10-20

### Changed
- Smaller installers: FFmpeg is now a small LGPL build with only the parts the app uses, FFprobe is gone (files are read with FFmpeg), and the release build is optimized for size.
- The release workflow runs a 5-second smoke test with every feature and checks the installers for source code, source maps, env files and keys.

### Added
- License agreement (EULA) on the Windows installer and in Settings > About.
- Test downloads in the Actions tab are now one single file per system.

### Removed
- Two leftover files from an older style picker and the old 3D style id.

## [0.1.1] - 2026-10-20

### Added
- Style Gallery with thumbnails, favorites and recently used styles.
- Automatic builds for Windows, macOS and Linux, free downloads from a public releases repository, and an in-app update button.

### Changed
- Style Gallery with thumbnails, favorites and recently used styles
- Automatic builds for Windows, macOS and Linux
- In-app update button and free download links

## [0.1.0] - 2026-10-18

### Added
- First complete version: Prompt Generator, Auto Editor, captions, audio mix, render, library updates, support tools.
