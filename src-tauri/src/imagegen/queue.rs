//! The job queue: one job per scene, with a strict state machine.
//!
//! ```text
//!   queued --claim--> generating --complete--> completed
//!     ^                   |
//!     +----- requeue -----+--fail--> failed --retry--> queued
//! ```
//!
//! **No scene is generated twice at once.** A job is claimed synchronously (the caller holds the
//! queue lock) and every claim gets a new `lease`. A result is only accepted for the lease that is
//! current, so a late answer from a job that was retried, stopped or claimed again is thrown away.
//!
//! The queue knows nothing about browsers or files except one thing: when a job is claimed it
//! chooses the file name it will be saved under (`target`), so recovery can tell after a crash
//! whether that exact file was already written.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::errors::ErrorKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Generating,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Job {
    /// The scene id (`S01`). One job per scene.
    pub id: String,
    pub order: u32,
    /// The name the image should have: `S01_000.0-005.1.png`.
    pub file_name: String,
    pub prompt: String,
    /// `16:9`, `1:1` or `9:16`.
    pub aspect: String,
    pub status: Status,
    pub attempts: u32,
    pub account_id: Option<String>,
    pub lease: Option<String>,
    /// The file name chosen when the job was claimed (the wanted name, or `name (2).png` when taken).
    pub target: Option<String>,
    /// The saved picture, relative to the project folder (`media/S01_000.0-005.1.png`).
    pub file: Option<String>,
    pub error: String,
    pub error_kind: Option<ErrorKind>,
    /// A new picture was asked for although one exists.
    pub regenerate: bool,
    pub next_attempt_at: u64,
    pub created_at: u64,
    pub started_at: u64,
    pub finished_at: u64,
    pub updated_at: u64,
}

impl Default for Job {
    fn default() -> Self {
        Self {
            id: String::new(),
            order: 0,
            file_name: String::new(),
            prompt: String::new(),
            aspect: "16:9".to_string(),
            status: Status::Queued,
            attempts: 0,
            account_id: None,
            lease: None,
            target: None,
            file: None,
            error: String::new(),
            error_kind: None,
            regenerate: false,
            next_attempt_at: 0,
            created_at: 0,
            started_at: 0,
            finished_at: 0,
            updated_at: 0,
        }
    }
}

/// What the page asks for: one picture for one scene.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJob {
    pub scene_id: String,
    pub file_name: String,
    pub prompt: String,
    pub aspect: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReport {
    pub added: usize,
    /// Already queued, running or finished (and not forced).
    pub skipped: usize,
    /// Finished scenes that will get a new picture (forced).
    pub regenerating: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Stats {
    pub total: usize,
    pub queued: usize,
    pub generating: usize,
    pub completed: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Default)]
