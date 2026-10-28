//! The ChatGPT accounts for custom styles: ChatGPT's chat page, used only to study
//! reference pictures and write a style profile (see `imagegen::chatgpt`).
//!
//! Several ChatGPT accounts can be connected, like the Claude accounts for scripts: each
//! account has its own browser profile, so the person signs in to each one himself in the
//! tool's own browser window. The app never sees a password and never bypasses a sign-in
//! page or check. When a style question is asked, the accounts are tried in order: a resting
//! (limited) account is skipped, a limit or a signed-out account moves on to the next one,
//! and any other error returns at once (the same rule as the API-key rotation).
//!
//! The saved part (`chatgpt/accounts.json`) is only the id and the name of each account.
//! The sign-in itself lives in the account's browser profile, never in this file, and a
//! saved OpenAI API key (if one was ever saved) is left untouched in the keychain: it is
//! simply no longer used, because the OpenAI key option was removed from custom styles.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::commands::error::AppError;
use crate::imagegen::browser::locator;
use crate::imagegen::chat::{self, ChatReply};
use crate::imagegen::chatgpt::{BrowserChoice, ChatGptChat, ChatGptStatus};
use crate::imagegen::config::EngineConfig;
use crate::imagegen::errors::{ErrorKind, GenError};
use crate::imagegen::ops::{to_app_error, ImageGen};
use crate::imagegen::real::mode_of;
use std::time::Duration;

pub type ChatGpt<'a> = State<'a, std::sync::Arc<ChatGptAccounts>>;

/// One saved ChatGPT account: only its id and name are stored. The sign-in itself lives in
/// the account's browser profile, never in this file.
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
    chat: std::sync::Arc<ChatGptChat>,
}

/// One ChatGPT account as the Settings card shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptAccountStatus {
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

