//! Golden-image tests of the graphics renderer. The TypeScript renderer is bundled by `scripts/graphics-harness.mjs`,
//! run in a hidden Chromium (same CDP client the app uses) and every case is compared with a stored PNG in
//! `src/lib/graphics/render/golden/`. A small difference is allowed (anti-aliasing). Set `UPDATE_GOLDEN=1` to write
//! the pictures (after checking them by eye). Skipped when there is no Chromium or no Node.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::api::base64;
use crate::imagegen::browser::session::{Launch, Mode, Session};
use crate::imagegen::testserver::{temp_dir, test_args, test_browser};
use crate::motion::capture::file_url;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn golden_dir() -> PathBuf {
    root().join("src").join("lib").join("graphics").join("render").join("golden")
}

fn bundle() -> Option<PathBuf> {
    let status = std::process::Command::new("node").arg("scripts/graphics-harness.mjs").current_dir(root()).status();
    match status {
        Ok(s) if s.success() => Some(root().join("src-tauri").join("target").join("graphics-harness").join("harness.js")),
        _ => {
            eprintln!("skipped: Node could not bundle the graphics renderer");
            None
        }
    }
}

async fn open() -> Option<(Session, PathBuf)> {
    let exe = test_browser().or_else(|| {
        eprintln!("skipped: no Chromium found (set AVE_TEST_CHROME)");
        None
    })?;
    let script = bundle()?;
    let work = temp_dir("graphics-golden");
    let page = work.join("page.html");
    std::fs::write(&page, format!("<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script charset=\"utf-8\" src=\"{}\"></script></body></html>", file_url(&script))).unwrap();
    let mut args = test_args();
    args.push("--allow-file-access-from-files".to_string());
    let launch = Launch { exe, profile: work.join("profile"), mode: Mode::Hidden, extra_args: args };
    let session = Session::open(&launch).await.expect("browser starts");
    session.navigate(&file_url(&page), Duration::from_secs(20)).await.expect("page loads");
    let fonts = format!("{}/", file_url(&root().join("resources").join("fonts")));
    let loaded = session.eval(&format!("window.__graphics.loadFonts({fonts:?})")).await.expect("fonts load");
    assert_eq!(loaded, 12, "all bundled fonts load");
    Some((session, work))
}

#[tokio::test]
async fn every_case_matches_its_golden_image() {
    let Some((session, work)) = open().await else { return };
    let update = std::env::var_os("UPDATE_GOLDEN").is_some();
    let dir = golden_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let actual_dir = work.join("actual");
    std::fs::create_dir_all(&actual_dir).unwrap();

    let list = session.eval("window.__graphics.cases()").await.expect("cases");
    let names: Vec<String> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
    assert!(names.len() >= 30, "the golden list is not empty: {}", names.len());
    let mut problems = Vec::new();
    for (index, name) in names.iter().enumerate() {
        let path = dir.join(format!("{name}.png"));
        let golden = match std::fs::read(&path) {
            Ok(bytes) if !update => format!("data:image/png;base64,{}", base64::encode(&bytes)),
            _ => String::new(),
        };
        let result: Value = session.eval(&format!("window.__graphics.compare({index}, {golden:?})")).await.expect("compare");
        let png = result["png"].as_str().and_then(|s| s.strip_prefix("data:image/png;base64,")).and_then(base64::decode).expect("png");
        if update {
            std::fs::write(&path, &png).unwrap();
            continue;
        }
        match result["status"].as_str() {
            Some("same") => {}
            Some("no-golden") => problems.push(format!("{name}: no golden image (run with UPDATE_GOLDEN=1)")),
            _ => {
                std::fs::write(actual_dir.join(format!("{name}.png")), &png).unwrap();
                problems.push(format!("{name}: differs (mean error {:.2}, {} of {} pixels far off)", result["mae"].as_f64().unwrap_or(0.0), result["bad"], result["total"]));
            }
        }
    }
    session.stop().await;
    if !problems.is_empty() {
        let keep = std::env::temp_dir().join("graphics-golden-actual");
        let _ = std::fs::remove_dir_all(&keep);
        let _ = std::fs::rename(&actual_dir, &keep);
        panic!("{} golden image problems (new pictures in {}):\n{}", problems.len(), keep.display(), problems.join("\n"));
    }
    let _ = std::fs::remove_dir_all(&work);
}

