# Auto Video Editor

A desktop app (Windows first; also builds for macOS and Linux) for creators of faceless narration videos in many languages.

1. **Prompt Generator**: add a voice-over and a script (or an SRT/JSON timing file). The app gets exact word timings, cuts the narration into scenes and writes style-locked image/video prompts. Every prompt starts with a timecode such as `S01_000.0-005.1`.
2. **Auto Editor**: drop a folder of pictures/clips named with those timecodes. The app builds the timeline, adds captions, Ken Burns motion, transitions, music with ducking and sound effects, and renders the final MP4.

Stack: Tauri 2, React 18 + TypeScript (strict) + Vite + Tailwind, Zustand, Rust (tokio, serde, reqwest, keyring), FFmpeg as the bundled sidecar (LGPL build). No FFprobe is bundled: files are read with `ffmpeg -i` (see `src-tauri/src/probe.rs`). No Python, no Electron. See `CLAUDE.md` for the project rules.

## Set up for development

You need:

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20 or newer | with npm |
| Rust | stable (1.77+) | `rustup` |
| Windows | Microsoft C++ Build Tools, WebView2 | Windows 10/11 already have WebView2 |
| Linux | `webkit2gtk-4.1`, `libsoup-3.0`, `libgtk-3`, `libayatana-appindicator3`, `librsvg2`, `libssl` dev packages | see the Tauri prerequisites page |
| macOS | Xcode command line tools | |

```bash
npm install
npm run setup:ffmpeg      # downloads LGPL FFmpeg into src-tauri/binaries (checked with SHA-256)
npm run tauri dev         # starts the app with hot reload
```

`npm run tauri dev` also runs `setup:ffmpeg --if-missing` first, so the second command is optional.

### Keys

The app uses two free keys that every user enters in **Settings** (they are saved only in the operating-system keychain, never in files):

- Groq (Whisper word timings): <https://console.groq.com/keys>
- Google Gemini (scenes, character bible, prompts): <https://aistudio.google.com/apikey>

Without keys you can still import an SRT/JSON timing file, cut scenes by sentence or seconds, import media, edit and render.

## Tests and checks

```bash
npm run test:ts                       # pure logic: parsers, alignment, timecodes, scenes, prompts, audio plan, render request, performance
npx tsc -b                            # TypeScript strict type check
cd src-tauri && cargo test            # Rust tests (FFmpeg integration tests run when the sidecars are installed)
cd src-tauri && cargo build           # must finish with no warnings
cd src-tauri && cargo test --features admin   # also tests the Admin Edition
```

A long performance test (20-minute video, 200 scenes, 1080p render) is ignored by default:
`cd src-tauri && cargo test --release performance_20_minutes -- --ignored --nocapture`.

The full checklist for every phase is in [TESTING.md](TESTING.md).

## Folders

```
src/                  React app: pages/, components/, store/, lib/ (pure logic + tests), types/, admin/ (Admin Edition only)
src-tauri/src/imagegen/ Image Generator: browser/ (own DevTools client), queue, scheduler, accounts, save, API engines (docs/IMAGE_ENGINE_DESIGN.md)
src-tauri/src/        Rust: commands/, api/, audio/, captions/, media/, render/, library/ (updates), admin/ (feature "admin"),
                      jobs.rs, ffmpeg*.rs, keys.rs, settings.rs, logging.rs, styles.rs, sfx.rs, timing.rs, project/
src-tauri/binaries/   FFmpeg sidecar only (downloaded, not in git; no FFprobe sidecar)
resources/image-engine/ settings of the free image engine (config.json, updated as a library package)
resources/styles/     built-in style profiles (JSON)
resources/sfx/        built-in sound effects + index.json + package.json (made by scripts/make-sfx.mjs)
resources/fonts/      Noto Sans, CJK (KR, JP, SC), Devanagari, Arabic
scripts/              fetch-ffmpeg.mjs, make-sfx.mjs, set-version.mjs
```

## Two builds: user and admin

- **User build** (`npm run tauri build`): the app people install. It has no Admin menu and no admin code or strings.
- **Admin Edition** (`npm run dev:admin`, `npm run build:admin`): adds an Admin page to find CC0 sounds on Freesound, normalize them, and build `sfx-library-<version>.zip` + `manifest.json` (and a styles package). It is compiled with the Cargo feature `admin` and the Vite flag `VITE_ADMIN=true`, uses its own app identifier (`com.autovideoeditor.admin`) and its own data folder, and is never given to users. The Freesound key is saved in the keychain of the admin's computer.

How the pieces are published is described in [RELEASE.md](RELEASE.md).

## Where things are saved

- Projects: `<app data>/projects/<id>/` (project JSON, voice, media, exports).
- Settings: `<app data>/settings.json` (no secrets).
- Keys: OS keychain only.
- Downloaded sound/style packages: `<app data>/library/` (the previous version is kept for rollback).
- Logs: `<app data>/logs/app.log` (rotates; no keys). Settings → Help and logs → **Export logs** makes one file for support.

`<app data>` is `%APPDATA%\com.autovideoeditor.app` on Windows, `~/Library/Application Support/com.autovideoeditor.app` on macOS and `~/.local/share/com.autovideoeditor.app` on Linux.

## Notes for maintainers

- The bundled FFmpeg is an LGPL build without libx264, so the CPU H.264 encoder is **libopenh264** (bitrate based). Graphics-card encoders (NVENC, QSV, AMF, VideoToolbox) are used when a test encode works. Setting: Settings → Video encoding → "Always use the CPU".
- SHA-256, CRC-32, inflate and zip reading/writing are small hand-written modules (`src-tauri/src/library/`), to avoid adding dependencies.
- New dependencies need approval (see `CLAUDE.md`). The updater plugin (`tauri-plugin-updater`) was added in Phase 16 because the phase asked for it.
