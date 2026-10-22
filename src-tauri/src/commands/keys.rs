//! Commands for API keys. None of them ever returns a key to the frontend.

use tauri::AppHandle;

use crate::api::{gemini, groq, openai};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::keys::{self, KeyStatus, Provider};
use crate::settings;

/// Saves (or replaces) the key for a provider in the OS keychain.
#[tauri::command]
pub async fn save_key(provider: Provider, key: String) -> Result<(), AppError> {
    run_blocking(move || keys::save(provider, &key)).await
}

/// Tells the UI whether a key is saved: "set" or "not_set".
#[tauri::command]
pub async fn get_key_status(provider: Provider) -> Result<KeyStatus, AppError> {
    run_blocking(move || keys::status(provider)).await
}

#[tauri::command]
pub async fn delete_key(provider: Provider) -> Result<(), AppError> {
    run_blocking(move || keys::delete(provider)).await
}

/// Checks the saved key with a tiny real request. Groq: list the models.
/// OpenAI: list the models. Gemini: send "Reply with OK" to `model` (or the saved Gemini model).
#[tauri::command]
pub async fn test_key(
    app: AppHandle,
    provider: Provider,
    model: Option<String>,
) -> Result<(), AppError> {
    let key = run_blocking(move || keys::require(provider)).await?;

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
