//! Transparent export of a graphic: the frontend draws frame after frame (TypeScript renderer) and sends each one as
//! raw RGBA bytes; this module pipes them into FFmpeg, which writes a lossless MOV with the PNG codec and an alpha channel.
//!
//! Why MOV + PNG: the bundled LGPL FFmpeg has the `png` encoder and the `mov` muxer but neither ProRes 4444 nor VP9 with
//! alpha. The PNG codec is lossless, keeps the alpha exactly and decodes with the decoder the app already has. The only
//! new FFmpeg part is the `rawvideo` demuxer (to read the pipe).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};
use crate::jobs::Job;

pub const FPS: u32 = 30;
/// 20 seconds is the longest graphic (see `LIMITS.maxDuration` in the TypeScript spec), plus one second of room.
pub const MAX_FRAMES: u32 = 21 * FPS;
pub const MIN_SIDE: u32 = 16;
pub const MAX_SIDE: u32 = 4096;
const FINISH_TIMEOUT: Duration = Duration::from_secs(120);
const ERROR_TAIL: usize = 1200;

/// What the frontend gets back.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphicClip {
    /// Inside the project, e.g. `graphics/g1/clip.mov`.
    pub path: String,
    pub frames: u32,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

fn bad(message: &str, details: String) -> AppError {
    AppError::new(message, details)
}

/// The graphic id is part of a folder name, so it is strictly checked.
pub fn valid_graphic_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn validate(id: &str, width: u32, height: u32, frames: u32) -> Result<(), AppError> {
    if !valid_graphic_id(id) {
        return Err(bad("The graphic has a wrong name.", format!("graphic id = {id:?}")));
    }
    if width % 2 != 0 || height % 2 != 0 || !(MIN_SIDE..=MAX_SIDE).contains(&width) || !(MIN_SIDE..=MAX_SIDE).contains(&height) {
        return Err(bad("The graphic has a wrong size.", format!("{width}x{height}: both sides must be even numbers from {MIN_SIDE} to {MAX_SIDE}")));
    }
    if frames == 0 || frames > MAX_FRAMES {
        return Err(bad("The graphic has a wrong length.", format!("{frames} frames (1 to {MAX_FRAMES})")));
    }
    Ok(())
}

/// Bytes of one frame (RGBA, straight alpha, rows top to bottom).
pub fn frame_bytes(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

/// FFmpeg arguments: raw RGBA frames on stdin, exactly `frames` of them at 30 fps, lossless PNG in MOV with alpha.
pub fn ffmpeg_args(width: u32, height: u32, frames: u32, out: &Path) -> Vec<String> {
    let s = |x: &str| x.to_string();
    vec![
        s("-hide_banner"), s("-y"), s("-loglevel"), s("error"),
        s("-f"), s("rawvideo"), s("-pix_fmt"), s("rgba"), s("-video_size"), format!("{width}x{height}"), s("-framerate"), FPS.to_string(),
        s("-i"), s("pipe:0"),
        s("-frames:v"), frames.to_string(),
        s("-an"), s("-c:v"), s("png"), s("-pix_fmt"), s("rgba"), s("-r"), FPS.to_string(),
        s("-f"), s("mov"), out.to_string_lossy().into_owned(),
    ]
}

struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr: tokio::task::JoinHandle<String>,
    width: u32,
    height: u32,
    frames: u32,
    written: u32,
    tmp: PathBuf,
    done: PathBuf,
    relative: String,
    job: Job,
}

/// The exports in progress (Tauri state). One export is one background job.
#[derive(Default, Clone)]
pub struct GraphicExports {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
}

fn tail(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    if chars.len() <= ERROR_TAIL { chars.into_iter().collect() } else { format!("…{}", chars[chars.len() - ERROR_TAIL..].iter().collect::<String>()) }
}

