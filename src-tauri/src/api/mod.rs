//! Calls to outside services (Groq, Gemini). All of them run here in Rust, so API keys
//! never reach the frontend.

pub mod base64;
pub mod client;
pub mod edge_tts;
pub mod error;
pub mod gemini;
pub mod monitor;
pub mod gemini_tts;
pub mod groq;
pub mod openai;
pub mod rotate;

/// Checks and tidies a model name typed by the user. Returns `None` if it is not usable.
///
/// Names may contain letters, digits, `.`, `-`, `_` and, when `allow_slash` is set
/// (Groq uses names like `openai/gpt-oss-120b`), `/`. A leading `models/` is dropped
/// when slashes are not allowed, because Gemini's API adds that part itself.
pub fn clean_model_name(raw: &str, allow_slash: bool) -> Option<String> {
    let trimmed = raw.trim();
    let name = if allow_slash {
        trimmed
    } else {
        trimmed.strip_prefix("models/").unwrap_or(trimmed)
    };
    let allowed = |c: char| {
        c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') || (allow_slash && c == '/')
    };
    let starts_well = name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    if !starts_well || name.len() > 100 || !name.chars().all(allowed) {
        return None;
    }
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::clean_model_name;

    #[test]
    fn accepts_normal_model_names() {
        assert_eq!(clean_model_name("gemini-3.8-flash", false).as_deref(), Some("gemini-3.8-flash"));
        assert_eq!(clean_model_name("  whisper-large-v3-turbo ", false).as_deref(), Some("whisper-large-v3-turbo"));
        assert_eq!(clean_model_name("openai/gpt-oss-120b", true).as_deref(), Some("openai/gpt-oss-120b"));
    }

    #[test]
    fn drops_the_models_prefix_for_gemini() {
        assert_eq!(clean_model_name("models/gemini-3.8-flash", false).as_deref(), Some("gemini-3.8-flash"));
    }

    #[test]
    fn rejects_unsafe_or_empty_names() {
        assert_eq!(clean_model_name("", false), None);
        assert_eq!(clean_model_name("   ", false), None);
        assert_eq!(clean_model_name("../etc", false), None);
        assert_eq!(clean_model_name("gemini flash", false), None);
        assert_eq!(clean_model_name("gemini:generate?key=1", false), None);
        assert_eq!(clean_model_name("a/b", false), None);
        assert_eq!(clean_model_name("-flag", true), None);
        assert_eq!(clean_model_name(&"a".repeat(101), false), None);
    }
}
