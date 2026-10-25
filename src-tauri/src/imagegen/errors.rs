//! What can go wrong while an image is made, and what the app does about each kind.
//!
//! Every way of making an image (a Google account in a browser) reports
//! failures as a `GenError`. The scheduler only looks at the `kind`, so its retry rules do not
//! depend on how the image was made.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The account is signed out, or the key was refused. The account waits for the user.
    Auth,
    /// Signed in, but Google does not let this account use the image tool.
    Access,
    /// Usage limit reached. The account cools down; the job waits and no attempt is used.
    RateLimit,
    /// Google asks the user for something (captcha, "unusual activity", terms). Account paused.
    Flagged,
    /// The browser closed or crashed. The job is queued again, no attempt used.
    Session,
    /// Offline or the page did not load. The job is queued again, no attempt used.
    Network,
    /// Cancelled by the app. The job is queued again.
    Aborted,
    /// Took too long. Retried with a delay.
    Timeout,
    /// Finished without a picture. Retried with a delay.
    NoImage,
    /// The prompt was refused on content grounds. Never retried.
    Blocked,
    /// The prompt or request cannot be used. Never retried.
    BadRequest,
    /// A temporary problem at the service. Retried with a delay.
    Server,
    /// The picture could not be written to the project folder (missing, read-only, disk full).
    /// Everything waits and the save is tried again; no attempt is used.
    Storage,
    Unknown,
    /// Chat: Gemini never started an answer.
    NoResponse,
    /// Chat: Gemini was still thinking after the longest wait.
    ResponseTimeout,
    /// Chat: a generic error/refusal reply ("encountering an error").
    SoftFailure,
    /// Chat: the answer was not usable JSON.
    InvalidJson,
    /// Chat: the answer left out some scene ids.
    MissingIds,
    /// Chat: the page does not look like it should (selectors missing).
    PageChanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenError {
    pub kind: ErrorKind,
    /// A sentence in simple English for the user.
    pub message: String,
    /// How long to wait before the account is used again (usage limits).
    pub retry_after_ms: u64,
}

impl GenError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), retry_after_ms: 0 }
    }

    pub fn aborted() -> Self {
        Self::new(ErrorKind::Aborted, "Cancelled.")
    }
}

impl std::fmt::Display for GenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// One rule of the remote config: when the text contains any of the words, this kind of error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPattern {
    /// Case-insensitive pieces of text. One match is enough.
    pub contains: Vec<String>,
    pub kind: ErrorKind,
    pub message: String,
}

/// True when `text` contains any of the pieces (ignoring case).
pub fn contains_any(text: &str, pieces: &[String]) -> bool {
    let lower = text.to_lowercase();
    pieces.iter().any(|p| !p.is_empty() && lower.contains(&p.to_lowercase()))
}

/// The tool's error text on a failed card, turned into an error the scheduler understands.
/// `signed_out` tells whether the page itself shows the account as signed out: a refusal (401/403)
/// on a page that shows the account signed in means this account may not use the model.
pub fn classify_card_error(patterns: &[ErrorPattern], text: &str, signed_out: bool) -> GenError {
    let Some(pattern) = patterns.iter().find(|p| contains_any(text, &p.contains)) else {
        return GenError::new(ErrorKind::Unknown, "Generation failed.");
    };
    if pattern.kind == ErrorKind::Auth && !signed_out {
        return GenError::new(
            ErrorKind::Access,
            "Google is not allowing image generation for this account right now (age, region or plan limits, or the tool's access changed).",
        );
    }
    GenError::new(pattern.kind, pattern.message.clone())
}

