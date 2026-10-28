//! Asking an AI to study reference pictures and write a style profile. This file holds the instructions and the
//! reading of the answer; the commands send the question to Gemini, ChatGPT's web chat or Gemini's web chat.
//! The OpenAI key option was removed (the person has no OpenAI key): `Openai` stays only so a
//! style saved earlier with that engine still loads; it is never offered as a choice and asking
//! with it returns a friendly error telling the person to pick ChatGPT web chat instead.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::commands::error::AppError;
use crate::styles::{self, StyleProfile};

/// What looks at the pictures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    /// Gemini through the person's Gemini API key.
    Gemini,
    /// Legacy only: an OpenAI vision model through the person's OpenAI key. Not offered any more.
    Openai,
    /// Gemini's web chat through the Google accounts.
    Chat,
    /// ChatGPT's web chat through the ChatGPT accounts. No API key needed.
    Chatgpt,
}

/// The fields the AI writes (the app adds id, name, category and version).
pub const FIELDS: [&str; 13] = [
    "core_identity", "medium", "lighting", "color_palette", "camera", "composition", "texture", "characters", "mood", "negative", "motion_rules", "style_lock", "example_prompt",
];

/// The standing instructions (they follow docs/STYLE_GUIDE.md).
pub const SYSTEM: &str = "You are a visual style analyst for a tool that writes image and video prompts. \
You are shown several (3 or more) reference pictures that share ONE look. Write a style profile that describes ONLY the visual look the pictures have in common: \
the medium, the light, the colors, the camera, the composition, the textures, how people are drawn and the mood. \
Do NOT describe the subjects, objects, places, people or story of the pictures. Never use brand, studio, artist, film, game or character names, and no names of real people. \
Write in English, in plain concrete words a picture generator understands. No vague praise (\"beautiful\", \"stunning\").\n\n\
Answer with ONLY one JSON object, no markdown, no comments, with exactly these keys, all strings:\n\
- core_identity: 2-3 sentences. What this look is and what makes it recognizable.\n\
- medium: one line. What the pictures look like they were made with.\n\
- lighting: 2-4 concrete sentences. Light sources, direction, contrast, time of day.\n\
- color_palette: 2-4 concrete sentences. The dominant colors, how saturated and warm or cool they are.\n\
- camera: 2-4 concrete sentences. Lens feel, angles, depth of field.\n\
- composition: 2-4 concrete sentences. Framing, balance, use of space.\n\
- texture: 2-4 concrete sentences. Surface detail, grain, brush marks, edges.\n\
- characters: 2-4 concrete sentences on how people and faces are rendered in this look (proportions, level of detail, skin, eyes). If the pictures show no people, say how people would be drawn to match.\n\
- mood: 4 to 6 single words or short phrases, separated by commas.\n\
- negative: 12 to 25 things that must NOT appear in this look, separated by commas. Nothing from style_lock.\n\
- motion_rules: 2-4 sentences. How the camera and subjects may move when the picture becomes a short video, in keeping with the look.\n\
- style_lock: 12 to 25 short phrases or words, separated by commas, that a generator can append to ANY prompt to get this look. No aspect ratio like 16:9. Nothing that is also in negative.\n\
- example_prompt: 60 to 100 words describing an elderly man sitting alone at a kitchen table at night, holding a cup of tea, an empty chair opposite him, written in this look. \
It MUST end with the exact text of style_lock, character for character.\n\n\
Do not add id, name, category or version.";

/// The question about the pictures (the pictures themselves are attached separately).
/// `problems` and `previous` are set when asking again after an answer that broke the rules.
pub fn build_question(name: &str, description: &str, image_count: usize, problems: &[String], previous: Option<&str>) -> String {
    let mut out = format!("Study the {image_count} attached reference pictures and write the style profile.\n");
    if !name.trim().is_empty() {
        out.push_str(&format!("The style will be called: {}\n", name.trim()));
    }
    if !description.trim().is_empty() {
        out.push_str(&format!("The person says about the look: {}\n", description.trim()));
    }
    if !problems.is_empty() {
        out.push_str("\nYour earlier answer broke these rules. Fix every one and return the COMPLETE corrected JSON object:\n");
        for problem in problems {
            out.push_str(&format!("- {problem}\n"));
        }
        if let Some(previous) = previous.filter(|p| !p.trim().is_empty()) {
            out.push_str("\nYour earlier answer:\n");
            out.push_str(previous.trim());
            out.push('\n');
        }
    }
    out
}

/// The JSON object inside an answer (the answer may wrap it in a code fence or add a sentence around it).
pub fn json_text(answer: &str) -> Option<String> {
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    (end > start).then(|| answer[start..=end].to_string())
}