pub struct RequeueOptions {
    pub count_attempt: bool,
    /// With `count_attempt`: the job fails instead when this many attempts are used.
    pub max_attempts: Option<u32>,
    pub delay_ms: u64,
    pub error: String,
    pub error_kind: Option<ErrorKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requeued {
    Queued,
    Failed,
    /// The lease is not current: nothing was changed.
    Stale,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Queue {
    pub jobs: Vec<Job>,
}

static LEASES: AtomicU64 = AtomicU64::new(1);

fn new_lease(now: u64) -> String {
    format!("{now:x}-{:x}", LEASES.fetch_add(1, Ordering::Relaxed))
}

/// `name`, or `stem (2).ext`, `stem (3).ext` ... for the first name `taken` does not know.
pub fn unique_target(name: &str, taken: &dyn Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    for number in 2..10_000 {
        let candidate = format!("{stem} ({number}){extension}");
        if !taken(&candidate) {
            return candidate;
        }
    }
    name.to_string()
}

impl Queue {
    pub fn get(&self, id: &str) -> Option<&Job> {
        self.jobs.iter().find(|j| j.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    /// Adds the wanted pictures. A scene that already has a job keeps it (its running or finished
    /// state is never disturbed) unless `force` asks for a new picture of a finished scene.
    pub fn add_jobs(&mut self, wanted: Vec<NewJob>, force: bool, now: u64) -> AddReport {
        let mut report = AddReport::default();
        // New pictures go after the ones already in the queue, so adding more prompts later keeps the order.
        let base = self.jobs.iter().map(|j| j.order.saturating_add(1)).max().unwrap_or(0);
        for (index, item) in wanted.into_iter().enumerate() {
            let order = base.saturating_add(u32::try_from(index).unwrap_or(u32::MAX));
            match self.get_mut(&item.scene_id) {
                None => {
                    self.jobs.push(Job {
                        id: item.scene_id.clone(),
                        order,
                        file_name: item.file_name,
                        prompt: item.prompt,
                        aspect: item.aspect,
                        created_at: now,
                        updated_at: now,
                        ..Job::default()
                    });
                    report.added += 1;
                }
                Some(job) => match job.status {
                    Status::Generating => report.skipped += 1,
                    Status::Queued => {
                        job.file_name = item.file_name;
                        job.prompt = item.prompt;
                        job.aspect = item.aspect;
                        job.updated_at = now;
                        report.skipped += 1;
                    }
                    Status::Failed => {
                        job.file_name = item.file_name;
                        job.prompt = item.prompt;
                        job.aspect = item.aspect;
                        reset_for_retry(job, now);
                        report.added += 1;
                    }
                    Status::Completed if force => {
                        job.file_name = item.file_name;
                        job.prompt = item.prompt;
                        job.aspect = item.aspect;
                        reset_for_retry(job, now);
                        job.regenerate = true;
                        report.regenerating += 1;
                    }
                    Status::Completed => report.skipped += 1,
                },
            }
        }
        self.jobs.sort_by_key(|j| j.order);
        report
    }

    /// Takes the next job that is ready. It becomes `generating` with a new lease and the file name it will be saved under.
    pub fn claim_next(&mut self, now: u64, account_id: Option<&str>, taken: &dyn Fn(&str) -> bool) -> Option<Job> {
        let job = self.jobs.iter_mut().find(|j| j.status == Status::Queued && j.next_attempt_at <= now)?;
        job.status = Status::Generating;
        job.lease = Some(new_lease(now));
        job.account_id = account_id.map(str::to_string);
        job.target = Some(unique_target(&job.file_name, taken));
        job.started_at = now;
        job.updated_at = now;
        job.error.clear();
        job.error_kind = None;
        Some(job.clone())
    }

    pub fn is_lease_valid(&self, id: &str, lease: &str) -> bool {
        self.get(id).is_some_and(|j| j.status == Status::Generating && j.lease.as_deref() == Some(lease))
    }

    /// The picture is saved. Only the current lease may complete a job.
    pub fn complete(&mut self, id: &str, lease: &str, file: &str, now: u64) -> bool {
        if !self.is_lease_valid(id, lease) {
            return false;
        }
        let Some(job) = self.get_mut(id) else { return false };
        job.status = Status::Completed;
        job.attempts += 1;
        job.file = Some(file.to_string());
        job.lease = None;
        job.target = None;
        job.error.clear();
        job.error_kind = None;
        job.regenerate = false;
        job.finished_at = now;
        job.updated_at = now;
        true
    }

    /// Puts a running job back in the queue (an account paused, a browser closed, a retry).
    pub fn requeue(&mut self, id: &str, lease: &str, options: RequeueOptions, now: u64) -> Requeued {
        if !self.is_lease_valid(id, lease) {
            return Requeued::Stale;
        }
        let Some(job) = self.get_mut(id) else { return Requeued::Stale };
        if options.count_attempt {
            job.attempts += 1;
            if options.max_attempts.is_some_and(|max| job.attempts >= max) {
                finish_failed(job, options.error, options.error_kind, now);
                return Requeued::Failed;
            }
        }
        job.status = Status::Queued;
        job.lease = None;
        job.target = None;
        job.account_id = None;
        job.error = options.error;
        job.error_kind = options.error_kind;
        job.next_attempt_at = if options.delay_ms > 0 { now + options.delay_ms } else { 0 };
        job.updated_at = now;
        Requeued::Queued
    }

    /// The job cannot be done. It stays failed until the user retries it.
    pub fn fail(&mut self, id: &str, lease: &str, error: String, kind: Option<ErrorKind>, now: u64) -> bool {
        if !self.is_lease_valid(id, lease) {
            return false;
        }
        match self.get_mut(id) {
            Some(job) => {
                finish_failed(job, error, kind, now);
                true
            }
            None => false,
        }
    }

    /// Failed jobs (or the given ones) go back to the queue with a fresh number of attempts.
    pub fn retry(&mut self, ids: &[String], now: u64) -> usize {
        let mut count = 0;
        for job in &mut self.jobs {
            if job.status != Status::Failed || (!ids.is_empty() && !ids.contains(&job.id)) {
                continue;
            }
            reset_for_retry(job, now);
            count += 1;
        }
        count
    }

    /// Removes jobs that are not running. Returns how many were removed.
    pub fn remove(&mut self, ids: &[String]) -> usize {
        let before = self.jobs.len();
        self.jobs.retain(|j| j.status == Status::Generating || !(ids.is_empty() || ids.contains(&j.id)));
        before - self.jobs.len()
    }

    /// The earliest moment a delayed job becomes ready (0 when none waits).
    pub fn next_ready_at(&self, now: u64) -> u64 {
        self.jobs.iter().filter(|j| j.status == Status::Queued && j.next_attempt_at > now).map(|j| j.next_attempt_at).min().unwrap_or(0)
    }

    pub fn stats(&self) -> Stats {
        let mut stats = Stats { total: self.jobs.len(), ..Stats::default() };
        for job in &self.jobs {
            match job.status {
                Status::Queued => stats.queued += 1,
                Status::Generating => stats.generating += 1,
                Status::Completed => stats.completed += 1,
                Status::Failed => stats.failed += 1,
            }
        }
        stats
    }
}

fn reset_for_retry(job: &mut Job, now: u64) {
    job.status = Status::Queued;
    job.attempts = 0;
    job.lease = None;
    job.target = None;
    job.account_id = None;
    job.error.clear();
    job.error_kind = None;
    job.regenerate = false;
    job.next_attempt_at = 0;
    job.updated_at = now;
}

fn finish_failed(job: &mut Job, error: String, kind: Option<ErrorKind>, now: u64) {
    job.status = Status::Failed;
    job.lease = None;
    job.target = None;
    job.account_id = None;
    job.error = if error.is_empty() { "Unknown error".to_string() } else { error };
    job.error_kind = kind;
    job.finished_at = now;
    job.updated_at = now;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wanted(ids: &[&str]) -> Vec<NewJob> {
        ids.iter()
            .enumerate()
            .map(|(i, id)| NewJob { scene_id: (*id).to_string(), file_name: format!("{id}_{:03}.0-{:03}.0.png", i * 5, i * 5 + 5), prompt: format!("prompt {id}"), aspect: "16:9".to_string() })
            .collect()
    }

    fn nothing_taken(_: &str) -> bool {
        false
    }

    fn claim(queue: &mut Queue, now: u64) -> Option<Job> {
        queue.claim_next(now, Some("a1"), &nothing_taken)
    }

    #[test]
    fn adding_creates_one_job_per_scene_in_order() {
        let mut queue = Queue::default();
        let report = queue.add_jobs(wanted(&["S01", "S02", "S03"]), false, 10);
        assert_eq!(report, AddReport { added: 3, skipped: 0, regenerating: 0 });
        assert_eq!(queue.jobs.iter().map(|j| j.id.as_str()).collect::<Vec<_>>(), ["S01", "S02", "S03"]);
        assert_eq!(queue.stats(), Stats { total: 3, queued: 3, ..Stats::default() });
    }

    #[test]
    fn a_scene_is_never_added_twice() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01", "S02"]), false, 10);
        let again = queue.add_jobs(wanted(&["S01", "S02", "S03"]), false, 20);
        assert_eq!(again, AddReport { added: 1, skipped: 2, regenerating: 0 });
        assert_eq!(queue.jobs.len(), 3);
    }

    #[test]
    fn claiming_gives_each_job_to_exactly_one_caller() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01", "S02", "S03"]), false, 10);
        let a = claim(&mut queue, 11).unwrap();
        let b = claim(&mut queue, 11).unwrap();
        let c = claim(&mut queue, 11).unwrap();
        assert!(claim(&mut queue, 11).is_none(), "nothing is left to claim");
        let mut ids = vec![a.id.clone(), b.id.clone(), c.id.clone()];
        ids.sort();
        assert_eq!(ids, ["S01", "S02", "S03"]);
        let leases: std::collections::HashSet<_> = [a.lease, b.lease, c.lease].into_iter().collect();
        assert_eq!(leases.len(), 3, "every claim has its own lease");
        assert_eq!(queue.stats().generating, 3);
    }

    #[test]
    fn a_hundred_scenes_are_each_claimed_once() {
        let mut queue = Queue::default();
        let ids: Vec<String> = (1..=100).map(|n| format!("S{n:02}")).collect();
        queue.add_jobs(ids.iter().map(|id| NewJob { scene_id: id.clone(), file_name: format!("{id}.png"), prompt: "p".into(), aspect: "16:9".into() }).collect(), false, 1);
        let mut seen = std::collections::HashSet::new();
        while let Some(job) = claim(&mut queue, 2) {
            assert!(seen.insert(job.id), "claimed twice");
        }
        assert_eq!(seen.len(), 100);
    }

    #[test]
    fn a_late_result_with_an_old_lease_is_thrown_away() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 10);
        let first = claim(&mut queue, 11).unwrap();
        let lease1 = first.lease.unwrap();
        assert_eq!(queue.requeue("S01", &lease1, RequeueOptions::default(), 12), Requeued::Queued);
        let second = claim(&mut queue, 13).unwrap();
        let lease2 = second.lease.unwrap();
        assert!(!queue.complete("S01", &lease1, "media/x.png", 14), "the old lease is refused");
        assert!(!queue.fail("S01", &lease1, "late".into(), None, 14));
        assert_eq!(queue.requeue("S01", &lease1, RequeueOptions::default(), 14), Requeued::Stale);
        assert!(queue.complete("S01", &lease2, "media/x.png", 15));
        assert!(!queue.complete("S01", &lease2, "media/x.png", 16), "a finished job cannot finish again");
        assert_eq!(queue.get("S01").unwrap().attempts, 1);
    }

