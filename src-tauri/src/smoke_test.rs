//! Full smoke test of the bundled FFmpeg: one 5-second project that uses every feature of the app.
//! CI runs it against the exact FFmpeg that goes into the installer (`cargo test smoke_test`), so a missing
//! encoder, decoder, filter or format fails the build instead of failing on a user's computer.
//!
//! Covered: picture with Ken Burns, clip with trim, xfade transitions, ASS captions in Latin, Korean, Japanese,
//! Chinese, Devanagari and Urdu (Arabic script), music with ducking, a sound effect, loudness normalisation,
//! silence detection, and reading pictures and sounds in the formats the app accepts.

use std::path::{Path, PathBuf};

use crate::audio::process::{preview, CleanupParams};
use crate::audio::probe::parse_probe;
use crate::captions::{build_ass, AssRequest};
use crate::ffmpeg::{command, Tool};
use crate::ffmpeg_job::sidecars_for_tests;
use crate::jobs::{test_job, JobRegistry};
use crate::probe::probe_text;
use crate::render::model::RenderRequest;
use crate::render::pipeline::{render, RenderEnv};

async fn ffmpeg(args: &[&str]) -> String {
    let mut cmd = command(Tool::Ffmpeg).unwrap();
    cmd.args(["-hide_banner", "-nostdin", "-y"]).args(args);
    let out = cmd.output().await.unwrap();
    let text = String::from_utf8_lossy(&out.stderr).to_string();
    assert!(out.status.success(), "ffmpeg {args:?} failed:\n{text}");
    text
}

/// Decodes a whole file to nowhere. Any error line fails the test.
async fn decodes_cleanly(path: &Path) {
    let text = ffmpeg(&["-v", "error", "-i", &path.to_string_lossy(), "-f", "null", "-"]).await;
    assert!(text.trim().is_empty(), "{} did not decode cleanly:\n{text}", path.display());
}

fn resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources")
}

fn caption_request(font: &str, text: &str) -> AssRequest {
    let words: Vec<serde_json::Value> = text.split(' ').enumerate().map(|(i, w)| serde_json::json!({"text": w, "start": i as f64 * 0.3, "end": i as f64 * 0.3 + 0.3})).collect();
    serde_json::from_value(serde_json::json!({
        "width": 640, "height": 360,
        "look": {"preset": "highlight", "font": font, "fontSize": 36, "primary": "#FFFFFF", "highlight": "#FFD400", "outline": 2, "shadow": 1, "position": "middle", "uppercase": false, "bold": true, "marginV": 30, "marginH": 30},
        "lines": [{"start": 0.0, "end": 1.5, "words": words, "breakAt": null}]
    }))
    .unwrap()
}

