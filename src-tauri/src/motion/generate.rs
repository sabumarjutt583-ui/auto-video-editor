//! Asks the AI for a motion graphic, checks it in the offline browser, and sends problems back (up to
//! three tries). The finished graphic is a folder in the project: `motion/<id>/motion.html` and `frames/`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::capture::{draw, frame_count, CaptureError, CaptureSpec};
use super::contract::{build_prompt, clamp_seconds, extract_html, wrap_html, Brief};
use crate::commands::error::AppError;
use crate::imagegen::chat::ChatReply;
use crate::imagegen::engine::BoxFuture;
use crate::jobs::Job;

pub const TRIES: u32 = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionRequest {
    /// Letters, digits, `-` and `_`: the folder name inside the project.
    pub id: String,
    pub narration: String,
    #[serde(default)]
    pub language: String,
    pub seconds: f64,
    #[serde(default)]
    pub look: String,
    #[serde(default)]
    pub idea: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionResult {
    pub id: String,
    /// Inside the project: `motion/<id>/frames` (files `00000.png ...`).
    pub frames_dir: String,
    /// Inside the project: `motion/<id>/motion.html` (the graphic itself, for preview).
    pub html_path: String,
    pub frames: u32,
    pub fps: u32,
    pub seconds: f64,
    pub width: u32,
    pub height: u32,
    /// How many times the AI was asked.
    pub tries: u32,
}

impl MotionRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        let bad = |message: &str, details: String| Err(AppError::new(message, details));
        if self.id.is_empty() || self.id.len() > 48 || !self.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return bad("The motion graphic has a wrong name.", format!("id = {:?}", self.id));
        }
        if self.narration.trim().is_empty() && self.idea.trim().is_empty() {
            return bad("Write what the graphic is about, or pick a scene that has narration.", "narration and idea are both empty".into());
        }
        let size_ok = |v: u32| (64..=4096).contains(&v) && v % 2 == 0;
        if !size_ok(self.width) || !size_ok(self.height) || !(12..=60).contains(&self.fps) {
            return bad("The motion graphic size is not valid.", format!("{}x{} at {} fps", self.width, self.height, self.fps));
        }
        Ok(())
    }

    fn brief(&self) -> Brief {
        Brief { narration: self.narration.clone(), language: self.language.clone(), seconds: clamp_seconds(self.seconds), width: self.width, height: self.height, look: self.look.clone(), idea: self.idea.clone() }
    }
}

pub type Ask<'a> = &'a (dyn Fn(String) -> BoxFuture<Result<ChatReply, AppError>> + Sync);

