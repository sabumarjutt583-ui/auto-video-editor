//! Typed errors for calls to outside services, with friendly messages for the UI.

use crate::commands::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// The service rejected the API key (HTTP 401/403, or Gemini's "API key not valid").
    InvalidKey(String),
    /// Too many requests (HTTP 429), even after retrying.
    RateLimited(String),
    /// The service could not be reached: no internet, DNS, TLS or a timeout.
    Network(String),
    /// The service had a problem (HTTP 5xx), even after retrying.
    Server(String),
    /// Anything else: an unexpected status or an answer the app could not read.
    BadResponse(String),
}

impl ApiError {
    /// A sentence in simple English that is safe to show to the user.
    pub fn message(&self) -> &'static str {
        match self {
            ApiError::InvalidKey(_) => {
                "This API key was not accepted. Please check that you copied the whole key."
            }
            ApiError::RateLimited(_) => {
                "Rate limit reached. Please wait a little while and try again."
            }
            ApiError::Network(_) => {
                "Could not reach the service. Please check your internet connection and try again."
            }
            ApiError::Server(_) => {
                "The service is having problems right now. Please try again later."
            }
            ApiError::BadResponse(_) => {
                "The service sent an answer the app could not use. If you changed a model name, please check it."
            }
        }
    }

    /// Technical text for the "Details" toggle.
    pub fn details(&self) -> &str {
        match self {
            ApiError::InvalidKey(d)
            | ApiError::RateLimited(d)
            | ApiError::Network(d)
            | ApiError::Server(d)
            | ApiError::BadResponse(d) => d,
        }
    }

    pub(crate) fn map_details(self, change: impl FnOnce(String) -> String) -> Self {
        match self {
            ApiError::InvalidKey(d) => ApiError::InvalidKey(change(d)),
            ApiError::RateLimited(d) => ApiError::RateLimited(change(d)),
            ApiError::Network(d) => ApiError::Network(change(d)),
            ApiError::Server(d) => ApiError::Server(change(d)),
            ApiError::BadResponse(d) => ApiError::BadResponse(change(d)),
        }
    }

    /// Removes a secret (an API key) from the technical details, in case a service echoed it back.
    pub fn redact(self, secret: &str) -> Self {
        if secret.is_empty() {
            return self;
        }
        self.map_details(|details| details.replace(secret, "[key hidden]"))
    }
}

impl From<ApiError> for AppError {
    fn from(error: ApiError) -> Self {
        AppError::new(error.message(), error.details())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_removes_the_secret_from_details() {
        let error = ApiError::InvalidKey("Incorrect key provided: sk-secret-123 (try again)".into());
        let redacted = error.redact("sk-secret-123");
        assert_eq!(
            redacted.details(),
            "Incorrect key provided: [key hidden] (try again)"
        );
    }

    #[test]
    fn redact_with_empty_secret_changes_nothing() {
        let error = ApiError::Server("HTTP 500".into());
        assert_eq!(error.clone().redact(""), error);
    }

    #[test]
    fn redact_keeps_the_error_kind() {
        let error = ApiError::RateLimited("key abc".into()).redact("abc");
        assert!(matches!(error, ApiError::RateLimited(_)));
    }

    #[test]
    fn every_kind_has_its_own_friendly_message() {
        let messages = [
            ApiError::InvalidKey(String::new()).message(),
            ApiError::RateLimited(String::new()).message(),
            ApiError::Network(String::new()).message(),
            ApiError::Server(String::new()).message(),
            ApiError::BadResponse(String::new()).message(),
        ];
        for (i, a) in messages.iter().enumerate() {
            for b in &messages[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn converts_to_app_error_with_details() {
        let app: AppError = ApiError::Network("dns error".into()).into();
        assert_eq!(app.details, "dns error");
        assert!(app.message.contains("internet"));
    }
}
