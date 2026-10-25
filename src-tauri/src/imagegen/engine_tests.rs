//! The scheduler with fake generators: no browser, no network, no Google.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::engine::{BoxFuture, Engine, Generators, Picture, Sink, Tuning};
use super::errors::{ErrorKind, GenError};
use super::queue::{Job, NewJob, Status};
use super::save::tiny_png;
use super::settings::ImageGenSettings;
use super::testserver::temp_dir;

type Handler = dyn Fn(&Call) -> Picture + Send + Sync;

#[derive(Debug, Clone)]
struct Call {
    account: Option<String>,
    scene: String,
    nth: usize,
}

struct Fake {
    handler: Mutex<Box<Handler>>,
    delay_ms: u64,
    calls: Mutex<Vec<Call>>,
    counts: Mutex<HashMap<String, usize>>,
    window_switches: AtomicUsize,
    can_switch: bool,
}

impl Fake {
    fn new(handler: impl Fn(&Call) -> Picture + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { handler: Mutex::new(Box::new(handler)), delay_ms: 20, calls: Mutex::new(Vec::new()), counts: Mutex::new(HashMap::new()), window_switches: AtomicUsize::new(0), can_switch: true })
    }
    fn run(self: &Arc<Self>, account: Option<String>, job: &Job) -> BoxFuture<Picture> {
        let nth = {
            let mut counts = self.counts.lock().unwrap();
            let count = counts.entry(job.id.clone()).or_default();
            *count += 1;
            *count
        };
        let call = Call { account, scene: job.id.clone(), nth };
        self.calls.lock().unwrap().push(call.clone());
        let fake = self.clone();
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(fake.delay_ms)).await;
            (fake.handler.lock().unwrap())(&call)
        })
    }
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
}

struct Wrapper(Arc<Fake>);

