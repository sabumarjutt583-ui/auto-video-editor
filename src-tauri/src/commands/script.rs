//! The script writer: Claude's chat page, used only to write scripts (see `imagegen::script_chat`).
//!
//! Several Claude accounts can be connected, like the Google accounts for pictures: each account
//! has its own browser profile, so the person signs in to each one himself in the tool's own
//! browser window. The app never sees a password and never bypasses a sign-in page or check.
//!
//! The first account keeps the original folder (`claude/profile` with `claude/state.json`), so an
//! existing sign-in keeps working untouched. New accounts live in `claude/profiles/<id>/`. The
//! notice is accepted once, for all accounts, and is mirrored onto every account's own chat state
//! so each account's existing consent check keeps working. When a script is asked for, the
//! accounts are tried in order: a resting (limited) account is skipped, a limit or a signed-out
//! account moves on to the next one, and any other error returns at once (the same rule as the
//! API-key rotation in `api::rotate`). There is no per-channel account choice: rotation is
//! automatic, in list order.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::commands::error::AppError;
use crate::imagegen::browser::locator;
use crate::imagegen::chat::{self, ChatReply, MIN_ANSWER_WAIT_SECS};
use crate::imagegen::engine;
use crate::imagegen::errors::{ErrorKind, GenError};
use crate::imagegen::ops::{to_app_error, ImageGen};
use crate::imagegen::real::mode_of;
use crate::imagegen::script_chat::{BrowserChoice, ScriptChat, ScriptStatus};
use crate::jobs::{event_sink, JobRegistry};

pub type Script<'a> = State<'a, std::sync::Arc<ScriptAccounts>>;

/// One saved Claude account: only its id and name are stored. The sign-in itself lives in the
/// account's browser profile, never in this file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SavedAccount {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SavedAccounts {
    accounts: Vec<SavedAccount>,
    consent: bool,
}

struct AccountEntry {
    id: String,
    name: String,
    chat: std::sync::Arc<ScriptChat>,
}

/// One Claude account as the Settings card shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptAccountStatus {
    pub id: String,
    pub name: String,
    pub consent: bool,
    pub connected: bool,
    pub signing_in: bool,
    pub busy: bool,
    /// Epoch milliseconds until which the account rests after a usage limit (0 = not resting).
    pub limited_until: u64,
    pub last_error: String,
}

pub struct ScriptAccounts {
    root: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    accounts: Vec<AccountEntry>,
    consent: bool,
}

impl ScriptAccounts {
    fn new(root: PathBuf) -> Self {
        let saved: Option<SavedAccounts> = std::fs::read_to_string(root.join("accounts.json")).ok().and_then(|t| serde_json::from_str(&t).ok());
        let (list, consent) = match saved {
            Some(saved) if !saved.accounts.is_empty() => {
                let consent = saved.consent;
                let accounts = saved
                    .accounts
                    .into_iter()
                    .filter(|a| !a.id.is_empty())
                    .map(|a| {
                        let chat = std::sync::Arc::new(ScriptChat::new(chat_dir(&root, &a.id)));
                        if consent {
                            chat.accept_consent();
                        }
                        AccountEntry { id: a.id, name: a.name, chat }
                    })
                    .collect();
                (accounts, consent)
            }
            _ => {
                // First run, or an install from before accounts existed: the original sign-in
                // becomes account 1, using its folder directly (nothing is moved or deleted).
                let chat = std::sync::Arc::new(ScriptChat::new(root.clone()));
                let consent = chat.status().consent;
                let accounts = vec![AccountEntry { id: "1".to_string(), name: "Claude 1".to_string(), chat }];
                (accounts, consent)
            }
        };
        let accounts = ScriptAccounts { root, inner: Mutex::new(Inner { accounts: list, consent }) };
        accounts.save();
        accounts
    }

    fn save(&self) {
        let inner = lock(&self.inner);
        let saved = SavedAccounts { accounts: inner.accounts.iter().map(|a| SavedAccount { id: a.id.clone(), name: a.name.clone() }).collect(), consent: inner.consent };
        if std::fs::create_dir_all(&self.root).is_ok() {
            if let Ok(text) = serde_json::to_string_pretty(&saved) {
                let _ = std::fs::write(self.root.join("accounts.json"), text);
            }
        }
    }

