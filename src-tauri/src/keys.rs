//! API keys, stored only in the OS keychain (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux). A key is never written to a file, never logged and never
//! sent to the frontend: the UI only ever learns whether a key is set.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;

const SERVICE: &str = "com.autovideoeditor.app";
const MAX_KEY_LENGTH: usize = 512;
/// Most keys of one provider (Gemini and Groq). OpenAI keeps one.
pub const MAX_SLOTS: u8 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Groq,
    Gemini,
    OpenAi,
}

impl Provider {
    /// Name of the keychain entry for this provider.
    fn account(self) -> &'static str {
        match self {
            Provider::Groq => "groq-api-key",
            Provider::Gemini => "gemini-api-key",
            Provider::OpenAi => "openai-api-key",
        }
    }

    /// How many keys the provider can have.
    pub fn slots(self) -> u8 {
        match self {
            Provider::Groq | Provider::Gemini => MAX_SLOTS,
            Provider::OpenAi => 1,
        }
    }
}

/// The keychain entry name of key number `slot` (1 is the original name, so keys saved before there were slots still work).
fn slot_account(provider: Provider, slot: u8) -> String {
    if slot <= 1 {
        provider.account().to_string()
    } else {
        format!("{}-{slot}", provider.account())
    }
}

fn check_slot(provider: Provider, slot: u8) -> Result<(), AppError> {
    if slot == 0 || slot > provider.slots() {
        return Err(AppError::new("That key number does not exist.", format!("slot {slot} of {}", provider.slots())));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyStatus {
    Set,
    NotSet,
}

fn slot_entry(provider: Provider, slot: u8) -> Result<Entry, AppError> {
    check_slot(provider, slot)?;
    Entry::new(SERVICE, &slot_account(provider, slot)).map_err(keychain_error)
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

/// Saves (or replaces) key number `slot`.
pub fn save_slot(provider: Provider, slot: u8, raw_key: &str) -> Result<(), AppError> {
    let key = clean_key(raw_key)?;
    slot_entry(provider, slot)?.set_password(&key).map_err(keychain_error)?;
    forget_rest(provider, slot);
    Ok(())
}

/// Whether ANY key of the provider is saved. Never returns a key.
pub fn status(provider: Provider) -> Result<KeyStatus, AppError> {
    Ok(if statuses(provider)?.contains(&KeyStatus::Set) { KeyStatus::Set } else { KeyStatus::NotSet })
}

/// Whether key number `slot` is saved.
pub fn slot_status(provider: Provider, slot: u8) -> Result<KeyStatus, AppError> {
    match slot_entry(provider, slot)?.get_password() {
        Ok(_) => Ok(KeyStatus::Set),
        Err(keyring::Error::NoEntry) => Ok(KeyStatus::NotSet),
        Err(error) => Err(keychain_error(error)),
    }
}

/// For every slot of the provider (1 to `slots`): saved or not.
pub fn statuses(provider: Provider) -> Result<Vec<KeyStatus>, AppError> {
    (1..=provider.slots()).map(|slot| slot_status(provider, slot)).collect()
}

/// Removes a key. Deleting a key that is not there is not an error.
pub fn delete_slot(provider: Provider, slot: u8) -> Result<(), AppError> {
    forget_rest(provider, slot);
    match slot_entry(provider, slot)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(error)),
    }
}

fn read_slot(provider: Provider, slot: u8) -> Result<Option<String>, AppError> {
    match slot_entry(provider, slot)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keychain_error(error)),
    }
}

/// The key of one slot, for Rust code that calls the provider's API. Never passed to the frontend.
pub fn require_slot(provider: Provider, slot: u8) -> Result<String, AppError> {
    read_slot(provider, slot)?.ok_or_else(|| AppError::new("No key is saved yet. Please paste your key and press Save first.", "The keychain has no entry for this key."))
}

/// A usable key for a single call without fail-over: the first saved key that is not resting.
/// This must never be passed back to the frontend.
pub fn require(provider: Provider) -> Result<String, AppError> {
    let all = candidates(provider)?;
    all.into_iter().next().map(|c| c.key).ok_or_else(|| {
        AppError::new("No key is saved yet. Please paste your key and press Save first.", "The keychain has no entry for this provider.")
    })
}

// ---- several keys of one provider: the first usable key is used until its limit is reached ----

/// A saved key and its number.
#[derive(Clone)]
pub struct Candidate {
    pub slot: u8,
    pub key: String,
}

struct Rest {
    until: Instant,
    /// Times in a row the key hit a limit right after resting (the rest gets longer).
    strikes: u32,
}

static RESTS: Mutex<Option<HashMap<(Provider, u8), Rest>>> = Mutex::new(None);

fn with_rests<T>(change: impl FnOnce(&mut HashMap<(Provider, u8), Rest>) -> T) -> T {
    let mut guard = RESTS.lock().unwrap_or_else(|e| e.into_inner());
    change(guard.get_or_insert_with(HashMap::new))
}