#[tokio::test]
async fn smoke_test_every_feature_in_five_seconds() {
    if !sidecars_for_tests() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("ave-smoke-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for sub in ["media", "audio", "exports", "tmp"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    let p = |name: &str| dir.join(name).to_string_lossy().into_owned();

    // 1. Make the inputs with FFmpeg's own generators and encoders (png, mjpeg, webp, mpeg4, mp3, opus, wav).
    ffmpeg(&["-f", "lavfi", "-i", "testsrc2=s=800x600", "-frames:v", "1", &p("media/a.png")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "testsrc2=s=800x600", "-frames:v", "1", &p("media/b.jpg")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "testsrc2=s=800x600", "-frames:v", "1", &p("media/c.webp")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "testsrc=s=320x240:r=25:d=4", "-pix_fmt", "yuv420p", &p("media/clip.mp4")]).await;
    // A voice with a silent gap between 2.0 s and 3.0 s.
    ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=300:duration=5.04", "-af", "volume='if(between(t,2,3),0,1)':eval=frame", &p("audio/voice.wav")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-c:a", "libmp3lame", &p("audio/music.mp3")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", &p("audio/tone.ogg")]).await;
    ffmpeg(&["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", &p("audio/tone.m4a")]).await;

    // 2. Everything the app accepts must be readable and decode without errors.
    for file in ["media/a.png", "media/b.jpg", "media/c.webp", "media/clip.mp4", "audio/voice.wav", "audio/music.mp3", "audio/tone.ogg", "audio/tone.m4a"] {
        let text = probe_text(&dir.join(file), "unreadable").await.unwrap_or_else(|e| panic!("{file}: {e:?}"));
        assert!(crate::probe::parse_info(&text).first(crate::probe::StreamKind::Video).is_some() || crate::probe::parse_info(&text).first(crate::probe::StreamKind::Audio).is_some(), "{file}");
        decodes_cleanly(&dir.join(file)).await;
    }

    // 3. Silence detection finds the gap.
    let voice = dir.join("audio/voice.wav");
    let info = parse_probe(&probe_text(&voice, "unreadable").await.unwrap()).unwrap();
    let registry = JobRegistry::default();
    let (job, _log) = test_job(&registry, "smoke-silence");
    let params = CleanupParams { threshold_db: -35.0, min_silence: 0.5, padding: 0.05, normalize: true }.validated().unwrap();
    let report = preview(&job, &voice, &info, params, 0.0, 100.0).await.unwrap();
    assert_eq!(report.removed.len(), 1, "one silence of one second: {:?}", report.removed);

    // 4. Captions in six scripts. Each one is drawn on a black picture; a picture with letters is larger than a black one.
    let fonts = resources().join("fonts");
    let fonts_arg = fonts.to_string_lossy().replace('\\', "/").replace(':', "\\:");
    let size_of = |name: &str| std::fs::metadata(dir.join(name)).unwrap().len();
    ffmpeg(&["-f", "lavfi", "-i", "color=c=black:s=640x360:d=1", "-frames:v", "1", &p("tmp/black.png")]).await;
    let black = size_of("tmp/black.png");
    let samples = [
        ("Noto Sans", "Hello brave new world"),
        ("Noto Sans KR", "안녕하세요 여러분 반갑습니다"),
        ("Noto Sans JP", "こんにちは 皆さん 元気ですか"),
        ("Noto Sans SC", "大家好 欢迎 观看 视频"),
        ("Noto Sans Devanagari", "नमस्ते मेरो साथीहरू स्वागत छ"),
        ("Noto Sans Arabic", "السلام علیکم دوستو خوش آمدید"),
    ];
    for (index, (font, text)) in samples.iter().enumerate() {
        let ass = dir.join(format!("tmp/caption{index}.ass"));
        std::fs::write(&ass, build_ass(&caption_request(font, text))).unwrap();
        let ass_arg = ass.to_string_lossy().replace('\\', "/").replace(':', "\\:");
        let out = format!("tmp/caption{index}.png");
        let log = ffmpeg(&["-f", "lavfi", "-i", "color=c=black:s=640x360:d=2", "-vf", &format!("subtitles=filename={ass_arg}:fontsdir={fonts_arg}"), "-ss", "0.9", "-frames:v", "1", &p(&out)]).await;
        assert!(!log.to_lowercase().contains("error"), "{font}: {log}");
        assert!(size_of(&out) > black + 1500, "{font}: the caption was not drawn ({} bytes, black picture {black} bytes)", size_of(&out));
    }

    // 5. The render itself: 5.04 s, picture with Ken Burns, clip with trim, transitions, Korean captions,
    //    music with ducking, a sound effect and loudness normalisation.
    let image = serde_json::json!({"kind": "image", "path": "media/a.png"});
    let clip = serde_json::json!({"kind": "video", "path": "media/clip.mp4", "duration": 4.0});
    let scene = |id: &str, start: f64, end: f64, source: serde_json::Value, motion: &str, transition: &str| serde_json::json!({"id": id, "start": start, "end": end, "source": source, "motion": motion, "fit": "crop", "speed": 1, "transition": {"kind": transition, "seconds": 0.5}});
    let request: RenderRequest = serde_json::from_value(serde_json::json!({
        "projectName": "Smoke 한국어", "width": 640, "height": 360, "fps": 30, "duration": 5.04,
        "scenes": [
            scene("S01", 0.0, 1.8, image.clone(), "zoom_in", "cut"),
            scene("S02", 1.8, 3.4, clip, "none", "dissolve"),
            scene("S03", 3.4, 5.04, image, "pan_left", "slide"),
        ],
        "kenBurns": true,
        "captions": {"width": 640, "height": 360, "look": {"preset": "highlight", "font": "Noto Sans KR", "fontSize": 28, "primary": "#FFFFFF", "highlight": "#FFD400", "outline": 2, "shadow": 1, "position": "bottom", "uppercase": false, "bold": true, "marginV": 30, "marginH": 30},
            "lines": [{"start": 0.5, "end": 2.5, "words": [{"text": "안녕하세요", "start": 0.5, "end": 1.5}, {"text": "여러분", "start": 1.5, "end": 2.5}], "breakAt": null}]},
        "srt": "1\n00:00:00,500 --> 00:00:02,500\n안녕하세요 여러분\n",
        "mix": {"duration": 5.04, "voicePath": "audio/voice.wav",
                "music": {"tracks": [{"path": "audio/music.mp3", "duration": 8.0}], "volume": 0.3, "fadeIn": 1, "fadeOut": 1, "mode": "loop", "ducking": "normal"},
                "sfx": [{"soundId": "whoosh_soft", "time": 1.8, "gain": 0.8}], "normalize": true},
        "aspectLabel": "16x9", "suffix": null, "date": "2026-10-20"
    }))
    .unwrap();
    let env = RenderEnv { project_dir: dir.clone(), fonts_dir: fonts, sfx_dir: resources().join("sfx"), export_folder: None, force_cpu: true };
    let (job, _log) = test_job(&registry, "smoke-render");
    let result = render(&job, &env, &request).await.unwrap_or_else(|e| panic!("render failed: {e:?}"));
    assert!(result.duration_ok, "video {:.3} s, voice 5.04 s", result.duration);
    assert_eq!((result.width, result.height), (640, 360));
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert!(result.size_bytes > 10_000);

    // 6. The finished file plays: video and audio decode from start to end without a single error.
    decodes_cleanly(Path::new(&result.path)).await;
    let _ = std::fs::remove_dir_all(&dir);
}
