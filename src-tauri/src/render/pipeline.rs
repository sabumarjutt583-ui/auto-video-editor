//! Runs a render from start to finish as one background job.
//!
//! 1. Mix the audio (voice, music, sound effects) and set its loudness.
//! 2. Make one temporary clip per scene at the final size (Ken Burns, fit, slow-down).
//! 3. Make a short clip for every transition.
//! 4. Join everything, burn in the captions, add the audio and encode the MP4.
//! 5. Save it in the project's exports folder (and the person's export folder), then check its length.

use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::audio::mix;
use crate::audio::paths::resolve;
use crate::captions::build_ass;
use crate::commands::error::AppError;
use crate::commands::mix::prepare_mix;
use crate::ffmpeg_job::{run, RunOptions};
use crate::jobs::Job;
use crate::media::probe::probe;

use super::encoder::{self, EncoderInfo};
use super::model::{RenderRequest, RenderResult, SourceKind};
use super::plan::{self, ScenePlan};

/// Where things are on this computer.
pub struct RenderEnv {
    pub project_dir: PathBuf,
    pub fonts_dir: PathBuf,
    pub sfx_dir: PathBuf,
    /// The person's default export folder, if one is set.
    pub export_folder: Option<PathBuf>,
    pub force_cpu: bool,
}

/// A folder for temporary files that is removed when the render ends, fails or is cancelled.
struct TempDir(PathBuf);