/// Makes the graphic. `ask` sends one prompt to the chat engine and returns its answer.
pub async fn generate(request: &MotionRequest, project_dir: &Path, exe: PathBuf, extra_args: Vec<String>, ask: Ask<'_>, job: &Job) -> Result<MotionResult, AppError> {
    request.validate()?;
    let brief = request.brief();
    let seconds = brief.seconds;
    let out = project_dir.join("motion").join(&request.id);
    std::fs::create_dir_all(&out).map_err(|e| AppError::new("The motion graphic folder could not be made.", format!("{e} ({})", out.display())))?;
    let mut problem: Option<String> = None;
    for attempt in 1..=TRIES {
        job.check()?;
        job.set_range(0.0, 30.0 + 5.0 * f64::from(attempt));
        job.progress(&format!("Asking Gemini (try {attempt} of {TRIES})"), 10.0);
        let reply = ask(build_prompt(&brief, problem.as_deref())).await?;
        let Some(html) = extract_html(&reply) else {
            problem = Some("Your answer did not contain an HTML file. Send the complete file in one ```html code block.".into());
            continue;
        };
        let wrapped = wrap_html(&html, request.width, request.height);
        job.progress("Checking the graphic", 60.0);
        let spec = CaptureSpec { exe: exe.clone(), extra_args: extra_args.clone(), html: wrapped.clone(), width: request.width, height: request.height, fps: request.fps, seconds, out_dir: Some(out.clone()) };
        job.set_range(40.0, 100.0);
        let progress = |done: u32, total: u32| job.progress("Drawing the frames", f64::from(done) * 100.0 / f64::from(total.max(1)));
        match draw(&spec, Some(job), &progress).await {
            Ok(frames) => {
                let html_file = out.join("motion.html");
                std::fs::write(&html_file, &wrapped).map_err(|e| AppError::new("The graphic could not be saved.", format!("{e} ({})", html_file.display())))?;
                job.progress("Done", 100.0);
                return Ok(MotionResult {
                    id: request.id.clone(),
                    frames_dir: format!("motion/{}/frames", request.id),
                    html_path: format!("motion/{}/motion.html", request.id),
                    frames,
                    fps: request.fps,
                    seconds,
                    width: request.width,
                    height: request.height,
                    tries: attempt,
                });
            }
            Err(CaptureError::Problem(text)) => problem = Some(text),
            Err(CaptureError::Failed(error)) => return Err(error),
        }
    }
    let last = problem.unwrap_or_default();
    Err(AppError::new("Gemini could not make a working motion graphic after three tries. Try again, or describe the graphic you want.", format!("Last problem: {last} (frames expected: {})", frame_count(seconds, request.fps))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imagegen::testserver::{temp_dir, test_args, test_browser};
    use crate::jobs::{test_job, JobRegistry};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    fn request() -> MotionRequest {
        MotionRequest { id: "m1".into(), narration: "The bank lost half its value".into(), language: "English".into(), seconds: 1.0, look: String::new(), idea: String::new(), width: 320, height: 180, fps: 12 }
    }

    fn reply(html: &str) -> ChatReply {
        ChatReply { text: "ok".into(), code: vec![html.to_string()] }
    }

    const GOOD: &str = "<html><body><div style=\"position:absolute;left:10px;top:10px;width:60px;height:30px;background:#e94560;animation:g 1s both\"></div><style>@keyframes g{from{transform:translateX(0)}to{transform:translateX(120px)}}</style></body></html>";
    const BLANK: &str = "<html><body><style>@keyframes a{to{opacity:0}}</style><div style=\"animation:a 1s both\"></div></body></html>";

    #[test]
    fn requests_are_checked_before_any_work() {
        assert!(request().validate().is_ok());
        let mut r = request();
        r.id = "../x".into();
        assert!(r.validate().is_err());
        let mut r = request();
        (r.narration, r.idea) = (" ".into(), String::new());
        assert!(r.validate().is_err());
        let mut r = request();
        r.width = 321;
        assert!(r.validate().is_err());
    }

    #[tokio::test]
    async fn a_rejected_graphic_is_sent_back_and_the_second_answer_is_used() {
        let Some(exe) = test_browser() else { return };
        let dir = temp_dir("gen-retry");
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "g1");
        let calls = Arc::new(AtomicU32::new(0));
        let seen_prompts = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let (counter, prompts) = (calls.clone(), seen_prompts.clone());
        let ask = move |prompt: String| -> BoxFuture<Result<ChatReply, AppError>> {
            let n = counter.fetch_add(1, Ordering::SeqCst);
            prompts.lock().unwrap().push(prompt);
            Box::pin(async move { Ok(reply(if n == 0 { BLANK } else { GOOD })) })
        };
        let result = generate(&request(), &dir, exe, test_args(), &ask, &job).await.expect("works on the second try");
        assert_eq!((result.tries, result.frames, calls.load(Ordering::SeqCst)), (2, 12, 2));
        let prompts = seen_prompts.lock().unwrap();
        assert!(!prompts[0].contains("REJECTED") && prompts[1].contains("REJECTED") && prompts[1].contains("nothing"), "the problem is told to the AI");
        assert!(dir.join("motion/m1/frames/00011.png").is_file() && dir.join("motion/m1/motion.html").is_file());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn three_failures_give_a_friendly_error_with_the_last_problem() {
        let Some(exe) = test_browser() else { return };
        let dir = temp_dir("gen-fail");
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "g2");
        let ask = |_: String| -> BoxFuture<Result<ChatReply, AppError>> { Box::pin(async { Ok(ChatReply { text: "I cannot".into(), code: vec![] }) }) };
        let error = generate(&request(), &dir, exe, test_args(), &ask, &job).await.expect_err("no html ever");
        assert!(error.message.contains("three tries") && error.details.contains("did not contain an HTML file"), "{error:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn an_error_of_the_chat_engine_stops_at_once() {
        let Some(exe) = test_browser() else { return };
        let dir = temp_dir("gen-chat-error");
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "g3");
        let ask = |_: String| -> BoxFuture<Result<ChatReply, AppError>> { Box::pin(async { Err(AppError::new("No Google account is ready.", "x")) }) };
        let error = generate(&request(), &dir, exe, test_args(), &ask, &job).await.expect_err("chat error");
        assert_eq!(error.message, "No Google account is ready.");
        let _ = std::fs::remove_dir_all(dir);
    }
}
