# Changelog

All notable changes to Auto Video Editor are written here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