#[tokio::test]
async fn nothing_is_painted_outside_the_layers_and_notes_are_reported() {
    let Some((session, work)) = open().await else { return };
    let list = session.eval("window.__graphics.cases()").await.expect("cases");
    let names: Vec<String> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
    let index = |name: &str| names.iter().position(|n| n == name).unwrap_or_else(|| panic!("case {name}"));
    // A line in the middle of the picture leaves almost everything transparent.
    let line: f64 = session.eval(&format!("window.__graphics.transparentShare({})", index("shape_line"))).await.unwrap().as_f64().unwrap();
    assert!(line > 0.95, "a thin line leaves the picture transparent: {line}");
    // The cut text and the shrunk text say so.
    let cut: Value = session.eval(&format!("window.__graphics.compare({}, \"\")", index("text_truncated"))).await.unwrap();
    assert!(cut["notes"].to_string().contains("truncated"), "{cut}");
    let shrunk: Value = session.eval(&format!("window.__graphics.compare({}, \"\")", index("text_shrinks_to_fit"))).await.unwrap();
    assert!(shrunk["notes"].to_string().contains("shrunk"), "{shrunk}");
    session.stop().await;
    let _ = std::fs::remove_dir_all(&work);
}

#[tokio::test]
async fn the_export_worker_draws_exactly_the_same_pixels_as_the_preview() {
    let Some((session, work)) = open().await else { return };
    let list = session.eval("window.__graphics.cases()").await.expect("cases");
    let names: Vec<String> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
    let worker = file_url(&root().join("src-tauri").join("target").join("graphics-harness").join("worker.js"));
    let fonts = format!("{}/", file_url(&root().join("resources").join("fonts")));
    // An entrance with text (frames in the middle of the move) and a whole 2-second graphic: 60 frames.
    for name in ["enter_slideLeft", "text_latin", "enter_typewriter"] {
        let index = names.iter().position(|n| n == name).unwrap();
        let result: Value = session.eval(&format!("window.__graphics.exportViaWorker({index}, {worker:?}, {fonts:?})")).await.unwrap_or_else(|e| panic!("worker run of {name} failed: {e}"));
        assert_eq!(result["frames"], 60, "{name}: {result}");
        assert_eq!(result["identical"], 60, "{name}: the worker's frames differ from the page's: {result}");
        assert_eq!(result["bytes"], 60 * 320 * 180 * 4, "{name}");
    }
    session.stop().await;
    let _ = std::fs::remove_dir_all(&work);
}

mod end_to_end {
    use super::*;
    use crate::ffmpeg::{command, Tool};
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::graphics::export::GraphicExports;
    use crate::jobs::{test_job, JobRegistry};

