//! Batch Flow Studio: the user's own batch tool inside Google Flow, used as an
//! additional image/video engine alongside the Gemini Canvas tool.
//!
//! This is NOT the old per-account Flow path in `flow.rs` (one video at a time in
//! a Flow project) and it is NOT the Gemini Canvas tool. The Batch tool is opened
//! at one shared tool address, takes a whole batch of prompts at once, and names
//! its own downloads by scene number only (`S01.png`, `S01.mp4`).
//!
//! Two rules from the user, enforced here and nowhere else guessed:
//!
//! 1. Prompt format is paragraph-based, NOT `Prompt N:` lines and NOT one short
//!    line per prompt. Every prompt is ONE paragraph: no blank line inside a
//!    prompt, and exactly ONE blank line between prompts. A blank line inside a
//!    prompt would split it into several prompts and break the count and the
//!    order, so `format_prompts` collapses a prompt's internal newlines to
//!    spaces and refuses to send when the paragraph count differs from the
//!    scene count.
//! 2. Naming: the Auto Editor never assigns or changes scene numbers. Scene
//!    ids (`S01`, `S02`, ... `S100`, ... `S500`; at least two digits, so `S01`,
//!    never `S001`) stay exactly as they are in the project, from voice
//!    timing. A Flow download arrives as `S01.png` / `S01.mp4`; `rename_flow_file`
//!    parses that scene id, looks the scene up in the project record (the
//!    caller passes its start/end), and builds the timecode name
//!    (`S01_000.0-008.0.png` / `.mp4`). Saving itself still goes through the
//!    existing `save::save_new` / `queue::unique_target` path, so a different
//!    file that already has the wanted name becomes `(2)`, `(3)`, ... and an
//!    identical file is reported as already saved. Because the Flow name
//!    already carries the scene number, the rename is safe even if downloads
//!    arrive out of order; per-card downloads in card order are still the
//!    intended behaviour, and `Download All` must be used in batch order.
//!
//! Character-consistency warning (verified live in the 20-image test, not
//! fixed here): the Batch tool auto-detects character names from prompts
//! and auto-injects consistency, and a prompt with no character name
//! defaults to locking "Jin Kun" in every image/video. That name is the
//! example project's character, NOT a universal character, and it is never
//! hardcoded here. The live test also showed the tool detecting "Korean"
//! (from "Korean man/home/webtoon" wording) as a third identity token
//! alongside Kim and Jin Kun, so prompts that always say "Korean" will
//! always pull that token in unless the characters are configured in the
//! Flow tool itself. The defence here is that every prompt sent to this
//! engine already carries its scene's character name (the assembled prompt
//! does), and the docs warn about both the Jin Kun default and the
//! "Korean" token.
//!
//! The browser selectors for this custom tool were first taken from the
//! user's screenshots and then checked against a live signed-in session
//! (Batch Prompt Box, Generation Type, Batch Media Queue, Download
//! buttons). The run loop in `flow_batch_run.rs` is built on those live
//! observations, but the automated loop itself has NOT been live-run yet
//! (it needs the user's account and, for video, credits), so a page change
//! is still fixed by a config update in `FlowBatchConfig` /
//! `resources/image-engine/config.json`, not a new app version. A page
//! that needs a person (captcha, terms, sign-in) or a credit/limit error
//! is never worked around: it stops the batch with a clear error.

use serde::{Deserialize, Serialize};

/// The ONLY Batch Flow Studio address this engine uses. Earlier Flow project
/// links from screenshots are superseded and must not be added back.
pub const SHARED_TOOL_URL: &str =
    "https://flow.google.com/shared/tool/74a00ce5-db5d-4ac4-8ae8-96e3e9b3b099";