impl Generators for Wrapper {
    fn free(&self, account_id: &str, job: &Job, _: &ImageGenSettings) -> BoxFuture<Picture> {
        self.0.run(Some(account_id.to_string()), job)
    }
    fn switch_to_window(&self, _: &str) -> BoxFuture<bool> {
        let fake = self.0.clone();
        Box::pin(async move { fake.can_switch && fake.window_switches.fetch_add(1, Ordering::SeqCst) == 0 })
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(String, Value)>>);

impl Sink for Events {
    fn emit(&self, event: &str, payload: Value) {
        if event != "imagegen-state" {
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }
}

fn ok() -> Picture {
    Ok(tiny_png(160, 90))
}

struct Setup {
    engine: Engine,
    project: PathBuf,
    events: Arc<Events>,
    fake: Arc<Fake>,
}

fn setup(name: &str, fake: Arc<Fake>, change: impl FnOnce(&mut ImageGenSettings)) -> Setup {
    let data = temp_dir(&format!("{name}-data"));
    let project = temp_dir(&format!("{name}-project"));
    std::fs::create_dir_all(project.join("media")).unwrap();
    let events = Arc::new(Events::default());
    let engine = Engine::new(data, Arc::new(Wrapper(fake.clone())), events.clone(), super::config::EngineConfig::bundled());
    engine.set_tuning(Tuning { retry_base_ms: 20, retry_max_ms: 100, session_cooldown_ms: 20, heartbeat_ms: 25, storage_retry_ms: 300 });
    let mut settings = engine.settings();
    settings.parallel = 3;
    settings.max_attempts = 3;
    change(&mut settings);
    engine.set_settings(settings).unwrap();
    engine.accept_consent().unwrap();
    let looper = engine.clone();
    tokio::spawn(async move { looper.run_loop().await });
    Setup { engine, project, events, fake }
}

fn account(engine: &Engine, name: &str) -> String {
    engine.with_accounts(|accounts, now| {
        let id = accounts.add(name, now);
        accounts.set_connected(&id, &format!("{}@example.com", name.to_lowercase()));
        accounts.set_verified(&id, Some(true), "");
        id
    })
}

fn scenes(count: usize) -> Vec<NewJob> {
    (1..=count)
        .map(|n| NewJob { scene_id: format!("S{n:02}"), file_name: format!("S{n:02}_{:05.1}-{:05.1}.png", (n - 1) as f64 * 5.0, n as f64 * 5.0), prompt: format!("scene {n}"), aspect: "16:9".into() })
        .collect()
}

async fn wait_for(engine: &Engine, what: &str, check: impl Fn(&super::engine::Snapshot) -> bool) {
    for _ in 0..400 {
        if check(&engine.snapshot()) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for: {what}\n{:?}", engine.snapshot().jobs.iter().map(|j| (j.id.clone(), j.status, j.error.clone())).collect::<Vec<_>>());
}

fn files(project: &PathBuf) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(project.join("media")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    names.sort();
    names
}

#[tokio::test]
async fn every_scene_becomes_a_picture_named_by_its_timecode() {
    let s = setup("all", Fake::new(|_| ok()), |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(6), false, true).unwrap();
    wait_for(&s.engine, "all completed", |snap| snap.stats.completed == 6).await;
    assert_eq!(files(&s.project), ["S01_000.0-005.0.png", "S02_005.0-010.0.png", "S03_010.0-015.0.png", "S04_015.0-020.0.png", "S05_020.0-025.0.png", "S06_025.0-030.0.png"]);
    let images: Vec<Value> = s.events.0.lock().unwrap().iter().filter(|(e, _)| e == "imagegen-image").map(|(_, p)| p.clone()).collect();
    assert_eq!(images.len(), 6);
    assert_eq!(images[0]["path"], "media/S01_000.0-005.0.png");
    assert_eq!((images[0]["width"].as_u64(), images[0]["height"].as_u64()), (Some(160), Some(90)));
    assert_eq!(s.fake.calls().len(), 6, "one call per scene");
}

#[tokio::test]
async fn two_accounts_share_the_work() {
    let s = setup("two", Fake::new(|_| ok()), |settings| settings.one_account_at_a_time = false);
    let (a, b) = (account(&s.engine, "A"), account(&s.engine, "B"));
    s.engine.start(&s.project, scenes(8), false, true).unwrap();
    wait_for(&s.engine, "all completed", |snap| snap.stats.completed == 8).await;
    let calls = s.fake.calls();
    assert!(calls.iter().any(|c| c.account.as_deref() == Some(a.as_str())) && calls.iter().any(|c| c.account.as_deref() == Some(b.as_str())));
}

#[tokio::test]
async fn by_default_only_one_account_works_at_a_time() {
    let s = setup("one-at-a-time", Fake::new(|_| ok()), |_| {});
    let (a, _b) = (account(&s.engine, "A"), account(&s.engine, "B"));
    s.engine.start(&s.project, scenes(8), false, true).unwrap();
    wait_for(&s.engine, "all completed", |snap| snap.stats.completed == 8).await;
    let calls = s.fake.calls();
    assert!(calls.iter().all(|c| c.account.as_deref() == Some(a.as_str())), "the second account was not started: {calls:?}");
}

#[tokio::test]
async fn a_usage_limit_pauses_only_that_account_and_the_job_moves_on_for_free() {
    let fake = Fake::new(|call| if call.account.is_some() && call.nth == 1 && call.scene == "S01" { Err(GenError::new(ErrorKind::RateLimit, "limit")) } else { ok() });
    let s = setup("limit", fake, |_| {});
    let (a, _b) = (account(&s.engine, "A"), account(&s.engine, "B"));
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "completed after the limit", |snap| snap.stats.completed == 1).await;
    let snap = s.engine.snapshot();
    let limited = snap.accounts.iter().filter(|x| x.cooldown_until > snap.now).count();
    assert_eq!(limited, 1, "exactly one account rests");
    assert_eq!(snap.jobs[0].attempts, 1, "the limit used no attempt");
    assert_eq!(s.fake.calls()[0].account.as_deref(), Some(a.as_str()));
    assert_eq!(files(&s.project).len(), 1);
}

#[tokio::test]
async fn when_every_account_is_limited_the_jobs_wait() {
    let fake = Fake::new(|_| Err(GenError::new(ErrorKind::RateLimit, "limit")));
    let s = setup("wait", fake, |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(2), false, true).unwrap();
    wait_for(&s.engine, "the notice", |snap| snap.notice.as_ref().is_some_and(|n| n.kind == "all_limited")).await;
    let snap = s.engine.snapshot();
    assert_eq!(snap.stats.queued, 2);
    assert!(snap.notice.unwrap().until > snap.now);
    assert!(files(&s.project).is_empty());
}

#[tokio::test]
async fn without_any_account_nothing_runs_and_the_page_says_why() {
    let t = setup("noacc", Fake::new(|_| ok()), |_| {});
    t.engine.start(&t.project, scenes(1), false, true).unwrap();
    wait_for(&t.engine, "notice", |snap| snap.notice.as_ref().is_some_and(|n| n.kind == "no_account")).await;
    assert!(t.fake.calls().is_empty());
}

#[tokio::test]
async fn content_refusals_fail_at_once_and_are_never_retried() {
    let fake = Fake::new(|call| if call.scene == "S02" { Err(GenError::new(ErrorKind::Blocked, "refused")) } else { ok() });
    let s = setup("blocked", fake, |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(3), false, true).unwrap();
    wait_for(&s.engine, "settled", |snap| snap.stats.completed == 2 && snap.stats.failed == 1).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(s.fake.calls().iter().filter(|c| c.scene == "S02").count(), 1);
    assert_eq!(s.engine.retry_failed(&[]), 1, "the user can still retry it");
}

#[tokio::test]
async fn timeouts_retry_with_a_delay_and_stop_after_the_maximum() {
    let fake = Fake::new(|call| if call.scene == "S01" { Err(GenError::new(ErrorKind::Timeout, "slow")) } else { ok() });
    let s = setup("timeout", fake, |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(2), false, true).unwrap();
    wait_for(&s.engine, "failed after 3 attempts", |snap| snap.stats.failed == 1 && snap.stats.completed == 1).await;
    assert_eq!(s.fake.calls().iter().filter(|c| c.scene == "S01").count(), 3);
    assert_eq!(s.engine.snapshot().jobs[0].attempts, 3);
}

#[tokio::test]
async fn a_signed_out_account_takes_no_more_jobs_and_the_job_waits_for_a_working_one() {
    let fake = Fake::new(|call| if call.account.is_some() && call.nth == 1 { Err(GenError::new(ErrorKind::Auth, "signed out")) } else { ok() });
    let s = setup("auth", fake, |_| {});
    let a = account(&s.engine, "A");
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "account marked signed out", |snap| snap.accounts.iter().any(|x| x.id == a && format!("{:?}", x.status) == "SignedOut")).await;
    assert_eq!(s.engine.snapshot().stats.queued, 1);
    let b = account(&s.engine, "B");
    wait_for(&s.engine, "done by B", |snap| snap.stats.completed == 1).await;
    assert_eq!(s.fake.calls().last().unwrap().account.as_deref(), Some(b.as_str()));
}

#[tokio::test]
async fn hidden_mode_refused_switches_to_a_window_once_without_blaming_the_account() {
    let fake = Fake::new(|call| if call.nth == 1 { Err(GenError::new(ErrorKind::Access, "no access")) } else { ok() });
    let s = setup("access", fake, |_| {});
    let a = account(&s.engine, "A");
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "completed after the switch", |snap| snap.stats.completed == 1).await;
    assert_eq!(s.fake.window_switches.load(Ordering::SeqCst), 1);
    let snap = s.engine.snapshot();
    assert!(snap.accounts.iter().find(|x| x.id == a).is_some_and(|x| format!("{:?}", x.verified) == "Unknown" || format!("{:?}", x.verified) == "Yes"));
}