    fn status_of(&self, entry: &AccountEntry, consent: bool) -> ScriptAccountStatus {
        let status = entry.chat.status();
        ScriptAccountStatus { id: entry.id.clone(), name: entry.name.clone(), consent, connected: status.connected, signing_in: status.signing_in, busy: status.busy, limited_until: status.limited_until, last_error: status.last_error }
    }

    pub fn list(&self) -> Vec<ScriptAccountStatus> {
        let inner = lock(&self.inner);
        inner.accounts.iter().map(|a| self.status_of(a, inner.consent)).collect()
    }

    pub fn consent(&self) -> bool {
        lock(&self.inner).consent
    }

    pub fn accept_consent(&self) {
        {
            let mut inner = lock(&self.inner);
            inner.consent = true;
            for entry in &inner.accounts {
                entry.chat.accept_consent();
            }
        }
        self.save();
    }

    /// Adds an account. An empty name becomes "Claude N" for the next free number.
    pub fn add(&self, name: Option<String>) -> ScriptAccountStatus {
        let mut inner = lock(&self.inner);
        let id = next_account_id(&inner.accounts.iter().map(|a| a.id.clone()).collect::<Vec<_>>());
        let trimmed = name.unwrap_or_default().trim().to_string();
        let name = if trimmed.is_empty() { default_account_name(&id) } else { trimmed };
        let chat = std::sync::Arc::new(ScriptChat::new(chat_dir(&self.root, &id)));
        if inner.consent {
            chat.accept_consent();
        }
        let entry = AccountEntry { id, name, chat };
        let status = self.status_of(&entry, inner.consent);
        inner.accounts.push(entry);
        drop(inner);
        self.save();
        status
    }

