//! Background jobs: each long task has an id, reports progress to the UI, and can be cancelled.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::commands::error::AppError;

/// The event name the UI listens to.
pub const PROGRESS_EVENT: &str = "job-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub kind: String,
    /// Short text for the user, e.g. "Finding silences".
    pub stage: String,
    /// 0 to 100.
    pub percent: f64,
}

pub type ProgressSink = Arc<dyn Fn(&JobProgress) + Send + Sync>;

/// Sends progress to the UI as Tauri events.
pub fn event_sink(app: AppHandle) -> ProgressSink {
    Arc::new(move |progress| {
        let _ = app.emit(PROGRESS_EVENT, progress);
    })
}

/// One running job id: the cancel sender, a receiver template, and how many
/// handles share this id. Parallel batches of one frontend run share one job
/// id (see PromptsStep: one runJob id for every generate_text call), so the
/// registry must refcount the id instead of refusing the second handle.
/// Genuinely different runs never share an id: the frontend runJob id is
/// unique per run (timestamp in base 36 plus a counter), so uniqueness across
/// runs is provided by the caller, not by rejecting a duplicate id here.
struct JobEntry {
    sender: watch::Sender<bool>,
    /// A receiver cloned for every new handle, so cancel reaches all of them.
    receiver: watch::Receiver<bool>,
    count: usize,
}

/// Which jobs are running. Managed by Tauri as shared state.
#[derive(Clone, Default)]
pub struct JobRegistry {
    jobs: Arc<Mutex<HashMap<String, JobEntry>>>,
}

impl JobRegistry {
    pub fn begin(&self, id: &str, kind: &str, sink: ProgressSink) -> Result<Job, AppError> {
        let valid = !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !valid {
            return Err(AppError::new("The job could not be started.", format!("Not a valid job id: {id:?}")));
        }
        let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = jobs.get_mut(id) {
            entry.count += 1;
            let receiver = entry.receiver.clone();
            return Ok(Job { id: id.to_string(), kind: kind.to_string(), cancel: receiver, registry: self.clone(), sink, range: Mutex::new((0.0, 100.0)) });
        }
        let (sender, receiver) = watch::channel(false);
        jobs.insert(id.to_string(), JobEntry { sender, receiver: receiver.clone(), count: 1 });
        Ok(Job { id: id.to_string(), kind: kind.to_string(), cancel: receiver, registry: self.clone(), sink, range: Mutex::new((0.0, 100.0)) })
    }

    /// Asks a running job to stop. Returns false if there is no such job.
    /// Cancels every handle sharing the id, because they share one sender.
    pub fn cancel(&self, id: &str) -> bool {
        let jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        jobs.get(id).is_some_and(|entry| entry.sender.send(true).is_ok())
    }

    /// Drops one handle for the id; the id is removed only when the last
    /// handle is dropped, so a finished handle never removes a still-running
    /// parallel handle sharing the same id.
    fn finish(&self, id: &str) {
        let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = jobs.get_mut(id) {
            entry.count = entry.count.saturating_sub(1);
            if entry.count == 0 {
                jobs.remove(id);
            }
        }
    }
}

/// A running job. Dropping it releases one handle for its id.
pub struct Job {
    id: String,
    kind: String,
    cancel: watch::Receiver<bool>,
    registry: JobRegistry,
    sink: ProgressSink,
    /// The part of the whole progress bar (0 to 100) that `progress` currently reports into.
    range: Mutex<(f64, f64)>,
}

impl Job {
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Reports `percent` (0 to 100) of the current range.
    pub fn progress(&self, stage: &str, percent: f64) {
        let (from, to) = *self.range.lock().unwrap_or_else(|e| e.into_inner());
        let whole = from + (to - from) * percent.clamp(0.0, 100.0) / 100.0;
        (self.sink)(&JobProgress {
            job_id: self.id.clone(),
            kind: self.kind.clone(),
            stage: stage.to_string(),
            percent: whole.clamp(0.0, 100.0),
        });
    }

