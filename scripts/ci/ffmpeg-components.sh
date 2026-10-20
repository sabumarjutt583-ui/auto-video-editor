#!/usr/bin/env bash
# The ONLY parts of FFmpeg that the app needs. Sourced by build-ffmpeg-cross.sh (Linux, Windows) and
# build-ffmpeg-macos.sh. Everything else is switched off (--disable-everything), which is what makes the file small.
# Every name comes from the app's Rust code or from the list of supported input files (see RELEASE.md, "FFmpeg parts").
# License: LGPL only. The H.264 software encoder is OpenH264 (BSD, LGPL-compatible), because x264 needs the GPL.

join_by_comma() { local IFS=,; echo "$*"; }

ENCODERS=(
  libopenh264 mpeg4 aac libopus libmp3lame pcm_s16le pcm_s16be pcm_f32le png mjpeg libwebp
  wrapped_avframe rawvideo
  ass ssa srt subrip webvtt
)
DECODERS=(
  h264 hevc vp8 vp9 av1 mpeg4 aac aac_latm mp3 mp3float opus libopus vorbis flac alac
  pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_f32le pcm_f64le pcm_u8 pcm_s8
  png mjpeg webp rawvideo wrapped_avframe
  ass ssa srt subrip webvtt
)
DEMUXERS=(
  mov matroska ogg mp3 wav flac aac image2 image2pipe png_pipe jpeg_pipe webp_pipe
  concat lavfi srt ass webvtt s16le f32le
)
MUXERS=(
  mp4 mov matroska webm mp3 wav ogg opus flac adts image2 null webp srt ass webvtt s16le f32le
)
PARSERS=(
  h264 hevc vp8 vp9 av1 mpeg4video aac aac_latm mpegaudio opus vorbis flac png mjpeg webp
)
BSFS=(
  h264_mp4toannexb hevc_mp4toannexb aac_adtstoasc extract_extradata vp9_superframe vp9_superframe_split av1_frame_split null
)
PROTOCOLS=(file pipe)
INDEVS=(lavfi)
FILTERS=(
  # video
  zoompan scale crop pad fps format setsar setdar xfade fade overlay gblur subtitles ass
  setpts trim tpad framerate hue split null nullsink
  # audio
  anull acopy atrim asetpts silencedetect silenceremove sidechaincompress loudnorm ebur128 volumedetect
  amix volume afade aresample apad aformat adelay asplit join pan amerge alimiter atempo anullsink
  # joining and sources
  concat
  color testsrc testsrc2 nullsrc anullsrc sine aevalsrc
)

# Flags for --disable-everything and the lists above. The arguments are the platform specific encoders
# (h264_nvenc, h264_qsv, h264_amf, h264_videotoolbox) that the callers add.
ffmpeg_component_flags() {
  local extra_encoders=("$@")
  echo --disable-everything \
    --enable-encoder="$(join_by_comma "${ENCODERS[@]}" "${extra_encoders[@]}")" \
    --enable-decoder="$(join_by_comma "${DECODERS[@]}")" \
    --enable-demuxer="$(join_by_comma "${DEMUXERS[@]}")" \
    --enable-muxer="$(join_by_comma "${MUXERS[@]}")" \
    --enable-parser="$(join_by_comma "${PARSERS[@]}")" \
    --enable-bsf="$(join_by_comma "${BSFS[@]}")" \
    --enable-protocol="$(join_by_comma "${PROTOCOLS[@]}")" \
    --enable-indev="$(join_by_comma "${INDEVS[@]}")" \
    --enable-filter="$(join_by_comma "${FILTERS[@]}")"
}

# Flags for size and license. No GPL, no nonfree, no tools except ffmpeg itself.
FFMPEG_COMMON_FLAGS=(
  --enable-small --disable-debug --disable-doc --disable-gpl --disable-nonfree
  --disable-ffplay --disable-ffprobe --enable-ffmpeg
  --disable-network --disable-autodetect
  --enable-static --disable-shared
)
