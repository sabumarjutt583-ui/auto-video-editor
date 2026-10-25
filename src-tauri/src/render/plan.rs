//! The arithmetic and FFmpeg arguments of a render. Everything here is pure (no files, no processes),
//! so it can be tested exactly. Times are counted in whole frames so that the video is never a frame
//! longer or shorter than the voice, however many scenes there are.

use std::path::Path;

use super::model::{Fit, Motion, RenderScene, ShortFill, SourceKind, TransitionKind};

/// How far a Ken Burns move zooms in. Same as the preview (src/lib/editor/motion.ts).
const ZOOM_AMOUNT: f64 = 0.12;
const ROOM: f64 = ZOOM_AMOUNT / 2.0;
/// Clips shorter than their scene are slowed down at most to this speed, then their last picture is held.
pub const MIN_AUTO_SPEED: f64 = 0.75;

pub fn frames_of(seconds: f64, fps: u32) -> i64 {
    (seconds * f64::from(fps)).round() as i64
}

/// One scene of the render, in frames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenePlan {
    /// Index into `RenderRequest::scenes`.
    pub scene: usize,
    pub frames: i64,
    /// Frames at the start of this scene that belong to the transition from the scene before (0 = cut).
    pub transition_frames: i64,
}

/// Cuts the voice into scenes of whole frames. Every boundary is rounded on its own (never a sum of
/// rounded lengths), so the total is exactly `round(duration * fps)`. Scenes that end up with no frames
/// are dropped.
pub fn plan_scenes(scenes: &[RenderScene], fps: u32, duration: f64) -> Vec<ScenePlan> {
    let total = frames_of(duration, fps);
    let mut bounds: Vec<i64> = Vec::with_capacity(scenes.len() + 1);
    for (i, scene) in scenes.iter().enumerate() {
        let at = if i == 0 { 0 } else { frames_of(scene.start, fps) };
        bounds.push(at.clamp(bounds.last().copied().unwrap_or(0), total));
    }
    bounds.push(total);

    let mut plan: Vec<ScenePlan> = Vec::new();
    for (i, scene) in scenes.iter().enumerate() {
        let frames = bounds[i + 1] - bounds[i];
        if frames <= 0 {
            continue;
        }
        let transition_frames = match plan.last() {
            Some(previous) if scene.transition.kind != TransitionKind::Cut => {
                let wanted = frames_of(scene.transition.seconds, fps);
                // Never longer than a third of either scene, as in the preview.
                wanted.min(frames / 3).min(previous.frames / 3).max(0)
            }
            _ => 0,
        };
        plan.push(ScenePlan { scene: i, frames, transition_frames });
    }
    plan
}

/// How fast a clip plays so that it covers `scene_seconds`: 1 when it is long enough, otherwise slower
/// (the user's choice, or automatically down to 0.75x). What is still missing is held on the last picture.
/// Like `video_speed`; with `ShortFill::Loop` a short clip is not slowed down by itself (only by the person's choice).
pub fn video_speed_for(clip_seconds: f64, scene_seconds: f64, user_speed: f64, fill: ShortFill) -> f64 {
    if clip_seconds <= 0.0 || clip_seconds >= scene_seconds - 0.02 {
        return 1.0;
    }
    if user_speed.is_finite() && user_speed < 0.999 {
        return user_speed.clamp(0.25, 1.0);
    }
    if fill == ShortFill::Loop {
        return 1.0;
    }
    (clip_seconds / scene_seconds).clamp(MIN_AUTO_SPEED, 1.0)
}

/// True when the clip must play again from the start to cover the scene at this speed.
pub fn needs_loop(clip_seconds: f64, scene_seconds: f64, speed: f64, fill: ShortFill) -> bool {
    fill != ShortFill::Hold && clip_seconds > 0.0 && clip_seconds / speed < scene_seconds - 0.02
}

fn esc_even(value: f64) -> u32 {
    let v = value.round().max(2.0) as u32;
    v + v % 2
}

