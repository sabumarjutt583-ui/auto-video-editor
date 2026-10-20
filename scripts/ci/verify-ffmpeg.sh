#!/usr/bin/env bash
# Checks the FFmpeg sidecar of one target:  verify-ffmpeg.sh <binaries-dir> <target-triple> [--no-run]
# It must run, must be an LGPL build (no GPL or nonfree parts) and must contain every part listed in ffmpeg-components.sh
# (encoders, decoders, formats, filters, protocols) plus the GPU encoders of its platform.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/ffmpeg-components.sh"
dir="$1"; triple="$2"; norun="${3:-}"
ext=""; case "$triple" in *windows*) ext=".exe";; esac
ffmpeg="$dir/ffmpeg-$triple$ext"
[ -f "$ffmpeg" ] || { echo "::error::Missing sidecar $ffmpeg"; exit 1; }
chmod +x "$ffmpeg" 2>/dev/null || true
echo "Size of the $triple sidecar: $(du -h "$ffmpeg" | cut -f1)"
if [ "$norun" = "--no-run" ]; then echo "Found the sidecar for $triple (not run on this machine)."; exit 0; fi
version="$("$ffmpeg" -version)"
echo "$version" | head -1
if grep -Eq -- '--enable-(gpl|nonfree)([[:space:]]|$)' <<<"$version"; then
  echo "::error::The FFmpeg for $triple is not an LGPL build (it was built with GPL or nonfree parts)."; exit 1
fi

case "$triple" in
  *windows*) gpu=(h264_nvenc h264_qsv h264_amf);;
  *apple*)   gpu=(h264_videotoolbox);;
  *)         gpu=(h264_nvenc);;
esac

missing=()
check() { # kind list-flag names...
  local kind="$1" flag="$2"; shift 2
  local listing; listing="$("$ffmpeg" -hide_banner "$flag" 2>/dev/null || true)"
  local name
  for name in "$@"; do
    # Some build names differ from the names FFmpeg prints: image_png_pipe -> png_pipe, pcm_s16le (format) -> s16le.
    case "$kind:$name" in demuxer:image_*) name="${name#image_}";; demuxer:pcm_*|muxer:pcm_*) name="${name#pcm_}";; esac
    grep -Eq "[[:space:]]${name}([[:space:],]|\$)" <<<"$listing" || missing+=("$kind:$name")
  done
}
check encoder -encoders "${ENCODERS[@]}" "${gpu[@]}"
check decoder -decoders "${DECODERS[@]}"
check demuxer -demuxers "${DEMUXERS[@]}"
check muxer -muxers "${MUXERS[@]}"
check filter -filters "${FILTERS[@]}"
check protocol -protocols "${PROTOCOLS[@]}"
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::The FFmpeg for $triple lacks these parts: ${missing[*]}"; exit 1
fi
echo "The FFmpeg sidecar for $triple is fine."
