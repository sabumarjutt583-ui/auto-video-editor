//! Asking Gemini which picture belongs to which scene (the prompt text and the answer check).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct MatchScene {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub scene_id: String,
    pub file: String,
    /// 0 to 1.
    pub confidence: f64,
}

pub const SYSTEM: &str = "You match AI-generated pictures and video clips to the scenes of a narrated video. \
Each scene has an id and the narration spoken during it. Look at each file (a picture, or three frames of a clip) \
and choose the scene whose narration it illustrates best. Use every scene at most once and every file at most once. \
If a file fits no scene, leave it out. Answer ONLY with a JSON list: [{\"scene_id\":\"S01\",\"file\":\"exact file name\",\"confidence\":0.0 to 1.0}].";

/// The scene list the files are matched against (long narration is shortened).
pub fn scene_list(scenes: &[MatchScene]) -> String {
    let mut text = String::from("Scenes:\n");
    for scene in scenes {
        let narration: String = scene.text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(180).collect();
        text.push_str(&format!("{}: {}\n", scene.id, narration));
    }
    text.push_str("\nFiles follow. Each one starts with its exact name.");
    text
}

fn strip_fences(answer: &str) -> &str {
    let trimmed = answer.trim();
    let without = trimmed.strip_prefix("```json").or_else(|| trimmed.strip_prefix("```")).unwrap_or(trimmed);
    without.strip_suffix("```").unwrap_or(without).trim()
}

/// Checks Gemini's answer: only known files and scenes, each used once, confidence between 0 and 1.
pub fn parse_matches(answer: &str, files: &[String], scene_ids: &[String]) -> Result<Vec<FileMatch>, String> {
    let value: Value = serde_json::from_str(strip_fences(answer)).map_err(|e| format!("The answer was not JSON: {e}"))?;
    let list = match &value {
        Value::Array(items) => items.clone(),
        Value::Object(map) => map.values().find_map(|v| v.as_array().cloned()).ok_or("The answer had no list in it.")?,
        _ => return Err("The answer was not a list.".to_string()),
    };
    let mut matches: Vec<FileMatch> = Vec::new();
    for item in list {
        let scene_id = item.get("scene_id").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let file = item.get("file").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !scene_ids.contains(&scene_id) || !files.contains(&file) {
            continue;
        }
        if matches.iter().any(|m| m.file == file || m.scene_id == scene_id) {
            continue;
        }
        let confidence = item.get("confidence").and_then(Value::as_f64).unwrap_or(0.5).clamp(0.0, 1.0);
        matches.push(FileMatch { scene_id, file, confidence });
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn keeps_only_known_unique_matches() {
        let answer = r#"```json
[{"scene_id":"S01","file":"a.png","confidence":0.9},
 {"scene_id":"S01","file":"b.png","confidence":0.4},
 {"scene_id":"S99","file":"b.png","confidence":0.4},
 {"scene_id":"S02","file":"zzz.png","confidence":0.4},
 {"scene_id":"S02","file":"b.png","confidence":7}]
```"#;
        let found = parse_matches(answer, &names(&["a.png", "b.png"]), &names(&["S01", "S02"])).unwrap();
        assert_eq!(found, vec![
            FileMatch { scene_id: "S01".into(), file: "a.png".into(), confidence: 0.9 },
            FileMatch { scene_id: "S02".into(), file: "b.png".into(), confidence: 1.0 },
        ]);
    }

    #[test]
    fn accepts_a_wrapped_list_and_rejects_nonsense() {
        let wrapped = r#"{"matches":[{"scene_id":"S01","file":"a.png"}]}"#;
        assert_eq!(parse_matches(wrapped, &names(&["a.png"]), &names(&["S01"])).unwrap().len(), 1);
        assert!(parse_matches("hello", &names(&["a.png"]), &names(&["S01"])).is_err());
    }

    #[test]
    fn the_scene_list_is_short_and_tidy() {
        let scenes = vec![MatchScene { id: "S01".into(), text: "Once   upon\na time".into() }];
        assert!(scene_list(&scenes).contains("S01: Once upon a time"));
    }
}
