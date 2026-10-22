//! The browser layer against the local imitation of Gemini and the tool, with a real Chromium.
//! Skipped (with a message) when no Chromium is installed.

use std::time::Duration;

use super::browser::session::{Launch, Mode, Session};
use super::errors::ErrorKind;
use super::testserver::{temp_dir, test_args, test_browser, TestServer};
use super::tool_page::{self, CardStatus};

async fn open(name: &str) -> Option<(Session, TestServer, std::path::PathBuf)> {
    let Some(exe) = test_browser() else {
        eprintln!("skipped: no Chromium found (set AVE_TEST_CHROME)");
        return None;
    };
    let server = TestServer::start().await;
    let profile = temp_dir(name);
    let launch = Launch { exe, profile: profile.join("profile"), mode: Mode::Hidden, extra_args: test_args() };
    let session = Session::open(&launch).await.expect("browser starts");
    Some((session, server, profile))
}

#[tokio::test]
async fn opens_the_tool_in_its_own_frame_and_makes_pictures() {
    let Some((session, server, dir)) = open("tool").await else { return };
    let config = server.config();
    let (frame, email) = tool_page::open_tool(&session, &config).await.expect("tool opens");
    assert_eq!(email, "test@example.com");
    assert_ne!(frame.session, session.page_session, "the tool runs in its own process (cross-site frame)");

    tool_page::prepare(&session, &frame, &config, 2, "9:16").await.unwrap();
    let first = tool_page::submit(&session, &frame, &config, "A red fox\nin   the snow").await.unwrap();
    let second = tool_page::submit(&session, &frame, &config, "A blue whale").await.unwrap();
    assert_eq!((first, second), (1, 2));

    let mut cards = Vec::new();
    for _ in 0..40 {
        cards = tool_page::poll(&session, &frame, &config).await.unwrap();
        if cards.len() == 2 && cards.iter().all(|c| c.status == CardStatus::Completed) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    assert!(cards.iter().all(|c| c.status == CardStatus::Completed && c.has_image), "{cards:?}");
    let image = tool_page::read_image(&session, &frame, &config, 1).await.unwrap();
    assert_eq!(super::save::png_size(&image), Some((72, 128)), "the 9:16 button was pressed");
    assert!(tool_page::clear_if_idle(&session, &frame, &config).await.unwrap());
    assert!(tool_page::poll(&session, &frame, &config).await.unwrap().is_empty());

    let shot = session.snapshot().await.unwrap();
    assert!(shot.starts_with(&[0xff, 0xd8]), "the snapshot is a JPEG");
    session.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn failed_cards_are_classified_like_the_real_tool() {
    let Some((session, server, dir)) = open("errors").await else { return };
    let config = server.config();
    let (frame, _) = tool_page::open_tool(&session, &config).await.unwrap();
    tool_page::prepare(&session, &frame, &config, 4, "16:9").await.unwrap();
    for prompt in ["[429] a", "[noimg] b", "[500] c", "[400] d"] {
        tool_page::submit(&session, &frame, &config, prompt).await.unwrap();
    }
    let mut cards = Vec::new();
    for _ in 0..40 {
        cards = tool_page::poll(&session, &frame, &config).await.unwrap();
        if cards.len() == 4 && cards.iter().all(|c| c.status == CardStatus::Failed) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let kinds: Vec<ErrorKind> = cards.iter().map(|c| tool_page::card_error(&config, c, false).kind).collect();
    assert_eq!(kinds, [ErrorKind::RateLimit, ErrorKind::NoImage, ErrorKind::Server, ErrorKind::BadRequest]);
    session.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_signed_out_page_is_reported_as_auth_after_a_few_seconds() {
    let Some((session, server, dir)) = open("signedout").await else { return };
    server.signed_in.store(false, std::sync::atomic::Ordering::SeqCst);
    let config = server.config();
    let started = std::time::Instant::now();
    let error = tool_page::open_tool(&session, &config).await.err().expect("signed out must fail");
    assert_eq!(error.kind, ErrorKind::Auth, "{error}");
    assert!(started.elapsed() >= Duration::from_secs(4));
    session.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_browser_left_running_is_attached_again_and_keeps_one_tab() {
    let Some((first, server, dir)) = open("reattach").await else { return };
    let profile = dir.join("profile");
    // A second open on the same profile (as after a crash of the app) attaches instead of starting another browser.
    let launch = Launch { exe: test_browser().unwrap(), profile: profile.clone(), mode: Mode::Hidden, extra_args: test_args() };
    let second = Session::open(&launch).await.expect("re-attach");
    second.navigate(&server.gemini_url(), Duration::from_secs(20)).await.unwrap();
    let state = tool_page::sign_state(&second, &server.config()).await.unwrap();
    assert!(state.signed_in);
    let targets = second.cdp.call("Target.getTargets", serde_json::json!({}), None).await.unwrap();
    let pages = targets["targetInfos"].as_array().unwrap().iter().filter(|t| t["type"] == "page").count();
    assert_eq!(pages, 1);
    second.stop().await;
    drop(first);
    let _ = std::fs::remove_dir_all(dir);
}

// ---- the worker (several prompts at once, errors, lost cards) ----

use super::worker::{FreeWorker, WorkerConfig};
use std::sync::Arc;

async fn worker(name: &str) -> Option<(FreeWorker, TestServer, std::path::PathBuf)> {
    let exe = test_browser().or_else(|| {
        eprintln!("skipped: no Chromium found (set AVE_TEST_CHROME)");
        None
    })?;
    let server = TestServer::start().await;
    let dir = temp_dir(name);
    let config = WorkerConfig { exe, profile: dir.join("profile"), mode: Mode::Hidden, extra_args: test_args(), engine: Arc::new(server.config()) };
    Some((FreeWorker::new(config), server, dir))
}

#[tokio::test]
async fn the_worker_makes_several_pictures_at_once_in_the_right_shape() {
    let Some((worker, _server, dir)) = worker("w-many").await else { return };
    let started = std::time::Instant::now();
    let jobs: Vec<_> = (1..=5)
        .map(|n| {
            let worker = worker.clone();
            tokio::spawn(async move { worker.generate(&format!("Scene {n}"), "16:9", 3, Duration::from_secs(30)).await })
        })
        .collect();
    for job in jobs {
        let image = job.await.unwrap().expect("picture");
        assert_eq!(super::save::png_size(&image), Some((128, 72)));
    }
    assert!(started.elapsed() < Duration::from_secs(20));
    assert!(worker.snapshot().await.is_some());
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn the_worker_reports_errors_per_prompt_without_mixing_them_up() {
    let Some((worker, _server, dir)) = worker("w-err").await else { return };
    let run = |prompt: &'static str| {
        let worker = worker.clone();
        tokio::spawn(async move { worker.generate(prompt, "1:1", 4, Duration::from_secs(30)).await })
    };
    let (a, b, c, d) = (run("[429] one"), run("ok two"), run("[noimg] three"), run("[400] four"));
    assert_eq!(a.await.unwrap().unwrap_err().kind, ErrorKind::RateLimit);
    assert_eq!(super::save::png_size(&b.await.unwrap().unwrap()), Some((128, 128)));
    assert_eq!(c.await.unwrap().unwrap_err().kind, ErrorKind::NoImage);
    assert_eq!(d.await.unwrap().unwrap_err().kind, ErrorKind::BadRequest);
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_slow_picture_times_out() {
    let Some((worker, _server, dir)) = worker("w-slow").await else { return };
    let error = worker.generate("[slow] never in time", "16:9", 1, Duration::from_secs(1)).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Timeout);
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_list_that_was_cleared_under_the_job_is_a_session_error_so_the_job_is_queued_again() {
    let Some((worker, _server, dir)) = worker("w-lost").await else { return };
    let busy = {
        let worker = worker.clone();
        tokio::spawn(async move { worker.generate("[slow] will vanish", "16:9", 1, Duration::from_secs(40)).await })
    };
    // Wait until the tool really works on it (the browser needs a moment to start).
    for _ in 0..100 {
        if worker.eval_in_tool("document.querySelector('#cntGenerating').textContent").await == Some(serde_json::json!("1")) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    // Someone presses "Clear batch" in the tool (it is idle-guarded in the app, but not for the user).
    worker.eval_in_tool("document.querySelector('#clearBatchBtn').click(); true").await;
    let error = busy.await.unwrap().unwrap_err();
    assert_eq!(error.kind, ErrorKind::Session, "{error}");
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn after_the_browser_dies_the_next_job_opens_a_new_one() {
    let Some((worker, _server, dir)) = worker("w-die").await else { return };
    worker.generate("first", "16:9", 1, Duration::from_secs(30)).await.expect("first");
    worker.close().await;
    let image = worker.generate("second", "16:9", 1, Duration::from_secs(30)).await.expect("a fresh browser is started");
    assert!(super::save::png_size(&image).is_some());
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_signed_out_account_gets_an_auth_error_and_no_browser_is_left_open() {
    let Some((worker, server, dir)) = worker("w-auth").await else { return };
    server.signed_in.store(false, std::sync::atomic::Ordering::SeqCst);
    let error = worker.generate("x", "16:9", 1, Duration::from_secs(30)).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Auth);
    assert!(worker.snapshot().await.is_none());
    let _ = std::fs::remove_dir_all(dir);
}

// ---- the chat (text answers) ----

#[tokio::test]
async fn the_chat_returns_a_finished_answer_and_its_code() {
    let Some((worker, _server, dir)) = worker("chat-ok").await else { return };
    let plain = worker.chat("Say hello\nin two lines", &[], Duration::from_secs(30)).await.expect("plain answer");
    assert!(plain.text.starts_with("Echo: Say hello"), "{plain:?}");
    assert!(plain.code.is_empty());

    let with_code = worker.chat("[code] a page", &[], Duration::from_secs(30)).await.expect("answer with code");
    assert_eq!(with_code.code, vec!["<div id=\"a\">hi</div>\nline two".to_string()]);
    assert_eq!(with_code.first_code_or_text(), "<div id=\"a\">hi</div>\nline two");
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn pictures_are_uploaded_through_the_pages_own_upload_and_reach_the_question() {
    let Some((worker, _server, dir)) = worker("chat-pictures").await else { return };
    let first = dir.join("one.jpg");
    let second = dir.join("two.jpg");
    std::fs::write(&first, b"jpeg one").unwrap();
    std::fs::write(&second, b"jpeg two").unwrap();
    let reply = worker.chat("describe them", &[first.clone(), second], Duration::from_secs(30)).await.expect("answer with pictures");
    assert_eq!(reply.text, "Echo with 2 files: describe them", "{reply:?}");
    let missing = worker.chat("x", &[dir.join("nope.jpg")], Duration::from_secs(5)).await.expect_err("missing file");
    assert_eq!(missing.kind, ErrorKind::BadRequest);
    let too_many: Vec<std::path::PathBuf> = (0..5).map(|_| first.clone()).collect();
    assert_eq!(worker.chat("x", &too_many, Duration::from_secs(5)).await.expect_err("too many").kind, ErrorKind::BadRequest);
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn several_chat_questions_in_a_row_each_get_their_own_fresh_chat() {
    let Some((worker, _server, dir)) = worker("chat-many").await else { return };
    for n in 1..=3 {
        let reply = worker.chat(&format!("question {n}"), &[], Duration::from_secs(30)).await.expect("answer");
        assert_eq!(reply.text, format!("Echo: question {n}"), "a fresh chat has no earlier answers");
    }
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_usage_limit_message_is_a_rate_limit_error() {
    let Some((worker, _server, dir)) = worker("chat-limit").await else { return };
    let error = worker.chat("[limit] please", &[], Duration::from_secs(30)).await.expect_err("limit");
    assert_eq!(error.kind, ErrorKind::RateLimit, "{error}");
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn an_answer_that_never_starts_is_an_error_and_a_missing_done_marker_falls_back_to_stable_text() {
    let Some((worker, _server, dir)) = worker("chat-edge").await else { return };
    let error = worker.chat("[never] nothing", &[], Duration::from_secs(30)).await.expect_err("no answer");
    assert_ne!(error.kind, ErrorKind::RateLimit);
    let reply = worker.chat("[nodone] still counts", &[], Duration::from_secs(30)).await.expect("stable text is finished");
    assert_eq!(reply.text, "Echo: [nodone] still counts");
    let empty = worker.chat("   ", &[], Duration::from_secs(5)).await.expect_err("empty prompt");
    assert_eq!(empty.kind, ErrorKind::BadRequest);
    worker.close().await;
    let _ = std::fs::remove_dir_all(dir);
}