impl GraphicExports {
    /// Starts FFmpeg for one graphic. `job` is the background job the UI shows (progress, Cancel).
    pub async fn start(&self, job: Job, project_dir: &Path, graphic_id: &str, width: u32, height: u32, frames: u32) -> Result<(), AppError> {
        validate(graphic_id, width, height, frames)?;
        let folder = project_dir.join("graphics").join(graphic_id);
        std::fs::create_dir_all(&folder).map_err(|e| AppError::new("The graphic folder could not be made.", format!("{}: {e}", folder.display())))?;
        let tmp = folder.join("clip.mov.tmp");
        let done = folder.join("clip.mov");
        let _ = std::fs::remove_file(&tmp);
        let mut cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
        cmd.args(ffmpeg_args(width, height, frames, &tmp)).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e.to_string()))?;
        let stdin = child.stdin.take();
        let stderr = child.stderr.take();
        let stderr = tokio::spawn(async move {
            let mut bytes = Vec::new();
            if let Some(stderr) = stderr {
                let _ = stderr.take(256 * 1024).read_to_end(&mut bytes).await;
            }
            String::from_utf8_lossy(&bytes).into_owned()
        });
        job.progress("Drawing the graphic", 0.0);
        let session = Session { child, stdin, stderr, width, height, frames, written: 0, tmp, done, relative: format!("graphics/{graphic_id}/clip.mov"), job };
        let id = session.job.id().to_string();
        let mut sessions = self.sessions.lock().await;
        sessions.insert(id, Arc::new(Mutex::new(session)));
        Ok(())
    }

    async fn find(&self, job_id: &str) -> Result<Arc<Mutex<Session>>, AppError> {
        self.sessions.lock().await.get(job_id).cloned().ok_or_else(|| AppError::new("The graphic export is not running.", format!("no export {job_id:?}")))
    }

    /// Sends the next frame. Fails when Cancel was pressed (the export is cleaned up first).
    pub async fn frame(&self, job_id: &str, bytes: &[u8]) -> Result<(), AppError> {
        let session = self.find(job_id).await?;
        let mut s = session.lock().await;
        if s.job.is_cancelled() {
            drop(s);
            self.abort(job_id).await;
            return Err(AppError::cancelled());
        }
        let expected = frame_bytes(s.width, s.height);
        if bytes.len() != expected {
            let details = format!("a frame has {} bytes, {}x{} RGBA needs {expected}", bytes.len(), s.width, s.height);
            drop(s);
            self.abort(job_id).await;
            return Err(bad("A frame of the graphic has the wrong size.", details));
        }
        if s.written >= s.frames {
            drop(s);
            self.abort(job_id).await;
            return Err(bad("The graphic has too many frames.", "more frames than announced".to_string()));
        }
        let Some(stdin) = s.stdin.as_mut() else {
            return Err(bad("The graphic export was already finished.", "stdin closed".to_string()));
        };
        if let Err(e) = stdin.write_all(bytes).await {
            drop(s);
            let text = self.abort_with_error(job_id).await;
            return Err(AppError::new("The video engine stopped while the graphic was being saved.", format!("{e}; FFmpeg said: {text}")));
        }
        s.written += 1;
        let percent = f64::from(s.written) / f64::from(s.frames) * 100.0;
        s.job.progress("Drawing the graphic", percent);
        Ok(())
    }

    /// Closes the pipe, waits for FFmpeg and moves the clip into place.
    pub async fn finish(&self, job_id: &str) -> Result<GraphicClip, AppError> {
        let session = self.find(job_id).await?;
        let mut s = session.lock().await;
        if s.written != s.frames {
            let details = format!("{} of {} frames were sent", s.written, s.frames);
            drop(s);
            self.abort(job_id).await;
            return Err(bad("The graphic is not complete.", details));
        }
        drop(s.stdin.take());
        let status = tokio::time::timeout(FINISH_TIMEOUT, s.child.wait()).await;
        let status = match status {
            Ok(Ok(status)) => status,
            other => {
                let details = format!("FFmpeg did not finish: {other:?}");
                drop(s);
                self.abort(job_id).await;
                return Err(bad("The graphic could not be saved.", details));
            }
        };
        let stderr = (&mut s.stderr).await.unwrap_or_default();
        if !status.success() {
            let details = format!("FFmpeg exited with {status}: {}", tail(&stderr));
            drop(s);
            self.abort(job_id).await;
            return Err(bad("The graphic could not be saved.", details));
        }
        let (tmp, done) = (s.tmp.clone(), s.done.clone());
        let _ = std::fs::remove_file(&done);
        if let Err(e) = std::fs::rename(&tmp, &done) {
            let details = format!("{}: {e}", done.display());
            drop(s);
            self.abort(job_id).await;
            return Err(bad("The graphic could not be saved.", details));
        }
        let size = std::fs::metadata(&done).map(|m| m.len()).unwrap_or(0);
        let clip = GraphicClip { path: s.relative.clone(), frames: s.frames, width: s.width, height: s.height, size_bytes: size };
        s.job.progress("Graphic saved", 100.0);
        drop(s);
        self.sessions.lock().await.remove(job_id);
        Ok(clip)
    }

    /// Stops FFmpeg and removes the temporary file (Cancel, an error, or a closed window).
    pub async fn abort(&self, job_id: &str) {
        let removed = self.sessions.lock().await.remove(job_id);
        if let Some(session) = removed {
            let mut s = session.lock().await;
            drop(s.stdin.take());
            let _ = s.child.kill().await;
            let _ = s.child.wait().await;
            s.stderr.abort();
            let _ = std::fs::remove_file(&s.tmp);
        }
    }

    async fn abort_with_error(&self, job_id: &str) -> String {
        let text = match self.sessions.lock().await.get(job_id).cloned() {
            Some(session) => {
                let mut s = session.lock().await;
                drop(s.stdin.take());
                let _ = tokio::time::timeout(Duration::from_secs(3), s.child.wait()).await;
                match tokio::time::timeout(Duration::from_secs(2), &mut s.stderr).await {
                    Ok(Ok(text)) => tail(&text),
                    _ => String::new(),
                }
            }
            None => String::new(),
        };
        self.abort(job_id).await;
        text
    }
}