    fn get(&self, id: &str) -> Result<std::sync::Arc<ScriptChat>, AppError> {
        lock(&self.inner)
            .accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.chat.clone())
            .ok_or_else(|| AppError::new("That Claude account was not found. It may have been deleted.", format!("account {id}")))
    }

    fn first(&self) -> Result<std::sync::Arc<ScriptChat>, AppError> {
        lock(&self.inner)
            .accounts
            .first()
            .map(|a| a.chat.clone())
            .ok_or_else(|| AppError::new("No Claude account has been added yet. Add one in Settings, Script writer.", "no Claude accounts"))
    }

    pub fn account_status(&self, id: &str) -> Result<ScriptAccountStatus, AppError> {
        let inner = lock(&self.inner);
        inner
            .accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| self.status_of(a, inner.consent))
            .ok_or_else(|| AppError::new("That Claude account was not found. It may have been deleted.", format!("account {id}")))
    }

    /// The old single-account status: the first account, with the shared consent flag.
    pub fn combined_status(&self) -> ScriptStatus {
        let inner = lock(&self.inner);
        match inner.accounts.first() {
            Some(entry) => {
                let mut status = entry.chat.status();
                status.consent = inner.consent;
                status
            }
            None => ScriptStatus { consent: inner.consent, ..Default::default() },
        }
    }

    /// Forgets one account's sign-in (its profile folder is deleted); the account row stays.
    pub fn disconnect(&self, id: &str) -> Result<ScriptAccountStatus, AppError> {
        let chat = self.get(id)?;
        chat.disconnect();
        self.account_status(id)
    }

    /// Deletes an account: its profile folder is deleted and the row is removed. Nothing else
    /// is touched, and no other account's profile is ever deleted.
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let chat = self.get(id)?;
        chat.disconnect();
        {
            let mut inner = lock(&self.inner);
            inner.accounts.retain(|a| a.id != id);
        }
        self.save();
        Ok(())
    }

    /// Tries the accounts in order, skipping resting ones. A usage limit or a signed-out account
    /// moves on to the next account; any other error returns at once.
    pub async fn ask_rotating(&self, browser: &BrowserChoice, config: &crate::imagegen::config::EngineConfig, prompt: &str, timeout: std::time::Duration, progress: chat::Progress<'_>) -> Result<ChatReply, GenError> {
        if !self.consent() {
            return Err(GenError::new(ErrorKind::BadRequest, "Please read and accept the notice about the script writer first (Settings, Script writer)."));
        }
        let chats: Vec<std::sync::Arc<ScriptChat>> = lock(&self.inner).accounts.iter().map(|a| a.chat.clone()).collect();
        if chats.is_empty() {
            return Err(GenError::new(ErrorKind::BadRequest, "No Claude account has been added yet. Add one in Settings, Script writer, then sign in."));
        }
        let now = engine::now_ms();
        let total = chats.len();
        let mut tried = 0usize;
        let mut earliest: Option<u64> = None;
        let mut any_signed_out = false;
        for chat in &chats {
            let status = chat.status();
            if status.limited_until > now {
                earliest = Some(match earliest {
                    Some(e) => e.min(status.limited_until),
                    None => status.limited_until,
                });
                continue;
            }
            tried += 1;
            match chat.ask(browser, config, prompt, timeout, progress).await {
                Ok(reply) => return Ok(reply),
                Err(error) => match error.kind {
                    ErrorKind::RateLimit => {
                        let status = chat.status();
                        if status.limited_until > now {
                            earliest = Some(match earliest {
                                Some(e) => e.min(status.limited_until),
                                None => status.limited_until,
                            });
                        }
                    }
                    ErrorKind::Auth => {
                        any_signed_out = true;
                    }
                    _ => return Err(error),
                },
            }
        }
        if let Some(until) = earliest {
            let minutes = until.saturating_sub(now).div_ceil(60_000).max(1);
            return Err(GenError::new(
                ErrorKind::RateLimit,
                format!("All {total} Claude account(s) are resting after a usage limit. The earliest one is ready again in about {minutes} minute(s), or sign in to another Claude account."),
            ));
        }
        if any_signed_out || tried > 0 {
            return Err(GenError::new(ErrorKind::Auth, "All Claude accounts are signed out. Open Settings, Script writer, and sign in to one of them."));
        }
        Err(GenError::new(ErrorKind::BadRequest, "No Claude account could be used. Open Settings, Script writer, and sign in to one of them."))
    }
}

/// The next account number: one more than the highest numeric id already used, so a deleted
/// account's number is never reused while a higher one exists.
fn next_account_id(ids: &[String]) -> String {
    (ids.iter().filter_map(|id| id.parse::<u32>().ok()).max().unwrap_or(0) + 1).to_string()
}

/// The name an account gets when the person types none.
fn default_account_name(id: &str) -> String {
    format!("Claude {id}")
}