    /// From now on, `progress(_, 0..100)` fills only `from..to` of the progress bar. Lets one job
    /// run several steps that each count from 0 to 100.
    pub fn set_range(&self, from: f64, to: f64) {
        *self.range.lock().unwrap_or_else(|e| e.into_inner()) = (from, to);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    /// Fails with the "cancelled" error if Cancel was pressed.
    pub fn check(&self) -> Result<(), AppError> {
        if self.is_cancelled() { Err(AppError::cancelled()) } else { Ok(()) }
    }

    /// Completes when Cancel is pressed (never, if it is not).
    pub async fn cancelled(&self) {
        let mut receiver = self.cancel.clone();
        if receiver.wait_for(|cancelled| *cancelled).await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        self.registry.finish(&self.id);
    }
}

/// A job that records its progress instead of sending it anywhere (for tests).
#[cfg(test)]
pub fn test_job(registry: &JobRegistry, id: &str) -> (Job, Arc<Mutex<Vec<JobProgress>>>) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let sink_log = log.clone();
    let sink: ProgressSink = Arc::new(move |p| sink_log.lock().unwrap().push(p.clone()));
    (registry.begin(id, "test", sink).unwrap(), log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_can_be_cancelled_and_is_removed_when_dropped() {
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "job-1");
        assert!(!job.is_cancelled());
        assert!(job.check().is_ok());
        assert!(registry.cancel("job-1"));
        assert!(job.is_cancelled());
        assert_eq!(job.check().unwrap_err().code.as_deref(), Some("cancelled"));
        drop(job);
        assert!(!registry.cancel("job-1"), "a finished job cannot be cancelled");
    }

    #[test]
    fn a_range_scales_the_progress() {
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "range");
        job.set_range(20.0, 60.0);
        job.progress("a", 0.0);
        job.progress("a", 50.0);
        job.progress("a", 100.0);
        let percents: Vec<f64> = log.lock().unwrap().iter().map(|p| p.percent).collect();
        assert_eq!(percents, vec![20.0, 40.0, 60.0]);
    }

    #[test]
    fn the_same_id_is_shared_by_parallel_handles_and_bad_ids_are_refused() {
        // Parallel batches of one run share one job id, so a second begin
        // with the same id must succeed as a shared handle, not error.
        let registry = JobRegistry::default();
        let (first, _) = test_job(&registry, "same");
        let sink: ProgressSink = Arc::new(|_| {});
        let second = registry.begin("same", "test", sink.clone()).expect("same id shares the job");
        assert!(!first.is_cancelled() && !second.is_cancelled());
        // Bad ids are still refused.
        assert!(registry.begin("", "test", sink.clone()).is_err());
        assert!(registry.begin("../x", "test", sink).is_err());
        assert!(registry.begin(&"x".repeat(65), "test", sink).is_err());
    }

    #[test]
    fn cancel_reaches_every_handle_sharing_an_id() {
        let registry = JobRegistry::default();
        let (first, _) = test_job(&registry, "shared");
        let sink: ProgressSink = Arc::new(|_| {});
        let second = registry.begin("shared", "test", sink).unwrap();
        assert!(registry.cancel("shared"));
        assert!(first.is_cancelled() && second.is_cancelled());
    }

    #[test]
    fn dropping_one_shared_handle_keeps_the_id_cancellable() {
        let registry = JobRegistry::default();
        let (first, _) = test_job(&registry, "shared");
        let sink: ProgressSink = Arc::new(|_| {});
        let second = registry.begin("shared", "test", sink).unwrap();
        drop(first);
        assert!(registry.cancel("shared"), "one handle still runs, so cancel must still work");
        assert!(second.is_cancelled());
        drop(second);
        assert!(!registry.cancel("shared"), "no handle left, so the id is gone");
    }

    #[test]
    fn progress_is_clamped_and_reported() {
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "p");
        job.progress("Working", 150.0);
        job.progress("Working", -5.0);
        let log = log.lock().unwrap();
        assert_eq!(log[0].percent, 100.0);
        assert_eq!(log[1].percent, 0.0);
        assert_eq!(log[0].job_id, "p");
    }

    #[tokio::test]
    async fn cancelled_future_completes_after_cancel() {
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "wait");
        let canceller = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            canceller.cancel("wait");
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), job.cancelled()).await.unwrap();
    }
}
