//! Scene to job mapping, checked in Rust before anything is queued: the page sends one entry per
//! scene (its id, the timecode file name, the final prompt, the aspect ratio) and nothing else decides
//! where a picture goes. A file name that could leave the media folder is refused.

use super::queue::NewJob;
use crate::commands::error::AppError;

pub const ASPECTS: [&str; 3] = ["16:9", "1:1", "9:16"];
pub const MAX_PROMPT_CHARS: usize = 8000;
pub const MAX_SCENES: usize = 2000;

/// `S07`, `S12`, `S05b`.
pub fn valid_scene_id(id: &str) -> bool {
    let rest = id.strip_prefix('S').unwrap_or("");
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    let tail = &rest[digits..];
    digits >= 2 && digits <= 6 && (tail.is_empty() || (tail.len() == 1 && tail.chars().all(|c| c.is_ascii_lowercase())))
}

fn digits_dot_one(text: &str) -> bool {
    let Some((whole, tenth)) = text.split_once('.') else { return false };
    whole.len() >= 3 && whole.len() <= 7 && whole.chars().all(|c| c.is_ascii_digit()) && tenth.len() == 1 && tenth.chars().all(|c| c.is_ascii_digit())
}

/// `S07_032.4-038.9.png` for scene `S07`.
pub fn valid_file_name(scene_id: &str, name: &str) -> bool {
    let Some(rest) = name.strip_prefix(scene_id).and_then(|r| r.strip_prefix('_')) else { return false };
    let Some(times) = rest.strip_suffix(".png") else { return false };
    let Some((start, end)) = times.split_once('-') else { return false };
    digits_dot_one(start) && digits_dot_one(end)
}

fn bad(message: &str, details: String) -> AppError {
    AppError::new(message, details)
}

/// Checks every scene and returns them (prompts tidied). One bad scene refuses the whole list.
pub fn check_jobs(jobs: Vec<NewJob>) -> Result<Vec<NewJob>, AppError> {
    if jobs.is_empty() {
        return Err(bad("There are no scenes to make pictures for.", "empty list".into()));
    }
    if jobs.len() > MAX_SCENES {
        return Err(bad("There are too many scenes for one run.", format!("{} scenes", jobs.len())));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(jobs.len());
    for mut job in jobs {
        if !valid_scene_id(&job.scene_id) {
            return Err(bad("A scene has an id the app does not understand.", format!("scene id {:?}", job.scene_id)));
        }
        if !seen.insert(job.scene_id.clone()) {
            return Err(bad("The same scene appears twice.", format!("duplicate {}", job.scene_id)));
        }
        if !valid_file_name(&job.scene_id, &job.file_name) {
            return Err(bad("A scene has no valid time code for its picture name.", format!("{} -> {:?}", job.scene_id, job.file_name)));
        }
        job.prompt = job.prompt.trim().to_string();
        if job.prompt.is_empty() {
            return Err(bad(&format!("Scene {} has no prompt yet. Make the prompts first.", job.scene_id), "empty prompt".into()));
        }
        if job.prompt.chars().count() > MAX_PROMPT_CHARS {
            return Err(bad(&format!("The prompt of scene {} is too long.", job.scene_id), format!("{} characters", job.prompt.chars().count())));
        }
        if !ASPECTS.contains(&job.aspect.as_str()) {
            return Err(bad("The picture shape is not one of 16:9, 1:1 or 9:16.", format!("aspect {:?}", job.aspect)));
        }
        out.push(job);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, name: &str, prompt: &str, aspect: &str) -> NewJob {
        NewJob { scene_id: id.into(), file_name: name.into(), prompt: prompt.into(), aspect: aspect.into() }
    }

    #[test]
    fn scene_ids_and_timecode_names_are_checked() {
        for ok in ["S01", "S07", "S123", "S05b"] {
            assert!(valid_scene_id(ok), "{ok}");
        }
        for bad in ["S1", "s01", "S01bb", "S01B", "", "S", "S01/", "../S01", "S0a1"] {
            assert!(!valid_scene_id(bad), "{bad}");
        }
        assert!(valid_file_name("S07", "S07_032.4-038.9.png"));
        assert!(valid_file_name("S05b", "S05b_1000.0-1005.5.png"));
        for bad in ["S07_32.4-038.9.png", "S08_032.4-038.9.png", "S07_032.4-038.9.jpg", "S07_032.4-038.9.png/x", "S07_032:4-038.9.png", "../S07_032.4-038.9.png", "S07_032.44-038.9.png"] {
            assert!(!valid_file_name("S07", bad), "{bad}");
        }
    }

    #[test]
    fn a_good_list_passes_and_prompts_are_trimmed() {
        let list = check_jobs(vec![job("S01", "S01_000.0-005.1.png", "  a fox  ", "16:9"), job("S02", "S02_005.1-009.0.png", "a bear", "9:16")]).unwrap();
        assert_eq!(list[0].prompt, "a fox");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn one_bad_scene_refuses_the_whole_list() {
        assert!(check_jobs(vec![]).is_err());
        assert!(check_jobs(vec![job("S01", "S01_000.0-005.1.png", "  ", "16:9")]).is_err());
        assert!(check_jobs(vec![job("S01", "S01_000.0-005.1.png", "x", "4:3")]).is_err());
        assert!(check_jobs(vec![job("S01", "evil.png", "x", "16:9")]).is_err());
        assert!(check_jobs(vec![job("S01", "S01_000.0-005.1.png", "x", "16:9"), job("S01", "S01_000.0-005.1.png", "y", "16:9")]).is_err());
        assert!(check_jobs(vec![job("S01", "S01_000.0-005.1.png", &"x".repeat(MAX_PROMPT_CHARS + 1), "16:9")]).is_err());
    }
}