/// The size the picture is scaled to before the Ken Burns move, so the move is smooth (no jitter).
pub fn zoompan_source_size(width: u32, height: u32) -> (u32, u32) {
    let k = if u64::from(width) * u64::from(height) <= 1920 * 1080 { 2.0 } else { 1.25 };
    (esc_even(f64::from(width) * k), esc_even(f64::from(height) * k))
}

/// The `z`, `x` and `y` expressions of FFmpeg's zoompan for a move that lasts `frames` frames.
/// Progress is eased (slow start, slow end) like the preview.
pub fn zoompan_expressions(motion: Motion, frames: i64) -> (String, String, String) {
    let last = (frames - 1).max(1);
    let p = format!("(on/{last})");
    let e = format!("({p}*{p}*(3-2*{p}))");
    let zoomed = 1.0 + ZOOM_AMOUNT;
    let center_x = "(iw-iw/zoom)/2".to_string();
    let center_y = "(ih-ih/zoom)/2".to_string();
    match motion {
        Motion::ZoomIn => (format!("1+{ZOOM_AMOUNT}*{e}"), center_x, center_y),
        Motion::ZoomOut => (format!("{zoomed}-{ZOOM_AMOUNT}*{e}"), center_x, center_y),
        Motion::PanLeft => (format!("{zoomed}"), format!("{center_x}-({ROOM}-{}*{p})*iw/zoom", 2.0 * ROOM), center_y),
        Motion::PanRight => (format!("{zoomed}"), format!("{center_x}-(-{ROOM}+{}*{p})*iw/zoom", 2.0 * ROOM), center_y),
        Motion::PanUp => (format!("{zoomed}"), center_x, format!("{center_y}-({ROOM}-{}*{p})*ih/zoom", 2.0 * ROOM)),
        Motion::None => ("1".to_string(), center_x, center_y),
    }
}

fn s(value: impl ToString) -> String {
    value.to_string()
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// "Fill the frame": scale up until both sides are covered, then cut off what sticks out.
fn cover(w: u32, h: u32) -> String {
    format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1")
}

/// A cheap strong blur: shrink, blur, enlarge.
fn blurred(w: u32, h: u32) -> String {
    let (sw, sh) = (esc_even(f64::from(w) / 8.0), esc_even(f64::from(h) / 8.0));
    format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},scale={sw}:{sh},gblur=sigma=5,scale={w}:{h},setsar=1")
}

/// Encoding of the temporary clips: big files, but fast to make and no visible loss.
fn clip_codec(fps: u32, frames: i64, output: &Path) -> Vec<String> {
    vec![
        s("-an"),
        s("-c:v"),
        s("mpeg4"),
        s("-q:v"),
        s("2"),
        s("-pix_fmt"),
        s("yuv420p"),
        s("-r"),
        s(fps),
        s("-fps_mode"),
        s("cfr"),
        s("-frames:v"),
        s(frames),
        s("-video_track_timescale"),
        s(fps * 1000),
        path_arg(output),
    ]
}

