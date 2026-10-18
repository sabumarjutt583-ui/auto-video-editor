//! Groq API calls.

use reqwest::header::AUTHORIZATION;

use super::client::{http, read_json, secret_header, send};
use super::error::ApiError;

const MODELS_URL: &str = "https://api.groq.com/openai/v1/models";

/// Checks a key by asking Groq for its model list (free, and needs a valid key).
pub async fn test_key(key: &str) -> Result<(), ApiError> {
    let client = http()?;
    let auth = secret_header("Bearer ", key)?;

    let response = send(|| client.get(MODELS_URL).header(AUTHORIZATION, auth.clone()))
        .await
        .map_err(|error| error.redact(key))?;

    let body = read_json(response).await.map_err(|error| error.redact(key))?;
    if body.get("data").and_then(|data| data.as_array()).is_some() {
        Ok(())
    } else {
        Err(ApiError::BadResponse(
            "The model list was missing from the answer.".to_string(),
        ))
    }
}

const TRANSCRIBE_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

/// One spoken word as Whisper heard it.
#[derive(Debug, Clone, PartialEq)]
pub struct HeardWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// Builds a `multipart/form-data` body by hand (reqwest's multipart feature is not enabled).
pub fn multipart_body(boundary: &str, fields: &[(&str, String)], file_name: &str, file: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(file.len() + 1024);
    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(file);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Reads the word list out of Whisper's `verbose_json` answer.
pub fn parse_words(answer: &serde_json::Value) -> Result<Vec<HeardWord>, ApiError> {
    let Some(words) = answer.get("words").and_then(|w| w.as_array()) else {
        // A chunk without any speech may come back without a word list.
        return if answer.get("text").is_some() {
            Ok(Vec::new())
        } else {
            Err(ApiError::BadResponse("The answer had no words and no text.".to_string()))
        };
    };
    let mut heard = Vec::with_capacity(words.len());
    for word in words {
        let text = word.get("word").or_else(|| word.get("text")).and_then(|t| t.as_str()).unwrap_or("").trim();
        let (Some(start), Some(end)) = (word.get("start").and_then(|v| v.as_f64()), word.get("end").and_then(|v| v.as_f64())) else {
            continue;
        };
        if !text.is_empty() {
            heard.push(HeardWord { text: text.to_string(), start, end: end.max(start) });
        }
    }
    Ok(heard)
}

/// Sends one audio chunk to Groq Whisper and returns its words with times (seconds from the chunk start).
pub async fn transcribe(key: &str, model: &str, language: Option<&str>, file_name: &str, audio: Vec<u8>) -> Result<Vec<HeardWord>, ApiError> {
    transcribe_at(TRANSCRIBE_URL, key, model, language, file_name, audio).await
}

pub async fn transcribe_at(
    url: &str,
    key: &str,
    model: &str,
    language: Option<&str>,
    file_name: &str,
    audio: Vec<u8>,
) -> Result<Vec<HeardWord>, ApiError> {
    let model = super::clean_model_name(model, true)
        .ok_or_else(|| ApiError::BadResponse("That Groq Whisper model name is not valid.".to_string()))?;
    let client = http()?;
    let auth = secret_header("Bearer ", key)?;
    let boundary = format!("----ave{:x}", std::process::id() as u64 * 7919 + audio.len() as u64);
    let mut fields = vec![
        ("model", model),
        ("response_format", "verbose_json".to_string()),
        ("timestamp_granularities[]", "word".to_string()),
        ("temperature", "0".to_string()),
    ];
    if let Some(language) = language.filter(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphabetic() || c == '-')) {
        fields.push(("language", language.to_string()));
    }
    let body = multipart_body(&boundary, &fields, file_name, &audio);
    let content_type = format!("multipart/form-data; boundary={boundary}");

    let response = send(|| {
        client
            .post(url)
            .header(AUTHORIZATION, auth.clone())
            .header(reqwest::header::CONTENT_TYPE, content_type.clone())
            .body(body.clone())
    })
    .await
    .map_err(|error| error.redact(key))?;
    let answer = read_json(response).await.map_err(|error| error.redact(key))?;
    parse_words(&answer)
}

const CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

/// Reads the answer text out of a chat completion.
pub fn parse_chat(answer: &serde_json::Value) -> Result<String, ApiError> {
    let text = answer.pointer("/choices/0/message/content").and_then(|c| c.as_str()).unwrap_or("");
    if text.trim().is_empty() {
        return Err(ApiError::BadResponse("Groq sent an empty answer.".to_string()));
    }
    Ok(text.to_string())
}

