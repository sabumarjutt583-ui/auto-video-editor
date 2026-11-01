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
//! Live evidence and limits: the paragraph prompt format, queue
//! counters, card names `S01.png`-`S20.png`, Batch Size 8 behaviour,
//! Images free tier, and shared-tool project handoff were checked in
//! the live Flow UI. The automated batch itself still needs a live
//! single-image run to verify its selectors and download flow.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::browser::session::{Session, Tab};
use super::config::FlowBatchConfig;
use super::errors::{ErrorKind, GenError};
use super::flow_batch::{self, queue_progress, GenerationType, QueueProgress, VideoModel};

fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

fn flow_expression(expression: &str) -> String {
    format!("({})({})", include_str!("flow_dom.js"), js(expression))
}

fn is_video_studio_url(url: &str) -> bool {
    [flow_batch::VIDEO_STUDIO_URL, "https://flow.google.com/shared/tool/cd8dede2-e843-470b-bc49-ab1ddb517186"]
        .iter().any(|known| url.trim_end_matches('/') == *known)
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
    session.eval_in(&tab.frame, &flow_expression(expression)).await.map_err(|e| {
        err(
            ErrorKind::Session,
            format!("The browser could not be read: {}", e),
        )
    })
}

/// Clicks a visible control with exact text. Flow's shared tool sometimes
/// renders its controls as divs with click handlers instead of `<button>`s.
async fn click_exact(session: &Session, tab: &Tab, text: &str) -> Result<bool, GenError> {
    let expr = format!(
        "(function () {{ var wanted = {}; var usable = function (e) {{ return !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getAttribute('data-disabled') !== 'true' && !e.hasAttribute('disabled') && e.getClientRects().length > 0; }}; var controls = [...document.querySelectorAll('button,[role=button],[role=radio],[tabindex]')]; var match = controls.find(function (e) {{ return (e.innerText || e.getAttribute('aria-label') || '').trim() === wanted && usable(e); }}); if (!match) {{ var nodes = [...document.querySelectorAll('body *')].filter(function (e) {{ return (e.innerText || '').trim() === wanted && e.getClientRects().length > 0; }}); nodes.sort(function (a,b) {{ var ar=a.getBoundingClientRect(), br=b.getBoundingClientRect(); return ar.width*ar.height - br.width*br.height; }}); if (nodes.length) {{ match = nodes[0].closest('button,[role=button],[role=radio],[tabindex]') || nodes[0]; if (!usable(match)) match = null; }} }} if (!match) return false; match.click(); return true; }})()",
        js(text)
    );
    Ok(eval_in(session, tab, &expr)
        .await?
        .as_bool()
        .unwrap_or(false))
}