/// Batch Size shown live ("8 at a time (Default)"); the tool also offers
/// 6, 10, 12 and 20 ("Fast 500+").
pub const DEFAULT_BATCH_SIZE: u32 = 8;
/// Videos mode default, verified live on 2026-10-28: Omni 1.1 Flash,
/// Text to Video, 4s @ 720p, 7 credits per video. The earlier screenshot's
/// "Veo 3.1 Flash" is NOT a model the live tool offers and must not be
/// offered here.
pub const DEFAULT_VIDEO_CREDITS_PER_VIDEO: u32 = 7;
/// Credit guard, reusing the existing Flow idea (default 20): a video batch
/// whose per-video cost exceeds this is never started.
pub const DEFAULT_MAX_CREDITS_PER_VIDEO: u32 = 20;
pub const DEFAULT_VIDEO_SECONDS: u32 = 4;
pub const IMAGES_MODEL: &str = "Nano Banana 2.1";
pub const VIDEOS_MODEL: &str = "Omni 1.1 Flash";
pub const VEO_SERIES_MODEL: &str = "Veo 3.1 Series";

/// A video model choice in Batch Flow Studio, as verified live.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoModel {
    OmniFlash,
    VeoLite,
    VeoFast,
    VeoQuality,
}

impl VideoModel {
    pub fn display(self) -> &'static str {
        match self {
            VideoModel::OmniFlash => "Omni 1.1 Flash",
            VideoModel::VeoLite => "Veo 3.1 Series (Lite)",
            VideoModel::VeoFast => "Veo 3.1 Series (Fast)",
            VideoModel::VeoQuality => "Veo 3.1 Series (Quality)",
        }
    }

    pub fn from_display(value: &str) -> Option<Self> {
        match value {
            "Omni 1.1 Flash" => Some(VideoModel::OmniFlash),
            "Veo 3.1 Series (Lite)" | "Veo 3.1 Series Lite" => Some(VideoModel::VeoLite),
            "Veo 3.1 Series (Fast)" | "Veo 3.1 Series Fast" => Some(VideoModel::VeoFast),
            "Veo 3.1 Series (Quality)" | "Veo 3.1 Series Quality" => {
                Some(VideoModel::VeoQuality)
            }
            _ => None,
        }
    }
}

/// Live credit table (2026-10-28). Omni 1.1 Flash has a full
/// duration/resolution table; for Veo 3.1 Series only the 8s @ 720p rate
/// was verified, so any other Veo duration/resolution returns `None`
/// (unknown cost — never guessed) and the batch must be refused.
pub fn video_credits_per_video(
    model: VideoModel,
    seconds: u32,
    resolution: &str,
) -> Option<u32> {
    match model {
        VideoModel::OmniFlash => match (seconds, resolution) {
            (4, "360p") => Some(4),
            (4, "720p") => Some(7),
            (6, "360p") => Some(5),
            (6, "720p") => Some(10),
            (8, "360p") => Some(6),
            (8, "720p") => Some(12),
            (10, "360p") => Some(7),
            (10, "720p") => Some(15),
            _ => None,
        },
        VideoModel::VeoLite if seconds == 8 && resolution == "720p" => Some(10),
        VideoModel::VeoFast if seconds == 8 && resolution == "720p" => Some(20),
        VideoModel::VeoQuality if seconds == 8 && resolution == "720p" => Some(100),
        _ => None,
    }
}

/// Credit guard by model + duration: unknown cost, or cost over the cap,
/// refuses the batch. Returns the estimated total for display.
pub fn check_video_credits_for(
    model: VideoModel,
    seconds: u32,
    resolution: &str,
    videos: u32,
    max_credits_per_video: u32,
) -> Result<u32, String> {
    let Some(per_video) = video_credits_per_video(model, seconds, resolution) else {
        return Err(format!(
            "The credit cost for {} at {}s @ {} is not known, so the batch was not started.",
            model.display(),
            seconds,
            resolution
        ));
    };
    check_video_credits(videos, per_video, max_credits_per_video)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GenerationType {
    Images,
    Videos,
}

impl GenerationType {
    pub fn extension(self) -> &'static str {
        match self {
            GenerationType::Images => "png",
            GenerationType::Videos => "mp4",
        }
    }

    pub fn model(self) -> &'static str {
        match self {
            GenerationType::Images => IMAGES_MODEL,
            GenerationType::Videos => VIDEOS_MODEL,
        }
    }

    pub fn generate_button_text(self) -> &'static str {
        match self {
            GenerationType::Images => "Generate All as Images",
            GenerationType::Videos => "Generate All as Videos",
        }
    }
}

