//! Which H.264 encoders this computer can really use: graphics-card encoders when they work, otherwise the CPU.

use serde::Serialize;
use tokio::sync::OnceCell;

use crate::ffmpeg::{command, Tool};

use super::plan::video_bitrate;

/// Best first. The CPU encoders come last.
const CANDIDATES: [(&str, &str, bool); 6] = [
    ("h264_nvenc", "NVIDIA NVENC (graphics card)", true),
    ("h264_qsv", "Intel Quick Sync (graphics chip)", true),
    ("h264_amf", "AMD AMF (graphics card)", true),
    ("h264_videotoolbox", "Apple VideoToolbox (graphics chip)", true),
    ("libx264", "x264 (CPU)", false),
    ("libopenh264", "OpenH264 (CPU)", false),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderInfo {
    /// The FFmpeg name, e.g. "h264_nvenc".
    pub id: String,
    pub label: String,
    /// True for encoders that run on the graphics card or chip.
    pub gpu: bool,
}

/// Finds the encoder names in the output of `ffmpeg -encoders`.
pub fn parse_encoder_list(output: &str) -> Vec<&'static str> {
    CANDIDATES
        .iter()
        .filter(|(id, _, _)| {
            output.lines().any(|line| {
                let mut words = line.split_whitespace();
                let flags = words.next().unwrap_or("");
                flags.starts_with('V') && words.next() == Some(*id)
            })
        })
        .map(|(id, _, _)| *id)
        .collect()
}

fn info(id: &str) -> Option<EncoderInfo> {
    CANDIDATES.iter().find(|(name, _, _)| *name == id).map(|(id, label, gpu)| EncoderInfo { id: (*id).to_string(), label: (*label).to_string(), gpu: *gpu })
}

/// Tries to encode three tiny frames. A card that is listed but has no driver fails here.
async fn works(id: &str) -> bool {
    let Ok(mut cmd) = command(Tool::Ffmpeg) else { return false };
    cmd.args(["-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30", "-frames:v", "3", "-pix_fmt", "yuv420p", "-c:v", id, "-f", "null", "-"]);
    match tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(output)) => output.status.success(),
        _ => false,
    }
}

async fn detect() -> Vec<EncoderInfo> {
    let Ok(mut cmd) = command(Tool::Ffmpeg) else { return Vec::new() };
    cmd.args(["-hide_banner", "-encoders"]);
    let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await else { return Vec::new() };
    let listed = parse_encoder_list(&String::from_utf8_lossy(&output.stdout));
    let mut usable = Vec::new();
    for id in listed {
        if works(id).await {
            usable.extend(info(id));
        }
    }
    usable
}

static DETECTED: OnceCell<Vec<EncoderInfo>> = OnceCell::const_new();

/// The usable encoders, best first. The check runs once (at startup) and is remembered.
pub async fn available() -> &'static [EncoderInfo] {
    DETECTED.get_or_init(detect).await
}

/// The encoder to use: the best graphics-card encoder, unless the person chose the CPU.
pub fn choose(usable: &[EncoderInfo], force_cpu: bool) -> Option<&EncoderInfo> {
    usable.iter().find(|e| !force_cpu && e.gpu).or_else(|| usable.iter().find(|e| !e.gpu))
}

/// FFmpeg output options for the encoder.
pub fn encoder_args(id: &str, width: u32, height: u32, fps: u32) -> Vec<String> {
    let bitrate = video_bitrate(width, height, fps);
    let kbps = |factor: f64| format!("{}k", (bitrate as f64 * factor / 1000.0) as u64);
    let list: Vec<&str> = match id {
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-b:v"],
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-preset", "medium", "-b:v"],
        "h264_amf" => vec!["-c:v", "h264_amf", "-quality", "balanced", "-rc", "vbr_peak", "-b:v"],
        "h264_videotoolbox" => vec!["-c:v", "h264_videotoolbox", "-b:v"],
        "libx264" => return vec!["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "20".into(), "-pix_fmt".into(), "yuv420p".into()],
        _ => vec!["-c:v", "libopenh264", "-b:v"],
    };
    let mut args: Vec<String> = list.into_iter().map(String::from).collect();
    args.push(kbps(1.0));
    if id != "libopenh264" && id != "h264_videotoolbox" {
        args.extend(["-maxrate".to_string(), kbps(1.5)]);
    }
    args.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(id: &str) -> EncoderInfo {
        info(id).unwrap()
    }

    #[test]
    fn finds_listed_h264_encoders() {
        let out = " V....D libopenh264          OpenH264 H.264\n V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n V....D hevc_nvenc  NVIDIA hevc\n A....D aac AAC\n V....D h264_vaapi  VAAPI\n";
        assert_eq!(parse_encoder_list(out), vec!["h264_nvenc", "libopenh264"]);
        assert!(parse_encoder_list("nothing").is_empty());
    }

    #[test]
    fn the_best_card_is_used_unless_cpu_is_forced() {
        let usable = vec![gpu("h264_nvenc"), gpu("h264_qsv"), gpu("libopenh264")];
        assert_eq!(choose(&usable, false).unwrap().id, "h264_nvenc");
        assert_eq!(choose(&usable, true).unwrap().id, "libopenh264");
        assert_eq!(choose(&[gpu("libopenh264")], false).unwrap().id, "libopenh264");
        assert!(choose(&[gpu("h264_nvenc")], true).is_none(), "no CPU encoder at all");
        assert!(choose(&[], false).is_none());
    }

    #[test]
    fn every_encoder_gets_a_bitrate_and_pixel_format() {
        for id in ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "libopenh264"] {
            let args = encoder_args(id, 1920, 1080, 30).join(" ");
            assert!(args.contains(&format!("-c:v {id}")), "{args}");
            assert!(args.contains("-b:v 7"), "{args}");
            assert!(args.contains("-pix_fmt yuv420p"), "{args}");
        }
        assert!(encoder_args("libx264", 1920, 1080, 30).join(" ").contains("-crf 20"));
    }
}
