//! API Monitor: the recent API calls (provider, key slot number, time, result — never a key).

use crate::api::monitor::{self, ApiCall};
use crate::commands::error::AppError;

#[tauri::command]
pub async fn api_monitor_list() -> Result<Vec<ApiCall>, AppError> {
    Ok(monitor::list())
}
