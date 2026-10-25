//! One place for all outgoing HTTP: a shared client with a 60 second timeout,
//! retry with backoff for 429 and 5xx answers, and mapping of failures to `ApiError`.

use std::error::Error as _;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};
use reqwest::{Client, RequestBuilder, Response};

use super::error::ApiError;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ERROR_TEXT_CHARS: usize = 1500;

/// How often and how long to wait before trying again after a 429 or 5xx answer.
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(10),
        }
    }
}

/// The shared HTTP client (created on first use).
pub fn http() -> Result<&'static Client, ApiError> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .connect_timeout(CONNECT_TIMEOUT)
                .user_agent(concat!("AutoVideoEditor/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| describe(&e))
        })
        .as_ref()
        .map_err(|details| {
            ApiError::Network(format!("Could not start the network layer: {details}"))
        })
}

/// An authorization header value that is marked sensitive, so it never shows up in debug output.
/// Use `prefix = "Bearer "` for bearer tokens or `""` for a bare key.
pub fn secret_header(prefix: &str, key: &str) -> Result<HeaderValue, ApiError> {
    let mut value = HeaderValue::from_str(&format!("{prefix}{key}")).map_err(|_| {
        ApiError::InvalidKey(
            "The key contains characters that cannot be sent, such as a line break.".to_string(),
        )
    })?;
    value.set_sensitive(true);
    Ok(value)
}

/// Sends the request built by `build`, retrying on 429 and 5xx with exponential backoff.
pub async fn send(build: impl Fn() -> RequestBuilder) -> Result<Response, ApiError> {
    send_with_policy(RetryPolicy::default(), build).await
}

pub async fn send_with_policy(
    policy: RetryPolicy,
    build: impl Fn() -> RequestBuilder,
) -> Result<Response, ApiError> {
    let mut attempt: u32 = 0;
    loop {
        let response = build()
            .send()
            .await
            .map_err(|error| network_error(error))?;

        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }

        let retry_after = parse_retry_after(response.headers());
        let body = response.text().await.unwrap_or_default();

        if is_retriable(status.as_u16()) && attempt < policy.max_retries {
            tokio::time::sleep(backoff_delay(&policy, attempt, retry_after)).await;
            attempt += 1;
            continue;
        }
        return Err(classify(status.as_u16(), &body));
    }
}

/// Reads an answer body as JSON.
pub async fn read_json(response: Response) -> Result<serde_json::Value, ApiError> {
    response.json().await.map_err(|error| {
        ApiError::BadResponse(format!(
            "The answer was not valid JSON: {}",
            describe(&error.without_url())
        ))
    })
}

fn is_retriable(status: u16) -> bool {
    status == 429 || (500..=599).contains(&status)
}

fn backoff_delay(policy: &RetryPolicy, attempt: u32, retry_after: Option<Duration>) -> Duration {
    let exponential = policy
        .base_delay
        .saturating_mul(2u32.saturating_pow(attempt));
    retry_after.unwrap_or(exponential).min(policy.max_delay)
}

/// Reads `Retry-After` when it is given as a number of seconds.
fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let seconds: u64 = headers.get(RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_secs(seconds))
}

/// Maps a failed HTTP answer to a typed error.
pub fn classify(status: u16, body: &str) -> ApiError {
    let details = format!("HTTP {status}: {}", summarize(body));
    match status {
        401 | 403 => ApiError::InvalidKey(details),
        // Gemini answers a wrong key with 400 and "API key not valid" / API_KEY_INVALID.
        400 if mentions_invalid_key(body) => ApiError::InvalidKey(details),
        429 => ApiError::RateLimited(details),
        500..=599 => ApiError::Server(details),
        _ => ApiError::BadResponse(details),
    }
}

fn mentions_invalid_key(body: &str) -> bool {
    let lower = body.to_lowercase();
    lower.contains("api_key_invalid") || lower.contains("api key not valid")
}

fn summarize(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "(empty answer)".to_string();
    }
    let mut text: String = trimmed.chars().take(MAX_ERROR_TEXT_CHARS).collect();
    if trimmed.chars().count() > MAX_ERROR_TEXT_CHARS {
        text.push('…');
    }
    text
}

fn network_error(error: reqwest::Error) -> ApiError {
    // `without_url` keeps request URLs out of the message.
    let error = error.without_url();
    let details = if error.is_timeout() {
        // Calls have different limits (60 s by default, longer for text generation), so no number is named.
        format!("The service did not answer in time. {}", describe(&error))
    } else {
        describe(&error)
    };
    ApiError::Network(details)
}

