//! API keys, stored only in the OS keychain (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux). A key is never written to a file, never logged and never
//! sent to the frontend: the UI only ever learns whether a key is set.

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;

const SERVICE: &str = "com.autovideoeditor.app";
const MAX_KEY_LENGTH: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Groq,
    Gemini,
    /// Cloudflare Workers AI token (the Image Generator's API engine).
    Cloudflare,
}

impl Provider {
    /// Name of the keychain entry for this provider.
    fn account(self) -> &'static str {
        match self {
            Provider::Groq => "groq-api-key",
            Provider::Gemini => "gemini-api-key",
            Provider::Cloudflare => "cloudflare-api-token",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyStatus {
    Set,
    NotSet,
}

fn entry(provider: Provider) -> Result<Entry, AppError> {
    Entry::new(SERVICE, provider.account()).map_err(keychain_error)
}

fn keychain_error(error: keyring::Error) -> AppError {
    AppError::new(
        "The system keychain is not available, so the key could not be saved or read.",
        error.to_string(),
    )
}

/// Trims a pasted key and rejects values that cannot be a real key.
fn clean_key(raw: &str) -> Result<String, AppError> {
    let key = raw.trim();
    if key.is_empty() {
        return Err(AppError::new("Please paste your API key first.", "The key was empty."));
    }
    if key.chars().count() > MAX_KEY_LENGTH {
        return Err(AppError::new(
            "That text is too long to be an API key. Please copy only the key.",
            format!("Longer than {MAX_KEY_LENGTH} characters."),
        ));
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::new(
            "The key contains spaces or line breaks. Please copy only the key.",
            "The key contained whitespace or control characters.",
        ));
    }
    Ok(key.to_string())
}

/// Saves (or replaces) the key for a provider.
pub fn save(provider: Provider, raw_key: &str) -> Result<(), AppError> {
    let key = clean_key(raw_key)?;
    entry(provider)?.set_password(&key).map_err(keychain_error)
}

/// Whether a key is saved. Never returns the key itself.
pub fn status(provider: Provider) -> Result<KeyStatus, AppError> {
    match entry(provider)?.get_password() {
        Ok(_) => Ok(KeyStatus::Set),
        Err(keyring::Error::NoEntry) => Ok(KeyStatus::NotSet),
        Err(error) => Err(keychain_error(error)),
    }
}

/// Removes the key. Deleting a key that is not there is not an error.
pub fn delete(provider: Provider) -> Result<(), AppError> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(error)),
    }
}

/// The saved key, for use by Rust code that calls the provider's API.
/// This must never be passed back to the frontend.
pub fn require(provider: Provider) -> Result<String, AppError> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err(AppError::new(
            "No key is saved yet. Please paste your key and press Save first.",
            "The keychain has no entry for this provider.",
        )),
        Err(error) => Err(keychain_error(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_whitespace_around_a_pasted_key() {
        assert_eq!(clean_key("  gsk_abc123\n").unwrap(), "gsk_abc123");
    }

    #[test]
    fn rejects_empty_keys() {
        assert!(clean_key("").is_err());
        assert!(clean_key("   \n ").is_err());
    }

    #[test]
    fn rejects_keys_with_inner_whitespace_or_control_characters() {
        assert!(clean_key("abc def").is_err());
        assert!(clean_key("abc\ndef").is_err());
        assert!(clean_key("abc\u{0}def").is_err());
    }

    #[test]
    fn rejects_absurdly_long_text() {
        assert!(clean_key(&"a".repeat(MAX_KEY_LENGTH + 1)).is_err());
        assert!(clean_key(&"a".repeat(MAX_KEY_LENGTH)).is_ok());
    }

    #[test]
    fn rejection_messages_never_contain_the_key() {
        let error = clean_key("secret with spaces").unwrap_err();
        assert!(!error.message.contains("secret"));
        assert!(!error.details.contains("secret"));
    }

    #[test]
    fn providers_use_lowercase_names_on_the_wire() {
        assert_eq!(serde_json::to_string(&Provider::Groq).unwrap(), "\"groq\"");
        assert_eq!(serde_json::from_str::<Provider>("\"gemini\"").unwrap(), Provider::Gemini);
        assert!(serde_json::from_str::<Provider>("\"openai\"").is_err());
    }

    #[test]
    fn status_is_reported_as_set_or_not_set() {
        assert_eq!(serde_json::to_string(&KeyStatus::Set).unwrap(), "\"set\"");
        assert_eq!(serde_json::to_string(&KeyStatus::NotSet).unwrap(), "\"not_set\"");
    }

    #[test]
    fn each_provider_has_its_own_keychain_entry() {
        assert_ne!(Provider::Groq.account(), Provider::Gemini.account());
    }
}
