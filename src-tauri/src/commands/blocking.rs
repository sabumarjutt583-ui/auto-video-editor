use crate::commands::error::AppError;

/// Runs slow synchronous work (keychain, disk) off the main thread so the UI never freezes.
pub async fn run_blocking<T, F>(job: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| AppError::new("Something went wrong inside the app.", error.to_string()))?
}