/// FFmpeg arguments that make the clip of one scene: `frames` frames at the final size.
/// `source` is the full path of the picture or clip (unused for a black scene).
pub fn clip_args(scene: &RenderScene, source: &Path, frames: i64, width: u32, height: u32, fps: u32, ken_burns: bool, output: &Path) -> Vec<String> {
    let scene_seconds = frames as f64 / f64::from(fps);
    let mut args: Vec<String> = Vec::new();
    match scene.source.kind {
        SourceKind::Black => {
            args.extend([s("-f"), s("lavfi"), s("-i"), format!("color=c=black:s={width}x{height}:r={fps}"), s("-vf"), s("format=yuv420p")]);
        }
        SourceKind::Image => {
            let moving = ken_burns && scene.motion != Motion::None && !scene.source.blur_all;
            if moving {
                let (sw, sh) = zoompan_source_size(width, height);
                let (z, x, y) = zoompan_expressions(scene.motion, frames);
                args.extend([s("-i"), path_arg(source)]);
                args.extend([
                    s("-vf"),
                    format!("scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},setsar=1,zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={width}x{height}:fps={fps},format=yuv420p"),
                ]);
            } else {
                let look = if scene.source.blur_all { blurred(width, height) } else { cover(width, height) };
                args.extend([s("-loop"), s("1"), s("-framerate"), s(fps), s("-i"), path_arg(source), s("-vf"), format!("{look},fps={fps},format=yuv420p")]);
            }
        }
        SourceKind::Video => {
            let speed = if scene.source.last_frame { 1.0 } else { video_speed_for(scene.source.duration, scene_seconds, scene.speed, scene.short_fill) };
            if scene.source.last_frame {
                args.extend([s("-sseof"), s("-0.2")]);
            } else if needs_loop(scene.source.duration, scene_seconds, speed, scene.short_fill) {
                // The clip is too short: play it again from the start (the output is cut at `frames`).
                args.extend([s("-stream_loop"), s("-1")]);
            }
            args.extend([s("-i"), path_arg(source)]);
            let pace = format!("setpts=PTS/{speed:.4},fps={fps}");
            // Hold the last picture for as long as the clip is too short (the output is cut at `frames`).
            let hold = format!("tpad=stop_mode=clone:stop_duration={:.3}", scene_seconds + 1.0);
            if scene.source.blur_all {
                args.extend([s("-vf"), format!("{pace},{},{hold},format=yuv420p", blurred(width, height))]);
            } else if scene.fit == Fit::Blur {
                let graph = format!(
                    "[0:v]{pace},split=2[a][b];[a]{}[bg];[b]scale={width}:{height}:force_original_aspect_ratio=decrease,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,{hold},format=yuv420p[out]",
                    blurred(width, height)
                );
                args.extend([s("-filter_complex"), graph, s("-map"), s("[out]")]);
            } else {
                args.extend([s("-vf"), format!("{pace},{},{hold},format=yuv420p", cover(width, height))]);
            }
        }
    }
    args.extend(clip_codec(fps, frames, output));
    args
}

/// The FFmpeg name of a transition.
pub fn xfade_name(kind: TransitionKind) -> &'static str {
    match kind {
        TransitionKind::Cut => "fade",
        TransitionKind::Dissolve => "fade",
        TransitionKind::Fade => "fadeblack",
        TransitionKind::Slide | TransitionKind::Whip => "slideleft",
        TransitionKind::Zoom => "zoomin",
    }
}

/// Saves the last picture of a clip as a PNG (the "old" scene of a transition stays on it).
pub fn last_frame_args(clip: &Path, output: &Path) -> Vec<String> {
    vec![s("-sseof"), s("-0.3"), s("-i"), path_arg(clip), s("-update"), s("1"), s("-c:v"), s("png"), s("-compression_level"), s("1"), path_arg(output)]
}

/// The clip of a transition: the held last picture of the old scene turns into the first `frames`
/// frames of the new scene's clip.
pub fn transition_args(last_picture: &Path, next_clip: &Path, kind: TransitionKind, frames: i64, fps: u32, output: &Path) -> Vec<String> {
    let seconds = frames as f64 / f64::from(fps);
    let mut args = vec![s("-loop"), s("1"), s("-framerate"), s(fps), s("-i"), path_arg(last_picture), s("-i"), path_arg(next_clip)];
    args.extend([
        s("-filter_complex"),
        format!(
            "[0:v]fps={fps},format=yuv420p,setsar=1[a];[1:v]fps={fps},format=yuv420p,setsar=1[b];[a][b]xfade=transition={}:duration={seconds:.5}:offset=0,format=yuv420p[out]",
            xfade_name(kind)
        ),
        s("-map"),
        s("[out]"),
    ]);
    args.extend(clip_codec(fps, frames, output));
    args
}

