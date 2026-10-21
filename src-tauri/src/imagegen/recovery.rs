//! Start-up recovery. After a crash, a forced quit or a power cut the saved queue is brought back to a
//! state that can simply be resumed, without making any picture twice:
//!
//! * a job that was `generating` and whose file was already written becomes `completed`;
//! * any other `generating` job was interrupted: it goes back to `queued` and no attempt is used;
//! * failed jobs can be queued again with fresh attempts (content refusals are never retried);
//! * pauses from the last session are forgotten.
//!
//! A finished job whose picture was deleted by the user is left alone: the user deleted it on purpose.

use super::errors::ErrorKind;
use super::queue::{Queue, Status};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Report {
    /// Written to disk before the crash, so not generated again.
    pub salvaged: usize,
    pub requeued: usize,
    pub retried_failed: usize,
}

/// `exists(relative path)` tells whether a file in the project folder is there and not empty.
pub fn recover(queue: &mut Queue, exists: &dyn Fn(&str) -> bool, retry_failed: bool, now: u64) -> Report {
    let mut report = Report::default();
    for job in &mut queue.jobs {
        match job.status {
            Status::Generating => {
                let saved = job.target.as_ref().map(|name| format!("media/{name}")).filter(|path| exists(path));
                if let Some(path) = saved {
                    job.status = Status::Completed;
                    job.attempts += 1;
                    job.file = Some(path);
                    job.error.clear();
                    job.error_kind = None;
                    job.regenerate = false;
                    job.finished_at = now;
                    report.salvaged += 1;
                } else {
                    job.status = Status::Queued;
                    report.requeued += 1;
                }
                job.lease = None;
                job.target = None;
                job.account_id = None;
                job.updated_at = now;
            }
            Status::Failed if retry_failed && job.error_kind != Some(ErrorKind::Blocked) && job.error_kind != Some(ErrorKind::BadRequest) => {
                job.status = Status::Queued;
                job.attempts = 0;
                job.error.clear();
                job.error_kind = None;
                job.updated_at = now;
                report.retried_failed += 1;
            }
            _ => {}
        }
        if job.status == Status::Queued {
            job.next_attempt_at = 0;
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imagegen::queue::NewJob;

    fn queue_with(ids: &[&str]) -> Queue {
        let mut queue = Queue::default();
        queue.add_jobs(ids.iter().map(|id| NewJob { scene_id: (*id).into(), file_name: format!("{id}_000.0-005.0.png"), prompt: "p".into(), aspect: "16:9".into() }).collect(), false, 1);
        queue
    }

    fn never(_: &str) -> bool {
        false
    }

    #[test]
    fn an_interrupted_job_without_a_file_is_queued_again_for_free() {
        let mut queue = queue_with(&["S01"]);
        queue.claim_next(2, Some("a"), &never).unwrap();
        let report = recover(&mut queue, &|_| false, false, 10);
        assert_eq!(report, Report { requeued: 1, ..Report::default() });
        let job = queue.get("S01").unwrap();
        assert_eq!((job.status, job.attempts, job.lease.clone(), job.target.clone()), (Status::Queued, 0, None, None));
    }

    #[test]
    fn a_job_whose_file_was_already_written_is_completed_not_generated_again() {
        let mut queue = queue_with(&["S01", "S02"]);
        queue.claim_next(2, Some("a"), &never).unwrap();
        queue.claim_next(2, Some("a"), &never).unwrap();
        // The crash: S01's picture reached the disk, S02's did not.
        let report = recover(&mut queue, &|path| path == "media/S01_000.0-005.0.png", false, 10);
        assert_eq!((report.salvaged, report.requeued), (1, 1));
        let s01 = queue.get("S01").unwrap();
        assert_eq!((s01.status, s01.file.as_deref()), (Status::Completed, Some("media/S01_000.0-005.0.png")));
        assert_eq!(queue.get("S02").unwrap().status, Status::Queued);
    }

    #[test]
    fn a_crash_in_the_middle_of_a_run_makes_no_duplicates() {
        let mut queue = queue_with(&["S01", "S02", "S03"]);
        let saved: std::collections::HashSet<String> = ["media/S01_000.0-005.0.png".to_string()].into();
        let first = queue.claim_next(2, Some("a"), &never).unwrap();
        queue.complete("S01", first.lease.as_deref().unwrap(), "media/S01_000.0-005.0.png", 3);
        queue.claim_next(3, Some("a"), &never).unwrap(); // S02 in flight when the app dies
        // Restart: the queue is read back from disk.
        let mut restored: Queue = serde_json::from_str(&serde_json::to_string(&queue).unwrap()).unwrap();
        recover(&mut restored, &|p| saved.contains(p), false, 20);
        // The user presses "Generate all" again: only what is missing is queued.
        let report = restored.add_jobs(vec![
            NewJob { scene_id: "S01".into(), file_name: "S01_000.0-005.0.png".into(), prompt: "p".into(), aspect: "16:9".into() },
            NewJob { scene_id: "S02".into(), file_name: "S02_000.0-005.0.png".into(), prompt: "p".into(), aspect: "16:9".into() },
            NewJob { scene_id: "S03".into(), file_name: "S03_000.0-005.0.png".into(), prompt: "p".into(), aspect: "16:9".into() },
        ], false, 21);
        assert_eq!(report.added, 0);
        assert_eq!(restored.stats().completed, 1);
        assert_eq!(restored.stats().queued, 2);
    }

    #[test]
    fn failed_jobs_are_retried_except_refusals() {
        let mut queue = queue_with(&["S01", "S02"]);
        let a = queue.claim_next(2, None, &never).unwrap();
        let b = queue.claim_next(2, None, &never).unwrap();
        queue.fail(&a.id, a.lease.as_deref().unwrap(), "no image".into(), Some(ErrorKind::NoImage), 3);
        queue.fail(&b.id, b.lease.as_deref().unwrap(), "refused".into(), Some(ErrorKind::Blocked), 3);
        let report = recover(&mut queue, &|_| false, true, 10);
        assert_eq!(report.retried_failed, 1);
        assert_eq!(queue.get(&a.id).unwrap().status, Status::Queued);
        assert_eq!(queue.get(&b.id).unwrap().status, Status::Failed);
        let mut untouched = queue.clone();
        assert_eq!(recover(&mut untouched, &|_| false, false, 11).retried_failed, 0);
    }

    #[test]
    fn old_delays_are_forgotten_and_finished_jobs_are_left_alone() {
        let mut queue = queue_with(&["S01", "S02"]);
        let a = queue.claim_next(2, None, &never).unwrap();
        queue.requeue(&a.id, a.lease.as_deref().unwrap(), crate::imagegen::queue::RequeueOptions { delay_ms: 60_000, ..Default::default() }, 3);
        let b = queue.claim_next(3, None, &never).unwrap();
        queue.claim_next(3, None, &never);
        queue.complete(&b.id, b.lease.as_deref().unwrap(), "media/gone.png", 4);
        recover(&mut queue, &|_| false, false, 10);
        assert_eq!(queue.get("S01").unwrap().next_attempt_at, 0);
        let finished = queue.jobs.iter().find(|j| j.status == Status::Completed).unwrap();
        assert_eq!(finished.file.as_deref(), Some("media/gone.png"), "a deleted picture is not generated again by itself");
    }
}