    #[test]
    fn requeue_with_a_delay_waits_and_counts_attempts() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 0);
        let lease = claim(&mut queue, 1).unwrap().lease.unwrap();
        let options = RequeueOptions { count_attempt: true, max_attempts: Some(3), delay_ms: 5_000, error: "slow".into(), error_kind: Some(ErrorKind::Timeout), ..RequeueOptions::default() };
        assert_eq!(queue.requeue("S01", &lease, options, 100), Requeued::Queued);
        assert!(claim(&mut queue, 4_000).is_none(), "still waiting");
        assert_eq!(queue.next_ready_at(4_000), 5_100);
        let job = claim(&mut queue, 5_100).unwrap();
        assert_eq!(job.attempts, 1);
    }

    #[test]
    fn a_job_fails_when_its_attempts_are_used_up() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 0);
        for attempt in 1..=3 {
            let lease = claim(&mut queue, attempt).unwrap().lease.unwrap();
            let options = RequeueOptions { count_attempt: true, max_attempts: Some(3), error: "no image".into(), error_kind: Some(ErrorKind::NoImage), ..RequeueOptions::default() };
            let result = queue.requeue("S01", &lease, options, attempt);
            assert_eq!(result, if attempt == 3 { Requeued::Failed } else { Requeued::Queued });
        }
        let job = queue.get("S01").unwrap();
        assert_eq!(job.status, Status::Failed);
        assert_eq!(job.error, "no image");
        assert_eq!(job.error_kind, Some(ErrorKind::NoImage));
    }

    #[test]
    fn pausing_an_account_requeues_without_using_an_attempt() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 0);
        let lease = claim(&mut queue, 1).unwrap().lease.unwrap();
        queue.requeue("S01", &lease, RequeueOptions { error_kind: Some(ErrorKind::RateLimit), ..RequeueOptions::default() }, 2);
        let job = queue.get("S01").unwrap();
        assert_eq!((job.status, job.attempts, job.account_id.clone()), (Status::Queued, 0, None));
    }

    #[test]
    fn the_target_name_is_unique_when_the_wanted_name_is_taken() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 0);
        let taken = |name: &str| name == "S01_000.0-005.0.png" || name == "S01_000.0-005.0 (2).png";
        let job = queue.claim_next(1, None, &taken).unwrap();
        assert_eq!(job.target.as_deref(), Some("S01_000.0-005.0 (3).png"));
        assert_eq!(unique_target("a.png", &|n| n == "a.png"), "a (2).png");
        assert_eq!(unique_target("noext", &|n| n == "noext"), "noext (2)");
        assert_eq!(unique_target("free.png", &|_| false), "free.png");
    }

    #[test]
    fn a_finished_scene_is_kept_unless_a_new_picture_is_forced() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01"]), false, 0);
        let lease = claim(&mut queue, 1).unwrap().lease.unwrap();
        queue.complete("S01", &lease, "media/S01_000.0-005.0.png", 2);
        let kept = queue.add_jobs(wanted(&["S01"]), false, 3);
        assert_eq!(kept.skipped, 1);
        assert_eq!(queue.get("S01").unwrap().status, Status::Completed);
        let forced = queue.add_jobs(wanted(&["S01"]), true, 4);
        assert_eq!(forced.regenerating, 1);
        let job = queue.get("S01").unwrap();
        assert_eq!((job.status, job.regenerate), (Status::Queued, true));
        assert_eq!(job.file.as_deref(), Some("media/S01_000.0-005.0.png"), "the old picture stays until the new one is saved");
    }

    #[test]
    fn running_jobs_are_not_disturbed_by_adding_or_removing() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01", "S02"]), false, 0);
        let running = claim(&mut queue, 1).unwrap();
        let mut changed = wanted(&["S01", "S02"]);
        changed[0].prompt = "new prompt".into();
        queue.add_jobs(changed, false, 2);
        assert_eq!(queue.get("S01").unwrap().prompt, "prompt S01", "a running job keeps its prompt");
        assert_eq!(queue.get("S02").unwrap().prompt, "prompt S02");
        assert_eq!(queue.remove(&[]), 1, "only the waiting job is removed");
        assert!(queue.is_lease_valid("S01", running.lease.as_deref().unwrap()));
    }

    #[test]
    fn retry_gives_failed_jobs_a_fresh_start() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01", "S02"]), false, 0);
        let lease = claim(&mut queue, 1).unwrap().lease.unwrap();
        queue.fail("S01", &lease, "refused".into(), Some(ErrorKind::Blocked), 2);
        assert_eq!(queue.retry(&["S02".to_string()], 3), 0, "S02 is not failed");
        assert_eq!(queue.retry(&[], 3), 1);
        let job = queue.get("S01").unwrap();
        assert_eq!((job.status, job.attempts, job.error.as_str()), (Status::Queued, 0, ""));
    }


    #[test]
    fn the_queue_survives_a_round_trip_through_json() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["S01", "S02"]), false, 5);
        claim(&mut queue, 6);
        let text = serde_json::to_string(&queue).unwrap();
        assert_eq!(serde_json::from_str::<Queue>(&text).unwrap(), queue);
        assert!(text.contains("\"fileName\""), "camelCase for the page");
    }

    #[test]
    fn prompts_added_later_go_after_the_earlier_ones() {
        let mut queue = Queue::default();
        queue.add_jobs(wanted(&["I001", "I002"]), false, 1);
        queue.add_jobs(wanted(&["I003", "I004"]), false, 2);
        let order: Vec<&str> = queue.jobs.iter().map(|j| j.id.as_str()).collect();
        assert_eq!(order, ["I001", "I002", "I003", "I004"]);
        // Asking again for one of the first scenes does not move it behind the others.
        queue.add_jobs(wanted(&["I002"]), false, 3);
        let order: Vec<&str> = queue.jobs.iter().map(|j| j.id.as_str()).collect();
        assert_eq!(order, ["I001", "I002", "I003", "I004"]);
    }
}
