//! The API engines: the Gemini image model (the user's own key) and Cloudflare Workers AI (FLUX).
//! They report failures like the free engine (`GenError`), so the queue treats both the same.
//! The scheduler does the retrying, so there are no hidden retries here. Keys come from the keychain
//! and are removed from any text that could be shown.

use std::time::Duration;

use serde_json::{json, Value};

use super::errors::{classify_http_status, ErrorKind, GenError};
use super::save::sniff;
use crate::api::base64;

pub const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com";
pub const CLOUDFLARE_BASE: &str = "https://api.cloudflare.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

pub fn gemini_body(prompt: &str, aspect: &str) -> Value {
    json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": { "responseModalities": ["IMAGE"], "imageConfig": { "aspectRatio": aspect } }
    })
}

/// The first picture of a `generateContent` answer, or why there is none.
pub fn parse_gemini_image(answer: &Value) -> Result<Vec<u8>, GenError> {
    if let Some(reason) = answer.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(GenError::new(ErrorKind::Blocked, format!("Gemini refused this prompt ({reason}).")));
    }
    let candidate = answer.pointer("/candidates/0");
    for part in candidate.and_then(|c| c.pointer("/content/parts")).and_then(Value::as_array).into_iter().flatten() {
        let data = part.pointer("/inlineData/data").or_else(|| part.pointer("/inline_data/data")).and_then(Value::as_str);
        if let Some(bytes) = data.and_then(base64::decode).filter(|b| sniff(b).is_some()) {
            return Ok(bytes);
        }
    }
    let finish = candidate.and_then(|c| c.get("finishReason")).and_then(Value::as_str).unwrap_or("");
    if ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].iter().any(|f| finish.eq_ignore_ascii_case(f)) {
        return Err(GenError::new(ErrorKind::Blocked, format!("Gemini refused this prompt ({finish}).")));
    }
    Err(GenError::new(ErrorKind::NoImage, "Gemini answered without a picture."))
}

pub fn cloudflare_body(prompt: &str) -> Value {
    json!({ "prompt": prompt, "steps": 4 })
}

pub fn parse_cloudflare_image(answer: &Value) -> Result<Vec<u8>, GenError> {
    let image = answer.pointer("/result/image").and_then(Value::as_str).and_then(base64::decode).filter(|b| sniff(b).is_some());
    image.ok_or_else(|| GenError::new(ErrorKind::NoImage, "Cloudflare answered without a picture."))
}

fn redact(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for secret in secrets.iter().filter(|s| s.len() > 3) {
        out = out.replace(secret, "***");
    }
    out
}

fn network_error(error: reqwest::Error, secrets: &[&str]) -> GenError {
    let timed_out = error.is_timeout();
    let text = redact(&error.without_url().to_string(), secrets);
    if timed_out {
        GenError::new(ErrorKind::Timeout, "The service took too long to answer.")
    } else {
        GenError::new(ErrorKind::Network, format!("Could not reach the service: {}", super::errors::clip(&text, 140)))
    }
}

fn retry_after_ms(headers: &reqwest::header::HeaderMap) -> u64 {
    headers.get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok()).map_or(0, |s| s.min(3600) * 1000)
}

async fn post(client: &reqwest::Client, request: reqwest::RequestBuilder, secrets: &[&str]) -> Result<Value, GenError> {
    let _ = client;
    let response = request.timeout(REQUEST_TIMEOUT).send().await.map_err(|e| network_error(e, secrets))?;
    let status = response.status().as_u16();
    let wait = retry_after_ms(response.headers());
    let text = response.text().await.map_err(|e| network_error(e, secrets))?;
    if !(200..300).contains(&status) {
        let error = classify_http_status(status, &redact(&text, secrets));
        return Err(if wait > 0 { error.with_retry_after(wait) } else { error });
    }
    serde_json::from_str(&text).map_err(|_| GenError::new(ErrorKind::NoImage, "The service sent an answer the app could not read."))
}

pub async fn gemini_image(base: &str, key: &str, model: &str, prompt: &str, aspect: &str) -> Result<Vec<u8>, GenError> {
    let client = crate::api::client::http().map_err(|e| GenError::new(ErrorKind::Network, e.details().to_string()))?;
    let auth = crate::api::client::secret_header("", key).map_err(|_| GenError::new(ErrorKind::Auth, "The Gemini key has characters that cannot be sent."))?;
    let url = format!("{base}/v1beta/models/{model}:generateContent");
    let request = client.post(url).header("x-goog-api-key", auth).json(&gemini_body(prompt, aspect));
    parse_gemini_image(&post(client, request, &[key]).await?)
}

pub async fn cloudflare_image(base: &str, account_id: &str, token: &str, model: &str, prompt: &str) -> Result<Vec<u8>, GenError> {
    let client = crate::api::client::http().map_err(|e| GenError::new(ErrorKind::Network, e.details().to_string()))?;
    let auth = crate::api::client::secret_header("Bearer ", token).map_err(|_| GenError::new(ErrorKind::Auth, "The Cloudflare token has characters that cannot be sent."))?;
    let url = format!("{base}/client/v4/accounts/{account_id}/ai/run/{model}");
    let request = client.post(url).header(reqwest::header::AUTHORIZATION, auth).json(&cloudflare_body(prompt));
    parse_cloudflare_image(&post(client, request, &[token]).await?)
}

