//! The engine's remote configuration: the tool address, the page's selectors, timings and the
//! texts that mean an error. It lives in `resources/image-engine/config.json` and is replaced by
//! a downloaded package (like the styles) when the page changes, so a fix needs no new app version.

use serde::{Deserialize, Serialize};

use super::errors::{contains_any, ErrorKind, ErrorPattern};
use crate::commands::error::AppError;

/// The configuration that ships inside the app. Used when no file can be read.
pub const BUNDLED_JSON: &str = include_str!("../../../resources/image-engine/config.json");

/// A selector that picks an element by CSS and, optionally, by a regular expression on its text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Selector {
    Css(String),
    WithText { css: String, text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selectors {
    pub continue_button: Selector,
    pub sign_in_link: String,
    pub account_button: String,
    pub prompts_tab: String,
    pub prompt_input: String,
    pub submit: String,
    pub parallel: String,
    /// Contains `{ratio}`, replaced by `16:9`, `1:1` or `9:16`.
    pub ratio_button: String,
    pub total: String,
    pub queued: String,
    pub generating: String,
    pub grid: String,
    pub all_filter: String,
    pub search: String,
    pub clear_batch: String,
    pub card_error: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub poll_ms: u64,
    pub page_load_timeout_ms: u64,
    pub submit_confirm_ms: u64,
    pub lost_card_ms: u64,
    /// The tool's own list is emptied once this many finished prompts are in it (tab memory).
    pub clear_after_tasks: u32,
    /// How long the sign-in window must show Gemini before it is closed automatically.
    pub signed_in_settle_ms: u64,
}

/// A page that needs the user (captcha, "unusual activity", terms). It is shown to the user, never worked around.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanCheck {
    pub contains: Vec<String>,
    pub kind: ErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    /// `major.minor`. The consent dialog is shown again when the major number changes.
    pub config_version: String,
    pub tool_url: String,
    pub sign_in_url: String,
    pub sign_in_continue_url: String,
    pub model: String,
    pub signed_in_title: Vec<String>,
    pub still_signing_in_title: Vec<String>,
    pub tool_aspect_ratios: Vec<String>,
    pub max_parallel: u32,
    pub selectors: Selectors,
    pub timing: Timing,
    pub error_patterns: Vec<ErrorPattern>,
    pub human_checks: Vec<HumanCheck>,
}

fn bad(message: &str, details: impl Into<String>) -> AppError {
    AppError::new(message, details)
}

impl EngineConfig {
    /// The bundled configuration.
    pub fn bundled() -> Self {
        Self::parse(BUNDLED_JSON).expect("the bundled image engine config must be valid")
    }

