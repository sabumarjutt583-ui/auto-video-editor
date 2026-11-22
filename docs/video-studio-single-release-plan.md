# Video Editing Studio — single public release plan

**Release rule:** Only one public Windows release, after every committed scope item works and the end-to-end acceptance suite passes. All interim branches, PRs and builds are internal; do not publish prereleases, installers or tags as a user-ready studio.

## Scope boundaries

- This is an independent editor, usable without Script Writer, existing One-Click Auto Pipeline, or a channel profile.
- Existing Script Writer and One-Click Pipeline remain frozen. Changes to shared modules require regression tests showing their behavior is unchanged.
- Keep all manually edited media, graphics, captions, overrides and timeline content when AI or asset imports run. No destructive regeneration without explicit approval.
- Never remove legacy motion graphics until V2 supports migration and regression tests.
- No competitor channel analysis / reverse engineering in this release.
- Do not market a capability as ready based only on a UI or mock.

## 10 internal engineering phases (NOT public releases)

1. **Audit and safe integration:** baseline, dependency map, isolated branch, scope gates.
2. **Standalone projects and storage:** blank edit, create/open/save, folder root, media import/relink, safe deletion, recovery.
3. **Professional timeline:** independent video/image/audio tracks; insert, split, trim, move, ripple, snapping, time ruler, player, undo/redo.
4. **Script-to-video:** sentence/phrase/word segmentation, editable scene plans, voiceover transcription, accurate timestamps and sync.
5. **Stock media intelligence:** licensed provider adapters, ranking, selection, downloads, video segment cutting and missing-media detection.
6. **Motion Graphics V2:** safe 2D templates, text animations, shapes/callouts/counters/charts, timeline overlays, migrated legacy projects.
7. **Captions and emphasis:** Unicode/RTL subtitle track, timing adjustment, styling, SRT/VTT, independent emphasis track.
8. **Audio studio and SFX:** voice enhancement, music ducking, independent cues, sound library and licensed collection metadata.
9. **AI Editor:** AI suggestions, auto/review/manual policies per operation, semantic matching, user override preservation and reliable job states.
10. **Export and product hardening:** encoder checks, scene-level QC, MP4/SRT, 16:9/9:16/1:1, Windows packaging, recovery and end-to-end checks.

## Current draft milestone

- [x] Independent Studio navigation entry and New Studio Edit.
- [x] Reuse durable project store and existing real media import.
- [x] Turn imported images/videos into editable scenes, append later imports.
- [x] Allow non-voice projects to use the preview's time-based clock.
- [x] Add backend silent WAV generation for voice-free renders and use existing FFmpeg mix/render path.
- [x] Preserve existing timeline motion/scene overrides on Studio media append.
- [x] Add unit test cases for scene timing, mapping and edit preservation.
- [ ] Typecheck and unit tests verified on CI.
- [ ] Render a complete media-only project on real Windows with FFmpeg.
- [ ] Implement actual independent freeform multitrack timeline and all remaining features.

## Final acceptance gates

- Studio works without a channel, script, voiceover or AI connection.
- Mixed image/video edit can be imported, previewed, saved, reopened, reordered, trimmed and rendered as validated MP4.
- Voiceover/script scenes are synchronized at real word timestamps when those inputs are present.
- Stock licensing and user-asset permissions are preserved.
- Import/apply AI suggestions never unexpectedly overwrite manual edits.
- Full regression suite passes for pre-existing Script Writer and Auto Pipeline.
- CI: Windows TypeScript/build, Rust tests, FFmpeg real render tests and desktop integration scenarios.
- Recover after crash, missing source file, invalid media, quota exhaustion, offline session and cancelled export.
- End-user Windows installer actually launches and passes smoke tests.
- Final release checklist explicitly approved; only then prepare one public release.

Do not count any unchecked gate as complete.
