#!/usr/bin/env bash
# Checks the FFmpeg and FFprobe sidecars of one target:  verify-ffmpeg.sh <binaries-dir> <target-triple> [--no-run]
# They must run (-version), must be an LGPL build (no GPL or nonfree parts) and must have the encoder and filters the app uses.
set -euo pipefail
dir="$1"; triple="$2"; norun="${3:-}"
ext=""; case "$triple" in *windows*) ext=".exe";; esac
ffmpeg="$dir/ffmpeg-$triple$ext"; ffprobe="$dir/ffprobe-$triple$ext"
for f in "$ffmpeg" "$ffprobe"; do
  [ -f "$f" ] || { echo "::error::Missing sidecar $f"; exit 1; }
  chmod +x "$f" 2>/dev/null || true
done
if [ "$norun" = "--no-run" ]; then echo "Found both sidecars for $triple (not run on this machine)."; exit 0; fi
"$ffprobe" -version | head -1
version="$("$ffmpeg" -version)"
echo "$version" | head -1
if grep -Eq -- '--enable-(gpl|nonfree)([[:space:]]|$)' <<<"$version"; then
  echo "::error::The FFmpeg for $triple is not an LGPL build (it was built with GPL or nonfree parts)."; exit 1
fi
encoders="$("$ffmpeg" -hide_banner -encoders 2>/dev/null || true)"
filters="$("$ffmpeg" -hide_banner -filters 2>/dev/null || true)"
grep -q libopenh264 <<<"$encoders" || { echo "::error::The FFmpeg for $triple has no libopenh264 encoder."; exit 1; }
grep -Eq '[[:space:]]subtitles[[:space:]]' <<<"$filters" || { echo "::error::The FFmpeg for $triple has no subtitles filter (libass)."; exit 1; }
grep -Eq '[[:space:]]sidechaincompress[[:space:]]' <<<"$filters" || { echo "::error::The FFmpeg for $triple has no sidechaincompress filter."; exit 1; }
echo "FFmpeg sidecars for $triple are fine."
