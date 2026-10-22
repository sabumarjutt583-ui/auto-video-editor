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
