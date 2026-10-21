# Changelog

All notable changes to Auto Video Editor are written here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Image Generator page (between Prompt Generator and Auto Editor): makes one picture per scene and saves it as `S01_000.0-005.1.png` in the project, so the Auto Editor timeline fills by itself.
- Free engine: Gemini's image tool through your own Google accounts (any number, taken in turn, each with its own usage-limit pause), with a one-time notice. The browser is driven by a small built-in DevTools client (no extra download).
- API engine: Gemini image model (editable name) or Cloudflare FLUX, also as automatic fallback.
- Crash-safe queue: pictures are never made twice, a limit on one account pauses only that account.
- Engine settings are a library package (`resources/image-engine/config.json`); the Admin Edition can edit and test them.

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
