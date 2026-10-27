//! Commands for API keys. None of them ever returns a key to the frontend.

use serde::Serialize;
use tauri::AppHandle;

use crate::api::{gemini, groq, openai};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::keys::{self, KeyStatus, Provider};
use crate::settings;

/// Saves (or replaces) a key of a provider in the OS keychain. `slot` is the key number (1 when not given).
#[tauri::command]
pub async fn save_key(provider: Provider, key: String, slot: Option<u8>) -> Result<(), AppError> {
    run_blocking(move || keys::save_slot(provider, slot.unwrap_or(1), &key)).await
}

/// Tells the UI whether any key is saved: "set" or "not_set".
#[tauri::command]
pub async fn get_key_status(provider: Provider) -> Result<KeyStatus, AppError> {
    run_blocking(move || keys::status(provider)).await
}

/// One key place of a provider, for the list in Settings. Never contains the key.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySlot {
    pub slot: u8,
    pub status: KeyStatus,
    /// Seconds the key still rests after a usage limit (0 = ready).
    pub resting_seconds: u64,
    /// Epoch milliseconds when the key is back online (0 = ready).
    pub resting_until_ms: u64,
}

/// All key places of a provider (1 to the most keys it can have) and whether each has a key.
#[tauri::command]
pub async fn get_key_slots(provider: Provider) -> Result<Vec<KeySlot>, AppError> {
    run_blocking(move || {
        Ok(keys::statuses(provider)?
            .into_iter()
            .enumerate()
            .map(|(i, status)| {
                let slot = (i + 1) as u8;
                KeySlot { slot, status, resting_seconds: keys::resting_seconds(provider, slot), resting_until_ms: keys::resting_until_ms(provider, slot) }
            })
            .collect())
    })
    .await
}

/// Sets when a key is back online after a usage limit (epoch ms, 0 = ready now). Saved to disk.
#[tauri::command]
pub async fn set_key_rest_until(provider: Provider, slot: u8, until_ms: u64) -> Result<(), AppError> {
    run_blocking(move || keys::set_rest_until(provider, slot, until_ms)).await
}

#[tauri::command]
pub async fn delete_key(provider: Provider, slot: Option<u8>) -> Result<(), AppError> {
    run_blocking(move || keys::delete_slot(provider, slot.unwrap_or(1))).await
}

/// Checks the saved key with a tiny real request. Groq: list the models.
/// OpenAI: list the models. Gemini: send "Reply with OK" to `model` (or the saved Gemini model).
#[tauri::command]
pub async fn test_key(
    app: AppHandle,
    provider: Provider,
    model: Option<String>,
    slot: Option<u8>,
) -> Result<(), AppError> {
    let key = run_blocking(move || keys::require_slot(provider, slot.unwrap_or(1))).await?;

    match provider {
        Provider::Groq => groq::test_key(&key).await?,
        Provider::OpenAi => openai::test_key(&key).await?,
        Provider::Gemini => {
            let model = match model {
                Some(model) => model,
                None => run_blocking(move || settings::load(&app)).await?.gemini_model,
            };
            gemini::test_key(&key, &model).await?;
        }
    }
    Ok(())
}
