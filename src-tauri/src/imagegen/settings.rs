//! The Image Generator's own settings (`imagegen/settings.json` in the app data folder). Nothing
//! secret is here: Google sign-ins live in the browser profile folders.

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserMode {
    Hidden,
    Window,
}

/// The one-time notice about using a Google account in the free engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Consent {
    pub accepted_at: String,
    /// The major number of the engine config the person agreed to. A new major asks again.
    pub config_major: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageGenSettings {
    /// Pictures made at the same time, 1 to 8.
    pub parallel: u32,
    pub max_attempts: u32,
    pub timeout_sec: u32,
    pub browser_mode: BrowserMode,
    /// A browser the person chose (empty = find one automatically).
    pub browser_path: String,
    /// Why the browser mode was changed by the app (shown in the accounts panel).
    pub browser_note: String,
    pub consent: Option<Consent>,
}

impl Default for ImageGenSettings {
    fn default() -> Self {
        Self {
            parallel: 3,
            max_attempts: 3,
            timeout_sec: 300,
            browser_mode: BrowserMode::Hidden,
            browser_path: String::new(),
            browser_note: String::new(),
            consent: None,
        }
    }
}

impl ImageGenSettings {
    /// Tidies the values (limits, trimmed names).
    pub fn validated(mut self) -> Result<Self, AppError> {
        self.parallel = self.parallel.clamp(1, 8);
        self.max_attempts = self.max_attempts.clamp(1, 10);
        self.timeout_sec = self.timeout_sec.clamp(30, 1800);
        self.browser_path = self.browser_path.trim().to_string();
        Ok(self)
    }

    /// The free engine may start only after the person agreed to the notice of this config version.
    pub fn consent_given(&self, config_major: u32) -> bool {
        self.consent.as_ref().is_some_and(|c| c.config_major == config_major)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_safe() {
        let s = ImageGenSettings::default();
        assert_eq!(s.parallel, 3);
        assert!(s.consent.is_none());
    }

    #[test]
    fn limits_are_applied() {
        let s = ImageGenSettings { parallel: 99, max_attempts: 0, timeout_sec: 1, browser_path: "  /x/chrome ".into(), ..Default::default() }.validated().unwrap();
        assert_eq!((s.parallel, s.max_attempts, s.timeout_sec, s.browser_path.as_str()), (8, 1, 30, "/x/chrome"));
        assert!(ImageGenSettings::default().validated().is_ok());
    }

    #[test]
    fn consent_must_match_the_config_major() {
        let mut s = ImageGenSettings::default();
        assert!(!s.consent_given(1));
        s.consent = Some(Consent { accepted_at: "2026-10-21".into(), config_major: 1 });
        assert!(s.consent_given(1));
        assert!(!s.consent_given(2), "a new major version asks again");
    }

    #[test]
    fn a_partial_file_gets_defaults_and_old_api_fields_are_ignored() {
        let s: ImageGenSettings = serde_json::from_str("{\"engine\":\"api\",\"cloudflareAccountId\":\"x\",\"parallel\":5}").unwrap();
        assert_eq!((s.parallel, s.max_attempts), (5, 3));
    }
}
