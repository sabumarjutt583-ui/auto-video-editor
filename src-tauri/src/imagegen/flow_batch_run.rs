//! The automated Batch Flow Studio run loop: open the shared tool in a
//! new tab of the account's own browser, fill the Batch Prompt Box,
//! generate, poll the queue, download per card in card order, and hand
//! back the raw files for the caller to save through the rename step.
//!
//! This is executable Session/Tab code (not a comment-only plan): it
//! drives the page over the DevTools protocol with the same primitives
//! the old Flow path used (`Session::open_tab`, `navigate_tab`,
//! `eval_in`, `Browser.setDownloadBehavior`). It reuses the account's
//! browser session, so it never opens a second browser on the same
//! profile (a profile can be open only once) — the caller (the worker's
//! `batch_tab`) owns the tab and closes it afterwards.
//!
//! What it deliberately does NOT do:
//! - It never guesses a scene: a download is named `Sxx.png` / `Sxx.mp4`
//!   by the tool, and the caller renames it from the scene record.
//! - It never works around a page that needs a person (captcha, terms,
//!   sign-in) or a credit/limit error: those stop the batch.
//! - It never starts a video batch whose per-video cost is unknown or
//!   over the cap — the caller checks `check_video_credits_for` first,
//!   and this loop re-checks the page's own credit text when it can.
//! - Download order is card order. `Download All` is only a fallback in
//!   batch order, and the rename step (scene id in the file name) makes
//!   the result safe even if downloads arrive out of order.
//!
//! Live evidence and limits: the paragraph prompt format, the queue
//! counters, the card names `S01.png`-`S20.png`, the Batch Size 8
//! behaviour and the Images free tier were verified in a live manual
//! 20-image test (2026-10-28). This automated loop itself has NOT been
//! live-run (it needs the user's Google account and, for video,
//! credits), so its button texts and page-text parsing are the parts
//! most likely to need a config fix if the tool's page changes.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::browser::session::{Session, Tab};
use super::config::FlowBatchConfig;
use super::errors::{ErrorKind, GenError};
use super::flow_batch::{
    self, queue_progress, GenerationType, QueueProgress, VideoModel,
};

fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

fn err(kind: ErrorKind, message: impl Into<String>) -> GenError {
    GenError::new(kind, message.into())
}

fn changed(what: &str) -> GenError {
    err(
        ErrorKind::PageChanged,
        format!("Batch Flow Studio's {what} was not found. The tool's page may have changed; check its settings."),
    )
}

/// One downloaded card: the tool's own name and the raw bytes.
pub struct BatchDownload {
    pub flow_name: String,
    pub bytes: Vec<u8>,
}

/// Everything the run loop needs, already validated by the caller.
pub struct RunRequest {
    pub generation: GenerationType,
    pub video_model: VideoModel,
    pub video_seconds: u32,
    pub video_resolution: String,
    /// Paragraph text from `format_prompts` (one paragraph per prompt,
    /// one blank line between prompts).
    pub text: String,
    pub scene_ids: Vec<String>,
    pub batch_size: u32,
}

async fn eval_in(session: &Session, tab: &Tab, expression: &str) -> Result<Value, GenError> {
    session.eval_in(&tab.frame, expression).await.map_err(|e| {
        err(ErrorKind::Session, format!("The browser could not be read: {}", e))
    })
}

/// Clicks the first visible button whose trimmed text is exactly `text`.
async fn click_exact(session: &Session, tab: &Tab, text: &str) -> Result<bool, GenError> {
    let expr = format!(
        "(function () {{ var bs = [...document.querySelectorAll('button')]; for (var b of bs) {{ var t = (b.innerText || '').trim(); if (t === {} && b.getClientRects().length > 0) {{ b.click(); return true; }} }} return false; }})()",
        js(text)
    );
    Ok(eval_in(session, tab, &expr).await?.as_bool().unwrap_or(false))
}

/// Clicks the first visible button whose text contains `text`.
async fn click_containing(session: &Session, tab: &Tab, text: &str) -> Result<bool, GenError> {
    let expr = format!(
        "(function () {{ var bs = [...document.querySelectorAll('button')]; for (var b of bs) {{ var t = (b.innerText || ''); if (t.indexOf({}) >= 0 && b.getClientRects().length > 0) {{ b.click(); return true; }} }} return false; }})()",
        js(text)
    );
    Ok(eval_in(session, tab, &expr).await?.as_bool().unwrap_or(false))
}

fn page_text_of(value: &Value) -> String {
    value["text"].as_str().unwrap_or_default().to_string()
}

async fn page_snapshot(session: &Session, tab: &Tab) -> Result<Value, GenError> {
    // Download buttons in card order, the prompt counter, queue counters
    // and any Failed marker, all in one page read.
    let expr = "(function () { var btns = [...document.querySelectorAll('button')].map(function (b) { return (b.innerText || '').trim(); }).filter(function (t) { return t.indexOf('Download S') === 0; }); var text = document.body ? document.body.innerText : ''; var pm = text.match(/(\\d+)\\s*Prompts/); var tm = text.match(/Total:\\s*(\\d+)/); var dm = text.match(/Done:\\s*(\\d+)/); return { text: text.slice(0, 12000), downloads: btns, promptCount: pm ? Number(pm[1]) : null, total: tm ? Number(tm[1]) : null, done: dm ? Number(dm[1]) : null, saysFailed: text.indexOf('Failed') >= 0 }; })()";
    eval_in(session, tab, expr).await
}