/// One paragraph of the Batch Prompt Box: the prompt collapsed to a single
/// paragraph (internal newlines become spaces, surrounding space trimmed).
pub fn one_paragraph(prompt: &str) -> String {
    prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Formats scene prompts for the Batch Prompt Box: one paragraph per prompt,
/// exactly one blank line between prompts. Returns an error (never a
/// half-formatted batch) when any prompt is empty after trimming, or when
/// the paragraph count would differ from the prompt count.
pub fn format_prompts(prompts: &[String]) -> Result<String, String> {
    if prompts.is_empty() {
        return Err("There are no prompts to send to Batch Flow Studio.".into());
    }
    let mut paragraphs = Vec::with_capacity(prompts.len());
    for (index, prompt) in prompts.iter().enumerate() {
        let paragraph = one_paragraph(prompt);
        if paragraph.is_empty() {
            return Err(format!(
                "Prompt {} is empty after trimming, so it was not sent.",
                index + 1
            ));
        }
        paragraphs.push(paragraph);
    }
    let text = paragraphs.join("\n\n");
    // Count check: splitting the formatted text on blank lines must give
    // back exactly one paragraph per prompt, or the tool would split a
    // prompt into several and break the order.
    let counted = text.split("\n\n").filter(|p| !p.trim().is_empty()).count();
    if counted != prompts.len() {
        return Err(format!(
            "The formatted batch has {counted} paragraphs for {} prompts, so it was not sent.",
            prompts.len()
        ));
    }
    Ok(text)
}

/// Parses a Flow download name such as `S01.png`, `S100.mp4` or
/// `S05b.png` into (scene id, extension). Returns `None` for anything else:
/// no scene prefix, a non-png/mp4 extension, or a path separator. Note that
/// `S001.png` parses to the id `S001` — it is NOT silently rewritten to
/// `S01`; `rename_flow_file` then fails the lookup against the project
/// record, because the project scene is `S01`, not `S001`.
pub fn parse_flow_filename(name: &str) -> Option<(String, String)> {
    if name.contains('/') || name.contains('\\') {
        return None;
    }
    let (stem, ext) = name.rsplit_once('.')?;
    if ext != "png" && ext != "mp4" {
        return None;
    }
    if !stem.starts_with('S') {
        return None;
    }
    let rest = &stem[1..];
    let digits = rest.chars().take_while(|c| c.is_ascii_digit()).count();
    if !(2..=6).contains(&digits) {
        return None;
    }
    let tail = &rest[digits..];
    if !tail.is_empty() && !(tail.len() == 1 && tail.chars().all(|c| c.is_ascii_lowercase())) {
        return None;
    }
    Some((stem.to_string(), ext.to_string()))
}

/// Seconds as `000.0`: one decimal, at least three digits before the dot.
/// Mirrors `src/lib/scenes/timecode.ts` `formatSeconds`.
pub fn format_seconds(seconds: f64) -> String {
    let safe = if seconds.is_finite() && seconds > 0.0 {
        seconds
    } else {
        0.0
    };
    format!("{safe:05.1}")
}

/// Builds the Auto Editor name for a Flow file: `S01_000.0-008.0.png`.
/// `scene_id` must match the id parsed from `flow_name` exactly, and
/// `start`/`end` come from the project scene record — never from the Flow
/// name, which carries no times. Returns `None` (fail the file, do not
/// guess a scene) when the names do not match or the extension is wrong.
pub fn rename_flow_file(
    flow_name: &str,
    scene_id: &str,
    start: f64,
    end: f64,
    generation: GenerationType,
) -> Option<String> {
    let (parsed_id, ext) = parse_flow_filename(flow_name)?;
    if parsed_id != scene_id {
        return None;
    }
    if ext != generation.extension() {
        return None;
    }
    Some(format!(
        "{}_{}-{:05.1}.{}",
        scene_id,
        format_seconds(start),
        end,
        ext
    ))
}

/// Credit guard for a video batch. `Err` when the per-video cost exceeds
/// the cap — such a batch is never started. The total is only an estimate
/// shown before generating: `videos * per_video_credits`.
pub fn check_video_credits(
    videos: u32,
    per_video_credits: u32,
    max_credits_per_video: u32,
) -> Result<u32, String> {
    if per_video_credits > max_credits_per_video {
        return Err(format!(
            "One video would cost {per_video_credits} credits, over the cap of {max_credits_per_video} credits, so the batch was not started."
        ));
    }
    Ok(videos.saturating_mul(per_video_credits))
}

/// Queue progress for the Batch Media Queue. `ready_ids` are the scene
/// ids whose card has a Download button, in card order. A failed scene
/// keeps its own number: it is listed in `failed_ids` and no other scene
/// is renumbered to fill its place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueProgress {
    pub total: usize,
    pub done: usize,
    pub remaining: usize,
    pub completed_percent: usize,
    pub ready_ids: Vec<String>,
    pub failed_ids: Vec<String>,
}