pub struct ChatGptAccounts {
    root: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    accounts: Vec<AccountEntry>,
    consent: bool,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn chat_dir(root: &PathBuf, id: &str) -> PathBuf {
    root.join("profiles").join(id)
}

impl ChatGptAccounts {
    fn new(root: PathBuf) -> Self {
        let saved: Option<SavedAccounts> = std::fs::read_to_string(root.join("accounts.json")).ok().and_then(|t| serde_json::from_str(&t).ok());
        let (list, consent) = match saved {
            Some(saved) => {
                let consent = saved.consent;
                let accounts = saved
                    .accounts
                    .into_iter()
                    .filter(|a| !a.id.is_empty())
                    .map(|a| {
                        let chat = std::sync::Arc::new(ChatGptChat::new(chat_dir(&root, &a.id)));
                        if consent {
                            chat.accept_consent();
                        }
                        AccountEntry { id: a.id, name: a.name, chat }
                    })
                    .collect();
                (accounts, consent)
            }
            None => (Vec::new(), false),
        };
        let accounts = ChatGptAccounts { root, inner: Mutex::new(Inner { accounts: list, consent }) };
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

    fn status_of(&self, entry: &AccountEntry, consent: bool) -> ChatGptAccountStatus {
        let status: ChatGptStatus = entry.chat.status();
        ChatGptAccountStatus { id: entry.id.clone(), name: entry.name.clone(), consent, connected: status.connected, signing_in: status.signing_in, busy: status.busy, limited_until: status.limited_until, last_error: status.last_error }
    }

    pub fn list(&self) -> Vec<ChatGptAccountStatus> {
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

    /// Adds an account. An empty name becomes "ChatGPT N" for the next free number.
    pub fn add(&self, name: Option<String>) -> ChatGptAccountStatus {
        let mut inner = lock(&self.inner);
        let id = next_account_id(&inner.accounts.iter().map(|a| a.id.clone()).collect::<Vec<_>>());
        let trimmed = name.unwrap_or_default().trim().to_string();
        let name = if trimmed.is_empty() { default_account_name(&id) } else { trimmed };
        let chat = std::sync::Arc::new(ChatGptChat::new(chat_dir(&self.root, &id)));
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

    fn get(&self, id: &str) -> Result<std::sync::Arc<ChatGptChat>, AppError> {
        lock(&self.inner)
            .accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.chat.clone())
            .ok_or_else(|| AppError::new("That ChatGPT account was not found. It may have been deleted.", format!("account {id}")))
    }

    pub fn account_status(&self, id: &str) -> Result<ChatGptAccountStatus, AppError> {
        let inner = lock(&self.inner);
        inner
            .accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| self.status_of(a, inner.consent))
            .ok_or_else(|| AppError::new("That ChatGPT account was not found. It may have been deleted.", format!("account {id}")))
    }

    /// The browser profile folder of one account, for the live view.
    pub fn profile_dir_for(&self, id: &str) -> Result<PathBuf, AppError> {
        let inner = lock(&self.inner);
        if inner.accounts.iter().any(|a| a.id == id) {
            Ok(chat_dir(&self.root, &id).join("profile"))
        } else {
            Err(AppError::new("That ChatGPT account was not found. It may have been deleted.", format!("account {id}")))
        }
    }

    /// Forgets one account's sign-in (its profile folder is deleted); the account row stays.
    pub fn disconnect(&self, id: &str) -> Result<ChatGptAccountStatus, AppError> {
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

    /// Tries the accounts in order, skipping resting ones. A usage limit or a signed-out
    /// account moves on to the next account; any other error returns at once.
    pub async fn ask_rotating(&self, browser: &BrowserChoice, config: &EngineConfig, prompt: &str, images: &[PathBuf], timeout: Duration, progress: chat::Progress<'_>) -> Result<ChatReply, GenError> {
        if !self.consent() {
            return Err(GenError::new(ErrorKind::BadRequest, "Please read and accept the notice about ChatGPT accounts first (Settings, ChatGPT accounts)."));
        }
        let chats: Vec<std::sync::Arc<ChatGptChat>> = lock(&self.inner).accounts.iter().map(|a| a.chat.clone()).collect();
        if chats.is_empty() {
            return Err(GenError::new(ErrorKind::BadRequest, "No ChatGPT account has been added yet. Add one in Settings, ChatGPT accounts, then sign in."));
        }
        let now = crate::imagegen::engine::now_ms();
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
            match chat.ask_with_images(browser, config, prompt, images, timeout, progress).await {
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
                format!("All {total} ChatGPT account(s) are resting after a usage limit. The earliest one is ready again in about {minutes} minute(s), or sign in to another ChatGPT account."),
            ));
        }
        if any_signed_out || tried > 0 {
            return Err(GenError::new(ErrorKind::Auth, "All ChatGPT accounts are signed out. Open Settings, ChatGPT accounts, and sign in to one of them."));
        }
        Err(GenError::new(ErrorKind::BadRequest, "No ChatGPT account could be used. Open Settings, ChatGPT accounts, and sign in to one of them."))
    }
}

/// The next account number: one more than the highest numeric id already used, so a deleted
/// account's number is never reused while a higher one exists.
fn next_account_id(ids: &[String]) -> String {
    (ids.iter().filter_map(|id| id.parse::<u32>().ok()).max().unwrap_or(0) + 1).to_string()
}

/// The name an account gets when the person types none.
fn default_account_name(id: &str) -> String {
    format!("ChatGPT {id}")
}

pub fn create(app: &AppHandle) -> Result<std::sync::Arc<ChatGptAccounts>, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?.join("chatgpt");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The ChatGPT folder could not be created.", e.to_string()))?;
    Ok(std::sync::Arc::new(ChatGptAccounts::new(dir)))
}

pub(crate) fn browser_of(ig: &ImageGen) -> Result<BrowserChoice, GenError> {
    let settings = ig.engine.settings();
    let exe = locator::find(Some(&settings.browser_path)).ok_or_else(|| {
        GenError::new(ErrorKind::Session, "No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.")
    })?;
    Ok(BrowserChoice { exe, mode: mode_of(settings.browser_mode), extra_args: ig.browser_args() })
}