fn download_names(snapshot: &Value) -> Vec<String> {
    snapshot["downloads"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn check_page_text(cfg: &FlowBatchConfig, text: &str) -> Result<(), GenError> {
    let lower = text.to_lowercase();
    for piece in &cfg.block_texts {
        if lower.contains(&piece.to_lowercase()) {
            return Err(err(
                ErrorKind::Flagged,
                "Batch Flow Studio is asking for a check (captcha or sign-in). Finish it yourself in the browser; the batch was stopped.",
            ));
        }
    }
    for piece in &cfg.limit_texts {
        if lower.contains(&piece.to_lowercase()) {
            return Err(err(
                ErrorKind::RateLimit,
                "Batch Flow Studio says there are not enough credits (or the limit was reached). The batch was stopped.",
            ));
        }
    }
    Ok(())
}

/// Runs one whole batch in `tab` (already opened by the caller) and
/// returns the downloads in card order. A scene whose card fails is
/// reported in the error and never renumbered: the caller must not
/// assign its number to another scene.
pub async fn run_batch(
    session: &Session,
    tab: &Tab,
    cfg: &FlowBatchConfig,
    request: &RunRequest,
) -> Result<Vec<BatchDownload>, GenError> {
    let timeout = Duration::from_secs(90);
    session
        .navigate_tab(tab, &cfg.url, timeout)
        .await
        .map_err(|e| err(ErrorKind::Network, format!("Batch Flow Studio did not open: {e}")))?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let snapshot = page_snapshot(session, tab).await?;
    let text = page_text_of(&snapshot);
    check_page_text(cfg, &text)?;

    // Generation type first: it swaps the whole settings panel.
    let type_text = match request.generation {
        GenerationType::Images => "Images",
        GenerationType::Videos => "Videos",
    };
    if !click_exact(session, tab, type_text).await? {
        // The type button may already be selected; only fail if the
        // page does not show the matching mode afterwards.
        let again = page_snapshot(session, tab).await?;
        let mode = match request.generation {
            GenerationType::Images => "IMAGE MODE",
            GenerationType::Videos => "VIDEO MODE",
        };
        if !page_text_of(&again).contains(mode) && !page_text_of(&again).contains(type_text) {
            return Err(changed(&format!("{type_text} button")));
        }
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Model / aspect / duration, by visible text. Each is best-effort
    // when the tool already shows that choice: failing to find an
    // option the user explicitly asked for is an error, not a guess.
    if request.generation == GenerationType::Images {
        if !click_containing(session, tab, "Nano Banana 2.1").await? {
            // Images default is Nano Banana 2.1; a missing button means
            // the panel has not loaded yet, so wait and try once more.
            tokio::time::sleep(Duration::from_secs(2)).await;
            if !click_containing(session, tab, "Nano Banana 2.1").await? {
                return Err(changed("Nano Banana 2.1 model button"));
            }
        }
    } else {
        let model_text = request.video_model.display();
        // Veo choices are shown as "Veo 3.1 Series"; the quality is a
        // separate rate choice on the page, so click the series button
        // for Veo and the exact model button for Omni.
        let model_button = if request.video_model == VideoModel::OmniFlash {
            "Omni 1.1 Flash"
        } else {
            "Veo 3.1 Series"
        };
        if !click_containing(session, tab, model_button).await? {
            return Err(changed(&format!("{model_text} model button")));
        }
        let duration_text = format!("{}s @ {}", request.video_seconds, request.video_resolution);
        if !click_containing(session, tab, &duration_text).await? {
            return Err(changed(&format!("{duration_text} duration option")));
        }
    }
    let aspect_label = match cfg.aspect.as_str() {
        "9:16" => "9:16",
        "1:1" => "1:1",
        _ => "16:9",
    };
    // Aspect buttons are labelled "16:9 Landscape" etc.; a missing
    // button is not fatal if the page already shows the aspect.
    let _ = click_containing(session, tab, aspect_label).await?;

    // Fill the Batch Prompt Box.
    let prompt_box = cfg.prompt_box.clone();
    let set_expr = format!(
        "(function () {{ var el = document.querySelector({}); if (!el) return false; var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var desc = Object.getOwnPropertyDescriptor(proto, 'value'); if (desc && desc.set) desc.set.call(el, {}); else el.value = {}; el.dispatchEvent(new Event('input', {{ bubbles: true }})); el.dispatchEvent(new Event('change', {{ bubbles: true }})); return true; }})()",
        js(&prompt_box),
        js(&request.text),
        js(&request.text)
    );
    if !eval_in(session, tab, &set_expr).await?.as_bool().unwrap_or(false) {
        return Err(changed("Batch Prompt Box"));
    }
    tokio::time::sleep(Duration::from_millis(800)).await;
    let after_fill = page_snapshot(session, tab).await?;
    if let Some(count) = after_fill["promptCount"].as_u64() {
        if count as usize != request.scene_ids.len() {
            return Err(err(
                ErrorKind::BadRequest,
                format!(
                    "Batch Flow Studio counted {} prompts for {} scenes, so nothing was generated. The paragraph format may have split a prompt.",
                    count,
                    request.scene_ids.len()
                ),
            ));
        }
    }
    check_page_text(cfg, &page_text_of(&after_fill))?;

    // Generate.
    let generate_text = request.generation.generate_button_text();
    if !click_containing(session, tab, generate_text).await? {
        return Err(changed(&format!("\"{generate_text}\" button")));
    }

    // Poll the queue until every scene is Ready (a Download button
    // exists for it) or a card fails. Batch Size 8 means the tool
    // works through the batch in groups; the loop only watches the
    // counters and the buttons, it never restarts a batch.
    let poll = Duration::from_millis(cfg.poll_ms.max(200));
    let deadline = Instant::now() + Duration::from_secs(3600);
    let mut progress = QueueProgress {
        total: request.scene_ids.len(),
        done: 0,
        remaining: request.scene_ids.len(),
        completed_percent: 0,
        ready_ids: Vec::new(),
        failed_ids: Vec::new(),
    };
    loop {
        if Instant::now() >= deadline {
            return Err(err(
                ErrorKind::Timeout,
                "Batch Flow Studio did not finish the batch in time. Nothing was saved from this run.",
            ));
        }
        tokio::time::sleep(poll).await;
        let snapshot = page_snapshot(session, tab).await?;
        let text = page_text_of(&snapshot);
        check_page_text(cfg, &text)?;
        let names = download_names(&snapshot);
        let ready: Vec<String> = names
            .iter()
            .filter_map(|name| {
                flow_batch::parse_flow_filename(name.trim_start_matches("Download ").trim())
                    .map(|(id, _)| id)
            })
            .collect();
        let done = snapshot["done"].and_then(|v| v.as_u64()).map(|d| d as usize).unwrap_or(ready.len());
        let total = snapshot["total"].and_then(|v| v.as_u64()).map(|t| t as usize).unwrap_or(request.scene_ids.len());
        progress = queue_progress(&request.scene_ids, &ready, done, total, snapshot["saysFailed"].as_bool().unwrap_or(false));
        if progress.ready_ids.len() == request.scene_ids.len() {
            break;
        }
        if !progress.failed_ids.is_empty() && progress.ready_ids.len() + progress.failed_ids.len() >= request.scene_ids.len() {
            return Err(err(
                ErrorKind::Server,
                format!(
                    "Batch Flow Studio failed these scenes, so they were not saved: {}. The other scenes were not renumbered.",
                    progress.failed_ids.join(", ")
                ),
            ));
        }
    }

    // Download per card in card order, into a temp folder, then read
    // the bytes. The browser's download folder is set once for the
    // whole run; each file is waited for by its exact tool name.
    let dir: PathBuf = std::env::temp_dir().join(format!(
        "avedit-flowbatch-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis())
    ));
    std::fs::create_dir_all(&dir).map_err(|e| {
        err(ErrorKind::Storage, format!("A temporary download folder could not be made: {e}"))
    })?;
    session
        .cdp
        .call(
            "Browser.setDownloadBehavior",
            json!({ "behavior": "allow", "downloadPath": dir.to_string_lossy() }),
            None,
        )
        .await
        .map_err(|e| err(ErrorKind::Session, format!("Preparing downloads failed: {e}")))?;
    let mut downloads = Vec::new();
    let download_result: Result<Vec<BatchDownload>, GenError> = async {
        for scene_id in &request.scene_ids {
            let flow_name = format!("{}.{}", scene_id, request.generation.extension());
            let button = format!("Download {flow_name}");
            if !click_exact(session, tab, &button).await? {
                return Err(changed(&format!("\"{button}\" button")));
            }
            let path = wait_for_file(&dir, &flow_name, Duration::from_secs(120)).await?;
            let bytes = std::fs::read(&path).map_err(|e| {
                err(ErrorKind::Storage, format!("The downloaded {flow_name} could not be read: {e}"))
            })?;
            if bytes.is_empty() {
                return Err(err(ErrorKind::NoImage, format!("The downloaded {flow_name} is empty.")));
            }
            downloads.push(BatchDownload { flow_name, bytes });
        }
        Ok(downloads)
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    download_result
}

async fn wait_for_file(dir: &Path, name: &str, timeout: Duration) -> Result<PathBuf, GenError> {
    let deadline = Instant::now() + timeout;
    loop {
        let path = dir.join(name);
        if path.is_file() {
            // Give the browser a moment to finish writing.
            tokio::time::sleep(Duration::from_millis(800)).await;
            return Ok(path);
        }
        if Instant::now() >= deadline {
            return Err(err(
                ErrorKind::Timeout,
                format!("The download of {name} did not finish in time."),
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