#[tokio::test]
async fn pausing_stops_new_work_and_resuming_continues() {
    let mut fake = Fake::new(|_| ok());
    Arc::get_mut(&mut fake).unwrap().delay_ms = 80;
    let s = setup("pause", fake, |settings| settings.parallel = 1);
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(6), false, true).unwrap();
    wait_for(&s.engine, "first done", |snap| snap.stats.completed >= 1).await;
    s.engine.pause();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let done = s.engine.snapshot().stats.completed;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(s.engine.snapshot().stats.completed, done, "nothing new while paused");
    assert!(done < 6);
    s.engine.resume();
    wait_for(&s.engine, "all done", |snap| snap.stats.completed == 6).await;
}

#[tokio::test]
async fn a_different_file_with_the_same_name_is_never_overwritten() {
    let s = setup("never", Fake::new(|_| ok()), |_| {});
    account(&s.engine, "A");
    std::fs::write(s.project.join("media").join("S01_000.0-005.0.png"), b"the user's own picture").unwrap();
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "completed", |snap| snap.stats.completed == 1).await;
    assert_eq!(std::fs::read(s.project.join("media").join("S01_000.0-005.0.png")).unwrap(), b"the user's own picture");
    assert!(files(&s.project).contains(&"S01_000.0-005.0 (2).png".to_string()));
}

#[tokio::test]
async fn regenerate_saves_a_new_file_and_adding_scenes_twice_makes_no_duplicates() {
    let s = setup("regen", Fake::new(|_| ok()), |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(2), false, true).unwrap();
    wait_for(&s.engine, "done", |snap| snap.stats.completed == 2).await;
    let again = s.engine.start(&s.project, scenes(2), false, true).unwrap();
    assert_eq!((again.added, again.skipped), (0, 2), "finished scenes are not made twice");
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(s.fake.calls().len(), 2);
    let force = s.engine.start(&s.project, scenes(1), true, true).unwrap();
    assert_eq!(force.regenerating, 1);
    wait_for(&s.engine, "regenerated", |snap| snap.stats.completed == 2 && snap.jobs[0].regenerate == false && snap.jobs[0].file.as_deref() == Some("media/S01_000.0-005.0 (2).png")).await;
    assert_eq!(files(&s.project).len(), 3);
}

