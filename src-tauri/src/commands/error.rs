use serde::Serialize;

/// Error sent to the UI: a friendly sentence in simple English, plus the technical
/// text shown behind the "Details" toggle.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub message: String,
    pub details: String,
    /// A short machine-readable tag, e.g. "cancelled", so the UI can treat a few errors specially.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl AppError {
    pub fn new(message: impl Into<String>, details: impl Into<String>) -> Self {
        let error = Self { message: message.into(), details: details.into(), code: None };
        crate::logging::error("error", &format!("{} | {}", error.message, error.details));
        error
    }

    /// The user pressed Cancel.
    pub fn cancelled() -> Self {
        Self {
            message: "Cancelled.".to_string(),
            details: "The job was cancelled by the user.".to_string(),
            code: Some("cancelled".to_string()),
        }
    }
}