#[tauri::command]
pub async fn chatgpt_accounts(chatgpt: ChatGpt<'_>) -> Result<Vec<ChatGptAccountStatus>, AppError> {
    Ok(chatgpt.list())
}

#[tauri::command]
pub async fn chatgpt_add_account(chatgpt: ChatGpt<'_>, name: Option<String>) -> Result<ChatGptAccountStatus, AppError> {
    Ok(chatgpt.add(name))
}

#[tauri::command]
pub async fn chatgpt_delete_account(chatgpt: ChatGpt<'_>, id: String) -> Result<Vec<ChatGptAccountStatus>, AppError> {
    chatgpt.remove(&id)?;
    Ok(chatgpt.list())
}

#[tauri::command]
pub async fn chatgpt_account_sign_in(chatgpt: ChatGpt<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, id: String) -> Result<ChatGptAccountStatus, AppError> {
    let chat = chatgpt.get(&id)?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.sign_in(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    chatgpt.account_status(&id)
}

#[tauri::command]
pub async fn chatgpt_account_confirm_signed_in(chatgpt: ChatGpt<'_>, id: String) -> Result<(), AppError> {
    chatgpt.get(&id)?.confirm_signed_in();
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_account_check(chatgpt: ChatGpt<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, id: String) -> Result<ChatGptAccountStatus, AppError> {
    let chat = chatgpt.get(&id)?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    chat.check(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    chatgpt.account_status(&id)
}

#[tauri::command]
pub async fn chatgpt_account_disconnect(chatgpt: ChatGpt<'_>, id: String) -> Result<ChatGptAccountStatus, AppError> {
    chatgpt.disconnect(&id)
}

#[tauri::command]
pub async fn chatgpt_account_set_limit(chatgpt: ChatGpt<'_>, id: String, until_ms: u64) -> Result<ChatGptAccountStatus, AppError> {
    let chat = chatgpt.get(&id)?;
    chat.set_limited_until(until_ms);
    chatgpt.account_status(&id)
}

#[tauri::command]
pub async fn chatgpt_accept_consent(chatgpt: ChatGpt<'_>) -> Result<Vec<ChatGptAccountStatus>, AppError> {
    chatgpt.accept_consent();
    Ok(chatgpt.list())
}

/// Opens one ChatGPT account's chat page in the person's own browser window, so the person
/// can watch it live. View-only: nothing is typed or clicked by the tool, and the window
/// stays open for the person to close. Uses the account's own browser profile.
#[tauri::command]
pub async fn chatgpt_open_live(chatgpt: ChatGpt<'_>, ig: State<'_, std::sync::Arc<ImageGen>>, account_id: Option<String>) -> Result<(), AppError> {
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    let id = match account_id {
        Some(id) => id,
        None => lock(&chatgpt.inner).accounts.first().map(|a| a.id.clone()).ok_or_else(|| AppError::new("No ChatGPT account has been added yet. Add one in Settings, ChatGPT accounts.", "no ChatGPT accounts"))?,
    };
    let profile = chatgpt.profile_dir_for(&id)?;
    let window = crate::imagegen::browser::signin::PlainWindow::open(&browser.exe, &profile, &config.chatgpt.url).await.map_err(|e| AppError::new("The ChatGPT page could not be opened.", e))?;
    // The window is left open for the person (dropping the handle does not close the browser).
    drop(window);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_numbers_are_never_reused_while_a_higher_one_exists() {
        assert_eq!(next_account_id(&[]), "1");
        assert_eq!(next_account_id(&["1".into(), "3".into()]), "4");
        assert_eq!(default_account_name("2"), "ChatGPT 2");
    }

    #[test]
    fn a_fresh_manager_starts_empty_and_accepts_consent() {
        let dir = std::env::temp_dir().join(format!("ave-chatgpt-accounts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = ChatGptAccounts::new(dir);
        assert!(manager.list().is_empty());
        assert!(!manager.consent());
        manager.accept_consent();
        assert!(manager.consent());
        let added = manager.add(None);
        assert_eq!(added.name, "ChatGPT 1");
        assert!(added.consent);
        assert_eq!(manager.list().len(), 1);
    }
}