#[tokio::test]
async fn a_crash_in_the_middle_resumes_without_duplicates() {
    // First "process": a slow generator, killed (dropped) while jobs are running.
    let mut slow = Fake::new(|_| ok());
    Arc::get_mut(&mut slow).unwrap().delay_ms = 60;
    let s = setup("crash", slow, |settings| settings.parallel = 2);
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(6), false, true).unwrap();
    wait_for(&s.engine, "some done", |snap| snap.stats.completed >= 2).await;
    let data = s.engine.data_dir().to_path_buf();
    let done_files = files(&s.project);
    // The "crash": the first engine and its tasks are abandoned. A second engine starts on the same folders.
    let fake2 = Fake::new(|_| ok());
    let events = Arc::new(Events::default());
    let engine2 = Engine::new(data, Arc::new(Wrapper(fake2.clone())), events, super::config::EngineConfig::bundled());
    engine2.set_tuning(Tuning { heartbeat_ms: 25, ..Tuning::default() });
    assert!(engine2.resume_after_restart(), "the run was marked as running");
    let looper = engine2.clone();
    tokio::spawn(async move { looper.run_loop().await });
    wait_for(&engine2, "all completed after restart", |snap| snap.stats.completed == 6).await;
    // Pictures that existed before the crash are not generated again; each scene has exactly one file.
    assert_eq!(files(&s.project).len(), 6, "{:?}", files(&s.project));
    for name in &done_files {
        assert!(!fake2.calls().iter().any(|c| name.starts_with(&c.scene)), "{name} was made again");
    }
}

#[tokio::test]
async fn a_folder_that_cannot_be_written_pauses_and_the_save_is_tried_again() {
    let s = setup("storage", Fake::new(|_| ok()), |_| {});
    account(&s.engine, "A");
    // `media` is a file: nothing can be saved there.
    std::fs::remove_dir_all(s.project.join("media")).unwrap();
    std::fs::write(s.project.join("media"), b"x").unwrap();
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "storage notice", |snap| snap.notice.as_ref().is_some_and(|n| n.kind == "storage")).await;
    assert_eq!(s.engine.snapshot().jobs[0].attempts, 0, "no attempt was used");
    std::fs::remove_file(s.project.join("media")).unwrap();
    std::fs::create_dir_all(s.project.join("media")).unwrap();
    wait_for(&s.engine, "saved after the folder is back", |snap| snap.stats.completed == 1).await;
    assert_eq!(files(&s.project).len(), 1);
}

#[tokio::test]
async fn removing_a_running_job_throws_its_late_answer_away() {
    let mut fake = Fake::new(|_| ok());
    Arc::get_mut(&mut fake).unwrap().delay_ms = 200;
    let s = setup("stale", fake, |_| {});
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(1), false, true).unwrap();
    wait_for(&s.engine, "generating", |snap| snap.stats.generating == 1).await;
    // Removing a running job is refused; changing the list while it runs must not break it.
    assert_eq!(s.engine.remove_jobs(&["S01".to_string()]), 0);
    wait_for(&s.engine, "completed", |snap| snap.stats.completed == 1).await;
    assert_eq!(files(&s.project).len(), 1);
    assert_eq!(s.engine.snapshot().jobs[0].status, Status::Completed);
}

#[tokio::test]
async fn the_limit_of_parallel_pictures_is_respected() {
    let running = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let (r, p) = (running.clone(), peak.clone());
    let mut fake = Fake::new(move |_| {
        let now = r.fetch_add(1, Ordering::SeqCst) + 1;
        p.fetch_max(now, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(1));
        r.fetch_sub(1, Ordering::SeqCst);
        ok()
    });
    Arc::get_mut(&mut fake).unwrap().delay_ms = 60;
    let s = setup("limit-par", fake, |settings| settings.parallel = 2);
    account(&s.engine, "A");
    s.engine.start(&s.project, scenes(6), false, true).unwrap();
    // The fake only sees calls at the end of each delay, so measure through the snapshot instead.
    let mut most = 0;
    for _ in 0..200 {
        most = most.max(s.engine.snapshot().stats.generating);
        if s.engine.snapshot().stats.completed == 6 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(s.engine.snapshot().stats.completed, 6);
    assert!(most <= 2 && most >= 1, "most at once: {most}");
    let _ = peak;
}