/// Reads the AI answer into a draft profile: id, category and thumbnail empty, version 1.0.0, never built in.
/// A field written as a list is joined with commas.
pub fn parse_answer(answer: &str, name: &str) -> Result<(StyleProfile, String), AppError> {
    let unusable = |details: String| AppError::new("The AI did not answer with a style profile. Please press Analyze again.", details);
    let json = json_text(answer).ok_or_else(|| unusable(format!("no JSON object in the answer: {}", answer.chars().take(200).collect::<String>())))?;
    let value: Value = serde_json::from_str(&json).map_err(|e| unusable(format!("not valid JSON ({e})")))?;
    let Value::Object(source) = value else { return Err(unusable("the answer is not a JSON object".to_string())) };
    if !FIELDS.iter().any(|key| source.get(*key).is_some()) {
        return Err(unusable("the JSON has none of the style fields".to_string()));
    }
    // parse_style joins lists and trims text and wants an id, a name and a category; they are replaced afterwards.
    let mut map = Map::new();
    for key in FIELDS {
        if let Some(v) = source.get(key) {
            map.insert(key.to_string(), v.clone());
        }
    }
    map.insert("id".into(), Value::String("draft".into()));
    map.insert("name".into(), Value::String("draft".into()));
    map.insert("category".into(), Value::String("draft".into()));
    let mut style = styles::parse_style(&Value::Object(map).to_string()).map_err(unusable)?;
    style.id = String::new();
    style.name = name.trim().to_string();
    style.category = String::new();
    style.version = "1.0.0".into();
    style.thumbnail = String::new();
    style.builtin = false;
    Ok((style, json))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"Here you go:
```json
{"core_identity":"Soft light.","medium":"Digital painting","lighting":"Window light.","color_palette":["warm","muted"],"camera":"c","composition":"c","texture":"t","characters":"ch","mood":"calm, warm","negative":"a, b","motion_rules":"slow","style_lock":"soft, warm","example_prompt":"An old man. soft, warm","id":"hacked","name":"Evil","version":"9"}
```"#;

    #[test]
    fn the_instructions_name_every_field_and_the_rules() {
        for key in FIELDS {
            assert!(SYSTEM.contains(&format!("- {key}:")), "{key} is not explained");
        }
        for rule in ["ONLY the visual look", "Never use brand", "ONLY one JSON object", "character for character", "12 to 25", "4 to 6"] {
            assert!(SYSTEM.contains(rule), "{rule}");
        }
    }

    #[test]
    fn the_question_carries_name_description_and_on_a_retry_the_problems() {
        let first = build_question(" Soft Film ", " warm and calm ", 3, &[], None);
        assert!(first.contains("3 attached") && first.contains("called: Soft Film") && first.contains("warm and calm"));
        assert!(!first.contains("broke these rules"));
        let again = build_question("", "", 4, &["style_lock has 5 items (need 12-25)".into()], Some("{\"a\":1}"));
        assert!(again.contains("- style_lock has 5 items") && again.contains("Your earlier answer:\n{\"a\":1}"));
        assert!(!again.contains("called:"));
    }

    #[test]
    fn the_json_is_found_inside_text_and_code_fences() {
        assert_eq!(json_text("x {\"a\": {\"b\": 1}} y").as_deref(), Some("{\"a\": {\"b\": 1}}"));
        assert_eq!(json_text("nothing"), None);
        assert_eq!(json_text("} {"), None);
    }

    #[test]
    fn an_answer_becomes_a_draft_the_app_controls() {
        let (style, json) = parse_answer(GOOD, "  My Look ").unwrap();
        assert_eq!(style.name, "My Look");
        assert_eq!((style.id.as_str(), style.category.as_str(), style.version.as_str()), ("", "", "1.0.0"), "the AI cannot choose these");
        assert_eq!(style.color_palette, "warm, muted", "a list is joined");
        assert_eq!(style.style_lock, "soft, warm");
        assert!(!style.builtin && style.thumbnail.is_empty());
        assert!(json.starts_with('{') && json.ends_with('}'));
    }

    #[test]
    fn answers_that_are_not_profiles_are_friendly_errors() {
        for bad in ["I cannot help", "{oops", "[1,2]", "{\"hello\":1}", ""] {
            let error = parse_answer(bad, "x").unwrap_err();
            assert!(error.message.contains("did not answer with a style profile"), "{bad}");
        }
    }

    #[test]
    fn engines_use_lowercase_names_on_the_wire() {
        assert_eq!(serde_json::from_str::<Engine>("\"openai\"").unwrap(), Engine::Openai, "an old saved style still loads");
        assert_eq!(serde_json::from_str::<Engine>("\"chat\"").unwrap(), Engine::Chat);
        assert_eq!(serde_json::from_str::<Engine>("\"chatgpt\"").unwrap(), Engine::Chatgpt, "the new web-chat choice");
        assert!(serde_json::from_str::<Engine>("\"claude\"").is_err());
    }
}
