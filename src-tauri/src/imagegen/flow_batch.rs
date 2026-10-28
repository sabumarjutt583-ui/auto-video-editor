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
//! Character-consistency warning (from the tool's own screenshots, not fixed
//! here): the Batch tool auto-detects character names from prompts and
//! auto-injects consistency, and a prompt with no character name defaults to
//! locking "Jin Kun" in every image/video. That name is the example project's
//! character, NOT a universal character, and it is never hardcoded here: the
//! defence is that every prompt sent to this engine already carries its
//! scene's character name (the assembled prompt does), and the docs warn that
//! a name-less prompt will get Jin Kun locked in by the Flow tool.
//!
//! The browser selectors for this custom tool are taken from the user's
//! screenshots only (button texts such as "Generate All as Images" and
//! "Batch Media Queue") and are UNVERIFIED against a live signed-in session.
//! They live in `FlowBatchConfig` in `config.rs` / `resources/image-engine/
//! config.json` so a page change can be fixed by a config update, not a new
//! app version. A page that needs a person (captcha, terms, sign-in) or a
//! credit/limit error is never worked around: it stops the batch with a
//! clear error.

use serde::{Deserialize, Serialize};

/// The ONLY Batch Flow Studio address this engine uses. Earlier Flow project
/// links from screenshots are superseded and must not be added back.
pub const SHARED_TOOL_URL: &str =
    "https://flow.google.com/shared/tool/74a00ce5-db5d-4ac4-8ae8-96e3e9b3b099";

/// Batch Size shown in the screenshots ("8 at a time (Default)").
pub const DEFAULT_BATCH_SIZE: u32 = 8;
/// Videos mode: Veo 3.1 Flash, Text to Video, 4s @ 720p, 7 credits per video.
pub const DEFAULT_VIDEO_CREDITS_PER_VIDEO: u32 = 7;
/// Credit guard, reusing the existing Flow idea (default 20): a video batch
/// whose per-video cost exceeds this is never started.
pub const DEFAULT_MAX_CREDITS_PER_VIDEO: u32 = 20;
pub const DEFAULT_VIDEO_SECONDS: u32 = 4;
pub const IMAGES_MODEL: &str = "Nano Banana 2.1";
pub const VIDEOS_MODEL: &str = "Veo 3.1 Flash";

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

/// Veo clips from this tool are 4 seconds long. A longer scene is NOT filled
/// automatically: the caller must make more than one clip or loop the clip.
/// This helper only states how many clips a scene needs, rounded up.
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
    fn defaults_match_the_screenshots() {
        assert_eq!(SHARED_TOOL_URL, "https://flow.google.com/shared/tool/74a00ce5-db5d-4ac4-8ae8-96e3e9b3b099");
        assert_eq!(DEFAULT_BATCH_SIZE, 8);
        assert_eq!(DEFAULT_VIDEO_CREDITS_PER_VIDEO, 7);
        assert_eq!(GenerationType::Images.model(), "Nano Banana 2.1");
        assert_eq!(GenerationType::Videos.model(), "Veo 3.1 Flash");
        assert_eq!(
            GenerationType::Videos.generate_button_text(),
            "Generate All as Videos"
        );
    }
}