/// The error message followed by the chain of causes.
fn describe(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        source = inner.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const FAST: RetryPolicy = RetryPolicy {
        max_retries: 3,
        base_delay: Duration::from_millis(1),
        max_delay: Duration::from_millis(5),
    };

    /// (status, extra header lines, body)
    type Answer = (u16, &'static str, &'static str);

    struct MockServer {
        url: String,
        hits: Arc<AtomicUsize>,
    }

    impl MockServer {
        fn hits(&self) -> usize {
            self.hits.load(Ordering::SeqCst)
        }
    }

    /// Answers each connection with the next scripted answer (the last one repeats).
    async fn mock_server(script: Vec<Answer>) -> MockServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let n = counter.fetch_add(1, Ordering::SeqCst);
                let (status, headers, body) = script[n.min(script.len() - 1)];
                tokio::spawn(async move {
                    let mut buffer = [0u8; 4096];
                    let _ = socket.read(&mut buffer).await;
                    let answer = format!(
                        "HTTP/1.1 {status} X\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(answer.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        MockServer { url, hits }
    }

    /// A client that ignores proxy settings, so tests talk to the local server directly.
    fn test_client() -> Client {
        Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn retries_429_and_then_succeeds() {
        let server = mock_server(vec![(429, "", ""), (429, "", ""), (200, "", "{}")]).await;
        let client = test_client();
        let result = send_with_policy(FAST, || client.get(&server.url)).await;
        assert!(result.is_ok());
        assert_eq!(server.hits(), 3);
    }

    #[tokio::test]
    async fn does_not_retry_an_invalid_key() {
        let server =
            mock_server(vec![(401, "", r#"{"error":{"message":"Invalid API Key"}}"#)]).await;
        let client = test_client();
        let error = send_with_policy(FAST, || client.get(&server.url))
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::InvalidKey(_)));
        assert!(error.details().contains("Invalid API Key"));
        assert_eq!(server.hits(), 1);
    }

    #[tokio::test]
    async fn gives_up_on_5xx_after_max_retries() {
        let server = mock_server(vec![(503, "", "busy")]).await;
        let client = test_client();
        let error = send_with_policy(FAST, || client.get(&server.url))
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::Server(_)));
        assert_eq!(server.hits(), 4); // first try + 3 retries
    }

    #[tokio::test]
    async fn reports_rate_limit_after_max_retries() {
        let server = mock_server(vec![(429, "", "slow down")]).await;
        let client = test_client();
        let error = send_with_policy(FAST, || client.get(&server.url))
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::RateLimited(_)));
        assert_eq!(server.hits(), 4);
    }

    #[tokio::test]
    async fn does_not_retry_other_client_errors() {
        let server = mock_server(vec![(400, "", "{}")]).await;
        let client = test_client();
        let error = send_with_policy(FAST, || client.get(&server.url))
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::BadResponse(_)));
        assert_eq!(server.hits(), 1);
    }

    #[tokio::test]
    async fn reports_network_error_without_leaking_the_url() {
        // Bind a port, then close it so nothing is listening there.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/secret-path?key=hunter2", listener.local_addr().unwrap());
        drop(listener);

        let client = test_client();
        let error = send_with_policy(FAST, || client.get(&url)).await.unwrap_err();
        assert!(matches!(error, ApiError::Network(_)));
        assert!(!error.details().contains("hunter2"));
        assert!(!error.details().contains("secret-path"));
    }

    #[tokio::test]
    async fn invalid_json_is_a_bad_response() {
        let server = mock_server(vec![(200, "", "<html>login</html>")]).await;
        let client = test_client();
        let response = send_with_policy(FAST, || client.get(&server.url))
            .await
            .unwrap();
        let error = read_json(response).await.unwrap_err();
        assert!(matches!(error, ApiError::BadResponse(_)));
    }

    #[test]
    fn classifies_status_codes() {
        assert!(matches!(classify(401, ""), ApiError::InvalidKey(_)));
        assert!(matches!(classify(403, ""), ApiError::InvalidKey(_)));
        assert!(matches!(classify(429, ""), ApiError::RateLimited(_)));
        assert!(matches!(classify(500, ""), ApiError::Server(_)));
        assert!(matches!(classify(503, ""), ApiError::Server(_)));
        assert!(matches!(classify(404, ""), ApiError::BadResponse(_)));
        assert!(matches!(classify(400, "{}"), ApiError::BadResponse(_)));
    }

    #[test]
    fn gemini_style_invalid_key_answer_is_an_invalid_key() {
        let body = r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"#;
        assert!(matches!(classify(400, body), ApiError::InvalidKey(_)));
    }

    #[test]
    fn long_error_bodies_are_shortened() {
        let body = "x".repeat(5000);
        let error = classify(500, &body);
        assert!(error.details().chars().count() < 1600);
    }

    #[test]
    fn only_429_and_5xx_are_retried() {
        assert!(is_retriable(429));
        assert!(is_retriable(500));
        assert!(is_retriable(599));
        assert!(!is_retriable(400));
        assert!(!is_retriable(401));
        assert!(!is_retriable(404));
        assert!(!is_retriable(200));
    }

    #[test]
    fn backoff_doubles_and_is_capped() {
        let policy = RetryPolicy::default();
        assert_eq!(backoff_delay(&policy, 0, None), Duration::from_secs(1));
        assert_eq!(backoff_delay(&policy, 1, None), Duration::from_secs(2));
        assert_eq!(backoff_delay(&policy, 2, None), Duration::from_secs(4));
        assert_eq!(backoff_delay(&policy, 10, None), Duration::from_secs(10));
    }

    #[test]
    fn backoff_prefers_retry_after_but_stays_capped() {
        let policy = RetryPolicy::default();
        assert_eq!(
            backoff_delay(&policy, 0, Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
        assert_eq!(
            backoff_delay(&policy, 0, Some(Duration::from_secs(120))),
            Duration::from_secs(10)
        );
    }

    #[test]
    fn parses_retry_after_seconds_only() {
        let mut headers = HeaderMap::new();
        assert_eq!(parse_retry_after(&headers), None);
        headers.insert(RETRY_AFTER, HeaderValue::from_static("7"));
        assert_eq!(parse_retry_after(&headers), Some(Duration::from_secs(7)));
        headers.insert(
            RETRY_AFTER,
            HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"),
        );
        assert_eq!(parse_retry_after(&headers), None);
    }

    #[test]
    fn secret_headers_are_sensitive_and_reject_line_breaks() {
        let header = secret_header("Bearer ", "abc123").unwrap();
        assert!(header.is_sensitive());
        assert_eq!(format!("{header:?}"), "Sensitive");
        assert!(matches!(
            secret_header("Bearer ", "abc\ndef"),
            Err(ApiError::InvalidKey(_))
        ));
    }
}
