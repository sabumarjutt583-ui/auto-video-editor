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

## After (CI run 39469678995, version 0.1.1 build, all platforms green)

| Installer | Before | After |
| --- | ---: | ---: |
| Windows `-setup.exe` (main download) | 116.8 MB | **36.0 MB** |
| Windows `.msi` | 153.4 MB | **45.5 MB** |
| macOS `.dmg` (universal) | 94.2 MB | **47 MB** |
| Linux `.AppImage` | 230.3 MB | **122.7 MB** |
| Linux `.deb` | 163.7 MB | **43.8 MB** |

Windows installer, unpacked (95 files):

| Part | Before | After |
| --- | ---: | ---: |
| FFmpeg (ffprobe removed) | 134.1 MB + ffprobe | 12.7 MB |
| Fonts (all languages kept) | 37.8 MB | 37.8 MB |
| Main program and libraries | 18.7 MB | 11.0 MB |
| Sound effects (WAV) | 3.6 MB | 3.6 MB |
| Styles | 0.2 MB | 0.2 MB |

macOS app: FFmpeg 20.5 MB (universal: two builds joined), program 14.7 MB, fonts 37.8 MB.

Notes:
- The Linux AppImage is large because it carries the WebKit and GTK system libraries (about 242 MB unpacked). This is how AppImage works. Most Linux users can use the 43.8 MB `.deb` instead.
- Fonts could not shrink: they are already separate regional files, Regular and Bold only.
- Sound effects stay WAV (3.6 MB in total, a smaller format would save about 3 MB but changes the mixing path).

## Version 0.6.1 sizes — NOT yet recorded (note added in fix/remaining-gaps-phase1, 2026-10-26)

The tables above are historical data for version 0.1.1 only. Installer sizes for version 0.6.1 have NOT been recorded in this file yet — do not use the 0.1.1 numbers above as 0.6.1 sizes. A future update should record the real 0.6.1 installer sizes (Windows setup.exe, Windows .msi, macOS universal .dmg, Linux .AppImage, Linux .deb) from the published release in abubacker44235-bit/autoeditor-releases, with the same before/after breakdown format as above, and only then remove this note.