    /// Reads and checks a configuration. Addresses must be https.
    pub fn parse(text: &str) -> Result<Self, AppError> {
        let config: Self = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| bad("The image engine settings file is damaged, so it was not used.", e.to_string()))?;
        config.check()?;
        Ok(config)
    }

    pub fn check(&self) -> Result<(), AppError> {
        for (name, url) in [("toolUrl", &self.tool_url), ("signInUrl", &self.sign_in_url), ("signInContinueUrl", &self.sign_in_continue_url)] {
            if !url.starts_with("https://") {
                return Err(bad("The image engine settings are not valid, so they were not used.", format!("{name} must start with https://")));
            }
        }
        if !self.sign_in_url.contains("{continueUrl}") {
            return Err(bad("The image engine settings are not valid, so they were not used.", "signInUrl must contain {continueUrl}"));
        }
        if !self.selectors.ratio_button.contains("{ratio}") {
            return Err(bad("The image engine settings are not valid, so they were not used.", "selectors.ratioButton must contain {ratio}"));
        }
        if self.major().is_none() {
            return Err(bad("The image engine settings are not valid, so they were not used.", "configVersion must look like 1.0"));
        }
        if self.tool_aspect_ratios.is_empty() || self.max_parallel == 0 || self.max_parallel > 16 {
            return Err(bad("The image engine settings are not valid, so they were not used.", "toolAspectRatios or maxParallel is wrong"));
        }
        if self.timing.poll_ms < 200 || self.timing.page_load_timeout_ms < 5_000 {
            return Err(bad("The image engine settings are not valid, so they were not used.", "timing values are too small"));
        }
        Ok(())
    }

    /// The major number of `configVersion` ("2.3" gives 2).
    pub fn major(&self) -> Option<u32> {
        self.config_version.split('.').next()?.trim().parse().ok()
    }

    /// Google's sign-in address, continuing to Gemini's home page.
    pub fn sign_in_address(&self) -> String {
        self.sign_in_url.replace("{continueUrl}", &percent_encode(&self.sign_in_continue_url))
    }

    /// `true` when this window title (as the OS shows it) means sign-in finished.
    pub fn title_says_signed_in(&self, title: &str) -> bool {
        contains_any(title, &self.signed_in_title) && !contains_any(title, &self.still_signing_in_title)
    }

    /// The first rule of `humanChecks` that matches the page's text, if any.
    pub fn human_check(&self, page_text: &str) -> Option<&HumanCheck> {
        self.human_checks.iter().find(|c| contains_any(page_text, &c.contains))
    }

    pub fn ratio_button_selector(&self, ratio: &str) -> String {
        self.selectors.ratio_button.replace("{ratio}", ratio)
    }
}

/// Escapes everything except letters, digits and `-_.~` (enough for a `continue=` value).
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_config_is_valid() {
        let config = EngineConfig::bundled();
        assert_eq!(config.major(), Some(1));
        assert!(config.tool_url.starts_with("https://"));
        assert!(config.error_patterns.iter().any(|p| p.kind == ErrorKind::RateLimit));
        assert!(config.tool_aspect_ratios.contains(&"16:9".to_string()));
    }

    #[test]
    fn the_sign_in_address_carries_the_encoded_continue_address() {
        let config = EngineConfig::bundled();
        assert_eq!(config.sign_in_address(), "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp");
    }

    #[test]
    fn titles_decide_when_sign_in_is_finished() {
        let config = EngineConfig::bundled();
        assert!(config.title_says_signed_in("Google Gemini - Google Chrome"));
        assert!(!config.title_says_signed_in("Sign in - Google Accounts - Google Chrome"));
        assert!(!config.title_says_signed_in("Verify it's you - Gemini"));
        assert!(!config.title_says_signed_in("New Tab"));
    }

    #[test]
    fn human_checks_find_captcha_and_terms_pages() {
        let config = EngineConfig::bundled();
        assert_eq!(config.human_check("Our systems have detected unusual traffic from your network").map(|c| c.kind), Some(ErrorKind::Flagged));
        assert_eq!(config.human_check("Please accept the Terms of Service").map(|c| c.kind), Some(ErrorKind::Access));
        assert!(config.human_check("A cat astronaut").is_none());
    }

    #[test]
    fn only_https_addresses_are_accepted() {
        let text = BUNDLED_JSON.replace("https://share.gemini.google/rqUWVwvowbjG", "http://example.com/x");
        let error = EngineConfig::parse(&text).unwrap_err();
        assert!(error.details.contains("toolUrl"));
    }

    #[test]
    fn broken_files_are_refused_with_a_friendly_message() {
        assert!(EngineConfig::parse("not json").is_err());
        let no_ratio = BUNDLED_JSON.replace("{ratio}", "16-9");
        assert!(EngineConfig::parse(&no_ratio).is_err());
        let bad_version = BUNDLED_JSON.replace("\"1.0\"", "\"x\"");
        assert!(EngineConfig::parse(&bad_version).is_err());
    }

    #[test]
    fn the_ratio_button_selector_names_the_ratio() {
        assert_eq!(EngineConfig::bundled().ratio_button_selector("9:16"), ".ratio-btn[data-ratio=\"9:16\"]");
    }
}
