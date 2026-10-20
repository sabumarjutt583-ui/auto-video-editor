# Size report

## Before (version 0.1.1, published Windows installer)

Installer `Auto Video Editor_0.1.1_x64-setup.exe`: **116.8 MB** (116,843,943 bytes). Unpacked: 196.4 MB in 96 files.

| Part | Unpacked size |
| --- | ---: |
| `ffmpeg.exe` (full BtbN LGPL build) | 134.1 MB |
| Fonts (Noto Sans, KR, JP, SC, Devanagari, Arabic; Regular + Bold) | 37.8 MB |
| Main program (Rust app + web UI) | 18.7 MB |
| Sound effects (21 WAV files) | 3.6 MB |
| WebView2 bootstrapper | 1.9 MB |
| Styles (51 JSON files; no thumbnails yet) | 0.2 MB |
| Installer parts | 0.1 MB |
| `ffprobe.exe` (a second full FFmpeg tool) | included in the 134 MB class of files |

Other published files: `.msi` 153.4 MB, `.dmg` 94.2 MB, `.AppImage` 230.3 MB, `.deb` 163.7 MB.

## After

See the section filled in after the first build with the small FFmpeg (numbers come from the `check-bundle.mjs` notices of the workflow run).
