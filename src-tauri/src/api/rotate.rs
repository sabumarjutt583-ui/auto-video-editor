//! Several keys of one provider: a call goes to the first saved key that is not resting.
//! When that key hits its usage limit (or is refused) it rests and the next key is tried.

use std::future::Future;

use crate::api::error::ApiError;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::keys::{self, Candidate, Provider};

/// Runs `call` with the saved keys of `provider` until one works.
/// Only "limit reached" and "key refused" move on to the next key; any other error is returned at once
/// (a second key would not help against a network problem).
pub async fn run<T, F, Fut>(provider: Provider, call: F) -> Result<T, AppError>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<T, ApiError>>,
{
    let candidates = run_blocking(move || keys::candidates(provider)).await?;
    if candidates.is_empty() {
        return Err(AppError::new(
            "No key is saved yet. Please paste your key and press Save first.",
            "The keychain has no entry for this provider.",
        ));
    }
    run_with(provider, candidates, call).await
}

/// Same as `run`, but the error keeps its kind (for callers that retry some kinds).
pub async fn run_api<T, F, Fut>(provider: Provider, call: F) -> Result<T, ApiError>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<T, ApiError>>,
{
    let candidates = run_blocking(move || keys::candidates(provider))
        .await
        .map_err(|e| ApiError::BadResponse(format!("the keys could not be read: {}", e.details)))?;
    if candidates.is_empty() {
        return Err(ApiError::InvalidKey("no key is saved for this provider".into()));
    }
    try_keys(provider, candidates, call).await
}

/// Same as `run`, with the list of keys given (so tests need no keychain).
pub async fn run_with<T, F, Fut>(provider: Provider, candidates: Vec<Candidate>, call: F) -> Result<T, AppError>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<T, ApiError>>,
{
    try_keys(provider, candidates, call).await.map_err(Into::into)
}

async fn try_keys<T, F, Fut>(provider: Provider, candidates: Vec<Candidate>, mut call: F) -> Result<T, ApiError>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<T, ApiError>>,
{
    let count = candidates.len();
    let mut first_problem: Option<ApiError> = None;
    for Candidate { slot, key } in candidates {
        match call(key.clone()).await {
            Ok(value) => {
                keys::worked(provider, slot);
                return Ok(value);
            }
            Err(error) => {
                let error = error.redact(&key);
                match &error {
                    ApiError::RateLimited(_) => {
                        keys::rest(provider, slot);
                    }
                    ApiError::InvalidKey(_) => keys::rest_long(provider, slot),
                    _ => return Err(with_key_number(error, slot, count)),
                }
                first_problem.get_or_insert_with(|| with_key_number(error, slot, count));
            }
        }
    }
    let problem = first_problem.unwrap_or_else(|| ApiError::BadResponse("no key was tried".into()));
    Err(if count > 1 { problem.map_details(|d| format!("All {count} keys were tried. {d}")) } else { problem })
}

fn with_key_number(error: ApiError, slot: u8, count: usize) -> ApiError {
    if count <= 1 {
        return error;
    }
    let tag = |d: String| format!("key {slot}: {d}");
    match error {
        ApiError::InvalidKey(d) => ApiError::InvalidKey(tag(d)),
        ApiError::RateLimited(d) => ApiError::RateLimited(tag(d)),
        ApiError::Network(d) => ApiError::Network(tag(d)),
        ApiError::Server(d) => ApiError::Server(tag(d)),
        ApiError::BadResponse(d) => ApiError::BadResponse(tag(d)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn list(provider_slots: &[u8]) -> Vec<Candidate> {
        provider_slots.iter().map(|&slot| Candidate { slot, key: format!("secret-{slot}") }).collect()
    }

    #[tokio::test]
    async fn a_limited_key_rests_and_the_next_key_is_used() {
        let used = Mutex::new(Vec::new());
        let result = run_with(Provider::Gemini, list(&[7, 8]), |key| {
            used.lock().unwrap().push(key.clone());
            async move { if key == "secret-7" { Err(ApiError::RateLimited("quota".into())) } else { Ok("fine") } }
        })
        .await;
        assert_eq!(result.unwrap(), "fine");
        assert_eq!(*used.lock().unwrap(), vec!["secret-7", "secret-8"]);
        assert!(keys::resting_seconds(Provider::Gemini, 7) > 0);
        assert_eq!(keys::resting_seconds(Provider::Gemini, 8), 0);
        keys::worked(Provider::Gemini, 7);
    }

    #[tokio::test]
    async fn a_refused_key_moves_on_and_a_network_problem_does_not() {
        let result: Result<(), AppError> = run_with(Provider::Groq, list(&[6, 7]), |key| async move {
            if key == "secret-6" { Err(ApiError::InvalidKey("bad".into())) } else { Err(ApiError::Network("offline".into())) }
        })
        .await;
        let error = result.unwrap_err();
        assert!(error.details.contains("key 7"), "{}", error.details);
        assert!(keys::resting_seconds(Provider::Groq, 6) > 3000);
        assert_eq!(keys::resting_seconds(Provider::Groq, 7), 0);
        keys::worked(Provider::Groq, 6);
    }

    #[tokio::test]
    async fn when_every_key_is_limited_the_first_problem_is_shown_without_any_key() {
        let result: Result<(), AppError> =
            run_with(Provider::Groq, list(&[4, 5]), |key| async move { Err(ApiError::RateLimited(format!("limit for {key}"))) }).await;
        let error = result.unwrap_err();
        assert!(error.details.starts_with("All 2 keys were tried."), "{}", error.details);
        assert!(error.message.contains("Rate limit"));
        assert!(!error.details.contains("secret-4"), "{}", error.details);
        keys::worked(Provider::Groq, 4);
        keys::worked(Provider::Groq, 5);
    }
}