fn forget_rest(provider: Provider, slot: u8) {
    with_rests(|rests| {
        rests.remove(&(provider, slot));
    });
}

/// How long a key rests after its n-th limit in a row: 2 min, 4 min, 8 min ... at most 1 hour.
pub fn rest_for(strikes: u32) -> Duration {
    Duration::from_secs((120u64 << strikes.min(5)).min(3600))
}

/// Puts a key to rest after a usage limit. Returns how long.
pub fn rest(provider: Provider, slot: u8) -> Duration {
    with_rests(|rests| {
        let strikes = rests.get(&(provider, slot)).map_or(0, |r| r.strikes);
        let wait = rest_for(strikes);
        rests.insert((provider, slot), Rest { until: Instant::now() + wait, strikes: strikes + 1 });
        wait
    })
}

/// A key that was refused (wrong or removed) rests for an hour.
pub fn rest_long(provider: Provider, slot: u8) {
    with_rests(|rests| {
        rests.insert((provider, slot), Rest { until: Instant::now() + Duration::from_secs(3600), strikes: 5 });
    });
}

/// A call worked: the key's strikes are forgotten.
pub fn worked(provider: Provider, slot: u8) {
    with_rests(|rests| {
        rests.remove(&(provider, slot));
    });
}

/// Seconds until the key can be used again (0 = ready).
pub fn resting_seconds(provider: Provider, slot: u8) -> u64 {
    with_rests(|rests| rests.get(&(provider, slot)).map_or(0, |r| r.until.saturating_duration_since(Instant::now()).as_secs()))
}

/// The saved keys in the order they are tried: keys that are not resting first (in slot order), resting keys last.
pub fn candidates(provider: Provider) -> Result<Vec<Candidate>, AppError> {
    let mut ready = Vec::new();
    let mut resting = Vec::new();
    for slot in 1..=provider.slots() {
        if let Some(key) = read_slot(provider, slot)? {
            let candidate = Candidate { slot, key };
            if resting_seconds(provider, slot) == 0 { ready.push(candidate) } else { resting.push(candidate) }
        }
    }
    ready.extend(resting);
    Ok(ready)
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
        assert_eq!(serde_json::from_str::<Provider>("\"openai\"").unwrap(), Provider::OpenAi);
        assert!(serde_json::from_str::<Provider>("\"claude\"").is_err());
    }

    #[test]
    fn slot_one_keeps_the_old_name_and_others_are_numbered() {
        assert_eq!(slot_account(Provider::Gemini, 1), "gemini-api-key");
        assert_eq!(slot_account(Provider::Gemini, 2), "gemini-api-key-2");
        assert_eq!(slot_account(Provider::Groq, 10), "groq-api-key-10");
        assert!(check_slot(Provider::Gemini, 10).is_ok());
        assert!(check_slot(Provider::Gemini, 11).is_err());
        assert!(check_slot(Provider::Gemini, 0).is_err());
        assert!(check_slot(Provider::OpenAi, 2).is_err());
    }

    #[test]
    fn a_key_that_limits_again_rests_longer_up_to_an_hour() {
        assert_eq!(rest_for(0), Duration::from_secs(120));
        assert_eq!(rest_for(1), Duration::from_secs(240));
        assert_eq!(rest_for(3), Duration::from_secs(960));
        assert_eq!(rest_for(5), Duration::from_secs(3600));
        assert_eq!(rest_for(50), Duration::from_secs(3600));
    }

    #[test]
    fn resting_keys_are_tracked_per_provider_and_slot() {
        assert_eq!(resting_seconds(Provider::Groq, 9), 0);
        let wait = rest(Provider::Groq, 9);
        assert_eq!(wait, Duration::from_secs(120));
        assert!(resting_seconds(Provider::Groq, 9) > 100);
        assert_eq!(resting_seconds(Provider::Gemini, 9), 0);
        assert_eq!(rest(Provider::Groq, 9), Duration::from_secs(240));
        worked(Provider::Groq, 9);
        assert_eq!(resting_seconds(Provider::Groq, 9), 0);
        assert_eq!(rest(Provider::Groq, 9), Duration::from_secs(120));
        forget_rest(Provider::Groq, 9);
    }

    #[test]
    fn status_is_reported_as_set_or_not_set() {
        assert_eq!(serde_json::to_string(&KeyStatus::Set).unwrap(), "\"set\"");
        assert_eq!(serde_json::to_string(&KeyStatus::NotSet).unwrap(), "\"not_set\"");
    }

    #[test]
    fn each_provider_has_its_own_keychain_entry() {
        assert_ne!(Provider::Groq.account(), Provider::Gemini.account());
        assert_ne!(Provider::OpenAi.account(), Provider::Gemini.account());
        assert_ne!(Provider::OpenAi.account(), Provider::Groq.account());
    }
}
