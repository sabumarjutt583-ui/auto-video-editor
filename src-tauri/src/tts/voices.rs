//! The ready-made voices of Gemini's speech models and the models themselves.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Voice {
    pub name: &'static str,
    /// Google's short word for how the voice sounds.
    pub feel: &'static str,
}

pub const VOICES: [Voice; 30] = [
    Voice { name: "Zephyr", feel: "Bright" },
    Voice { name: "Puck", feel: "Upbeat" },
    Voice { name: "Charon", feel: "Informative" },
    Voice { name: "Kore", feel: "Firm" },
    Voice { name: "Fenrir", feel: "Excitable" },
    Voice { name: "Leda", feel: "Youthful" },
    Voice { name: "Orus", feel: "Firm" },
    Voice { name: "Aoede", feel: "Breezy" },
    Voice { name: "Callirrhoe", feel: "Easy-going" },
    Voice { name: "Autonoe", feel: "Bright" },
    Voice { name: "Enceladus", feel: "Breathy" },
    Voice { name: "Iapetus", feel: "Clear" },
    Voice { name: "Umbriel", feel: "Easy-going" },
    Voice { name: "Algieba", feel: "Smooth" },
    Voice { name: "Despina", feel: "Smooth" },
    Voice { name: "Erinome", feel: "Clear" },
    Voice { name: "Algenib", feel: "Gravelly" },
    Voice { name: "Rasalgethi", feel: "Informative" },
    Voice { name: "Laomedeia", feel: "Upbeat" },
    Voice { name: "Achernar", feel: "Soft" },
    Voice { name: "Alnilam", feel: "Firm" },
    Voice { name: "Schedar", feel: "Even" },
    Voice { name: "Gacrux", feel: "Mature" },
    Voice { name: "Pulcherrima", feel: "Forward" },
    Voice { name: "Achird", feel: "Friendly" },
    Voice { name: "Zubenelgenubi", feel: "Casual" },
    Voice { name: "Vindemiatrix", feel: "Gentle" },
    Voice { name: "Sadachbia", feel: "Lively" },
    Voice { name: "Sadaltager", feel: "Knowledgeable" },
    Voice { name: "Sulafat", feel: "Warm" },
];

#[derive(Debug, Clone, Copy, Serialize)]
pub struct TtsModel {
    pub id: &'static str,
    pub label: &'static str,
    pub note: &'static str,
}

pub const MODELS: [TtsModel; 3] = [
    TtsModel { id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS (newest)", note: "Fast, most languages, has a free tier with low limits" },
    TtsModel { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS", note: "Fast and cheaper" },
    TtsModel { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS", note: "Slower, best quality of the 2.5 family" },
];

pub const DEFAULT_MODEL: &str = "gemini-3.1-flash-tts-preview";
pub const DEFAULT_VOICE: &str = "Kore";

pub fn is_voice(name: &str) -> bool {
    VOICES.iter().any(|v| v.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_exist() {
        assert!(is_voice(DEFAULT_VOICE));
        assert!(MODELS.iter().any(|m| m.id == DEFAULT_MODEL));
        assert!(!is_voice("Nobody"));
        let mut names: Vec<&str> = VOICES.iter().map(|v| v.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 30);
    }
}