impl TempDir {
    fn create(path: PathBuf) -> Result<Self, AppError> {
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).map_err(|e| AppError::new("A temporary folder for the render could not be created. Please check that the disk is not full.", format!("{e} ({})", path.display())))?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn io(message: &str, error: std::io::Error, path: &Path) -> AppError {
    AppError::new(message, format!("{error} ({})", path.display()))
}

/// Finds the picture or clip of each scene and makes sure it still exists.
fn find_sources(env: &RenderEnv, request: &RenderRequest, plan: &[ScenePlan]) -> Result<Vec<PathBuf>, AppError> {
    plan.iter()
        .map(|p| {
            let scene = &request.scenes[p.scene];
            if scene.source.kind == SourceKind::Black {
                return Ok(PathBuf::new());
            }
            let path = resolve(&env.project_dir, &scene.source.path)?;
            if path.is_file() {
                Ok(path)
            } else {
                Err(AppError::new(
                    format!("The file for scene {} is missing. It may have been moved or deleted. Replace it in the Edit step and try again.", scene.id),
                    format!("Missing: {}", path.display()),
                ))
            }
        })
        .collect()
}

fn unique_path(folder: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = folder.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    (2..1000).map(|n| folder.join(format!("{stem}_{n}.{extension}"))).find(|p| !p.exists()).unwrap_or(first)
}

pub async fn render(job: &Job, env: &RenderEnv, request: &RenderRequest) -> Result<RenderResult, AppError> {
    let started = Instant::now();
    request.validate()?;
    let fps = request.fps;
    let (width, height) = (request.width, request.height);
    let plan = plan::plan_scenes(&request.scenes, fps, request.duration);
    if plan.is_empty() {
        return Err(AppError::new("There is nothing to render: every scene has zero length.", "empty plan"));
    }
    let total_frames: i64 = plan.iter().map(|p| p.frames).sum();
    let sources = find_sources(env, request, &plan)?;
    let mix_inputs = prepare_mix(&env.project_dir, &env.sfx_dir, &request.mix)?;

    let exports = env.project_dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| io("The exports folder could not be created.", e, &exports))?;
    let usable = encoder::available().await;
    let chosen = encoder::choose(usable, env.force_cpu).cloned().ok_or_else(|| {
        AppError::new("No H.264 video encoder is available in the video engine.", "ffmpeg -encoders lists no usable h264 encoder")
    })?;
    let temp = TempDir::create(exports.join(format!(".render-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0))))?;
    let tmp = &temp.0;

    // 1. Audio
    job.set_range(0.0, 10.0);
    let audio = tmp.join("audio.wav");
    mix::render_mix(job, &request.mix, &mix_inputs.voice, &mix_inputs.music, &mix_inputs.cues, tmp, &audio).await?;

    // 2. One clip per scene
    let clip_name = |position: usize| format!("clip_{position:05}.mp4");
    let trans_name = |position: usize| format!("trans_{position:05}.mp4");
    let mut done_frames = 0_i64;
    for (position, scene_plan) in plan.iter().enumerate() {
        job.check()?;
        let scene = &request.scenes[scene_plan.scene];
        let from = 10.0 + 45.0 * done_frames as f64 / total_frames as f64;
        done_frames += scene_plan.frames;
        let to = 10.0 + 45.0 * done_frames as f64 / total_frames as f64;
        job.set_range(from, to);
        let args = plan::clip_args(scene, &sources[position], scene_plan.frames, width, height, fps, request.ken_burns, &tmp.join(clip_name(position)));
        let stage = format!("Preparing scene {} of {}", position + 1, plan.len());
        let mut options = RunOptions::new(&stage, Some(scene_plan.frames as f64 / f64::from(fps)), 0.0, 100.0);
        options.failure_message = format!("Scene {} could not be prepared. Its picture or clip may be damaged.", scene.id);
        run(job, &args, &options).await?;
    }

    // 3. Transitions
    let transitions: Vec<usize> = plan.iter().enumerate().filter(|(_, p)| p.transition_frames > 0).map(|(i, _)| i).collect();
    for (n, &position) in transitions.iter().enumerate() {
        job.check()?;
        job.set_range(55.0 + 5.0 * n as f64 / transitions.len() as f64, 55.0 + 5.0 * (n + 1) as f64 / transitions.len() as f64);
        let scene = &request.scenes[plan[position].scene];
        let picture = tmp.join(format!("last_{position:05}.png"));
        let stage = format!("Making transition {} of {}", n + 1, transitions.len());
        let mut options = RunOptions::new(&stage, None, 0.0, 50.0);
        options.failure_message = format!("The transition into scene {} could not be made.", scene.id);
        run(job, &plan::last_frame_args(&tmp.join(clip_name(position - 1)), &picture), &options).await?;
        let args = plan::transition_args(&picture, &tmp.join(clip_name(position)), scene.transition.kind, plan[position].transition_frames, fps, &tmp.join(trans_name(position)));
        let mut options = RunOptions::new(&stage, None, 50.0, 100.0);
        options.failure_message = format!("The transition into scene {} could not be made.", scene.id);
        run(job, &args, &options).await?;
        let _ = std::fs::remove_file(&picture);
    }

    // 4. Join, captions, audio, encode
    let list = tmp.join("join.txt");
    let parts = plan::join_parts(&plan, &clip_name, &trans_name);
    std::fs::write(&list, plan::concat_list(&parts, fps)).map_err(|e| io("The scene list could not be written.", e, &list))?;

    let mut filter = String::new();
    if let Some(captions) = &request.captions {
        let ass = tmp.join("captions.ass");
        std::fs::write(&ass, build_ass(captions)).map_err(|e| io("The captions could not be prepared.", e, &ass))?;
        filter.push_str(&format!("subtitles=filename={}:fontsdir={},", plan::filter_path(&ass), plan::filter_path(&env.fonts_dir)));
    }
    filter.push_str("format=yuv420p");

    // Motion graphics: each one is a folder of transparent frames, read as one more input.
    let mut graph = Graph { inputs: Vec::new(), filter: vec!["-vf".into(), filter.clone()], maps: vec!["-map".into(), "0:v:0".into(), "-map".into(), "1:a:0".into()] };
    if !request.overlays.is_empty() {
        let mut inputs = Vec::new();
        for overlay in &request.overlays {
            if let Some(clip) = &overlay.clip {
                let file = env.project_dir.join(clip);
                if !file.is_file() {
                    return Err(AppError::new("A motion graphic is missing. Please make it again.", format!("no clip {}", file.display())));
                }
                graph.inputs.extend(["-i".into(), arg(&file)]);
            } else {
                let dir = env.project_dir.join(&overlay.frames_dir);
                if !dir.join("00000.png").is_file() {
                    return Err(AppError::new("A motion graphic is missing. Please make it again.", format!("no frames in {}", dir.display())));
                }
                graph.inputs.extend(["-framerate".into(), overlay.fps.to_string(), "-start_number".into(), "0".into(), "-i".into(), arg(&dir.join("%05d.png"))]);
            }
            inputs.push(plan::OverlayInput { start: overlay.start, exact_frames: overlay.clip.is_some() });
        }
        graph.filter = vec!["-filter_complex".into(), plan::overlay_graph_for(&inputs, request.width, request.height, request.fps, &filter)];
        graph.maps = vec!["-map".into(), "[vout]".into(), "-map".into(), "1:a:0".into()];
    }

    job.set_range(60.0, 98.0);
    let encoded = tmp.join("video.mp4");
    let used = encode(job, request, &list, &audio, &graph, &encoded, total_frames, &chosen, usable).await?;

    // 5. Save and check
    job.set_range(98.0, 100.0);
    job.progress("Saving the video", 0.0);
    let stem = plan::output_stem(&request.project_name, &request.aspect_label, &request.date, request.suffix.as_deref());
    let final_path = unique_path(&exports, &stem, "mp4");
    std::fs::rename(&encoded, &final_path).map_err(|e| io("The finished video could not be saved in the exports folder.", e, &final_path))?;
    let mut warnings = Vec::new();

    let srt_path = match request.srt.as_deref().filter(|t| !t.trim().is_empty()) {
        Some(text) => {
            let path = final_path.with_extension("srt");
            match std::fs::write(&path, text) {
                Ok(()) => Some(path),
                Err(e) => {
                    warnings.push(format!("The subtitle file (SRT) could not be saved: {e}"));
                    None
                }
            }
        }
        None => None,
    };

    let mut copy_path = None;
    if let Some(folder) = env.export_folder.as_deref().filter(|f| !f.as_os_str().is_empty()) {
        let target = unique_path(folder, &stem, "mp4");
        let _ = std::fs::create_dir_all(folder);
        match std::fs::copy(&final_path, &target) {
            Ok(_) => {
                copy_path = Some(target.clone());
                if let Some(srt) = &srt_path {
                    let _ = std::fs::copy(srt, target.with_extension("srt"));
                }
            }
            Err(e) => warnings.push(format!("The copy in your export folder could not be saved ({}): {e}", folder.display())),
        }
    }

    let info = probe(&final_path).await?;
    let size_bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    let duration_ok = (info.duration - request.duration).abs() <= 0.1;
    if !duration_ok {
        warnings.push(format!("The video is {:.2} s long but the voice is {:.2} s.", info.duration, request.duration));
    }
    job.progress("Done", 100.0);
    Ok(RenderResult {
        path: arg(&final_path),
        copy_path: copy_path.map(|p| arg(&p)),
        srt_path: srt_path.map(|p| arg(&p)),
        size_bytes,
        duration: info.duration,
        expected_duration: request.duration,
        duration_ok,
        width: info.width,
        height: info.height,
        encoder: used.label,
        seconds_taken: started.elapsed().as_secs_f64(),
        warnings,
    })
}

/// The extra inputs, the filter and the stream choice of the final encode.
struct Graph {
    inputs: Vec<String>,
    filter: Vec<String>,
    maps: Vec<String>,
}

/// The last step. If a graphics-card encoder fails in the middle (a driver problem), the CPU encoder takes over.
#[allow(clippy::too_many_arguments)]
async fn encode(job: &Job, request: &RenderRequest, list: &Path, audio: &Path, graph: &Graph, output: &Path, total_frames: i64, first: &EncoderInfo, usable: &[EncoderInfo]) -> Result<EncoderInfo, AppError> {
    let mut attempt = first.clone();
    loop {
        let mut args: Vec<String> = vec!["-f".into(), "concat".into(), "-safe".into(), "0".into(), "-i".into(), arg(list), "-i".into(), arg(audio)];
        args.extend(graph.inputs.iter().cloned());
        args.extend(graph.filter.iter().cloned());
        args.extend(graph.maps.iter().cloned());
        args.extend(encoder::encoder_args(&attempt.id, request.width, request.height, request.fps));
        args.extend(["-r", &request.fps.to_string(), "-fps_mode", "cfr", "-frames:v", &total_frames.to_string(), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", &format!("{:.3}", request.duration), "-movflags", "+faststart"].map(String::from));
        args.push(arg(output));
        let stage = format!("Encoding the video with {}", attempt.label);
        let mut options = RunOptions::new(&stage, Some(request.duration), 0.0, 100.0);
        options.failure_message = "The video could not be encoded.".to_string();
        match run(job, &args, &options).await {
            Ok(_) => return Ok(attempt),
            Err(error) if error.code.as_deref() == Some("cancelled") => return Err(error),
            Err(error) => {
                let cpu = if attempt.gpu { encoder::choose(usable, true).filter(|e| !e.gpu).cloned() } else { None };
                match cpu {
                    Some(cpu) => {
                        let _ = std::fs::remove_file(output);
                        attempt = cpu;
                    }
                    None => return Err(error),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::{command, Tool};
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};

    async fn ffmpeg(args: &[&str]) {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-y"]).args(args);
        let out = cmd.output().await.unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }

    async fn count_frames(path: &Path) -> i64 {
        // Copies the packets to nowhere and reads the frame counter from the progress report.
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-nostats", "-i"]).arg(path).args(["-map", "0:v:0", "-c", "copy", "-f", "null", "-progress", "pipe:1", "-"]);
        let out = cmd.output().await.unwrap();
        String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.strip_prefix("frame=")).filter_map(|v| v.trim().parse().ok()).last().unwrap()
    }

    fn request(json: serde_json::Value) -> RenderRequest {
        serde_json::from_value(json).unwrap()
    }

    fn scene(id: &str, start: f64, end: f64, source: serde_json::Value, motion: &str, transition: &str) -> serde_json::Value {
        serde_json::json!({"id": id, "start": start, "end": end, "source": source, "motion": motion, "fit": "crop", "speed": 1, "transition": {"kind": transition, "seconds": 0.5}})
    }

    #[tokio::test]
    async fn renders_a_small_project_with_the_exact_voice_length() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-render-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["media", "audio", "exports"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let p = |name: &str| dir.join(name).to_string_lossy().into_owned();
        ffmpeg(&["-f", "lavfi", "-i", "testsrc2=s=800x600", "-frames:v", "1", &p("media/a.png")]).await;
        ffmpeg(&["-f", "lavfi", "-i", "testsrc=s=320x240:r=25:d=2", "-pix_fmt", "yuv420p", &p("media/b.mp4")]).await;
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=12.04", &p("audio/voice.wav")]).await;

        let image = serde_json::json!({"kind": "image", "path": "media/a.png"});
        let video = serde_json::json!({"kind": "video", "path": "media/b.mp4", "duration": 2.0});
        let black = serde_json::json!({"kind": "black"});
        let request = request(serde_json::json!({
            "projectName": "Test 한국어", "width": 640, "height": 360, "fps": 30, "duration": 12.04,
            "scenes": [
                scene("S01", 0.0, 3.1, image.clone(), "zoom_in", "cut"),
                scene("S02", 3.1, 6.07, video, "none", "dissolve"),
                scene("S03", 6.07, 9.0, image, "pan_left", "slide"),
                scene("S04", 9.0, 12.04, black, "none", "fade"),
            ],
            "kenBurns": true,
            "captions": {"width": 640, "height": 360, "look": {"preset": "highlight", "font": "Noto Sans", "fontSize": 28, "primary": "#FFFFFF", "highlight": "#FFD400", "outline": 2, "shadow": 1, "position": "bottom", "uppercase": false, "bold": true, "marginV": 30, "marginH": 30},
                "lines": [{"start": 0.5, "end": 2.5, "words": [{"text": "Hello", "start": 0.5, "end": 1.0}, {"text": "world", "start": 1.0, "end": 2.5}], "breakAt": null}]},
            "srt": "1\n00:00:00,500 --> 00:00:02,500\nHello world\n",
            "mix": {"duration": 12.04, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": true},
            "aspectLabel": "16x9", "suffix": null, "date": "2026-10-18"
        }));
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("fonts"), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "render");

        let result = render(&job, &env, &request).await.unwrap();
        assert!(result.duration_ok, "video {:.3} s, voice 12.04 s", result.duration);
        assert_eq!((result.width, result.height), (640, 360));
        assert_eq!(count_frames(Path::new(&result.path)).await, 361, "round(12.04 * 30) frames");
        assert!(result.path.ends_with("Test_한국어_16x9_2026-10-18.mp4"), "{}", result.path);
        assert!(result.srt_path.as_deref().is_some_and(|p| Path::new(p).is_file()));
        assert!(result.size_bytes > 10_000);
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        assert!(!std::fs::read_dir(dir.join("exports")).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".render")), "temporary files must be removed");
        let percents: Vec<f64> = log.lock().unwrap().iter().map(|p| p.percent).collect();
        assert!(percents.windows(2).all(|w| w[1] >= w[0] - 0.01), "progress never goes back: {percents:?}");
        assert!(percents.last().copied().unwrap_or(0.0) >= 99.9);
        let _ = std::fs::remove_dir_all(&dir);
    }

    async fn pixel_at(video: &Path, seconds: f64) -> [u8; 3] {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-ss", &seconds.to_string(), "-i"]).arg(video).args(["-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        assert_eq!(out.stdout.len(), 3, "{}", String::from_utf8_lossy(&out.stderr));
        [out.stdout[0], out.stdout[1], out.stdout[2]]
    }

    #[tokio::test]
    async fn a_motion_graphic_appears_at_its_start_time_and_goes_away_after_its_last_frame() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-render-overlay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["audio", "exports", "motion/m1/frames"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let p = |name: &str| dir.join(name).to_string_lossy().into_owned();
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=4", &p("audio/voice.wav")]).await;
        // 12 opaque red frames (1 second at 12 fps).
        ffmpeg(&["-f", "lavfi", "-i", "color=c=red:s=640x360:r=12:d=1,format=rgba", "-start_number", "0", &p("motion/m1/frames/%05d.png")]).await;
        let request = request(serde_json::json!({
            "projectName": "Overlay", "width": 640, "height": 360, "fps": 30, "duration": 4.0,
            "scenes": [scene("S01", 0.0, 4.0, serde_json::json!({"kind": "black"}), "none", "cut")],
            "kenBurns": false,
            "overlays": [{"framesDir": "motion/m1/frames", "start": 1.5, "fps": 12}],
            "mix": {"duration": 4.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "suffix": null, "date": "2026-10-18"
        }));
        request.validate().unwrap();
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: dir.clone(), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "overlay");
        let result = render(&job, &env, &request).await.unwrap();
        assert!(result.duration_ok, "{:.3}", result.duration);
        let video = Path::new(&result.path);
        let red = |px: [u8; 3]| px[0] > 150 && px[1] < 90 && px[2] < 90;
        assert!(!red(pixel_at(video, 0.8).await), "before the start");
        assert!(red(pixel_at(video, 2.0).await), "while it plays");
        assert!(!red(pixel_at(video, 3.4).await), "after the last frame");
        let _ = std::fs::remove_dir_all(&dir);
    }

    use crate::graphics::export::test_support::{flat_frame, make_clip};
    use crate::graphics::export::GraphicExports;

    /// The picture at `seconds` scaled to `w` x `h`, as RGB bytes.
    async fn frame_rgb(video: &Path, seconds: f64, w: u32, h: u32) -> Vec<u8> {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-ss", &format!("{seconds:.4}"), "-i"]).arg(video).args(["-frames:v", "1", "-vf", &format!("scale={w}:{h}"), "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        assert_eq!(out.stdout.len() as u32, w * h * 3, "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    /// The average colour of every frame, in order.
    async fn frame_colours(video: &Path) -> Vec<[u8; 3]> {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-i"]).arg(video).args(["-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        out.stdout.chunks(3).map(|c| [c[0], c[1], c[2]]).collect()
    }

    fn is_red(px: &[u8]) -> bool {
        px[0] > 150 && px[1] < 90 && px[2] < 90
    }

    fn overlay_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-render-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["audio", "exports"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        dir
    }

    fn overlay_request(duration: f64, clip: &str, start: f64, extra: serde_json::Value) -> RenderRequest {
        let mut json = serde_json::json!({
            "projectName": "Clip", "width": 640, "height": 360, "fps": 30, "duration": duration,
            "scenes": [scene("S01", 0.0, duration, serde_json::json!({"kind": "black"}), "none", "cut")],
            "kenBurns": false,
            "overlays": [{"clip": clip, "start": start, "fps": 30}],
            "mix": {"duration": duration, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "suffix": null, "date": "2026-10-18"
        });
        if let (Some(map), Some(more)) = (json.as_object_mut(), extra.as_object()) {
            map.extend(more.clone());
        }
        request(json)
    }

    #[tokio::test]
    async fn a_graphic_clip_starts_on_its_exact_frame_and_the_video_keeps_its_exact_length() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = overlay_project("clip");
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=4", &dir.join("audio/voice.wav").to_string_lossy()]).await;
        // One second (30 frames) of opaque red, laid over the video at 1.5 s = frame 45.
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let clip = make_clip(&exports, &registry, &dir, "g1", 640, 360, 30, &|_| flat_frame(640, 360, [255, 0, 0, 255])).await;
        let request = overlay_request(4.0, &clip.path, 1.5, serde_json::json!({}));
        request.validate().unwrap();
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: dir.clone(), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let (job, _) = test_job(&registry, "clip");
        let result = render(&job, &env, &request).await.unwrap();
        assert!(result.duration_ok, "{:.3}", result.duration);
        let video = Path::new(&result.path);
        assert_eq!(count_frames(video).await, 120, "round(4.0 * 30) frames, nothing added or lost by the graphic");
        // Every frame in order (no seeking, which is only approximate): red must be exactly frames 45 to 74.
        let colours = frame_colours(video).await;
        assert_eq!(colours.len(), 120);
        let red: Vec<usize> = colours.iter().enumerate().filter(|(_, p)| is_red(&p[..])).map(|(i, _)| i).collect();
        assert_eq!((red.first().copied(), red.last().copied(), red.len()), (Some(45), Some(74), 30), "the clip covers frames 45 to 74 (1.5 s to 2.5 s)");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Composites a clip over a flat background with the same filter graph the render uses; returns the first frame as RGB.
    async fn composite_over(background: &str, clip: &Path, width: u32, height: u32) -> Vec<u8> {
        let graph = plan::overlay_graph_for(&[plan::OverlayInput { start: 0.0, exact_frames: true }], width, height, 30, "format=yuv420p");
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", &format!("color=c={background}:s={width}x{height}:r=30:d=0.5,format=yuv420p"), "-f", "lavfi", "-i", "anullsrc=d=0.5", "-i"])
            .arg(clip)
            .args(["-filter_complex", &graph, "-map", "[vout]", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        assert_eq!(out.stdout.len() as u32, width * height * 3, "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    /// Straight-alpha pixels with every alpha from 0 to 255 along the row, in one colour.
    fn ramp(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for _ in 0..height {
            for x in 0..width {
                bytes.extend_from_slice(&[rgb[0], rgb[1], rgb[2], (x * 255 / (width - 1)) as u8]);
            }
        }
        bytes
    }

    #[tokio::test]
    async fn soft_edges_have_no_dark_or_white_halo_over_black_and_over_white() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = overlay_project("halo");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let (w, h) = (256u32, 16u32);
        // White text with soft edges (alpha 0..255).
        let white = make_clip(&exports, &registry, &dir, "white", w, h, 3, &|_| ramp(w, h, [255, 255, 255])).await;
        let over_black = composite_over("black", &dir.join(&white.path), w, h).await;
        let over_white = composite_over("white", &dir.join(&white.path), w, h).await;
        for x in 0..w {
            let i = ((8 * w + x) * 3) as usize;
            let alpha = (x * 255 / (w - 1)) as i32;
            // White over black is exactly the alpha (a white halo would be brighter, a dark one darker).
            assert!((i32::from(over_black[i]) - alpha).abs() <= 4, "over black at x={x}: {} vs {alpha}", over_black[i]);
            // White over white stays white (a dark halo would show up as gray).
            assert!(over_white[i] >= 251 && over_white[i + 1] >= 251 && over_white[i + 2] >= 251, "over white at x={x}: {:?}", &over_white[i..i + 3]);
        }
        // Black text with soft edges over white: 255 - alpha.
        let black = make_clip(&exports, &registry, &dir, "black", w, h, 3, &|_| ramp(w, h, [0, 0, 0])).await;
        let black_over_white = composite_over("white", &dir.join(&black.path), w, h).await;
        let black_over_black = composite_over("black", &dir.join(&black.path), w, h).await;
        for x in 0..w {
            let i = ((8 * w + x) * 3) as usize;
            let alpha = (x * 255 / (w - 1)) as i32;
            assert!((i32::from(black_over_white[i]) - (255 - alpha)).abs() <= 4, "black over white at x={x}: {} vs {}", black_over_white[i], 255 - alpha);
            assert!(black_over_black[i] <= 4, "black over black at x={x}: {}", black_over_black[i]);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_graphic_colour_matches_the_same_colour_in_a_picture() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = overlay_project("colour");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let clip = make_clip(&exports, &registry, &dir, "c", 64, 64, 3, &|_| flat_frame(64, 64, [200, 100, 50, 255])).await;
        let graphic = composite_over("black", &dir.join(&clip.path), 64, 64).await;
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=c=0xC86432:s=64x64:r=30:d=0.5,format=yuv420p", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        let picture = cmd.output().await.unwrap().stdout;
        assert_eq!(picture.len(), graphic.len());
        let worst = graphic.iter().zip(&picture).map(|(a, b)| (i32::from(*a) - i32::from(*b)).abs()).max().unwrap();
        assert!(worst <= 2, "the graphic and a picture of the same colour differ by {worst} levels: the colour conversion must be the same");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn captions_are_always_drawn_above_graphics() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = overlay_project("captions");
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=3", &dir.join("audio/voice.wav").to_string_lossy()]).await;
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        // A red graphic that covers the whole picture for the whole video; the captions must still be readable on top.
        let clip = make_clip(&exports, &registry, &dir, "g", 640, 360, 90, &|_| flat_frame(640, 360, [255, 0, 0, 255])).await;
        let captions = serde_json::json!({"width": 640, "height": 360, "look": {"preset": "highlight", "font": "Noto Sans", "fontSize": 48, "primary": "#FFFFFF", "highlight": "#FFFFFF", "outline": 0, "shadow": 0, "position": "bottom", "uppercase": false, "bold": true, "marginV": 30, "marginH": 30},
            "lines": [{"start": 0.0, "end": 3.0, "words": [{"text": "Hello", "start": 0.0, "end": 1.0}, {"text": "world", "start": 1.0, "end": 3.0}], "breakAt": null}]});
        let request = overlay_request(3.0, &clip.path, 0.0, serde_json::json!({"captions": captions}));
        request.validate().unwrap();
        let fonts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("fonts");
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: fonts, sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let (job, _) = test_job(&registry, "captions");
        let result = render(&job, &env, &request).await.unwrap();
        assert!(result.duration_ok);
        let rgb = frame_rgb(Path::new(&result.path), 2.0, 320, 180).await;
        // Only white has green and blue: the graphic is pure red.
        let white = rgb.chunks(3).filter(|p| p[1] > 150 && p[2] > 150).count();
        let red = rgb.chunks(3).filter(|p| is_red(p)).count();
        assert!(white > 40, "caption letters are visible on top of the graphic ({white} white pixels)");
        assert!(red > 320 * 180 / 2, "the graphic covers the rest ({red} red pixels)");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_clip_overlay_must_be_a_mov_inside_the_project() {
        let base = |overlay: serde_json::Value| request(serde_json::json!({
            "projectName": "x", "width": 640, "height": 360, "fps": 30, "duration": 4.0,
            "scenes": [scene("S01", 0.0, 4.0, serde_json::json!({"kind": "black"}), "none", "cut")], "kenBurns": false, "overlays": [overlay],
            "mix": {"duration": 4.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "date": "2026-10-18"
        }));
        assert!(base(serde_json::json!({"clip": "graphics/g1/clip.mov", "start": 1.0, "fps": 30})).validate().is_ok());
        assert!(base(serde_json::json!({"clip": "../clip.mov", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"clip": "/tmp/clip.mov", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"clip": "graphics/g1/clip.png", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"clip": "graphics/g1/clip.mov", "framesDir": "motion/a", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"start": 1.0, "fps": 30})).validate().is_err(), "neither frames nor clip");
    }

    #[test]
    fn overlay_folders_must_stay_inside_the_project() {
        let base = |overlay: serde_json::Value| request(serde_json::json!({
            "projectName": "x", "width": 640, "height": 360, "fps": 30, "duration": 4.0,
            "scenes": [scene("S01", 0.0, 4.0, serde_json::json!({"kind": "black"}), "none", "cut")], "kenBurns": false, "overlays": [overlay],
            "mix": {"duration": 4.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "date": "2026-10-18"
        }));
        assert!(base(serde_json::json!({"framesDir": "motion/a/frames", "start": 1.0, "fps": 30})).validate().is_ok());
        assert!(base(serde_json::json!({"framesDir": "../x", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"framesDir": "/etc", "start": 1.0, "fps": 30})).validate().is_err());
        assert!(base(serde_json::json!({"framesDir": "motion/a", "start": 9.0, "fps": 30})).validate().is_err());
    }

    /// The big one: 20 minutes, 200 scenes, 1080p with captions and transitions. Slow, so it only runs on request:
    /// `cargo test --release performance_20_minutes -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "takes many minutes"]
    async fn performance_20_minutes_200_scenes_1080p() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-render-perf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["media", "audio", "exports"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let p = |name: &str| dir.join(name).to_string_lossy().into_owned();
        for i in 0..10 {
            ffmpeg(&["-f", "lavfi", "-i", &format!("testsrc2=s=1920x1080:r=1,hue=h={}", i * 36), "-frames:v", "1", &p(&format!("media/{i}.png"))]).await;
        }
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=1200", &p("audio/voice.wav")]).await;
        let scenes: Vec<_> = (0..200)
            .map(|i| {
                let kind = if i % 5 == 2 { "dissolve" } else if i % 5 == 4 { "slide" } else { "cut" };
                let motion = ["zoom_in", "zoom_out", "pan_left", "pan_right"][i % 4];
                scene(&format!("S{:02}", i + 1), i as f64 * 6.0, (i + 1) as f64 * 6.0, serde_json::json!({"kind": "image", "path": format!("media/{}.png", i % 10)}), motion, if i == 0 { "cut" } else { kind })
            })
            .collect();
        let lines: Vec<_> = (0..200)
            .map(|i| serde_json::json!({"start": i as f64 * 6.0 + 0.3, "end": i as f64 * 6.0 + 5.5, "words": [{"text": "Caption", "start": i as f64 * 6.0 + 0.3, "end": i as f64 * 6.0 + 2.0}, {"text": "line", "start": i as f64 * 6.0 + 2.0, "end": i as f64 * 6.0 + 5.5}], "breakAt": null}))
            .collect();
        let request = request(serde_json::json!({
            "projectName": "Perf", "width": 1920, "height": 1080, "fps": 30, "duration": 1200.0, "scenes": scenes, "kenBurns": true,
            "captions": {"width": 1920, "height": 1080, "look": {"preset": "highlight", "font": "Noto Sans", "fontSize": 48, "primary": "#FFFFFF", "highlight": "#FFD400", "outline": 3, "shadow": 1, "position": "bottom", "uppercase": false, "bold": true, "marginV": 60, "marginH": 60}, "lines": lines},
            "srt": null,
            "mix": {"duration": 1200.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": true},
            "aspectLabel": "16x9", "suffix": null, "date": "2026-10-18"
        }));
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("fonts"), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "perf");
        let started = std::time::Instant::now();
        let result = render(&job, &env, &request).await.unwrap();
        println!("PERF render 20 min / 200 scenes / 1080p: {:.0} s wall, encoder {}, {} MB, duration {:.3} s (ok: {}), progress events {}", started.elapsed().as_secs_f64(), result.encoder, result.size_bytes / 1_000_000, result.duration, result.duration_ok, log.lock().unwrap().len());
        assert!(result.duration_ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancel_stops_the_render_and_removes_temporary_files() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-render-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["audio", "exports"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=60", dir.join("audio/voice.wav").to_str().unwrap()]).await;
        let scenes: Vec<_> = (0..12).map(|i| scene(&format!("S{i:02}"), i as f64 * 5.0, (i + 1) as f64 * 5.0, serde_json::json!({"kind": "black"}), "none", "cut")).collect();
        let request = request(serde_json::json!({
            "projectName": "Cancel", "width": 1280, "height": 720, "fps": 30, "duration": 60.0, "scenes": scenes, "kenBurns": true, "captions": null, "srt": null,
            "mix": {"duration": 60.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "date": "2026-10-18"
        }));
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: dir.clone(), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "cancel-render");
        let canceller = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            canceller.cancel("cancel-render");
        });
        let started = std::time::Instant::now();
        let error = render(&job, &env, &request).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("cancelled"));
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        let leftovers: Vec<_> = std::fs::read_dir(dir.join("exports")).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "nothing may be left behind: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_missing_file_gives_a_friendly_error_before_any_work() {
        let dir = std::env::temp_dir().join(format!("ave-render-missing-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("exports")).unwrap();
        let request = request(serde_json::json!({
            "projectName": "Missing", "width": 640, "height": 360, "fps": 30, "duration": 3.0,
            "scenes": [scene("S01", 0.0, 3.0, serde_json::json!({"kind": "image", "path": "media/gone.png"}), "zoom_in", "cut")],
            "kenBurns": true, "mix": {"duration": 3.0, "voicePath": "audio/voice.wav", "music": {"tracks": [], "volume": 0.2, "fadeIn": 2, "fadeOut": 3, "mode": "loop", "ducking": "normal"}, "sfx": [], "normalize": false},
            "aspectLabel": "16x9", "date": "2026-10-18"
        }));
        let env = RenderEnv { project_dir: dir.clone(), fonts_dir: dir.clone(), sfx_dir: dir.clone(), export_folder: None, force_cpu: true };
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "missing");
        let error = render(&job, &env, &request).await.unwrap_err();
        assert!(error.message.contains("scene S01 is missing"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
