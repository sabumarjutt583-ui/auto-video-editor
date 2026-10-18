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
cargo test                                   # Rust tests (needs the sidecars for the FFmpeg ones: npm run setup:ffmpeg)
cargo test --features admin                  # adds the Admin Edition tests
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
| 16: Install and release | Build the installers (RELEASE.md). On a clean Windows PC, install the `-setup.exe` and do: new project → voice → timing → scenes → prompts → import media → render. Check the first-run screens, Check for app update, Export logs. | Everything works with nothing else installed. Export logs gives a file without keys. |

## 4. Performance (20-minute voice, 200 scenes)

| Part | How it is checked | Target |
| --- | --- | --- |
| Read timings, align 3,000 words, build ~260 scenes, write prompts in batches, export, plan the render | `npm run test:ts` (file `src/lib/perf.test.ts`, prints the milliseconds with `node --test src/lib/perf.test.ts`) | each part far below one second, so the screen never waits |
| Groq transcription of 20 minutes | chunked in Rust (`timing.rs`); a background job with progress and Cancel | the UI stays responsive (all work is in Rust jobs) |
| Prompt generation | 200 scenes = 10 requests of 20 scenes, one after another, finished batches are saved | progress bar per batch |
| 1080p render | `cargo test --release performance_20_minutes -- --ignored --nocapture` | finishes; length equals voice; the window stays responsive |

## Results of the last full run

Run date: 2026-10-18 (Linux sandbox, headless).

| Check | Result |
|---|---|
| `npx tsc -b` | clean, no errors |
| `npm run test:ts` | 143 passed, 0 failed |
| `cargo build` (user) / `--features admin` | no warnings |
| `cargo test` (user) | 220 passed, 0 failed |
| `cargo test --features admin` | 233 passed, 0 failed |
| User build has no admin/Freesound strings (dist + binary) | 0 matches |
| Admin build: Admin page, package build, install in user build via "Check for library update" | works (sfx v2 and styles v2 installed) |
| Onboarding (3 screens, Skip for now), logs written, App-update error with Details | works |
| Performance: 20 min voice, 200 scenes, 1080p, 30 fps, captions, mixed transitions (release, CPU OpenH264, 2-core sandbox) | 1309 s wall, 1122 MB, output exactly 1200.000 s (ok), 3217 progress events, UI stays responsive (work is in Rust jobs) |

Bugs found and fixed in this run: log redaction swallowed the full stop after a key; the Admin build did not register the logs and app-update commands.

Not tested here: Windows installer and a clean Windows PC, GPU encoders, real Groq/Gemini/Freesound network calls, the updater install path (needs https and signed files), real audio playback, 4K speed.
