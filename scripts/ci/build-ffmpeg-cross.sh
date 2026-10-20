#!/usr/bin/env bash
# Builds the small, LGPL-only FFmpeg for Linux (x86_64) or Windows (x86_64, cross-compiled with mingw-w64) on an Ubuntu machine:
#   build-ffmpeg-cross.sh <linux|windows> <out-dir>
# Result: <out-dir>/ffmpeg (or ffmpeg.exe), stripped, with every library built in (static).
# Which FFmpeg parts are switched on is decided in ffmpeg-components.sh. The workflow caches <out-dir>,
# so this long build only runs again when one of the build scripts changes.
set -Eeuo pipefail

annotate() { printf '::error::%s\n' "$(printf '%s' "$1" | head -c 3500 | awk '{printf "%s%%0A", $0}')"; }
on_error() {
  annotate "build-ffmpeg-cross.sh failed at line $1"
  if [ -n "${WORK:-}" ]; then
    local log
    log="$(ls -t "$WORK"/*/config.log "$WORK"/ffmpeg/ffbuild/config.log 2>/dev/null | head -n 1 || true)"
    if [ -n "$log" ]; then annotate "$log: $(grep -n -i -E "error|fail|not found|no such|cannot" "$log" | tail -n 12)"; fi
    annotate "pkg-config files: $(ls "$P/lib/pkgconfig" 2>/dev/null | tr '\n' ' ')"
  fi
}
trap 'on_error $LINENO' ERR

TARGET="$1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
WORK="$(mktemp -d)"
P="$WORK/prefix"
mkdir -p "$P/lib/pkgconfig" "$P/include"
JOBS="$(nproc)"
# shellcheck source=ffmpeg-components.sh
source "$HERE/ffmpeg-components.sh"

ZLIB=1.3.1; FREETYPE=2.13.3; FRIBIDI=1.0.16; HARFBUZZ=10.2.0; LIBASS=0.17.3; WEBP=1.5.0; OPENH264=2.5.0
OPUS=1.5.2; LAME=3.100; VPL=2.14.0; NVCODEC=n12.2.72.0; FFMPEG=8.1

export PKG_CONFIG_LIBDIR="$P/lib/pkgconfig"
unset PKG_CONFIG_PATH

case "$TARGET" in
  linux)
    HOST=""; CROSS=""; EXE=""
    CC=gcc; CXX=g++; AR=ar; RANLIB=ranlib; STRIP=strip
    CMAKE_SYSTEM=()
    CONFIGURE_HOST=()
    ;;
  windows)
    HOST="x86_64-w64-mingw32"; CROSS="$HOST-"; EXE=".exe"
    CC="$HOST-gcc-posix"; CXX="$HOST-g++-posix"; AR="$HOST-ar"; RANLIB="$HOST-ranlib"; STRIP="$HOST-strip"
    cat > "$WORK/toolchain.cmake" <<TC
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER $CC)
set(CMAKE_CXX_COMPILER $CXX)
set(CMAKE_RC_COMPILER $HOST-windres)
set(CMAKE_FIND_ROOT_PATH $P /usr/$HOST)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
TC
    CMAKE_SYSTEM=(-DCMAKE_TOOLCHAIN_FILE="$WORK/toolchain.cmake")
    CONFIGURE_HOST=(--host="$HOST")
    ;;
  *) echo "Usage: build-ffmpeg-cross.sh <linux|windows> <out-dir>"; exit 2;;
esac
export CC CXX AR RANLIB
export CFLAGS="-O2 -I$P/include" CXXFLAGS="-O2 -I$P/include" CPPFLAGS="-I$P/include" LDFLAGS="-L$P/lib"

fetch() { # url dir
  local flag=z
  case "$1" in *.tar.xz) flag=J;; esac
  mkdir -p "$2"
  curl -fsSL --retry 4 --retry-delay 3 "$1" | tar "-x$flag" --strip-components=1 -C "$2"
}
cmake_build() { # dir extra-args...
  local dir="$1"; shift
  cmake -S "$dir" -B "$dir/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_PREFIX_PATH="$P" \
    -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_LIBDIR=lib "${CMAKE_SYSTEM[@]}" "$@"
  cmake --build "$dir/build" -j"$JOBS"
  cmake --install "$dir/build"
}

echo "== zlib"; fetch "https://github.com/madler/zlib/releases/download/v$ZLIB/zlib-$ZLIB.tar.xz" "$WORK/zlib"
cmake_build "$WORK/zlib" -DZLIB_BUILD_EXAMPLES=OFF
rm -f "$P"/lib/libz.so* "$P"/lib/libzlib.dll.a "$P"/bin/zlib1.dll
# The Windows CMake build names the static library libzlibstatic.a.
[ -f "$P/lib/libz.a" ] || cp "$P/lib/libzlibstatic.a" "$P/lib/libz.a"

echo "== freetype"; fetch "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE.tar.xz" "$WORK/freetype"
cmake_build "$WORK/freetype" -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_BROTLI=ON -DFT_REQUIRE_ZLIB=ON

echo "== fribidi"; fetch "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI/fribidi-$FRIBIDI.tar.xz" "$WORK/fribidi"
( cd "$WORK/fribidi" && ./configure "${CONFIGURE_HOST[@]}" --prefix="$P" --disable-shared --enable-static --disable-docs && make -j"$JOBS" && make install )

echo "== harfbuzz"; fetch "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ/harfbuzz-$HARFBUZZ.tar.xz" "$WORK/harfbuzz"
cmake_build "$WORK/harfbuzz" -DHB_HAVE_FREETYPE=ON -DHB_BUILD_UTILS=OFF -DHB_BUILD_SUBSET=OFF -DBUILD_TESTING=OFF