/// One entry of the join list: a file, and how many of its first frames to skip.
#[derive(Debug, Clone, PartialEq)]
pub struct JoinPart {
    pub file: String,
    pub skip_frames: i64,
}

/// The text of the list for FFmpeg's concat reader. `skip_frames` is cut half a frame early so that
/// rounding can never drop or repeat a frame.
pub fn concat_list(parts: &[JoinPart], fps: u32) -> String {
    let mut text = String::from("ffconcat version 1.0\n");
    for part in parts {
        let quoted = part.file.replace('\'', "'\\''");
        text.push_str(&format!("file '{quoted}'\n"));
        if part.skip_frames > 0 {
            let at = (part.skip_frames as f64 - 0.5) / f64::from(fps);
            text.push_str(&format!("inpoint {at:.6}\n"));
        }
    }
    text
}

/// How the intermediate files join up: a scene's transition clip first (if any), then the scene's clip
/// without the frames the transition already showed.
pub fn join_parts(plan: &[ScenePlan], clip_file: &dyn Fn(usize) -> String, transition_file: &dyn Fn(usize) -> String) -> Vec<JoinPart> {
    let mut parts = Vec::new();
    for (position, scene) in plan.iter().enumerate() {
        if scene.transition_frames > 0 {
            parts.push(JoinPart { file: transition_file(position), skip_frames: 0 });
        }
        parts.push(JoinPart { file: clip_file(position), skip_frames: scene.transition_frames });
    }
    parts
}

/// Escapes a path for use inside an FFmpeg filter argument (works for Windows paths too).
pub fn filter_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let escaped = text.replace('\'', "'\\\\\\''").replace(':', "\\:");
    format!("'{escaped}'")
}

/// One graphic laid over the video.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlayInput {
    pub start: f64,
    /// A transparent clip (30 fps, made by the app): it starts on an exact frame of the video.
    pub exact_frames: bool,
}

/// The filter graph of the final encode when motion graphics are laid over the video. Input 0 is the
/// joined scenes, input 1 the audio, inputs 2.. the graphics (in the order of `starts`).
/// `tail` runs last (captions, pixel format). The result ends in the label `[vout]`.
#[cfg(test)]
pub fn overlay_graph(starts: &[f64], width: u32, height: u32, tail: &str) -> String {
    let inputs: Vec<OverlayInput> = starts.iter().map(|&start| OverlayInput { start, exact_frames: false }).collect();
    overlay_graph_for(&inputs, width, height, 30, tail)
}

/// Same as `overlay_graph`. A clip made by the app starts on frame `round(start * fps)` of the video, written as an exact
/// fraction (`n/(fps*TB)`), so it never lags a frame behind because of a rounded decimal.
pub fn overlay_graph_for(inputs: &[OverlayInput], width: u32, height: u32, fps: u32, tail: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut base = String::from("0:v");
    for (i, input) in inputs.iter().enumerate() {
        let shift = if input.exact_frames { format!("{}/({fps}*TB)", (input.start * f64::from(fps)).round() as u64) } else { format!("{:.3}/TB", input.start) };
        parts.push(format!("[{}:v]format=rgba,scale={width}:{height},setpts=PTS-STARTPTS+{shift}[o{i}]", i + 2));
        parts.push(format!("[{base}][o{i}]overlay=eof_action=pass:format=auto[v{}]", i + 1));
        base = format!("v{}", i + 1);
    }
    parts.push(format!("[{base}]{tail}[vout]"));
    parts.join(";")
}

/// A target bitrate in bits per second for the picture size and frame rate.
pub fn video_bitrate(width: u32, height: u32, fps: u32) -> u64 {
    let rate = f64::from(width) * f64::from(height) * f64::from(fps) * 0.12;
    rate.clamp(2_000_000.0, 80_000_000.0) as u64
}