    async fn decode(width: u32, height: u32, pix_fmt: &str, extra: &[&str]) -> Vec<u8> {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-v", "error"]).args(extra).args(["-frames:v", "1", "-pix_fmt", pix_fmt, "-f", "rawvideo", "-"]);
        let out = cmd.output().await.unwrap();
        let per = if pix_fmt == "rgba" { 4 } else { 3 };
        assert_eq!(out.stdout.len() as u32, width * height * per, "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    #[tokio::test]
    async fn frames_drawn_by_the_real_renderer_become_an_exact_transparent_clip() {
        if !sidecars_for_tests() {
            return;
        }
        let Some((session, work)) = open().await else { return };
        let list = session.eval("window.__graphics.cases()").await.unwrap();
        let names: Vec<String> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
        let index = names.iter().position(|n| n == "enter_slideLeft").unwrap();
        let (w, h, frames) = (320u32, 180u32, 60u32);
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "e2e");
        exports.start(job, &work, "e2e", w, h, frames).await.unwrap();
        let mut sent = Vec::new();
        for n in 0..frames {
            let text = session.eval(&format!("window.__graphics.rawFrame({index}, {n})")).await.unwrap();
            let bytes = base64::decode(text.as_str().unwrap()).unwrap();
            exports.frame("e2e", &bytes).await.unwrap();
            sent.push(bytes);
        }
        let clip = exports.finish("e2e").await.unwrap();
        let file = work.join(&clip.path);
        assert_eq!((clip.frames, clip.width, clip.height), (60, 320, 180));
        // The graphic starts empty (entrance not started), so frame 0 is fully transparent and a later one is not.
        let first = decode(w, h, "rgba", &["-i", &file.to_string_lossy()]).await;
        assert!(first.chunks(4).all(|p| p[3] == 0), "the first frame is transparent");
        let later = decode(w, h, "rgba", &["-ss", "1.0", "-i", &file.to_string_lossy()]).await;
        assert_eq!(later, sent[30], "frame 30 (1.0 s) is bit for bit what the page drew, alpha included");
        assert!(later.chunks(4).any(|p| p[3] == 255) && later.chunks(4).any(|p| p[3] == 0), "opaque and transparent areas");
        session.stop().await;
        let _ = std::fs::remove_dir_all(&work);
    }

    #[tokio::test]
    async fn real_text_edges_composite_correctly_over_black_and_over_white() {
        if !sidecars_for_tests() {
            return;
        }
        let Some((session, work)) = open().await else { return };
        let list = session.eval("window.__graphics.cases()").await.unwrap();
        let names: Vec<String> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
        let index = names.iter().position(|n| n == "text_latin").unwrap();
        let (w, h) = (320u32, 180u32);
        let text = session.eval(&format!("window.__graphics.rawFrame({index}, 30)")).await.unwrap();
        let frame = base64::decode(text.as_str().unwrap()).unwrap();
        let exports = GraphicExports::default();
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "halo");
        exports.start(job, &work, "halo", w, h, 3).await.unwrap();
        for _ in 0..3 {
            exports.frame("halo", &frame).await.unwrap();
        }
        let clip = exports.finish("halo").await.unwrap();
        let graph = crate::render::plan::overlay_graph_for(&[crate::render::plan::OverlayInput { start: 0.0, exact_frames: true }], w, h, 30, "format=yuv420p");
        for (name, level) in [("black", 0.0f64), ("white", 255.0)] {
            let mut cmd = command(Tool::Ffmpeg).unwrap();
            cmd.args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", &format!("color=c={name}:s={w}x{h}:r=30:d=0.5,format=yuv420p"), "-f", "lavfi", "-i", "anullsrc=d=0.5", "-i"])
                .arg(work.join(&clip.path))
                .args(["-filter_complex", &graph, "-map", "[vout]", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
            let out = cmd.output().await.unwrap().stdout;
            assert_eq!(out.len() as u32, w * h * 3);
            let mut worst = 0.0f64;
            let mut edge_pixels = 0;
            for (i, px) in frame.chunks(4).enumerate() {
                let a = f64::from(px[3]) / 255.0;
                if a > 0.02 && a < 0.98 {
                    edge_pixels += 1;
                }
                for c in 0..3 {
                    let expected = a * f64::from(px[c]) + (1.0 - a) * level;
                    worst = worst.max((expected - f64::from(out[i * 3 + c])).abs());
                }
            }
            assert!(edge_pixels > 200, "the text has soft edges to test ({edge_pixels})");
            assert!(worst <= 6.0, "over {name}: the composite is {worst:.1} levels away from the exact straight-alpha result (halo)");
        }
        session.stop().await;
        let _ = std::fs::remove_dir_all(&work);
    }
}