echo "== libass"; fetch "https://github.com/libass/libass/releases/download/$LIBASS/libass-$LIBASS.tar.xz" "$WORK/libass"
( cd "$WORK/libass" && PKG_CONFIG="pkg-config --static" ./configure "${CONFIGURE_HOST[@]}" --prefix="$P" --disable-shared --enable-static --disable-fontconfig --disable-require-system-font-provider --disable-directwrite --disable-coretext --disable-asm && make -j"$JOBS" && make install )

echo "== libwebp"; fetch "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-$WEBP.tar.gz" "$WORK/webp"
cmake_build "$WORK/webp" -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF

echo "== openh264"; fetch "https://github.com/cisco/openh264/archive/refs/tags/v$OPENH264.tar.gz" "$WORK/openh264"
if [ "$TARGET" = windows ]; then
  ( cd "$WORK/openh264" && make -j"$JOBS" OS=mingw_nt ARCH=x86_64 CC="$CC" CXX="$CXX" AR="$AR" PREFIX="$P" libraries && make OS=mingw_nt ARCH=x86_64 CC="$CC" CXX="$CXX" AR="$AR" PREFIX="$P" install-static )
else
  ( cd "$WORK/openh264" && make -j"$JOBS" OS=linux ARCH=x86_64 PREFIX="$P" libraries && make OS=linux ARCH=x86_64 PREFIX="$P" install-static )
fi

echo "== opus"; fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS.tar.gz" "$WORK/opus"
cmake_build "$WORK/opus" -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_INSTALL_PKG_CONFIG_MODULE=ON

echo "== lame"; fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME/lame-$LAME.tar.gz" "$WORK/lame"
( cd "$WORK/lame" && ./configure "${CONFIGURE_HOST[@]}" --prefix="$P" --disable-shared --enable-static --disable-frontend --disable-decoder --disable-gtktest --disable-dependency-tracking && make -j"$JOBS" && make install )

# GPU encoders. NVENC is loaded from the graphics driver at run time (headers only), so the same build runs with or without an NVIDIA card.
echo "== nv-codec-headers"
git clone --depth 1 --branch "$NVCODEC" https://github.com/FFmpeg/nv-codec-headers.git "$WORK/nvcodec"
make -C "$WORK/nvcodec" PREFIX="$P" install
EXTRA_FLAGS=(--enable-ffnvcodec --enable-nvenc)
EXTRA_ENCODERS=(h264_nvenc)

if [ "$TARGET" = windows ]; then
  echo "== AMF headers (AMD)"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git "$WORK/amf"
  ( cd "$WORK/amf" && git sparse-checkout set amf/public/include )
  mkdir -p "$P/include/AMF" && cp -r "$WORK/amf/amf/public/include/." "$P/include/AMF/"

  echo "== libvpl (Intel Quick Sync)"; fetch "https://github.com/intel/libvpl/archive/refs/tags/v$VPL.tar.gz" "$WORK/vpl"
  cmake_build "$WORK/vpl" -DBUILD_TOOLS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTS=OFF -DBUILD_PREVIEW=OFF -DINSTALL_EXAMPLE_CODE=OFF -DBUILD_EXPERIMENTAL=OFF
  EXTRA_FLAGS+=(--enable-amf --enable-libvpl --enable-d3d11va --enable-dxva2)
  EXTRA_ENCODERS+=(h264_amf h264_qsv)
  PLATFORM_FLAGS=(--arch=x86_64 --target-os=mingw32 --cross-prefix="$CROSS" --enable-cross-compile --cc="$CC" --cxx="$CXX")
  LINK_FLAGS="-static -static-libgcc -static-libstdc++"
else
  PLATFORM_FLAGS=()
  LINK_FLAGS="-static-libgcc -static-libstdc++"
fi

echo "== ffmpeg"; fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG.tar.xz" "$WORK/ffmpeg"
# shellcheck disable=SC2046  # the component flags are meant to be split into words
( cd "$WORK/ffmpeg" && ./configure --prefix="$P/ff" "${PLATFORM_FLAGS[@]}" --pkg-config=pkg-config --pkg-config-flags="--static" \
    --extra-cflags="-I$P/include" --extra-ldflags="-L$P/lib $LINK_FLAGS" --extra-libs="-lstdc++" \
    "${FFMPEG_COMMON_FLAGS[@]}" $(ffmpeg_component_flags "${EXTRA_ENCODERS[@]}") \
    --enable-zlib --enable-libass --enable-libwebp --enable-libopenh264 --enable-libopus --enable-libmp3lame "${EXTRA_FLAGS[@]}" \
    && make -j"$JOBS" && make install )

cp "$P/ff/bin/ffmpeg$EXE" "$OUT/ffmpeg$EXE"
"${CROSS}strip" -s "$OUT/ffmpeg$EXE"
ls -l "$OUT/ffmpeg$EXE"

if [ "$TARGET" = linux ]; then
  # Only the basic system libraries may be loaded at run time.
  bad="$(ldd "$OUT/ffmpeg" | awk '{print $1}' | grep -Ev '^(linux-vdso|/lib64/ld-linux|libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so)' || true)"
  if [ -n "$bad" ]; then annotate "ffmpeg needs libraries that are not part of every Linux system: $bad"; exit 1; fi
fi
rm -rf "$WORK"
echo "Built FFmpeg $FFMPEG for $TARGET in $OUT"