/// Helpers shared by the tests of the export and of the final render.
#[cfg(test)]
pub mod test_support {
    use super::*;
    use crate::jobs::{test_job, JobRegistry};

    /// A frame with every kind of alpha (0 at the left edge to 255 at the right) and a moving bright dot.
    pub fn gradient_frame(width: u32, height: u32, k: u32) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(frame_bytes(width, height));
        for y in 0..height {
            for x in 0..width {
                let alpha = (x * 255 / (width - 1)) as u8;
                let dot = (x + 3 * k) % width < 8 && y < 8;
                bytes.extend_from_slice(&[(x * 255 / width) as u8, (y * 255 / height) as u8, (k * 3 % 256) as u8, if dot { 255 } else { alpha }]);
            }
        }
        bytes
    }

    /// One colour everywhere, with the given alpha.
    pub fn flat_frame(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.iter().copied().cycle().take(frame_bytes(width, height)).collect()
    }

    pub async fn make_clip(exports: &GraphicExports, registry: &JobRegistry, dir: &Path, id: &str, width: u32, height: u32, frames: u32, frame: &(dyn Fn(u32) -> Vec<u8> + Sync)) -> GraphicClip {
        let (job, _) = test_job(registry, id);
        exports.start(job, dir, id, width, height, frames).await.expect("start");
        for k in 0..frames {
            exports.frame(id, &frame(k)).await.expect("frame");
        }
        exports.finish(id).await.expect("finish")
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-gexport-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn frame_count(path: &Path) -> i64 {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-nostats", "-i"]).arg(path).args(["-map", "0:v:0", "-c", "copy", "-f", "null", "-progress", "pipe:1", "-"]);
        let out = cmd.output().await.unwrap();
        String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.strip_prefix("frame=")).filter_map(|v| v.trim().parse().ok()).last().unwrap_or(-1)
    }

    /// "00:00:03.00" in the header FFmpeg prints for a file.
    async fn duration_text(path: &Path) -> String {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-i"]).arg(path);
        let out = cmd.output().await.unwrap();
        let text = String::from_utf8_lossy(&out.stderr).into_owned();
        text.split("Duration: ").nth(1).and_then(|t| t.split(',').next()).unwrap_or("").to_string()
    }

    /// The frame shown at `seconds` as RGBA bytes (the clip is lossless, so this is exact).
    async fn decoded(path: &Path, seconds: f64, width: u32, height: u32) -> Vec<u8> {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error", "-ss", &format!("{seconds:.4}"), "-i"]).arg(path).args(["-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        assert_eq!(out.stdout.len(), frame_bytes(width, height), "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    #[test]
    fn sizes_lengths_and_ids_are_checked() {
        assert!(validate("g1", 1920, 1080, 90).is_ok());
        assert!(validate("g1", 1080, 1920, 600).is_ok());
        assert!(validate("g1", 1081, 1080, 90).is_err(), "odd width");
        assert!(validate("g1", 8, 8, 90).is_err(), "too small");
        assert!(validate("g1", 8192, 4320, 90).is_err(), "too large");
        assert!(validate("g1", 640, 360, 0).is_err());
        assert!(validate("g1", 640, 360, MAX_FRAMES + 1).is_err());
        assert!(validate("../x", 640, 360, 10).is_err());
        assert!(validate("", 640, 360, 10).is_err());
        assert!(validate(&"a".repeat(41), 640, 360, 10).is_err());
    }

    #[test]
    fn ffmpeg_reads_raw_rgba_and_writes_png_in_mov() {
        let args = ffmpeg_args(640, 360, 90, Path::new("/p/clip.mov.tmp")).join(" ");
        assert_eq!(args, "-hide_banner -y -loglevel error -f rawvideo -pix_fmt rgba -video_size 640x360 -framerate 30 -i pipe:0 -frames:v 90 -an -c:v png -pix_fmt rgba -r 30 -f mov /p/clip.mov.tmp");
        assert_eq!(frame_bytes(640, 360), 921_600);
    }

    #[tokio::test]
    async fn a_three_second_graphic_has_exactly_90_frames_alpha_and_the_exact_duration() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = temp("three");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let clip = make_clip(&exports, &registry, &dir, "g1", 320, 180, 90, &|k| gradient_frame(320, 180, k)).await;
        assert_eq!((clip.path.as_str(), clip.frames, clip.width, clip.height), ("graphics/g1/clip.mov", 90, 320, 180));
        let file = dir.join(&clip.path);
        assert!(file.is_file() && clip.size_bytes > 1000 && !dir.join("graphics/g1/clip.mov.tmp").exists());
        assert_eq!(frame_count(&file).await, 90);
        assert_eq!(duration_text(&file).await, "00:00:03.00");
        // Lossless with alpha: frame 45 (1.5 s) comes back bit for bit, including every alpha value.
        let back = decoded(&file, 1.5, 320, 180).await;
        assert_eq!(back, gradient_frame(320, 180, 45), "frame 45 is identical to what was sent");
        let alphas: std::collections::BTreeSet<u8> = back.chunks(4).map(|p| p[3]).collect();
        assert!(alphas.contains(&0) && alphas.contains(&255) && alphas.len() > 100, "full alpha range is kept");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn portrait_and_square_canvases_work() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = temp("shapes");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        for (id, w, h) in [("portrait", 360u32, 640u32), ("square", 480, 480)] {
            let clip = make_clip(&exports, &registry, &dir, id, w, h, 6, &|k| gradient_frame(w, h, k)).await;
            let file = dir.join(&clip.path);
            assert_eq!(frame_count(&file).await, 6, "{id}");
            assert_eq!(decoded(&file, 3.0 / 30.0, w, h).await, gradient_frame(w, h, 3), "{id} frame 3");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancel_stops_ffmpeg_and_removes_the_temporary_file() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = temp("cancel");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "cancel-1");
        exports.start(job, &dir, "g2", 320, 180, 90).await.unwrap();
        for k in 0..5 {
            exports.frame("cancel-1", &gradient_frame(320, 180, k)).await.unwrap();
        }
        assert!(dir.join("graphics/g2/clip.mov.tmp").exists());
        assert!(registry.cancel("cancel-1"));
        let error = exports.frame("cancel-1", &gradient_frame(320, 180, 5)).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("cancelled"), "{error:?}");
        assert!(!dir.join("graphics/g2/clip.mov.tmp").exists() && !dir.join("graphics/g2/clip.mov").exists());
        assert!(exports.finish("cancel-1").await.is_err(), "the export is gone");
        // The job id is free again.
        assert!(test_job(&registry, "cancel-1").0.id() == "cancel-1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_wrong_frame_or_a_missing_frame_fails_cleanly() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = temp("wrong");
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "bad-1");
        exports.start(job, &dir, "g3", 320, 180, 10).await.unwrap();
        assert!(exports.frame("bad-1", &[0u8; 100]).await.is_err(), "a frame with the wrong size");
        assert!(!dir.join("graphics/g3/clip.mov.tmp").exists());

        let (job, _) = test_job(&registry, "bad-2");
        exports.start(job, &dir, "g3", 320, 180, 10).await.unwrap();
        for k in 0..4 {
            exports.frame("bad-2", &gradient_frame(320, 180, k)).await.unwrap();
        }
        let error = exports.finish("bad-2").await.unwrap_err();
        assert!(error.details.contains("4 of 10"), "{}", error.details);
        assert!(!dir.join("graphics/g3/clip.mov.tmp").exists() && !dir.join("graphics/g3/clip.mov").exists());
        assert!(exports.frame("nobody", &[]).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
