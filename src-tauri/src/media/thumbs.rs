//! Small preview pictures (for the storyboard, the timeline and Gemini matching) made with FFmpeg.

use std::path::Path;
use std::time::Duration;

use tokio::time::timeout;

use super::Kind;
use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

const THUMB_TIMEOUT: Duration = Duration::from_secs(60);

/// `thumbs/<name>.<width>.<index>.jpg`: one cached picture per file, size and frame.
pub fn thumb_path(name: &str, width: u32, index: u32) -> String {
    format!("thumbs/{name}.{width}.{index}.jpg")
}

/// Moments of a clip to take pictures at: `count` points spread through it (one picture: the middle, at most 1 s in).
pub fn frame_times(duration: f64, count: u32) -> Vec<f64> {
    let count = count.max(1);
    if count == 1 {
        return vec![(duration / 2.0).min(1.0).max(0.0)];
    }
    (0..count).map(|i| duration * (f64::from(i) + 0.5) / f64::from(count)).collect()
}

/// Makes one JPEG, at most `width` pixels wide (never enlarged).
pub async fn make(source: &Path, kind: Kind, at: f64, width: u32, out: &Path) -> Result<(), AppError> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::new("The thumbnail folder could not be created.", e.to_string()))?;
    }
    let mut cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    cmd.args(["-v", "error", "-y"]);
    if kind == Kind::Video {
        cmd.args(["-ss", &format!("{at:.3}")]);
    }
    cmd.arg("-i").arg(source);
    let filter = format!("scale='min({width},iw)':-2");
    cmd.args(["-frames:v", "1", "-vf", &filter, "-q:v", "5"]).arg(out);
    let output = timeout(THUMB_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new("Making a preview picture took too long.", format!("FFmpeg timed out on {}", source.display())))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    if !output.status.success() || !out.is_file() {
        return Err(AppError::new("A preview picture could not be made.", format!("{}: {}", source.display(), String::from_utf8_lossy(&output.stderr).trim())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_times_spread_through_the_clip() {
        assert_eq!(frame_times(10.0, 3).iter().map(|t| (t * 10.0).round() / 10.0).collect::<Vec<_>>(), vec![1.7, 5.0, 8.3]);
        assert_eq!(frame_times(0.4, 1), vec![0.2]);
        assert_eq!(frame_times(30.0, 1), vec![1.0]);
    }

    #[test]
    fn thumbnails_are_cached_by_name_width_and_frame() {
        assert_eq!(thumb_path("S01.png", 320, 0), "thumbs/S01.png.320.0.jpg");
    }

    /// Real FFmpeg: makes a picture and a clip, reads them and makes thumbnails. Skipped when FFmpeg is not available.
    #[tokio::test]
    async fn probes_and_thumbnails_real_files() {
        use crate::ffmpeg::{command, sidecar_path, Tool};
        use crate::media::probe::probe;
        if !sidecar_path(Tool::Ffmpeg).is_ok_and(|p| p.is_file()) {
            return;
        }
        let dir = std::env::temp_dir().join("ave-thumbs-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("a.png");
        let mp4 = dir.join("b.mp4");
        let run = |args: Vec<String>| async move {
            let mut cmd = command(Tool::Ffmpeg).unwrap();
            let out = cmd.args(args).output().await.unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        };
        run(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1"].iter().map(|s| s.to_string()).chain([png.to_string_lossy().into_owned()]).collect()).await;
        run(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=10:d=3", "-pix_fmt", "yuv420p"].iter().map(|s| s.to_string()).chain([mp4.to_string_lossy().into_owned()]).collect()).await;

        let image = probe(&png).await.unwrap();
        assert_eq!((image.kind, image.width, image.height), (Kind::Image, 640, 360));
        let clip = probe(&mp4).await.unwrap();
        assert_eq!((clip.kind, clip.width, clip.height), (Kind::Video, 320, 180));
        assert!((clip.duration - 3.0).abs() < 0.2);

        let small = dir.join("small.jpg");
        make(&png, Kind::Image, 0.0, 200, &small).await.unwrap();
        assert!(std::fs::metadata(&small).unwrap().len() > 100);
        let frame = dir.join("frame.jpg");
        make(&mp4, Kind::Video, 1.5, 1000, &frame).await.unwrap();
        assert!(frame.is_file());
        assert_eq!(probe(&small).await.unwrap().width, 200, "the thumbnail was scaled down");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
