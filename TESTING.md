# Test checklist

Two kinds of checks:

- **Automatic** (run these first, they take a few minutes) and
- **By hand** (each phase's acceptance test, done in the running app).

Results of the last full run are at the end of this file.

## 1. Automatic checks

```bash
npx tsc -b                                   # TypeScript strict, no errors
npm run test:ts                              # pure logic tests (Node test runner)
cd src-tauri
cargo build                                  # no warnings (user build)
cargo build --features admin                 # no warnings (admin build)
cargo test                                   # Rust tests (needs the sidecar for the FFmpeg ones: npm run setup:ffmpeg)
cargo test smoke_test -- --nocapture         # 5-second project with every feature (CI runs it with the installer FFmpeg)
cargo test --features admin                  # adds the Admin Edition tests
cargo test imagegen                          # Image Generator: queue, scheduler, real Chromium against a fake Gemini page (needs Chromium; skips when none is found)
cargo test --release performance_20_minutes -- --ignored --nocapture   # 20 min, 200 scenes, 1080p (slow)
```

What they cover: parsers (SRT/VTT/JSON), word alignment, timecodes, scene splitting, style parsing, bible, prompt assembly and batching, export formats, media matching, editor boundaries and undo, caption layout, ASS output, audio planning (SFX), mix request, render request and plan (frame-exact lengths), transitions, FFmpeg progress, job cancel, SHA-256/CRC-32/zip/inflate, library install/rollback/update (against a local test server), settings validation, log rotation and key hiding, Freesound CC0 filter, sound normalization (-16 LUFS), package building, and the admin-to-user package round trip.

## 2. User build and admin build separation (Phase 15)

```bash
rm -rf dist && npx vite build
grep -rlE "Freesound|admin_overview|admin_search|Admin Edition|Build library package" dist   # must print nothing
strings -a src-tauri/target/debug/auto-video-editor | grep -ciE "freesound|admin_overview|admin_search|autovideoeditor.admin"  # must print 0 (after a normal `cargo build`)
npx vite build --mode admin && grep -rl "Build library package" dist      # prints the admin chunk
```

### Checks of the final release setup

```bash
bash scripts/ci/verify-ffmpeg.sh src-tauri/binaries <target-triple>          # every FFmpeg part from ffmpeg-components.sh is present, LGPL only
node scripts/ci/check-bundle.mjs <installer>                                 # no *.ts *.tsx *.rs *.map .env* *.key src/ inside; prints sizes
npm run test:scripts                                                         # release helper tests
git log --all -p -G"PRIVATE KEY|gsk_|AIza|ghp_|github_pat_"                  # no secret was ever committed (prints nothing)
```

## 3. Acceptance tests by phase (by hand)

Use a short voice file (30 to 120 seconds) and its script. Korean, Japanese, Nepali and Urdu samples are good for the caption phases.

| Phase | What to do | You should see |
| --- | --- | --- |
| 1 to 3: shell, Settings, Projects | Start the app. Click every sidebar item. Create, rename, duplicate and delete a project; close and reopen the app. Save a Groq key, press Test Key, delete it. | Dark theme with purple accent, all pages open, "Engine: ready", projects and settings are still there after a restart, keys show only "Key saved" and are never shown again. |
| 4: Voice | Add a 2-minute voice with pauses. Preview the silences, Apply, play the new file, then Lock. Restart the app. | Silences are marked, the new file is shorter and natural, Lock disables the controls, everything is remembered. |
| 5: Timing | Paste the script. Get timings with Groq (or upload an SRT/JSON). Play the preview. Try a wrong SRT. | The highlighted word follows the voice; a wrong SRT shows the mismatch warning. |
| 6: Scenes | Try per-sentence, per-seconds and AI modes. | Switching is instant (AI shows a spinner). No gaps or overlaps. The last scene ends exactly at the voice length. |
| 7: Styles | Open the style picker. Create a custom style. | 51 built-in styles grouped; placeholders show "Incomplete"; the custom style can be chosen. |
| 8: Bible | Use a family-story script. | The main people are found with fixed English descriptions; they can be edited; each scene shows who appears. |
| 9: Prompts | Generate for all scenes. Export TXT, CSV, JSON; Copy all. | Every prompt starts with its timecode and ends with the same style words; each character's description is identical everywhere. |
| 10: Media | Drop correctly named files; drop randomly named files and use Bulk Rename; delete one file afterwards. | Named files match 100% at once; Bulk Rename gives the right names; the deleted file shows a red warning; a short clip is flagged. |
| 11: Editor | Press play; drag the edge between two scenes; press Ctrl+Z. | Preview runs with the voice; both neighbours change; undo restores; it is all still there after a restart. |
| 12: Captions | Test Korean, Japanese, Nepali and Urdu scripts; export SRT. | No boxes (□) in the preview and in the video; the spoken word is highlighted; the SRT opens with correct times. |
| 13: Audio | Add music, build the audio mix. Edit some SFX on the timeline. | The voice stays clear over the music; SFX sit at scene changes and can be moved; the mix measures about -14 LUFS. |
| 14: Render | Render 2 minutes with music, SFX and transitions at 1080p. Press Cancel in another run. Try Shorts. | Video length equals voice length (±0.1 s); captions burned in; Cancel stops and leaves no temp files; a graphics-card encoder is used when present; Shorts is 9:16. |
| 15: Library and Admin | User build: no Admin menu (see section 2). Admin build: save a Freesound key, search, add a CC0 sound, build a package. Serve the package folder over HTTPS (or `http://127.0.0.1`), put its address in Settings → Library updates, press Check for library update. Then Go back to the version before. | The package installs (version goes up, sounds appear), a damaged zip is refused, rollback works. |
| Image Generator | Add a Google account, Sign in, Verify, Test image. Press Generate all scenes on a project with prompts. Kill the app in the middle and start it again. Add a second account and wait for a limit; tick "continue with API" and remove the browser. | S01_...png for every scene appear in the project media folder and in the Auto Editor; after the crash it continues with no duplicate files; a limit pauses only that account; the API makes the rest. **Not tested against real Gemini from the build sandbox: do this row on a real PC.** |
| 16: Install and release | Build the installers (RELEASE.md). On a clean Windows PC, install the `-setup.exe` and do: new project → voice → timing → scenes → prompts → import media → render. Check the first-run screens, Check for app update, Export logs. | Everything works with nothing else installed. Export logs gives a file without keys. |

## 4. Performance (20-minute voice, 200 scenes)

| Part | How it is checked | Target |
| --- | --- | --- |
| Read timings, align 3,000 words, build ~260 scenes, write prompts in batches, export, plan the render | `npm run test:ts` (file `src/lib/perf.test.ts`, prints the milliseconds with `node --test src/lib/perf.test.ts`) | each part far below one second, so the screen never waits |
| Groq transcription of 20 minutes | chunked in Rust (`timing.rs`); a background job with progress and Cancel | the UI stays responsive (all work is in Rust jobs) |
| Prompt generation | 200 scenes = 10 requests of 20 scenes, one after another, finished batches are saved | progress bar per batch |
| 1080p render | `cargo test --release performance_20_minutes -- --ignored --nocapture` | finishes; length equals voice; the window stays responsive |

## Results of the last full run

Run date: 2026-10-20 (Linux sandbox, headless) and CI run 39469678995.

| Check | Result |
|---|---|
| `npx tsc -b` | clean, no errors |
| `npm run test:ts` | 219 passed, 0 failed |
| `npm run test:scripts` | 8 passed, 0 failed |
| `cargo test` (user) / `--features admin` | 234 / 250 passed, 0 failed, no warnings |
| Workflow lint (actionlint) | clean |
| CI: small FFmpeg builds (Windows, Linux, macOS arm64 + x86_64), LGPL check, part list check | pass |
| CI: 5-second smoke test with every feature (captions in 6 scripts, ducking, SFX, loudnorm, silence detection) on Windows, Linux, macOS | pass |
| CI: bundle check (no source, maps, env files, keys) on all installers | pass |
| CI: publish job | stops on purpose: "already has a published release v0.1.1" (a new version is needed) |
| Installer sizes | Windows exe 36.0 MB, msi 45.5 MB, dmg 47 MB, AppImage 122.7 MB, deb 43.8 MB (docs/SIZE_REPORT.md) |

Bugs found and fixed in this run: log redaction swallowed the full stop after a key; the Admin build did not register the logs and app-update commands.

Not tested here: Windows installer and a clean Windows PC, GPU encoders, real Groq/Gemini/Freesound network calls, the updater install path (needs https and signed files), real audio playback, 4K speed.

### Image Generator run (2026-10-21, Linux sandbox)

`cargo test` 358 / `--features admin` 374 passed, no warnings; `npm run test:ts` 231 passed; `tsc` clean. Covered with a real Chromium against a fake Gemini + tool page: cross-process iframe, parallel prompts, aspect (9:16 gives 72x128), 429 / no image / 500 / 400 errors, timeout, lost card, browser death and reopen, signed-out detection. Scheduler: round-robin, per-account 429, API fallback, no duplicates, pause/resume, crash resume, storage pause, parallel limits. Not tested: real Gemini (needs a Google account), Windows sign-in window handling.

## Style system checks
- `npm run styles:check`: table with 51 complete and 0 incomplete styles; the 5 style tests pass.
- Admin Edition (`npm run dev:admin`) > Admin > Style Test: pick Cinematic Realism, press Run test (needs the Gemini key). Expect 5 prompts (S01 to S05), all ending with the style lock; Copy and Export TXT work.
- User build: `grep -rlE "Style Test|sample_story" dist` prints nothing.
- Not tested here: the real Gemini call of Style Test (no key/network in the sandbox).
- Batch 1 sample prompts (docs/style-tests/batch1.txt) still have to be generated with Admin > Style Test (needs the Gemini key).
- Batch 2 sample prompts (docs/style-tests/batch2.txt) also still need Admin > Style Test. Open an old project saved with the old 3D style id: it must now show 3D Animated Film.
- Batch 3 sample prompts (docs/style-tests/batch3.txt) also still need Admin > Style Test.
- Batch 4 sample prompts (docs/style-tests/batch4.txt) also still need Admin > Style Test.
- Batch 5 sample prompts (docs/style-tests/batch5.txt) still need Admin > Style Test.
- Styles package: `STYLES_PACKAGE_OUT=<folder> cargo test --features admin the_shipped_styles_make` builds styles-package-<version>.zip + manifest from resources/styles and installs it into a temp user folder (51 styles load).

### Web chat + motion graphics run (2026-10-21, Linux sandbox)

`cargo test` 382 passed (`--features admin` builds without warnings); `npm run test:ts` 243 passed; `tsc` clean; user bundle has no admin code. Real Chromium against a fake Gemini chat page: answers, code blocks, fresh chat per question, usage limit -> rate limit, answer that never starts, stable-text fallback. Motion: CSS and `renderFrame` graphics drawn frame by frame with transparency, blank / screen-covering / static / throwing / not-animated graphics rejected with a reason, retry feeds the reason back, three failures give a friendly error. Render: an overlay appears at its start time, is gone after its last frame (pixel checks).

Manual checks on a computer with a Google account:
- Settings > Text engine > Web chat, then Prompt Generator "Generate prompts": answers arrive without a Gemini key. If nothing is typed or the answer is never read, the Gemini page changed: update the `chat` selectors in resources/image-engine/config.json (library package `image_engine`).
- Auto Editor > Motion > Make a motion graphic; check the preview, render, and that the graphic sits over the picture and under the captions.
- Not tested: the real Gemini page (selectors come from a DOM capture), the real "limit reached" text, the small production FFmpeg (all parts the overlay needs are in scripts/ci/ffmpeg-components.sh).

### Quick Prompts + empty-line export (2026-10-22, Linux sandbox)

`cargo test` 384 passed, no warnings (also `--features admin`); `npm run test:ts` 259 passed; `npm run build` (tsc -b + vite) clean. Covered by tests: text scenes (sentences in English, Korean, Japanese, Urdu; per sentence 1-4, per line, AI groups, P ids), quick folder kept apart from the projects list, restart restore, Save as project with timing (S ids, words, style kept) and without (P ids), Copy all with 1/2/3 empty lines, Include IDs off, MOTION under its prompt, single row copy, paste back into Only images (one job per prompt, ids kept, MOTION skipped).

Manual checks (the screen itself was not run in the sandbox): open the app with no project > Prompt Generator shows Quick prompts; paste text > Build > Style > Prompts; close and reopen the app (session restored note); Save as project > Image Generator and Auto Editor open it; paste Copy all text into Notepad (2 empty lines) and into Image Generator > Only images.

### Custom styles from reference pictures (2026-10-22, Linux sandbox)

`cargo test` 409 passed, no warnings (also `--features admin`); `npm run test:ts` 269 passed; `npm run build` (tsc -b + vite) clean. Covered by tests: picture checks (type, empty, 10 MB), shrinking to 1024 px with the real sidecar FFmpeg (big pictures shrunk, small ones not enlarged), storing/replacing/copying/removing reference folders, the AI instructions and answer reading (code fences, lists, wrong keys, id/name/category never taken from the AI), the OpenAI request (key in the header, data-URL pictures, JSON mode), the validate-then-retry-once flow (a passing answer is asked once, a failing one twice with the problems and the earlier answer, never a third time), `.avstyle` round trip and refusal of damaged or unsafe files, and the whole life on disk with real FFmpeg (save with 480x360 WebP thumbnail, listed after a "restart", export, import as a second style, delete). The chat picture upload was tested in a real Chromium against the fake chat page (pictures reach the question; missing files and more than 4 pictures are refused).

Manual checks (the screen itself was not run in the sandbox, and no real Gemini/OpenAI/Google page was reached): upload 3 pictures of one look > name > Analyze > review > Save; the style shows in My Styles with its thumbnail; write prompts with it (they end with its style lock); close and reopen the app; Export the style, delete it, Import the file. With the web chat: check that the upload button selectors in `resources/image-engine/config.json` (`chat.selectors.attach`, `uploadItem`, `fileInput`, `attachment`) still match the real page (Admin > Chat test).
