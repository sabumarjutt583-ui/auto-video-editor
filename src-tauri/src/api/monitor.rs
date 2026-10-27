//! A short, recent list of API calls for the API Monitor view. Only the provider, the key
//! slot number, the time and the result are kept — never a key value, prompt or answer.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCall {
    /// Epoch milliseconds when the call was tried.
    pub time_ms: u64,
    /// "groq" | "gemini" | "openai".
    pub provider: String,
    /// Key slot number only (never the key itself).
    pub slot: u8,
    /// "ok" | "rate_limited" | "invalid_key" | "error".
    pub result: String,
    /// Short error kind, or "" on success.
    pub detail: String,
}

static CALLS: Mutex<VecDeque<ApiCall>> = Mutex::new(VecDeque::new);
const MAX_CALLS: usize = 200;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn record(provider: &str, slot: u8, result: &str, detail: &str) {
    let mut guard = match CALLS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.push_back(ApiCall { time_ms: now_ms(), provider: provider.to_string(), slot, result: result.to_string(), detail: detail.chars().take(80).collect() });
    while guard.len() > MAX_CALLS {
        guard.pop_front();
    }
}

pub fn list() -> Vec<ApiCall> {
    match CALLS.lock() {
        Ok(guard) => guard.iter().rev().cloned().collect(),
        Err(poisoned) => poisoned.into_inner().iter().rev().cloned().collect(),
    }
}