/// Failures of the browser itself (not of the page) as an error kind.
pub fn classify_browser_error(raw: &str, prefix: &str) -> GenError {
    let lower = raw.to_lowercase();
    let first_line = raw.lines().next().unwrap_or("").trim();
    if ["target closed", "has been closed", "session closed", "connection closed", "crashed", "no target", "websocket", "not running", "broken pipe", "connection reset", "session with given id not found", "no session with given id", "-32001"].iter().any(|p| lower.contains(p)) {
        return GenError::new(ErrorKind::Session, "The browser was closed or crashed.");
    }
    if ["err_internet_disconnected", "err_name_not_resolved", "err_connection", "err_network", "err_timed_out", "err_address_unreachable", "err_proxy", "err_tunnel"].iter().any(|p| lower.contains(p)) {
        return GenError::new(ErrorKind::Network, format!("Network error: {}", clip(first_line, 140)));
    }
    if lower.contains("timeout") || lower.contains("timed out") {
        return GenError::new(ErrorKind::Timeout, format!("{prefix}: timed out."));
    }
    GenError::new(ErrorKind::NoImage, format!("{prefix}: {}", clip(first_line, 180)))
}

pub fn clip(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    let head: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lost_page_is_a_session_problem() {
        assert_eq!(classify_browser_error("browser error -32001: Session with given id not found.", "Reading the chat page").kind, ErrorKind::Session);
        assert_eq!(classify_browser_error("Target closed", "x").kind, ErrorKind::Session);
        assert_eq!(classify_browser_error("something else", "x").kind, ErrorKind::NoImage);
    }

    fn patterns() -> Vec<ErrorPattern> {
        let p = |words: &[&str], kind, message: &str| ErrorPattern { contains: words.iter().map(|w| (*w).to_string()).collect(), kind, message: message.to_string() };
        vec![
            p(&["API Error 429"], ErrorKind::RateLimit, "Usage limit reached."),
            p(&["API Error 401", "API Error 403"], ErrorKind::Auth, "Signed out."),
            p(&["API Error 404"], ErrorKind::Access, "Not available."),
            p(&["API Error 400"], ErrorKind::BadRequest, "Rejected."),
            p(&["API Error 5"], ErrorKind::Server, "Temporary."),
            p(&["No image data returned"], ErrorKind::NoImage, "No image."),
        ]
    }

    #[test]
    fn card_errors_map_to_kinds_ignoring_case() {
        let p = patterns();
        assert_eq!(classify_card_error(&p, "API Error 429", false).kind, ErrorKind::RateLimit);
        assert_eq!(classify_card_error(&p, "api error 500", false).kind, ErrorKind::Server);
        assert_eq!(classify_card_error(&p, "No image data returned from Gemini.", false).kind, ErrorKind::NoImage);
        assert_eq!(classify_card_error(&p, "API Error 400 bad", false).kind, ErrorKind::BadRequest);
        assert_eq!(classify_card_error(&p, "something new", false).kind, ErrorKind::Unknown);
    }

    #[test]
    fn a_refusal_on_a_signed_in_page_means_no_access_not_signed_out() {
        let p = patterns();
        assert_eq!(classify_card_error(&p, "API Error 403", true).kind, ErrorKind::Auth);
        assert_eq!(classify_card_error(&p, "API Error 403", false).kind, ErrorKind::Access);
        assert_eq!(classify_card_error(&p, "API Error 401", false).kind, ErrorKind::Access);
    }

    #[test]
    fn browser_failures_map_to_kinds() {
        assert_eq!(classify_browser_error("Target closed", "x").kind, ErrorKind::Session);
        assert_eq!(classify_browser_error("websocket closed", "x").kind, ErrorKind::Session);
        assert_eq!(classify_browser_error("net::ERR_INTERNET_DISCONNECTED at https://a", "x").kind, ErrorKind::Network);
        assert_eq!(classify_browser_error("Operation timed out", "Open").kind, ErrorKind::Timeout);
        let other = classify_browser_error("weird\nsecond line", "Open");
        assert_eq!(other.kind, ErrorKind::NoImage);
        assert_eq!(other.message, "Open: weird");
    }

    #[test]
    fn empty_pieces_never_match() {
        assert!(!contains_any("anything", &[String::new()]));
        assert!(contains_any("Anything", &["thing".to_string()]));
    }

    #[test]
    fn clip_shortens_with_an_ellipsis() {
        assert_eq!(clip("abcdef", 4), "abc…");
        assert_eq!(clip("abc", 4), "abc");
    }
}
