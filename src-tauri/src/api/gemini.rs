//! Google Gemini API calls.

use serde_json::json;

use super::client::{http, read_json, secret_header, send};
use super::clean_model_name;
use super::error::ApiError;

const MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Checks a key by sending a tiny prompt to the chosen model.
///
/// The key travels in the `x-goog-api-key` header, never in the URL, so it cannot
/// end up in error messages or logs that contain the request address.
pub async fn test_key(key: &str, model: &str) -> Result<(), ApiError> {
    let model = clean_model_name(model, false).ok_or_else(|| {
        ApiError::BadResponse("That Gemini model name is not valid.".to_string())
    })?;
    let client = http()?;
    let auth = secret_header("", key)?;
    let url = format!("{MODELS_URL}/{model}:generateContent");
    let body = json!({ "contents": [{ "parts": [{ "text": "Reply with OK" }] }] });

    let response = send(|| {
        client
            .post(&url)
            .header("x-goog-api-key", auth.clone())
            .json(&body)
    })
    .await
    .map_err(|error| error.redact(key))?;

    // A 200 answer with readable JSON means the key and model were accepted.
    read_json(response)
        .await
        .map(|_| ())
        .map_err(|error| error.redact(key))
}

/// How long one text request may take (long batches of prompts need more than the default).
const GENERATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(150);

/// Reads the answer text out of a `generateContent` response.
pub fn parse_text(answer: &serde_json::Value) -> Result<String, ApiError> {
    if let Some(reason) = answer.pointer("/promptFeedback/blockReason").and_then(|r| r.as_str()) {
        return Err(ApiError::BadResponse(format!("Gemini refused the request ({reason}).")));
    }
    let candidate = answer.pointer("/candidates/0");
    let text: String = candidate
        .and_then(|c| c.pointer("/content/parts"))
        .and_then(|parts| parts.as_array())
        .map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(|t| t.as_str())).collect())
        .unwrap_or_default();
    if text.trim().is_empty() {
        let finish = candidate.and_then(|c| c.get("finishReason")).and_then(|f| f.as_str()).unwrap_or("none");
        return Err(ApiError::BadResponse(format!("Gemini sent an empty answer (finish reason: {finish}).")));
    }
    Ok(text)
}

/// Asks Gemini for text. With `json` set, the answer is requested as JSON.
pub async fn generate(key: &str, model: &str, system: Option<&str>, prompt: &str, json: bool) -> Result<String, ApiError> {
    let model = clean_model_name(model, false).ok_or_else(|| ApiError::BadResponse("That Gemini model name is not valid.".to_string()))?;
    generate_at(&format!("{MODELS_URL}/{model}:generateContent"), key, system, prompt, json).await
}

pub async fn generate_at(url: &str, key: &str, system: Option<&str>, prompt: &str, json: bool) -> Result<String, ApiError> {
    generate_parts_at(url, key, system, vec![json!({ "text": prompt })], json).await
}

/// Like `generate`, but the question can hold pictures: `parts` are Gemini "parts" (text or inlineData).
pub async fn generate_parts(key: &str, model: &str, system: Option<&str>, parts: Vec<serde_json::Value>, json: bool) -> Result<String, ApiError> {
    let model = clean_model_name(model, false).ok_or_else(|| ApiError::BadResponse("That Gemini model name is not valid.".to_string()))?;
    generate_parts_at(&format!("{MODELS_URL}/{model}:generateContent"), key, system, parts, json).await
}

/// A picture part for `generate_parts`.
pub fn image_part(mime: &str, bytes: &[u8]) -> serde_json::Value {
    json!({ "inlineData": { "mimeType": mime, "data": super::base64::encode(bytes) } })
}

pub async fn generate_parts_at(url: &str, key: &str, system: Option<&str>, parts: Vec<serde_json::Value>, json: bool) -> Result<String, ApiError> {
    let client = http()?;
    let auth = secret_header("", key)?;
    let mut body = json!({
        "contents": [{ "role": "user", "parts": parts }],
        "generationConfig": { "temperature": 0.4 },
    });
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    if json {
        body["generationConfig"]["responseMimeType"] = json!("application/json");
    }
    let response = send(|| client.post(url).timeout(GENERATE_TIMEOUT).header("x-goog-api-key", auth.clone()).json(&body))
        .await
        .map_err(|error| error.redact(key))?;
    let answer = read_json(response).await.map_err(|error| error.redact(key))?;
    parse_text(&answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn generate_sends_the_key_in_a_header_and_asks_for_json() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        std::env::set_var("NO_PROXY", "127.0.0.1");
        std::env::set_var("no_proxy", "127.0.0.1");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/m:generateContent", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                let n = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&received).into_owned();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text[..split].lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                    if received.len() >= split + 4 + length || n == 0 {
                        break;
                    }
                }
            }
            let body = r#"{"candidates":[{"content":{"parts":[{"text":"[]"}]}}]}"#;
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        let text = generate_at(&url, "AIza-secret", Some("be brief"), "hello", true).await.unwrap();
        assert_eq!(text, "[]");
        let request = server.await.unwrap().to_lowercase();
        assert!(request.contains("x-goog-api-key: aiza-secret"));
        assert!(!request.lines().next().unwrap().contains("aiza-secret"), "the key must not be in the URL");
        assert!(request.contains("application/json"));
        assert!(request.contains("systeminstruction"));
    }

    #[test]
    fn reads_text_from_all_parts() {
        let answer = json!({"candidates":[{"content":{"parts":[{"text":"[1,"},{"text":"2]"}]}}]});
        assert_eq!(parse_text(&answer).unwrap(), "[1,2]");
    }

    #[test]
    fn blocked_and_empty_answers_are_errors_with_a_reason() {
        let blocked = parse_text(&json!({"promptFeedback":{"blockReason":"SAFETY"}})).unwrap_err();
        assert!(blocked.details().contains("SAFETY"));
        let empty = parse_text(&json!({"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[]}}]})).unwrap_err();
        assert!(empty.details().contains("MAX_TOKENS"));
    }
}