/// Asks a Groq text model (used as a backup when Gemini fails).
pub async fn chat(key: &str, model: &str, system: Option<&str>, prompt: &str) -> Result<String, ApiError> {
    chat_at(CHAT_URL, key, model, system, prompt).await
}

pub async fn chat_at(url: &str, key: &str, model: &str, system: Option<&str>, prompt: &str) -> Result<String, ApiError> {
    let model = super::clean_model_name(model, true).ok_or_else(|| ApiError::BadResponse("That Groq text model name is not valid.".to_string()))?;
    let client = http()?;
    let auth = secret_header("Bearer ", key)?;
    let mut messages = Vec::new();
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        messages.push(serde_json::json!({ "role": "system", "content": system }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    let body = serde_json::json!({ "model": model, "messages": messages, "temperature": 0.4 });
    let response = send(|| client.post(url).timeout(std::time::Duration::from_secs(150)).header(AUTHORIZATION, auth.clone()).json(&body))
        .await
        .map_err(|error| error.redact(key))?;
    let answer = read_json(response).await.map_err(|error| error.redact(key))?;
    parse_chat(&answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chat_text_is_read_and_empty_is_an_error() {
        assert_eq!(parse_chat(&json!({"choices":[{"message":{"content":"hi"}}]})).unwrap(), "hi");
        assert!(parse_chat(&json!({"choices":[]})).is_err());
    }

    #[test]
    fn multipart_has_fields_file_and_closing_boundary() {
        let body = multipart_body("B", &[("model", "m".to_string())], "a.mp3", b"DATA");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"model\"\r\n\r\nm\r\n"));
        assert!(text.contains("filename=\"a.mp3\""));
        assert!(text.contains("DATA\r\n--B--\r\n"));
    }

    #[test]
    fn words_are_read_and_bad_entries_skipped() {
        let answer = json!({"text":"hi","words":[{"word":" hi ","start":0.1,"end":0.4},{"word":"","start":1,"end":2},{"word":"x"}]});
        let words = parse_words(&answer).unwrap();
        assert_eq!(words, vec![HeardWord { text: "hi".into(), start: 0.1, end: 0.4 }]);
    }

    #[test]
    fn silent_chunk_without_words_is_empty_not_an_error() {
        assert!(parse_words(&json!({"text":""})).unwrap().is_empty());
        assert!(parse_words(&json!({"oops":1})).is_err());
    }

    fn no_proxy() {
        std::env::set_var("NO_PROXY", "127.0.0.1");
        std::env::set_var("no_proxy", "127.0.0.1");
    }

    async fn serve_once(status: u16, body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        no_proxy();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let n = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&received).into_owned();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text[..split].lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                    if received.len() >= split + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let reply = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn transcribe_sends_key_and_options_and_reads_words() {
        let (url, server) = serve_once(200, r#"{"text":"a","words":[{"word":"a","start":0,"end":1}]}"#).await;
        let words = transcribe_at(&url, "gsk_secret", "whisper-large-v3-turbo", Some("ko"), "c.mp3", b"AUDIO".to_vec()).await.unwrap();
        assert_eq!(words.len(), 1);
        let request = server.await.unwrap();
        assert!(request.contains("authorization: Bearer gsk_secret") || request.contains("Authorization: Bearer gsk_secret"));
        assert!(request.contains("name=\"language\"\r\n\r\nko"));
        assert!(request.contains("timestamp_granularities[]"));
        assert!(request.contains("AUDIO"));
    }

    #[tokio::test]
    async fn a_401_is_an_invalid_key_error_without_the_key_in_details() {
        let (url, _server) = serve_once(401, r#"{"error":{"message":"Invalid API Key gsk_secret"}}"#).await;
        let error = transcribe_at(&url, "gsk_secret", "whisper-large-v3-turbo", None, "c.mp3", vec![1]).await.unwrap_err();
        assert!(matches!(error, ApiError::InvalidKey(_)));
        assert!(!error.details().contains("gsk_secret"));
    }

    #[tokio::test]
    async fn bad_model_names_and_unreachable_servers_are_reported() {
        no_proxy();
        let error = transcribe_at("http://127.0.0.1:9/", "k", "../x", None, "c.mp3", vec![1]).await.unwrap_err();
        assert!(matches!(error, ApiError::BadResponse(_)));
        let error = transcribe_at("http://127.0.0.1:9/", "k", "whisper", None, "c.mp3", vec![1]).await.unwrap_err();
        assert!(matches!(error, ApiError::Network(_)));
    }
}
