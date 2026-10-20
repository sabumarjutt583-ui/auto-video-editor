#!/usr/bin/env bash
# Builds the small, static, LGPL-only FFmpeg for macOS from source (nobody publishes ready-made LGPL macOS builds
# with libass + libopenh264 + libwebp). The parts that are switched on are listed in ffmpeg-components.sh. Run on a Mac of the target architecture:
#   build-ffmpeg-macos.sh <out-dir>
# Result: <out-dir>/ffmpeg. Only system libraries are linked dynamically.
# The workflow caches <out-dir>, so this long build runs only when this file changes.
set -Eeuo pipefail

# On any failure, show the line (and the tail of FFmpeg's configure log) as an error annotation of the workflow run.
annotate() { printf '::error::%s\n' "$(printf '%s' "$1" | head -c 3500 | awk '{printf "%s%%0A", $0}')"; }
on_error() {
  annotate "build-ffmpeg-macos.sh failed at line $1"
  if [ -n "${WORK:-}" ] && [ -f "$WORK/ffmpeg/ffbuild/config.log" ]; then annotate "$(tail -n 25 "$WORK/ffmpeg/ffbuild/config.log")"; fi
}
trap 'on_error $LINENO' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/ffmpeg-components.sh"
OUT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
WORK="$(mktemp -d)"
PREFIX="$WORK/prefix"
mkdir -p "$OUT" "$PREFIX"
ARCH="$(uname -m)"   # arm64 or x86_64
JOBS="$(sysctl -n hw.ncpu)"

FREETYPE=2.13.3; FRIBIDI=1.0.16; HARFBUZZ=10.2.0; LIBASS=0.17.3; WEBP=1.5.0; OPENH264=2.5.0; OPUS=1.5.2; LAME=3.100; FFMPEG=8.1

# Only our own static libraries may be found (never the dynamic ones of Homebrew).
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_PATH
export CFLAGS="-O2 -I$PREFIX/include" CXXFLAGS="-O2 -I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
export MACOSX_DEPLOYMENT_TARGET=11.0

brew install pkg-config nasm meson ninja cmake autoconf automake libtool >/dev/null

fetch() { # url dir
  local flag=z
  case "$1" in *.tar.xz) flag=J;; esac
  mkdir -p "$2"
  curl -fsSL --retry 3 "$1" | tar "-x$flag" --strip-components=1 -C "$2"
}

echo "== freetype"; fetch "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE.tar.xz" "$WORK/freetype"
( cd "$WORK/freetype" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --with-harfbuzz=no --with-png=no --with-brotli=no --with-bzip2=no && make -j"$JOBS" && make install )

echo "== fribidi"; fetch "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI/fribidi-$FRIBIDI.tar.xz" "$WORK/fribidi"
( cd "$WORK/fribidi" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-docs && make -j"$JOBS" && make install )

echo "== harfbuzz"; fetch "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ/harfbuzz-$HARFBUZZ.tar.xz" "$WORK/harfbuzz"
( cd "$WORK/harfbuzz" && meson setup build --prefix="$PREFIX" --default-library=static --buildtype=release -Dtests=disabled -Ddocs=disabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled -Dfreetype=enabled -Dcoretext=enabled && ninja -C build install )

echo "== libass"; fetch "https://github.com/libass/libass/releases/download/$LIBASS/libass-$LIBASS.tar.xz" "$WORK/libass"
( cd "$WORK/libass" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-fontconfig --disable-require-system-font-provider --enable-coretext && make -j"$JOBS" && make install )

echo "== libwebp"; fetch "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-$WEBP.tar.gz" "$WORK/webp"
( cd "$WORK/webp" && cmake -S . -B build -DCMAKE_INSTALL_PREFIX="$PREFIX" -DBUILD_SHARED_LIBS=OFF -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF -DCMAKE_BUILD_TYPE=Release && cmake --build build -j"$JOBS" && cmake --install build )

echo "== openh264"; fetch "https://github.com/cisco/openh264/archive/refs/tags/v$OPENH264.tar.gz" "$WORK/openh264"
( cd "$WORK/openh264" && make -j"$JOBS" OS=darwin ARCH="$ARCH" PREFIX="$PREFIX" libraries && make OS=darwin ARCH="$ARCH" PREFIX="$PREFIX" install-static )

echo "== opus"; fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS.tar.gz" "$WORK/opus"
( cd "$WORK/opus" && cmake -S . -B build -DCMAKE_INSTALL_PREFIX="$PREFIX" -DBUILD_SHARED_LIBS=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_INSTALL_PKG_CONFIG_MODULE=ON -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release && cmake --build build -j"$JOBS" && cmake --install build )

echo "== lame"; fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME/lame-$LAME.tar.gz" "$WORK/lame"
( cd "$WORK/lame" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-frontend --disable-decoder --disable-gtktest --disable-dependency-tracking && make -j"$JOBS" && make install )

echo "== ffmpeg"; fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG.tar.xz" "$WORK/ffmpeg"
# shellcheck disable=SC2046  # the component flags are meant to be split into words
( cd "$WORK/ffmpeg" && ./configure --prefix="$PREFIX/ff" --pkg-config-flags="--static" \
    --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" --extra-libs="-lc++" \
    "${FFMPEG_COMMON_FLAGS[@]}" $(ffmpeg_component_flags h264_videotoolbox) \
    --enable-zlib --enable-iconv --enable-libass --enable-libwebp --enable-libopenh264 --enable-libopus --enable-libmp3lame \
    --enable-videotoolbox \
    && make -j"$JOBS" && make install )

cp "$PREFIX/ff/bin/ffmpeg" "$OUT/ffmpeg"
strip -x "$OUT/ffmpeg"
ls -l "$OUT/ffmpeg"

# Only Apple's own libraries may be loaded at run time (nothing from Homebrew or from this build folder).
for f in "$OUT/ffmpeg"; do
  bad="$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' || true)"
  if [ -n "$bad" ]; then
    annotate "$f needs libraries that are not part of macOS, so it would not run on other Macs: $bad"
    exit 1
  fi
done
rm -rf "$WORK"
echo "Built FFmpeg $FFMPEG for $ARCH in $OUT"