pub fn queue_progress(
    scene_ids: &[String],
    ready_ids: &[String],
    done: usize,
    total: usize,
    page_says_failed: bool,
) -> QueueProgress {
    let total = if total > 0 { total } else { scene_ids.len() };
    let done = done.min(total);
    let ready: Vec<String> = ready_ids
        .iter()
        .filter(|id| scene_ids.iter().any(|s| s == *id))
        .cloned()
        .collect();
    let failed = if page_says_failed {
        scene_ids
            .iter()
            .filter(|id| !ready.contains(id))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    QueueProgress {
        total,
        done,
        remaining: total - done,
        completed_percent: if total == 0 { 0 } else { done * 100 / total },
        ready_ids: ready,
        failed_ids: failed,
    }
}

/// Validates a Batch batch's jobs for the run loop. Unlike the image
/// engine's `check_jobs`, which only allows `.png` timecode names, this
/// allows the generation's own extension: `.png` for images, `.mp4` for
/// videos. Scene id, timecode shape, prompt and aspect are checked the
/// same way, and one bad entry refuses the whole list.
pub fn check_flow_batch_jobs(
    jobs: &[(String, String, String, String)],
    generation: GenerationType,
) -> Result<(), String> {
    if jobs.is_empty() {
        return Err("There is nothing to make in Batch Flow Studio.".into());
    }
    let mut seen: Vec<&str> = Vec::new();
    for (scene_id, file_name, prompt, aspect) in jobs {
        if seen.contains(&scene_id.as_str()) {
            return Err(format!("The same scene appears twice: {scene_id}."));
        }
        seen.push(scene_id.as_str());
        let Some(rest) = file_name
            .strip_prefix(scene_id.as_str())
            .and_then(|r| r.strip_prefix('_'))
        else {
            return Err(format!("The file name {file_name} does not start with its scene {scene_id}."));
        };
        let Some(times) = rest.strip_suffix(&format!(".{}", generation.extension())) else {
            return Err(format!(
                "The file name {file_name} does not end with .{} for this generation type.",
                generation.extension()
            ));
        };
        let Some((start, end)) = times.split_once('-') else {
            return Err(format!("The file name {file_name} has no start-end times."));
        };
        if !digits_dot_one(start) || !digits_dot_one(end) {
            return Err(format!("The times in {file_name} are not in the 000.0-000.0 shape."));
        }
        if prompt.trim().is_empty() {
            return Err(format!("The prompt for {scene_id} is empty."));
        }
        if !["16:9", "1:1", "9:16"].contains(&aspect.as_str()) {
            return Err(format!("The aspect {aspect} for {scene_id} is not 16:9, 1:1 or 9:16."));
        }
    }
    Ok(())
}

fn digits_dot_one(value: &str) -> bool {
    let Some((whole, frac)) = value.split_once('.') else {
        return false;
    };
    whole.len() >= 3
        && whole.chars().all(|c| c.is_ascii_digit())
        && frac.len() == 1
        && frac.chars().all(|c| c.is_ascii_digit())
}

/// Batch video clips last the chosen duration (4s-10s). A longer scene is
/// NOT filled automatically: the caller must make more than one clip or
/// loop the clip. This helper only states how many clips a scene needs,
/// rounded up.
pub fn clips_needed(scene_seconds: f64, clip_seconds: u32) -> u32 {
    if scene_seconds <= 0.0 || clip_seconds == 0 {
        return 0;
    }
    (scene_seconds / f64::from(clip_seconds)).ceil() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraphs_have_no_blank_line_inside_and_one_between() {
        let prompts = vec![
            "First line of scene one.\nSecond line of scene one.".to_string(),
            "Scene two, one paragraph.".to_string(),
        ];
        let text = format_prompts(&prompts).unwrap();
        assert_eq!(
            text,
            "First line of scene one. Second line of scene one.\n\nScene two, one paragraph."
        );
        assert_eq!(text.split("\n\n").count(), 2);
    }

    #[test]
    fn empty_prompts_and_empty_batches_are_refused() {
        assert!(format_prompts(&[]).is_err());
        assert!(format_prompts(&["  \n ".to_string()]).is_err());
    }

    #[test]
    fn flow_names_parse_and_s001_is_not_rewritten_to_s01() {
        assert_eq!(
            parse_flow_filename("S01.png"),
            Some(("S01".into(), "png".into()))
        );
        assert_eq!(
            parse_flow_filename("S100.mp4"),
            Some(("S100".into(), "mp4".into()))
        );
        assert_eq!(
            parse_flow_filename("S05b.png"),
            Some(("S05b".into(), "png".into()))
        );
        // S001 parses as its own id; the rename step must refuse it when
        // the project scene is S01 (see the next test).
        assert_eq!(
            parse_flow_filename("S001.png"),
            Some(("S001".into(), "png".into()))
        );
        assert!(parse_flow_filename("01.png").is_none());
        assert!(parse_flow_filename("S01.jpg").is_none());
        assert!(parse_flow_filename("S01.png/x").is_none());
        assert!(parse_flow_filename("S1.png").is_none());
    }

    #[test]
    fn rename_uses_the_scene_record_times_and_refuses_mismatches() {
        assert_eq!(
            rename_flow_file("S01.png", "S01", 0.0, 8.0, GenerationType::Images),
            Some("S01_000.0-008.0.png".into())
        );
        assert_eq!(
            rename_flow_file("S01.mp4", "S01", 0.0, 8.0, GenerationType::Videos),
            Some("S01_000.0-008.0.mp4".into())
        );
        assert_eq!(
            rename_flow_file("S500.png", "S500", 3992.0, 4000.0, GenerationType::Images),
            Some("S500_3992.0-4000.0.png".into())
        );
        // S001 must not silently become S01.
        assert!(rename_flow_file("S001.png", "S01", 0.0, 8.0, GenerationType::Images).is_none());
        // Wrong scene, wrong extension, and no times in the Flow name.
        assert!(rename_flow_file("S02.png", "S01", 0.0, 8.0, GenerationType::Images).is_none());
        assert!(rename_flow_file("S01.mp4", "S01", 0.0, 8.0, GenerationType::Images).is_none());
    }

    #[test]
    fn credit_guard_and_clip_count() {
        // The observed 7 credits per video passes the default cap of 20.
        assert_eq!(
            check_video_credits(10, 7, DEFAULT_MAX_CREDITS_PER_VIDEO),
            Ok(70)
        );
        assert!(check_video_credits(1, 21, DEFAULT_MAX_CREDITS_PER_VIDEO).is_err());
        assert_eq!(clips_needed(8.0, 4), 2);
        assert_eq!(clips_needed(16.5, 4), 5);
        assert_eq!(clips_needed(0.0, 4), 0);
    }

    #[test]
    fn defaults_match_the_live_tool() {
        assert_eq!(SHARED_TOOL_URL, "https://flow.google.com/shared/tool/74a00ce5-db5d-4ac4-8ae8-96e3e9b3b099");
        assert_eq!(DEFAULT_BATCH_SIZE, 8);
        assert_eq!(DEFAULT_VIDEO_CREDITS_PER_VIDEO, 7);
        assert_eq!(GenerationType::Images.model(), "Nano Banana 2.1");
        // Live default is Omni 1.1 Flash, not the earlier screenshot's Veo 3.1 Flash.
        assert_eq!(GenerationType::Videos.model(), "Omni 1.1 Flash");
        assert_eq!(
            GenerationType::Videos.generate_button_text(),
            "Generate All as Videos"
        );
    }

    #[test]
    fn live_credit_table_and_veo_quality_refusal() {
        assert_eq!(video_credits_per_video(VideoModel::OmniFlash, 4, "720p"), Some(7));
        assert_eq!(video_credits_per_video(VideoModel::OmniFlash, 4, "360p"), Some(4));
        assert_eq!(video_credits_per_video(VideoModel::OmniFlash, 6, "720p"), Some(10));
        assert_eq!(video_credits_per_video(VideoModel::OmniFlash, 8, "720p"), Some(12));
        assert_eq!(video_credits_per_video(VideoModel::OmniFlash, 10, "720p"), Some(15));
        assert_eq!(video_credits_per_video(VideoModel::VeoLite, 8, "720p"), Some(10));
        assert_eq!(video_credits_per_video(VideoModel::VeoFast, 8, "720p"), Some(20));
        assert_eq!(video_credits_per_video(VideoModel::VeoQuality, 8, "720p"), Some(100));
        assert_eq!(video_credits_per_video(VideoModel::VeoLite, 4, "720p"), None);
        assert_eq!(
            check_video_credits_for(VideoModel::OmniFlash, 4, "720p", 10, 20),
            Ok(70)
        );
        // Veo Quality (100) is refused by the default cap of 20.
        assert!(check_video_credits_for(VideoModel::VeoQuality, 8, "720p", 1, 20).is_err());
        assert!(check_video_credits_for(VideoModel::VeoLite, 4, "720p", 1, 20).is_err());
    }

    #[test]
    fn queue_progress_keeps_failed_scenes_on_their_numbers() {
        let scenes = vec!["S01".to_string(), "S02".to_string(), "S03".to_string()];
        let ready = vec!["S01".to_string(), "S03".to_string()];
        let progress = queue_progress(&scenes, &ready, 2, 3, true);
        assert_eq!(progress.remaining, 1);
        assert_eq!(progress.completed_percent, 66);
        assert_eq!(progress.failed_ids, vec!["S02".to_string()]);
        let clean = queue_progress(&scenes, &ready, 3, 3, false);
        assert!(clean.failed_ids.is_empty());
    }

    #[test]
    fn batch_jobs_allow_mp4_timecode_names_for_videos() {
        let jobs = vec![(
            "S01".to_string(),
            "S01_000.0-008.0.mp4".to_string(),
            "A scene.".to_string(),
            "16:9".to_string(),
        )];
        assert!(check_flow_batch_jobs(&jobs, GenerationType::Videos).is_ok());
        assert!(check_flow_batch_jobs(&jobs, GenerationType::Images).is_err());
        let bad = vec![(
            "S01".to_string(),
            "S01_000.0-008.0.png".to_string(),
            "".to_string(),
            "16:9".to_string(),
        )];
        assert!(check_flow_batch_jobs(&bad, GenerationType::Images).is_err());
    }
}