/// Account 1 keeps the original `claude/` folder; later accounts get `claude/profiles/<id>/`.
fn chat_dir(root: &PathBuf, id: &str) -> PathBuf {
    if id == "1" {
        root.clone()
    } else {
        root.join("profiles").join(id)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn create(app: &AppHandle) -> Result<std::sync::Arc<ScriptAccounts>, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?.join("claude");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The script writer folder could not be created.", e.to_string()))?;
    Ok(std::sync::Arc::new(ScriptAccounts::new(dir)))
}

fn browser_of(ig: &ImageGen) -> Result<BrowserChoice, GenError> {
    let settings = ig.engine.settings();
    let exe = locator::find(Some(&settings.browser_path)).ok_or_else(|| {
        GenError::new(crate::imagegen::errors::ErrorKind::Session, "No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.")
    })?;
    Ok(BrowserChoice { exe, mode: mode_of(settings.browser_mode), extra_args: ig.browser_args() })
}

#[tauri::command]
pub async fn script_accounts(script: Script<'_>) -> Result<Vec<ScriptAccountStatus>, AppError> {
    Ok(script.list())
}

#[tauri::command]
pub async fn script_add_account(script: Script<'_>, name: Option<String>) -> Result<ScriptAccountStatus, AppError> {
    Ok(script.add(name))
}

#[tauri::command]
pub async fn script_delete_account(script: Script<'_>, id: String) -> Result<Vec<ScriptAccountStatus>, AppError> {
    script.remove(&id)?;
    Ok(script.list())
}

#[tauri::command]
pub async fn script_account_sign_in(script: Script<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, id: String) -> Result<ScriptAccountStatus, AppError> {
    let chat = script.get(&id)?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.sign_in(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    script.account_status(&id)
}

#[tauri::command]
pub async fn script_account_confirm_signed_in(script: Script<'_>, id: String) -> Result<(), AppError> {
    script.get(&id)?.confirm_signed_in();
    Ok(())
}

#[tauri::command]
pub async fn script_account_check(script: Script<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, id: String) -> Result<ScriptAccountStatus, AppError> {
    let chat = script.get(&id)?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.check(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    script.account_status(&id)
}

#[tauri::command]
pub async fn script_account_disconnect(script: Script<'_>, id: String) -> Result<ScriptAccountStatus, AppError> {
    script.disconnect(&id)
}

/// The old single-account commands, kept working as aliases to the first account, so Step 0
/// and any other caller keeps working unchanged.
#[tauri::command]
pub async fn script_status(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    Ok(script.combined_status())
}

#[tauri::command]
pub async fn script_accept_consent(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    script.accept_consent();
    Ok(script.combined_status())
}

/// Opens the person's own browser on Claude's sign-in page. Returns when the window is closed and the sign-in was checked.
#[tauri::command]
pub async fn script_sign_in(script: Script<'_>, ig: State<'_, std::sync::Arc<ImageGen>>) -> Result<ScriptStatus, AppError> {
    let chat = script.first()?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.sign_in(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    Ok(script.combined_status())
}

/// "I have signed in": closes the sign-in window.
#[tauri::command]
pub async fn script_confirm_signed_in(script: Script<'_>) -> Result<(), AppError> {
    script.first()?.confirm_signed_in();
    Ok(())
}

#[tauri::command]
pub async fn script_check(script: Script<'_>, ig: State<'_, std::sync::Arc<ImageGen>>) -> Result<ScriptStatus, AppError> {
    let chat = script.first()?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.check(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    Ok(script.combined_status())
}

#[tauri::command]
pub async fn script_disconnect(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    let first_id = lock(&script.inner).accounts.first().map(|a| a.id.clone()).ok_or_else(|| AppError::new("No Claude account has been added yet. Add one in Settings, Script writer.", "no Claude accounts"))?;
    script.disconnect(&first_id)?;
    Ok(script.combined_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_numbers_and_names_do_not_collide() {
        assert_eq!(next_account_id(&[]), "1");
        assert_eq!(next_account_id(&["1".to_string()]), "2");
        assert_eq!(next_account_id(&["1".to_string(), "3".to_string()]), "4");
        assert_eq!(default_account_name("2"), "Claude 2");
        assert_eq!(chat_dir(&PathBuf::from("/data/claude"), "1"), PathBuf::from("/data/claude"));
        assert_eq!(chat_dir(&PathBuf::from("/data/claude"), "2"), PathBuf::from("/data/claude/profiles/2"));
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptAnswer {
    pub text: String,
}

/// Writes one script: the prompt goes into a fresh Claude chat and the finished answer comes back. Can be cancelled.
/// The accounts are tried in order, moving on when one is limited or signed out.
#[tauri::command]
pub async fn script_ask(app: AppHandle, jobs: State<'_, JobRegistry>, script: Script<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, prompt: String, job_id: String) -> Result<ScriptAnswer, AppError> {
    let job = jobs.begin(&job_id, "script", event_sink(app))?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    job.progress("Asking Claude to write the script", 5.0);
    let report = |msg: String| job.progress(&msg, 30.0);
    let timeout = std::time::Duration::from_secs(MIN_ANSWER_WAIT_SECS);
    let reply = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        reply = script.ask_rotating(&browser, &config, &prompt, timeout, Some(&report)) => reply.map_err(|e| to_app_error(&e))?,
    };
    Ok(ScriptAnswer { text: reply.text })
}