/// A safe file name part: letters, digits (any language), dashes and underscores.
pub fn file_safe(text: &str) -> String {
    let cleaned: String = text
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else if c.is_whitespace() { '_' } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches(|c| c == '-' || c == '_').to_string();
    let short: String = cleaned.chars().take(60).collect();
    if short.is_empty() { "video".to_string() } else { short }
}

/// `<project>_<aspect>_<date>[_<suffix>]`, without an extension.
pub fn output_stem(project: &str, aspect: &str, date: &str, suffix: Option<&str>) -> String {
    let mut stem = format!("{}_{}_{}", file_safe(project), file_safe(aspect), file_safe(date));
    if let Some(suffix) = suffix.map(file_safe).filter(|x| x != "video") {
        stem.push('_');
        stem.push_str(&suffix);
    }
    stem
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::model::{SceneTransition, Source};

    fn scene(start: f64, end: f64, kind: TransitionKind, seconds: f64) -> RenderScene {
        RenderScene {
            id: "S".into(),
            start,
            end,
            source: Source { kind: SourceKind::Image, path: "media/a.png".into(), duration: 0.0, last_frame: false, blur_all: false },
            motion: Motion::ZoomIn,
            fit: Fit::Crop,
            speed: 1.0,
            short_fill: ShortFill::Hold,
            transition: SceneTransition { kind, seconds },
        }
    }

    #[test]
    fn the_scenes_always_add_up_to_the_voice_length() {
        // 200 scenes with odd lengths: sums of rounded lengths would drift, boundaries do not.
        let mut scenes = Vec::new();
        let mut at = 0.0;
        for i in 0..200 {
            let length = 5.0 + (i % 7) as f64 * 0.137;
            scenes.push(scene(at, at + length, TransitionKind::Cut, 0.0));
            at += length;
        }
        for fps in [24, 30, 60] {
            let plan = plan_scenes(&scenes, fps, at);
            assert_eq!(plan.iter().map(|p| p.frames).sum::<i64>(), frames_of(at, fps), "fps {fps}");
        }
    }

    #[test]
    fn transitions_are_capped_to_a_third_of_both_scenes() {
        let scenes = vec![
            scene(0.0, 1.0, TransitionKind::Cut, 0.0),
            scene(1.0, 4.0, TransitionKind::Dissolve, 0.5),
            scene(4.0, 4.3, TransitionKind::Slide, 0.5),
            scene(4.3, 10.0, TransitionKind::Fade, 0.5),
        ];
        let plan = plan_scenes(&scenes, 30, 10.0);
        assert_eq!(plan[0].transition_frames, 0);
        assert_eq!(plan[1].transition_frames, 10, "a third of the 1 s scene before it");
        assert_eq!(plan[2].transition_frames, 3, "a third of its own 9 frames");
        assert_eq!(plan[3].transition_frames, 3, "a third of the 9-frame scene before it");
    }

    #[test]
    fn empty_scenes_are_dropped_and_the_total_still_matches() {
        let scenes = vec![scene(0.0, 2.0, TransitionKind::Cut, 0.0), scene(2.0, 2.0, TransitionKind::Dissolve, 0.5), scene(2.0, 5.0, TransitionKind::Dissolve, 0.5)];
        let plan = plan_scenes(&scenes, 30, 5.0);
        assert_eq!(plan.len(), 2);
        assert_eq!(plan.iter().map(|p| p.frames).sum::<i64>(), 150);
        assert_eq!(plan[1].scene, 2);
    }

    #[test]
    fn short_clips_slow_down_to_three_quarters_then_hold() {
        assert_eq!(video_speed_for(10.0, 5.0, 1.0, ShortFill::Hold), 1.0);
        assert_eq!(video_speed_for(4.0, 5.0, 1.0, ShortFill::Hold), 0.8);
        assert_eq!(video_speed_for(2.0, 5.0, 1.0, ShortFill::Hold), MIN_AUTO_SPEED);
        assert_eq!(video_speed_for(4.0, 5.0, 0.5, ShortFill::Hold), 0.5, "the user's choice wins");
        assert_eq!(video_speed_for(5.0, 5.0, 0.5, ShortFill::Hold), 1.0, "a long enough clip is never slowed");
    }

    #[test]
    fn zoom_expressions_follow_the_preview() {
        let (z, x, y) = zoompan_expressions(Motion::ZoomIn, 31);
        assert!(z.starts_with("1+0.12*"));
        assert!(z.contains("on/30"));
        assert_eq!(x, "(iw-iw/zoom)/2");
        assert_eq!(y, "(ih-ih/zoom)/2");
        let (z, x, _) = zoompan_expressions(Motion::PanLeft, 31);
        assert_eq!(z, "1.12");
        assert!(x.contains("0.06-0.12*(on/30)"));
        let (z, _, _) = zoompan_expressions(Motion::ZoomOut, 1);
        assert!(z.starts_with("1.12-0.12*"), "one frame must not divide by zero: {z}");
    }

    #[test]
    fn the_source_is_scaled_up_before_a_move() {
        assert_eq!(zoompan_source_size(1280, 720), (2560, 1440));
        assert_eq!(zoompan_source_size(3840, 2160), (4800, 2700));
    }

    #[test]
    fn clips_have_the_right_filters() {
        let out = Path::new("/t/clip.mp4");
        let img = scene(0.0, 5.0, TransitionKind::Cut, 0.0);
        let args = clip_args(&img, Path::new("/p/a.png"), 150, 1920, 1080, 30, true, out).join(" ");
        assert!(args.contains("zoompan="), "{args}");
        assert!(args.contains("d=150:s=1920x1080:fps=30"), "{args}");
        assert!(args.contains("-frames:v 150"), "{args}");
        let still = clip_args(&img, Path::new("/p/a.png"), 150, 1920, 1080, 30, false, out).join(" ");
        assert!(!still.contains("zoompan"), "{still}");
        assert!(still.contains("-loop 1"), "{still}");

        let mut video = scene(0.0, 5.0, TransitionKind::Cut, 0.0);
        video.source = Source { kind: SourceKind::Video, path: "media/a.mp4".into(), duration: 4.0, last_frame: false, blur_all: false };
        let args = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(args.contains("setpts=PTS/0.8000"), "{args}");
        assert!(args.contains("tpad=stop_mode=clone"), "{args}");
        assert!(!args.contains("-stream_loop"), "hold: {args}");

        // A short clip plays again from the start; "smart" slows it a little first, "loop" does not.
        video.short_fill = ShortFill::Smart;
        let covered = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(!covered.contains("-stream_loop"), "slowing to 0.8x already covers the scene: {covered}");
        video.source.duration = 3.0;
        let smart = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(smart.contains("-stream_loop -1 -i /p/a.mp4"), "{smart}");
        assert!(smart.contains("setpts=PTS/0.7500"), "{smart}");
        video.short_fill = ShortFill::Loop;
        let looped = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(looped.contains("-stream_loop -1") && looped.contains("setpts=PTS/1.0000"), "{looped}");
        // A long clip is never looped: it is cut at the end of the scene.
        video.source.duration = 9.0;
        let long = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(!long.contains("-stream_loop"), "{long}");
        video.source.duration = 4.0;
        video.short_fill = ShortFill::Hold;
        video.fit = Fit::Blur;
        let args = clip_args(&video, Path::new("/p/a.mp4"), 150, 1080, 1920, 30, true, out).join(" ");
        assert!(args.contains("overlay=(W-w)/2:(H-h)/2"), "{args}");
        assert!(args.contains("-filter_complex"), "{args}");

        let mut black = scene(0.0, 5.0, TransitionKind::Cut, 0.0);
        black.source = Source { kind: SourceKind::Black, path: String::new(), duration: 0.0, last_frame: false, blur_all: false };
        assert!(clip_args(&black, Path::new(""), 30, 640, 360, 30, true, out).join(" ").contains("color=c=black:s=640x360:r=30"));
    }

    #[test]
    fn the_join_list_skips_the_frames_a_transition_already_showed() {
        let plan = vec![ScenePlan { scene: 0, frames: 100, transition_frames: 0 }, ScenePlan { scene: 1, frames: 100, transition_frames: 15 }];
        let parts = join_parts(&plan, &|i| format!("/t/clip_{i}.mp4"), &|i| format!("/t/trans_{i}.mp4"));
        assert_eq!(parts.iter().map(|p| (p.file.as_str(), p.skip_frames)).collect::<Vec<_>>(), vec![("/t/clip_0.mp4", 0), ("/t/trans_1.mp4", 0), ("/t/clip_1.mp4", 15)]);
        let text = concat_list(&parts, 30);
        assert!(text.starts_with("ffconcat version 1.0\n"));
        assert!(text.contains("inpoint 0.483333"), "{text}");
        assert_eq!(text.matches("inpoint").count(), 1);
    }

    #[test]
    fn quotes_in_paths_are_escaped() {
        let parts = vec![JoinPart { file: "/t/it's.mp4".into(), skip_frames: 0 }];
        assert!(concat_list(&parts, 30).contains(r"file '/t/it'\''s.mp4'"));
        assert_eq!(filter_path(Path::new(r"C:\Users\Ali\x.ass")), r"'C\:/Users/Ali/x.ass'");
    }

    #[test]
    fn overlays_are_chained_over_the_video_before_the_captions() {
        let graph = overlay_graph(&[1.5, 4.0], 1920, 1080, "format=yuv420p");
        assert_eq!(graph, "[2:v]format=rgba,scale=1920:1080,setpts=PTS-STARTPTS+1.500/TB[o0];[0:v][o0]overlay=eof_action=pass:format=auto[v1];[3:v]format=rgba,scale=1920:1080,setpts=PTS-STARTPTS+4.000/TB[o1];[v1][o1]overlay=eof_action=pass:format=auto[v2];[v2]format=yuv420p[vout]");
        assert_eq!(overlay_graph(&[], 64, 64, "format=yuv420p"), "[0:v]format=yuv420p[vout]");
    }

    #[test]
    fn clips_start_on_an_exact_frame() {
        let graph = overlay_graph_for(&[OverlayInput { start: 32.43, exact_frames: true }, OverlayInput { start: 1.5, exact_frames: false }], 1080, 1920, 30, "format=yuv420p");
        assert!(graph.contains("[2:v]format=rgba,scale=1080:1920,setpts=PTS-STARTPTS+973/(30*TB)[o0]"), "{graph}");
        assert!(graph.contains("[3:v]format=rgba,scale=1080:1920,setpts=PTS-STARTPTS+1.500/TB[o1]"), "{graph}");
        let at_24 = overlay_graph_for(&[OverlayInput { start: 2.0, exact_frames: true }], 640, 360, 24, "null");
        assert!(at_24.contains("+48/(24*TB)"), "{at_24}");
    }

    #[test]
    fn file_names_are_safe_in_every_language() {
        assert_eq!(output_stem("Korean story EP1", "16x9", "2026-10-18", None), "Korean_story_EP1_16x9_2026-10-18");
        assert_eq!(output_stem("한국어 이야기", "9x16", "2026-10-18", Some("shorts")), "한국어_이야기_9x16_2026-10-18_shorts");
        assert_eq!(output_stem("a/b:c*d", "1x1", "2026-10-18", None), "a-b-c-d_1x1_2026-10-18");
        assert_eq!(file_safe("///"), "video");
    }

    #[test]
    fn bitrates_grow_with_size() {
        assert!(video_bitrate(1920, 1080, 30) > 7_000_000 && video_bitrate(1920, 1080, 30) < 9_000_000);
        assert!(video_bitrate(3840, 2160, 60) > video_bitrate(1920, 1080, 30));
        assert_eq!(video_bitrate(64, 64, 12), 2_000_000);
    }
}
