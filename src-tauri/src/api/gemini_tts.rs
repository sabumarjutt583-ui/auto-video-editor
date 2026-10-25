//! Gemini speech models: text in, spoken audio out (the same API key as the text models).

use serde_json::{json, Value};

use super::client::{http, read_json, secret_header, send};
use super::clean_model_name;
use super::error::ApiError;

const MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
/// Reading one piece of 1,200 letters takes the model up to a minute or two.
const SPEAK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(240);

/// Spoken audio as the model sends it: raw 16-bit mono samples and their rate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spoken {
    pub pcm: Vec<u8>,
    pub rate: u32,
}

/// The request body for one piece of text and one ready-made voice.
pub fn request_body(text: &str, voice: &str) -> Value {
    json!({
        "contents": [{ "parts": [{ "text": text }] }],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } } },
        },
    })
}

/// Reads the audio out of the answer. A model that answers with words instead of sound is a bad answer (it can be asked again).
pub fn parse_audio(answer: &Value) -> Result<Spoken, ApiError> {
    if let Some(reason) = answer.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(ApiError::BadResponse(format!("Gemini refused the text ({reason}).")));
    }
    let part = answer.pointer("/candidates/0/content/parts").and_then(Value::as_array).and_then(|parts| parts.iter().find(|p| p.pointer("/inlineData/data").is_some()));
    let Some(part) = part else {
        let finish = answer.pointer("/candidates/0/finishReason").and_then(Value::as_str).unwrap_or("none");
        return Err(ApiError::BadResponse(format!("Gemini sent no audio (finish reason: {finish}).")));
    };
    let data = part.pointer("/inlineData/data").and_then(Value::as_str).unwrap_or_default();
    let mime = part.pointer("/inlineData/mimeType").and_then(Value::as_str).unwrap_or_default();
    let pcm = super::base64::decode(data).filter(|bytes| bytes.len() >= 2).ok_or_else(|| ApiError::BadResponse("The audio from Gemini could not be read.".to_string()))?;
    Ok(Spoken { pcm, rate: crate::tts::wav::rate_from_mime(mime) })
}

/// Speaks `text` with a ready-made voice.
pub async fn speak(key: &str, model: &str, voice: &str, text: &str) -> Result<Spoken, ApiError> {
    let model = clean_model_name(model, false).ok_or_else(|| ApiError::BadResponse("That Gemini voice model name is not valid.".to_string()))?;
    let client = http()?;
    let auth = secret_header("", key)?;
    let url = format!("{MODELS_URL}/{model}:generateContent");
    let body = request_body(text, voice);
    let response = send(|| client.post(&url).timeout(SPEAK_TIMEOUT).header("x-goog-api-key", auth.clone()).json(&body)).await.map_err(|error| error.redact(key))?;
    let answer = read_json(response).await.map_err(|error| error.redact(key))?;
    parse_audio(&answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_asks_for_audio_with_the_voice() {
        let body = request_body("Hello", "Kore");
        assert_eq!(body.pointer("/generationConfig/responseModalities/0").and_then(Value::as_str), Some("AUDIO"));
        assert_eq!(body.pointer("/generationConfig/speechConfig/voiceConfig/prebuiltVoiceConfig/voiceName").and_then(Value::as_str), Some("Kore"));
        assert_eq!(body.pointer("/contents/0/parts/0/text").and_then(Value::as_str), Some("Hello"));
    }

    #[test]
    fn audio_is_read_from_the_answer() {
        let data = super::super::base64::encode(&[1, 0, 2, 0, 3, 0]);
        let answer = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "mimeType": "audio/L16;codec=pcm;rate=24000", "data": data } }] } }] });
        let spoken = parse_audio(&answer).unwrap();
        assert_eq!((spoken.pcm.len(), spoken.rate), (6, 24_000));
    }

    #[test]
    fn words_instead_of_sound_or_a_refusal_are_errors() {
        let words = json!({ "candidates": [{ "content": { "parts": [{ "text": "I cannot do that" }] }, "finishReason": "OTHER" }] });
        let error = parse_audio(&words).unwrap_err();
        assert!(error.details().contains("no audio") && error.details().contains("OTHER"));
        let blocked = json!({ "promptFeedback": { "blockReason": "SAFETY" } });
        assert!(parse_audio(&blocked).unwrap_err().details().contains("SAFETY"));
        let broken = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "mimeType": "audio/L16", "data": "!!" } }] } }] });
        assert!(parse_audio(&broken).is_err());
    }
}