/// The shared Flow link first opens an interstitial, then a project picker.
/// Continue through those screens only when the page clearly identifies the
/// shared-tool handoff; never pick a project from an unrelated Flow page.
async fn enter_shared_tool_project(
    session: &Session,
    tab: &mut Tab,
    cfg: &FlowBatchConfig,
) -> Result<(), GenError> {
    // The project chooser needs a person to pick the intended Flow project.
    // Keep the browser available while they do that instead of guessing a
    // project (which can silently send a batch to the wrong workspace).
    let deadline = Instant::now() + Duration::from_secs(5 * 60);
    let mut opened_picker = false;
    let mut opened_project = false;
    let mut project_chooser_seen = false;
    let mut last_frame_scan = String::new();

    loop {
        let snapshot = page_snapshot(session, tab).await?;
        let text = page_text_of(&snapshot);
        check_page_text(cfg, &text)?;
        let lower = text.to_lowercase();

        // Flow's editor is ready once its own batch panel is present. Do
        // not key this wait to an HTML <button>: the current shared tool
        // renders its Images/Videos selector as custom controls, and the
        // project page can load successfully while that selector is absent
        // from `querySelectorAll('button')`.
        let expected_tool_id = cfg
            .url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or_default();
        let current_url = snapshot["url"].as_str().unwrap_or_default();
        let opened_in_project = !expected_tool_id.is_empty()
            && current_url.contains("/project/")
            && current_url.contains(&format!("/tool/{expected_tool_id}"));
        opened_project |= opened_in_project;
        let is_video_tool = is_video_studio_url(&cfg.url);
        let editor_route = opened_in_project
            || (lower.contains("batch prompt box")
                && lower.contains("select generation type")
                && (lower.contains("batch flow studio")
                    || lower.contains("generate all as images")))
            || (lower.contains("video generation pipeline mode")
                && lower.contains("prompts & scene sequence input"));
        if editor_route {
            let (frame, diagnostics) = if is_video_tool {
                find_video_studio_frame(session, tab).await?
            } else {
                find_batch_tool_frame(session, tab).await?
            };
            last_frame_scan = diagnostics;
            if let Some(frame) = frame {
                tab.frame = frame;
                crate::logging::info(
                "flowbatch",
                &format!(
                    "Flow editor detected url={} by_project_route={} by_page_text={} frame_session={}",
                    current_url,
                    opened_in_project,
                    lower.contains("batch prompt box"),
                    tab.frame.session
                ),
            );
                return Ok(());
            }
        }

        if !opened_picker
            && (lower.contains("shared tool: batch flow studio")
                || lower.contains("shared tool: batch video studio"))
            && click_exact(session, tab, "Try in a project").await?
        {
            opened_picker = true;
            tokio::time::sleep(Duration::from_millis(800)).await;
            continue;
        }

        // The chooser is user-controlled: don't guess which of their Flow
        // projects is the right destination. Once it appears, leave it open
        // so the user can select the intended project and press Open.
        if opened_picker && lower.contains("try in a project") {
            project_chooser_seen = true;
        }

        if Instant::now() >= deadline {
            crate::logging::warn(
                "flowbatch",
                &format!(
                    "Flow editor wait timed out url={} text_len={} has_batch_prompt={} has_generation_type={} opened_picker={} project_chooser_seen={} opened_project={} text_start={:?}",
                    current_url,
                    text.len(),
                    lower.contains("batch prompt box"),
                    lower.contains("select generation type"),
                    opened_picker,
                    project_chooser_seen,
                    opened_project,
                    text.chars().take(300).collect::<String>()
                ),
            );
            if !last_frame_scan.is_empty() {
                crate::logging::warn(
                    "flowbatch",
                    &format!("Last Batch Flow Studio frame scan: {last_frame_scan}"),
                );
            }
            let message = if project_chooser_seen && !opened_project {
                if is_video_tool {
                    "Choose the Flow project you want in the browser, press Open, and leave that window open. The app will continue when Batch Video Studio finishes loading."
                } else {
                    "Choose the Flow project you want in the browser, press Open, and leave that window open. The app will continue when Batch Flow Studio finishes loading."
                }
            } else if opened_project {
                if is_video_tool {
                    "The Flow project opened, but the app could not locate Batch Video Studio inside the page. The browser is left open; check that the tool panel is visible, then try again."
                } else {
                    "The Flow project opened, but the app could not locate Batch Flow Studio inside the page. The browser is left open; check that the tool panel is visible, then try again."
                }
            } else if opened_in_project {
                if is_video_tool {
                    "The Flow project page opened, but the app could not locate Batch Video Studio inside it. The browser is left open so the page can be inspected."
                } else {
                    "The Flow project page opened, but the app could not locate Batch Flow Studio inside it. The browser is left open so the page can be inspected."
                }
            } else {
                if is_video_tool {
                    "Flow did not reach the Batch Video Studio project. Open the shared tool in a Flow project, then try again."
                } else {
                    "Flow did not reach the Batch Flow Studio project. Open the shared tool in a Flow project, then try again."
                }
            };
            return Err(err(ErrorKind::Timeout, message));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn find_video_studio_frame(
    session: &Session,
    tab: &Tab,
) -> Result<(Option<super::browser::session::Frame>, String), GenError> {
    let frames = session.frames_in_tab(tab).await.map_err(|e| {
        err(ErrorKind::Session, format!("The Flow page frames could not be read: {e}"))
    })?;
    let mut diagnostics = Vec::new();
    for frame in frames {
        let probe = eval_frame(
            session,
            &frame,
            "(function(){var t=(document.body&&document.body.innerText)||'';return {url:location.href,title:document.title,text:t.slice(0,16000),textareas:document.querySelectorAll('textarea').length};})()",
        )
        .await;
        let Ok(probe) = probe else {
            diagnostics.push("frame probe failed".to_string());
            continue;
        };
        let text = probe["text"].as_str().unwrap_or_default();
        let lower = text.to_lowercase();
        let ready = eval_frame(session, &frame,
            "(()=>{const r=document.getElementById('ave-video-studio');return !!r&&r.getAttribute('data-ready')==='true'&&!!document.getElementById('ave-prompts-input')&&!!document.getElementById('ave-start');})()"
        ).await.unwrap_or(Value::Bool(false));
        if ready == true || ((lower.contains("video generation pipeline mode") || lower.contains("video pipeline mode"))
            && lower.contains("prompts & scene sequence input")
            && lower.contains("start batch generation"))
        {
            return Ok((Some(frame), format!(
                "url={} title={} text_len={} textareas={}",
                probe["url"].as_str().unwrap_or_default(),
                probe["title"].as_str().unwrap_or_default(),
                text.len(),
                probe["textareas"].as_u64().unwrap_or_default()
            )));
        }
        diagnostics.push(format!(
            "url={} title={} text_len={} text_start={:?}",
            probe["url"].as_str().unwrap_or_default(),
            probe["title"].as_str().unwrap_or_default(),
            text.len(),
            text.chars().take(160).collect::<String>()
        ));
    }
    Ok((None, diagnostics.join(" | ")))
}

/// Flow's project URL is only the outer shell. The actual Batch Flow Studio
/// controls can be in a child document, so find and use the frame that owns
/// the tool before attempting clicks or prompt entry.
async fn find_batch_tool_frame(
    session: &Session,
    tab: &Tab,
) -> Result<(Option<super::browser::session::Frame>, String), GenError> {
    let frames = session.frames_in_tab(tab).await.map_err(|e| {
        err(
            ErrorKind::Session,
            format!("The Flow page frames could not be read: {e}"),
        )
    })?;
    let mut diagnostics = Vec::new();
    for frame in frames {
        let probe_js = r#"(function () {
            var text = (document.body && document.body.innerText || '');
            var controls = [...document.querySelectorAll('button,[role=button],[role=radio]')]
                .map(function (e) { return (e.innerText || e.getAttribute('aria-label') || '').trim(); })
                .filter(Boolean);
            return {
                url: location.href,
                title: document.title,
                text: text.slice(0, 12000),
                images: controls.filter(function (x) { return x === 'Images'; }).length,
                videos: controls.filter(function (x) { return x === 'Videos'; }).length,
                promptBox: controls.some(function (x) {
                    var lower = x.toLowerCase();
                    return lower.includes('generate all as images') || lower.includes('generate all as videos');
                }),
                frameCount: document.querySelectorAll('iframe').length
            };
        })()"#;
        let probe = eval_frame(session, &frame, probe_js).await;
        let Ok(probe) = probe else {
            diagnostics.push("frame probe failed".to_string());
            continue;
        };
        let text = probe["text"].as_str().unwrap_or_default();
        let lower = text.to_lowercase();
        let has_tool = lower.contains("select generation type")
            && (lower.contains("batch prompt box") || lower.contains("generate all as images"))
            || (probe["images"].as_u64().unwrap_or_default() > 0
                && probe["videos"].as_u64().unwrap_or_default() > 0
                && (probe["promptBox"].as_bool().unwrap_or(false)
                    || lower.contains("batch prompt box")));
        if has_tool {
            let summary = format!(
                "url={} title={} text_len={} image_buttons={} video_buttons={}",
                probe["url"].as_str().unwrap_or_default(),
                probe["title"].as_str().unwrap_or_default(),
                text.len(),
                probe["images"].as_u64().unwrap_or_default(),
                probe["videos"].as_u64().unwrap_or_default()
            );
            return Ok((Some(frame), summary));
        }
        diagnostics.push(format!(
            "url={} title={} text_len={} image_buttons={} video_buttons={} nested_iframes={} text_start={:?}",
            probe["url"].as_str().unwrap_or_default(),
            probe["title"].as_str().unwrap_or_default(),
            text.len(),
            probe["images"].as_u64().unwrap_or_default(),
            probe["videos"].as_u64().unwrap_or_default(),
            probe["frameCount"].as_u64().unwrap_or_default(),
            text.chars().take(180).collect::<String>()
        ));
    }
    Ok((None, diagnostics.join(" | ")))
}

async fn eval_frame(
    session: &Session,
    frame: &super::browser::session::Frame,
    expression: &str,
) -> Result<Value, GenError> {
    session.eval_in(frame, &flow_expression(expression)).await.map_err(|e| {
        err(
            ErrorKind::Session,
            format!("The Flow page frame could not be read: {e}"),
        )
    })
}

/// Clicks the first visible button whose text contains `text`.
async fn click_containing(session: &Session, tab: &Tab, text: &str) -> Result<bool, GenError> {
    let expr = format!(
        "(function () {{ var wanted = {}; var controls = [...document.querySelectorAll('button,[role=button],[role=radio],[tabindex]')]; var match = controls.find(function (e) {{ return (e.innerText || e.getAttribute('aria-label') || '').indexOf(wanted) >= 0 && !e.disabled && e.getClientRects().length > 0; }}); if (!match) {{ var nodes = [...document.querySelectorAll('body *')].filter(function (e) {{ return (e.innerText || '').indexOf(wanted) >= 0 && e.getClientRects().length > 0; }}); nodes.sort(function (a,b) {{ var ar=a.getBoundingClientRect(), br=b.getBoundingClientRect(); return ar.width*ar.height - br.width*br.height; }}); if (nodes.length) match = nodes[0].closest('button,[role=button],[role=radio],[tabindex]') || nodes[0]; }} if (!match) return false; match.click(); return true; }})()",
        js(text)
    );
    Ok(eval_in(session, tab, &expr)
        .await?
        .as_bool()
        .unwrap_or(false))
}

fn page_text_of(value: &Value) -> String {
    value["text"].as_str().unwrap_or_default().to_string()
}

async fn page_snapshot(session: &Session, tab: &Tab) -> Result<Value, GenError> {
    // Download buttons in card order, the prompt counter, queue counters
    // and any Failed marker, all in one page read.
    let expr = "(function () { var btns = [...document.querySelectorAll('button')].map(function (b) { return (b.innerText || '').trim(); }).filter(function (t) { return t.indexOf('Download S') === 0; }); var text = document.body ? document.body.innerText : ''; var pm = text.match(/(\\d+)\\s*Prompts/); var tm = text.match(/Total:\\s*(\\d+)/); var dm = text.match(/Done:\\s*(\\d+)/); return { url: location.href, title: document.title, text: text.slice(0, 12000), downloads: btns, promptCount: pm ? Number(pm[1]) : null, total: tm ? Number(tm[1]) : null, done: dm ? Number(dm[1]) : null, saysFailed: text.indexOf('Failed') >= 0 }; })()";
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
    let mut work_tab = tab.clone();
    let timeout = Duration::from_secs(90);
    session
        .navigate_tab(&work_tab, &cfg.url, timeout)
        .await
        .map_err(|e| {
            err(
                ErrorKind::Network,
                format!("Batch Flow Studio did not open: {e}"),
            )
        })?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    enter_shared_tool_project(session, &mut work_tab, cfg).await?;
    if request.generation == GenerationType::Videos
        && is_video_studio_url(&cfg.url)
    {
        return run_video_studio_batch(session, &work_tab, cfg, request).await;
    }
    let snapshot = page_snapshot(session, &work_tab).await?;
    let text = page_text_of(&snapshot);
    check_page_text(cfg, &text)?;

    // Generation type first: it swaps the whole settings panel.
    let type_text = match request.generation {
        GenerationType::Images => "Images",
        GenerationType::Videos => "Videos",
    };
    if !click_exact(session, &work_tab, type_text).await? {
        // The type button may already be selected; only fail if the
        // page does not show the matching mode afterwards.
        let again = page_snapshot(session, &work_tab).await?;
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
        if !click_containing(session, &work_tab, "Nano Banana 2.1").await? {
            // Images default is Nano Banana 2.1; a missing button means
            // the panel has not loaded yet, so wait and try once more.
            tokio::time::sleep(Duration::from_secs(2)).await;
            if !click_containing(session, &work_tab, "Nano Banana 2.1").await? {
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
        if !click_containing(session, &work_tab, model_button).await? {
            return Err(changed(&format!("{model_text} model button")));
        }
        let duration_text = format!("{}s @ {}", request.video_seconds, request.video_resolution);
        if !click_containing(session, &work_tab, &duration_text).await? {
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
    let _ = click_containing(session, &work_tab, aspect_label).await?;

    // Fill the Batch Prompt Box.
    let prompt_box = cfg.prompt_box.clone();
    let set_expr = format!(
        "(function () {{ var el = document.querySelector({}); if (!el) return false; var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var desc = Object.getOwnPropertyDescriptor(proto, 'value'); if (desc && desc.set) desc.set.call(el, {}); else el.value = {}; el.dispatchEvent(new Event('input', {{ bubbles: true }})); el.dispatchEvent(new Event('change', {{ bubbles: true }})); return true; }})()",
        js(&prompt_box),
        js(&request.text),
        js(&request.text)
    );
    if !eval_in(session, &work_tab, &set_expr)
        .await?
        .as_bool()
        .unwrap_or(false)
    {
        return Err(changed("Batch Prompt Box"));
    }
    tokio::time::sleep(Duration::from_millis(800)).await;
    let after_fill = page_snapshot(session, &work_tab).await?;
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
    if !click_containing(session, &work_tab, generate_text).await? {
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
        let snapshot = page_snapshot(session, &work_tab).await?;
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
        let done = snapshot["done"]
            .as_u64()
            .map(|d| d as usize)
            .unwrap_or(ready.len());
        let total = snapshot["total"]
            .as_u64()
            .map(|t| t as usize)
            .unwrap_or(request.scene_ids.len());
        progress = queue_progress(
            &request.scene_ids,
            &ready,
            done,
            total,
            snapshot["saysFailed"].as_bool().unwrap_or(false),
        );
        if progress.ready_ids.len() == request.scene_ids.len() {
            break;
        }
        if !progress.failed_ids.is_empty()
            && progress.ready_ids.len() + progress.failed_ids.len() >= request.scene_ids.len()
        {
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
        err(
            ErrorKind::Storage,
            format!("A temporary download folder could not be made: {e}"),
        )
    })?;
    session
        .cdp
        .call(
            "Browser.setDownloadBehavior",
            json!({ "behavior": "allow", "downloadPath": dir.to_string_lossy() }),
            None,
        )
        .await
        .map_err(|e| {
            err(
                ErrorKind::Session,
                format!("Preparing downloads failed: {e}"),
            )
        })?;
    let mut downloads = Vec::new();
    let download_result: Result<Vec<BatchDownload>, GenError> = async {
        for scene_id in &request.scene_ids {
            let flow_name = format!("{}.{}", scene_id, request.generation.extension());
            let button = format!("Download {flow_name}");
            if !click_exact(session, &work_tab, &button).await? {
                return Err(changed(&format!("\"{button}\" button")));
            }
            let path = wait_for_file(&dir, &flow_name, Duration::from_secs(120)).await?;
            let bytes = std::fs::read(&path).map_err(|e| {
                err(
                    ErrorKind::Storage,
                    format!("The downloaded {flow_name} could not be read: {e}"),
                )
            })?;
            if bytes.is_empty() {
                return Err(err(
                    ErrorKind::NoImage,
                    format!("The downloaded {flow_name} is empty."),
                ));
            }
            downloads.push(BatchDownload { flow_name, bytes });
        }
        Ok(downloads)
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    download_result
}

fn video_tool_prompt_text(request: &RunRequest) -> Result<String, GenError> {
    let prompts: Vec<&str> = request.text.split("\n\n").filter(|p| !p.trim().is_empty()).collect();
    if prompts.len() != request.scene_ids.len() {
        return Err(err(
            ErrorKind::BadRequest,
            format!("Prepared {} prompts for {} scenes; no video batch was sent.", prompts.len(), request.scene_ids.len()),
        ));
    }
    Ok(request.scene_ids.iter().zip(prompts).map(|(id, prompt)| {
        format!("{} | {}", id, prompt.split_whitespace().collect::<Vec<_>>().join(" "))
    }).collect::<Vec<_>>().join("\n"))
}

async fn click_video_control(session: &Session, tab: &Tab, id: &str) -> Result<bool, GenError> {
    let expression = format!("(()=>{{const e=document.getElementById({});if(!e||e.disabled||!e.getClientRects().length)return false;e.click();return true;}})()", js(id));
    Ok(eval_in(session, tab, &expression).await?.as_bool().unwrap_or(false))
}

async fn set_video_tool_select(
    session: &Session,
    tab: &Tab,
    label: &str,
    option_hint: &str,
) -> Result<(), GenError> {
    let id = match label {
        "Video Model" => "ave-video-model",
        "Aspect Ratio" => "ave-aspect-ratio",
        "Resolution" => "ave-resolution",
        "Clip Duration" => "ave-clip-duration",
        "Parallel Workers" => "ave-concurrency",
        _ => "",
    };
    let direct = format!(r#"(()=>{{const e=document.getElementById({});if(!e)return 'legacy';const hint={};const options=[...e.options];const o=options.find(o=>o.value===hint)||options.find(o=>o.text.trim()===hint)||options.find(o=>o.text.toLowerCase().includes(hint.toLowerCase()));if(!o)return 'unsupported';Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,o.value);e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));return 'ok';}})()"#, js(id), js(option_hint));
    match eval_in(session, tab, &direct).await?.as_str() {
        Some("ok") => return Ok(()),
        Some("legacy") => {},
        _ => return Err(changed(&format!("Video Studio {label}: unsupported option {option_hint}"))),
    }
    let expr = format!(
        "(function(){{var label={};var hint={};var labels=[...document.querySelectorAll('label')];var l=labels.find(function(e){{return (e.innerText||'').trim().toLowerCase().includes(label.toLowerCase())}});if(!l)return 'missing-label';var root=l;while(root&&!root.querySelector('select'))root=root.parentElement;if(!root)return 'missing-select';var s=root.querySelector('select');var o=[...s.options].find(function(x){{return (x.text+' '+x.value).toLowerCase().includes(hint.toLowerCase())}});if(!o)return 'missing-option:'+([...s.options].map(x=>x.text).join('|'));var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,o.value);s.dispatchEvent(new Event('input',{{bubbles:true}}));s.dispatchEvent(new Event('change',{{bubbles:true}}));return 'ok:'+o.text;}})()",
        js(label), js(option_hint)
    );
    match eval_in(session, tab, &expr).await?.as_str() {
        Some(value) if value.starts_with("ok:") => Ok(()),
        Some(value) => Err(changed(&format!("Video Studio {label} setting ({value})"))),
        None => Err(changed(&format!("Video Studio {label} setting"))),
    }
}

async fn video_tool_snapshot(session: &Session, tab: &Tab) -> Result<Value, GenError> {
    let expr = r#"(()=>{const t=document.body?.innerText||'';const q=document.getElementById('ave-queue-summary');function n(key,re){const value=q?.getAttribute('data-'+key);if(value!==null&&value!==undefined)return Number(value);const m=t.match(re);return m?Number(m[1]):null;}const parsed=document.getElementById('ave-parsed-count')?.getAttribute('data-count');return {url:location.href,title:document.title,text:t.slice(0,20000),parsed:parsed!==null&&parsed!==undefined?Number(parsed):n('total',/(\d+)\s+(?:items|scenes) parsed/i),total:n('total',/Total:\s*(\d+)/i),active:n('active',/Active:\s*(\d+)/i),ready:n('completed',/(?:Ready|Completed):\s*(\d+)/i),failed:n('failed',/Failed:\s*(\d+)/i),remain:n('pending',/(?:Remain|Pending):\s*(\d+)/i)};})()"#;
    eval_in(session, tab, expr).await
}

async fn click_video_tool_card_download(
    session: &Session,
    tab: &Tab,
    scene_id: &str,
) -> Result<bool, GenError> {
    let direct = format!("(()=>{{const id={};const e=[...document.querySelectorAll('[data-action=download]')].find(e=>e.getAttribute('data-scene-id')===id&&!e.disabled);if(!e)return false;e.click();return true;}})()", js(scene_id));
    if eval_in(session, tab, &direct).await?.as_bool().unwrap_or(false) {
        return Ok(true);
    }
    let expr = format!(
        "(function(){{var id={};var nodes=[...document.querySelectorAll('body *')].filter(e=>(e.childElementCount===0)&&(e.innerText||'').trim()===id&&e.getClientRects().length);for(var n of nodes){{var p=n;for(var i=0;p&&i<9;i++,p=p.parentElement){{var b=[...p.querySelectorAll('button,[role=button]')].find(x=>/^(Download File|Re-Download)$/.test((x.innerText||'').trim())&&!x.disabled);if(b){{b.click();return true;}}}}}}return false;}})()",
        js(scene_id)
    );
    Ok(eval_in(session, tab, &expr).await?.as_bool().unwrap_or(false))
}

async fn run_video_studio_batch(
    session: &Session,
    tab: &Tab,
    cfg: &FlowBatchConfig,
    request: &RunRequest,
) -> Result<Vec<BatchDownload>, GenError> {
    let text = video_tool_prompt_text(request)?;
    // This new custom tool accepts one explicit scene ID per input line.
    // Start with Text to Video; asset modes need media upload/attachment
    // handoff and are deliberately not implied by this prompt-only runner.
    if !click_video_control(session, tab, "ave-mode-t2v").await?
        && !click_exact(session, tab, "Text to Video").await?
        && !click_containing(session, tab, "Text to Video").await?
    {
        return Err(changed("Text to Video mode control"));
    }
    let model_name = match request.video_model {
        VideoModel::OmniFlash => "Omni 1.1 Flash",
        VideoModel::VeoLite => "Veo 3.1 - Lite",
        VideoModel::VeoFast => "Veo 3.1 - Fast",
        VideoModel::VeoQuality => "Veo 3.1 - Quality",
    };
    set_video_tool_select(session, tab, "Video Model", model_name).await?;
    set_video_tool_select(session, tab, "Aspect Ratio", &cfg.aspect).await?;
    set_video_tool_select(session, tab, "Resolution", &request.video_resolution).await?;
    set_video_tool_select(session, tab, "Clip Duration", &format!("{}", request.video_seconds)).await?;
    set_video_tool_select(session, tab, "Parallel Workers", &format!("{}", request.batch_size)).await?;

    let fill = format!(
        "(function(){{var auto=document.getElementById('ave-auto-download');if(auto&&auto.checked)auto.click();var el=document.getElementById('ave-prompts-input')||[...document.querySelectorAll('textarea')].find(e=>e.getClientRects().length>0);if(!el||el.disabled)return false;var d=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');d.set.call(el,{});el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return true;}})()",
        js(&text)
    );
    if !eval_in(session, tab, &fill).await?.as_bool().unwrap_or(false) {
        return Err(changed("Prompts & Scene Sequence Input box"));
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    let after_fill = video_tool_snapshot(session, tab).await?;
    if after_fill["parsed"].as_u64() != Some(request.scene_ids.len() as u64) {
        return Err(err(ErrorKind::BadRequest, format!(
            "Video Studio prompt count {:?} does not match {} scenes; nothing was generated.", after_fill["parsed"], request.scene_ids.len()
        )));
    }
    check_page_text(cfg, &page_text_of(&after_fill))?;
    let start = format!("Start Batch Generation ({})", request.scene_ids.len());
    if !click_video_control(session, tab, "ave-start").await? && !click_exact(session, tab, &start).await? {
        // The count may include failed items on retry, so prefix match the visible action.
        if !click_containing(session, tab, "Start Batch Generation").await? {
            return Err(changed("Start Batch Generation button"));
        }
    }

    let poll = Duration::from_millis(cfg.poll_ms.max(300));
    let deadline = Instant::now() + Duration::from_secs(3600);
    loop {
        if Instant::now() >= deadline {
            return Err(err(ErrorKind::Timeout, "Batch Video Studio did not finish the batch in time. Nothing was saved from this run."));
        }
        tokio::time::sleep(poll).await;
        let snapshot = video_tool_snapshot(session, tab).await?;
        let page_text = page_text_of(&snapshot);
        check_page_text(cfg, &page_text)?;
        let ready = snapshot["ready"].as_u64().unwrap_or(0) as usize;
        let failed = snapshot["failed"].as_u64().unwrap_or(0) as usize;
        let active = snapshot["active"].as_u64().unwrap_or(0) as usize;
        if failed > 0 && ready + failed >= request.scene_ids.len() {
            return Err(err(ErrorKind::Server, format!(
                "Batch Video Studio failed {} scene(s). Their scene IDs were kept; no other scene was renumbered.", failed
            )));
        }
        if ready >= request.scene_ids.len() && active == 0 {
            break;
        }
    }

    let dir = std::env::temp_dir().join(format!(
        "avedit-video-studio-{}-{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis())
    ));
    std::fs::create_dir_all(&dir).map_err(|e| err(ErrorKind::Storage, format!("A temporary download folder could not be made: {e}")))?;
    session.cdp.call("Browser.setDownloadBehavior", json!({"behavior":"allow","downloadPath":dir.to_string_lossy()}), None).await
        .map_err(|e| err(ErrorKind::Session, format!("Preparing downloads failed: {e}")))?;
    let download_result: Result<Vec<BatchDownload>, GenError> = async {
        let mut downloads = Vec::with_capacity(request.scene_ids.len());
        for scene_id in &request.scene_ids {
            if !click_video_tool_card_download(session, tab, scene_id).await? {
                return Err(changed(&format!("Download File control for {scene_id}")));
            }
            let flow_name = format!("{scene_id}.mp4");
            let path = wait_for_file(&dir, &flow_name, Duration::from_secs(120)).await?;
            let bytes = std::fs::read(&path).map_err(|e| err(ErrorKind::Storage, format!("The downloaded {flow_name} could not be read: {e}")))?;
            if bytes.is_empty() { return Err(err(ErrorKind::NoImage, format!("The downloaded {flow_name} is empty."))); }
            downloads.push(BatchDownload { flow_name, bytes });
        }
        Ok(downloads)
    }.await;
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
