//! The Image Generator's own settings (`imagegen/settings.json` in the app data folder). Nothing
//! secret is here: keys are in the OS keychain, Google sign-ins live in the browser profile folders.

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Free,
    Api,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiProvider {
    Gemini,
    Cloudflare,
}

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
    pub engine: Engine,
    pub api_provider: ApiProvider,
    pub gemini_image_model: String,
    pub cloudflare_account_id: String,
    pub cloudflare_model: String,
    /// "If Free fails or all accounts hit their limit, continue with API".
    pub fallback_to_api: bool,
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

pub const DEFAULT_GEMINI_IMAGE_MODEL: &str = "gemini-2.5-flash-image";
pub const DEFAULT_CLOUDFLARE_MODEL: &str = "@cf/black-forest-labs/flux-1-schnell";

impl Default for ImageGenSettings {
    fn default() -> Self {
        Self {
            engine: Engine::Free,
            api_provider: ApiProvider::Gemini,
            gemini_image_model: DEFAULT_GEMINI_IMAGE_MODEL.to_string(),
            cloudflare_account_id: String::new(),
            cloudflare_model: DEFAULT_CLOUDFLARE_MODEL.to_string(),
            fallback_to_api: false,
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

fn model_ok(model: &str, allow_at_and_slash: bool) -> bool {
    !model.is_empty()
        && model.len() <= 120
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') || (allow_at_and_slash && matches!(c, '@' | '/')))
}

impl ImageGenSettings {
    /// Tidies the values (limits, trimmed names) and rejects ones that cannot work.
    pub fn validated(mut self) -> Result<Self, AppError> {
        self.parallel = self.parallel.clamp(1, 8);
        self.max_attempts = self.max_attempts.clamp(1, 10);
        self.timeout_sec = self.timeout_sec.clamp(30, 1800);
        self.gemini_image_model = self.gemini_image_model.trim().to_string();
        self.cloudflare_model = self.cloudflare_model.trim().to_string();
        self.cloudflare_account_id = self.cloudflare_account_id.trim().to_string();
        self.browser_path = self.browser_path.trim().to_string();
        if !model_ok(&self.gemini_image_model, false) {
            return Err(AppError::new("That Gemini image model name is not valid.", format!("gemini image model: {}", self.gemini_image_model)));
        }
        if !model_ok(&self.cloudflare_model, true) {
            return Err(AppError::new("That Cloudflare model name is not valid.", format!("cloudflare model: {}", self.cloudflare_model)));
        }
        if !self.cloudflare_account_id.is_empty() && !self.cloudflare_account_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(AppError::new("The Cloudflare account id should only have letters and numbers.", "cloudflare account id has other characters"));
        }
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
        assert_eq!((s.engine, s.parallel, s.fallback_to_api), (Engine::Free, 3, false));
        assert!(s.consent.is_none());
    }

    #[test]
    fn limits_are_applied_and_bad_names_are_rejected() {
        let s = ImageGenSettings { parallel: 99, max_attempts: 0, timeout_sec: 1, gemini_image_model: "  my-model ".into(), ..Default::default() }.validated().unwrap();
        assert_eq!((s.parallel, s.max_attempts, s.timeout_sec, s.gemini_image_model.as_str()), (8, 1, 30, "my-model"));
        assert!(ImageGenSettings { gemini_image_model: "a b".into(), ..Default::default() }.validated().is_err());
        assert!(ImageGenSettings { gemini_image_model: "../x".into(), ..Default::default() }.validated().is_err());
        assert!(ImageGenSettings { cloudflare_account_id: "ab-c".into(), ..Default::default() }.validated().is_err());
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
    fn a_partial_file_gets_defaults() {
        let s: ImageGenSettings = serde_json::from_str("{\"engine\":\"api\",\"parallel\":5}").unwrap();
        assert_eq!((s.engine, s.parallel, s.max_attempts), (Engine::Api, 5, 3));
    }
}