/// Checks a Cloudflare API token (no picture is made).
pub async fn verify_cloudflare_token(token: &str) -> Result<(), crate::api::error::ApiError> {
    use crate::api::client::{http, read_json, secret_header, send};
    let client = http()?;
    let auth = secret_header("Bearer ", token)?;
    let url = format!("{CLOUDFLARE_BASE}/client/v4/user/tokens/verify");
    let response = send(|| client.get(&url).header(reqwest::header::AUTHORIZATION, auth.clone())).await.map_err(|e| e.redact(token))?;
    let answer = read_json(response).await.map_err(|e| e.redact(token))?;
    if answer["success"] == Value::Bool(true) {
        Ok(())
    } else {
        Err(crate::api::error::ApiError::InvalidKey("Cloudflare did not accept the token.".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imagegen::save::tiny_png;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn b64(bytes: &[u8]) -> String {
        base64::encode(bytes)
    }

    #[test]
    fn the_gemini_request_asks_for_a_picture_in_the_wanted_ratio() {
        let body = gemini_body("a fox", "9:16");
        assert_eq!(body["generationConfig"]["imageConfig"]["aspectRatio"], "9:16");
        assert_eq!(body["generationConfig"]["responseModalities"], json!(["IMAGE"]));
        assert_eq!(body["contents"][0]["parts"][0]["text"], "a fox");
    }

    #[test]
    fn the_gemini_picture_is_found_in_either_spelling() {
        let png = tiny_png(16, 9);
        let camel = json!({ "candidates": [{ "content": { "parts": [{ "text": "here" }, { "inlineData": { "mimeType": "image/png", "data": b64(&png) } }] } }] });
        let snake = json!({ "candidates": [{ "content": { "parts": [{ "inline_data": { "data": b64(&png) } }] } }] });
        assert_eq!(parse_gemini_image(&camel).unwrap(), png);
        assert_eq!(parse_gemini_image(&snake).unwrap(), png);
    }

    #[test]
    fn gemini_refusals_and_empty_answers_are_told_apart() {
        let blocked = json!({ "promptFeedback": { "blockReason": "PROHIBITED_CONTENT" } });
        assert_eq!(parse_gemini_image(&blocked).unwrap_err().kind, ErrorKind::Blocked);
        let safety = json!({ "candidates": [{ "finishReason": "IMAGE_SAFETY" }] });
        assert_eq!(parse_gemini_image(&safety).unwrap_err().kind, ErrorKind::Blocked);
        let text_only = json!({ "candidates": [{ "content": { "parts": [{ "text": "Sorry" }] }, "finishReason": "STOP" }] });
        assert_eq!(parse_gemini_image(&text_only).unwrap_err().kind, ErrorKind::NoImage);
        let junk = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "data": b64(b"not an image at all, just text that is long enough to pass a length check but is no picture at all, really") } }] } }] });
        assert_eq!(parse_gemini_image(&junk).unwrap_err().kind, ErrorKind::NoImage);
    }

    #[test]
    fn the_cloudflare_picture_is_read_from_result_image() {
        let png = tiny_png(8, 8);
        assert_eq!(parse_cloudflare_image(&json!({ "result": { "image": b64(&png) }, "success": true })).unwrap(), png);
        assert_eq!(parse_cloudflare_image(&json!({ "result": {}, "success": false })).unwrap_err().kind, ErrorKind::NoImage);
        assert_eq!(cloudflare_body("a fox")["steps"], 4);
    }

    #[test]
    fn keys_are_removed_from_texts() {
        assert_eq!(redact("bad key sk-secret-123 here", &["sk-secret-123"]), "bad key *** here");
        assert_eq!(redact("abc", &["ab"]), "abc", "very short secrets are not replaced");
    }

    async fn fake_service(status: u16, body: String, extra: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0u8; 16384];
            let _ = socket.read(&mut buffer).await;
            let head = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(body.as_bytes()).await;
        });
        format!("http://127.0.0.1:{port}")
    }

    #[tokio::test]
    async fn a_good_gemini_answer_gives_the_picture() {
        let png = tiny_png(32, 18);
        let body = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "data": b64(&png) } }] } }] }).to_string();
        let base = fake_service(200, body, "").await;
        assert_eq!(gemini_image(&base, "key-12345", "m", "p", "16:9").await.unwrap(), png);
    }

    #[tokio::test]
    async fn statuses_become_the_same_kinds_the_free_engine_uses() {
        let base = fake_service(429, "{\"error\":\"quota\"}".into(), "Retry-After: 30\r\n").await;
        let error = gemini_image(&base, "key-12345", "m", "p", "16:9").await.unwrap_err();
        assert_eq!((error.kind, error.retry_after_ms), (ErrorKind::RateLimit, 30_000));
        let base = fake_service(401, "{\"error\":\"bad key key-12345\"}".into(), "").await;
        let error = cloudflare_image(&base, "acc", "key-12345", "@cf/m", "p").await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Auth);
        assert!(!error.message.contains("key-12345"));
        let base = fake_service(503, "{}".into(), "").await;
        assert_eq!(gemini_image(&base, "key-12345", "m", "p", "16:9").await.unwrap_err().kind, ErrorKind::Server);
    }

    #[tokio::test]
    async fn an_unreachable_service_is_a_network_error() {
        let error = gemini_image("http://127.0.0.1:9", "key-12345", "m", "p", "16:9").await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Network);
    }
}
