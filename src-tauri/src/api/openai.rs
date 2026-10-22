//! OpenAI API calls (used for looking at pictures when the person has an OpenAI key).

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};

use super::base64;
use super::client::{http, read_json, secret_header, send};
use super::error::ApiError;

const MODELS_URL: &str = "https://api.openai.com/v1/models";
const CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
const GENERATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(150);

/// Checks a key by asking OpenAI for its model list (free, and needs a valid key).
pub async fn test_key(key: &str) -> Result<(), ApiError> {
    let client = http()?;
    let auth = secret_header("Bearer ", key)?;
    let response = send(|| client.get(MODELS_URL).header(AUTHORIZATION, auth.clone())).await.map_err(|error| error.redact(key))?;
    let body = read_json(response).await.map_err(|error| error.redact(key))?;
    if body.get("data").and_then(Value::as_array).is_some() {
        Ok(())
    } else {
        Err(ApiError::BadResponse("The model list was missing from the answer.".to_string()))
    }
}

/// The message content for a question with pictures: one text part, then one `image_url` part per picture.
pub fn vision_content(text: &str, images: &[(&str, &[u8])]) -> Value {
    let mut parts = vec![json!({ "type": "text", "text": text })];
    for (mime, bytes) in images {
        parts.push(json!({ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{}", base64::encode(bytes)) } }));
    }
    Value::Array(parts)
}

/// Reads the answer text out of a chat completions answer.
pub fn parse_chat(answer: &Value) -> Result<String, ApiError> {
    let text = answer.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").trim();
    if text.is_empty() {
        let finish = answer.pointer("/choices/0/finish_reason").and_then(Value::as_str).unwrap_or("none");
        return Err(ApiError::BadResponse(format!("OpenAI sent an empty answer (finish reason: {finish}).")));
    }
    Ok(text.to_string())
}

/// Asks a vision model one question about pictures. With `json` set, the answer is requested as a JSON object.
pub async fn vision(key: &str, model: &str, system: Option<&str>, text: &str, images: &[(&str, &[u8])], json: bool) -> Result<String, ApiError> {
    vision_at(CHAT_URL, key, model, system, text, images, json).await
}

pub async fn vision_at(url: &str, key: &str, model: &str, system: Option<&str>, text: &str, images: &[(&str, &[u8])], json: bool) -> Result<String, ApiError> {
    let model = super::clean_model_name(model, false).ok_or_else(|| ApiError::BadResponse("That OpenAI model name is not valid.".to_string()))?;
    let client = http()?;
    let auth = secret_header("Bearer ", key)?;
    let mut messages = Vec::new();
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": vision_content(text, images) }));
    let mut body = json!({ "model": model, "messages": messages, "temperature": 0.4 });
    if json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let response = send(|| client.post(url).timeout(GENERATE_TIMEOUT).header(AUTHORIZATION, auth.clone()).json(&body)).await.map_err(|error| error.redact(key))?;
    let answer = read_json(response).await.map_err(|error| error.redact(key))?;
    parse_chat(&answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_are_sent_as_data_urls_after_the_text() {
        let content = vision_content("look", &[("image/jpeg", b"abc"), ("image/jpeg", b"de")]);
        let parts = content.as_array().unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0]["text"], "look");
        assert_eq!(parts[1]["image_url"]["url"], "data:image/jpeg;base64,YWJj");
    }

    #[test]
    fn the_answer_text_is_read_and_empty_is_an_error() {
        assert_eq!(parse_chat(&json!({"choices":[{"message":{"content":" {} "}}]})).unwrap(), "{}");
        let empty = parse_chat(&json!({"choices":[{"finish_reason":"length","message":{"content":""}}]})).unwrap_err();
        assert!(empty.details().contains("length"));
    }

    #[tokio::test]
    async fn vision_sends_the_key_in_a_header_and_asks_for_json() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        std::env::set_var("NO_PROXY", "127.0.0.1");
        std::env::set_var("no_proxy", "127.0.0.1");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
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
            let body = r#"{"choices":[{"message":{"content":"{\"a\":1}"}}]}"#;
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        let text = vision_at(&url, "sk-secret", "gpt-4.1-mini", Some("be brief"), "hello", &[("image/jpeg", b"x")], true).await.unwrap();
        assert_eq!(text, "{\"a\":1}");
        let request = server.await.unwrap().to_lowercase();
        assert!(request.contains("authorization: bearer sk-secret"));
        assert!(!request.lines().next().unwrap().contains("sk-secret"));
        assert!(request.contains("json_object"));
        assert!(request.contains("data:image/jpeg;base64"));
    }
}
