//! Searching Freesound for CC0 sounds. The key lives only in the OS keychain.

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;

use crate::api::client::{http, read_json, secret_header, send};
use crate::api::error::ApiError;
use crate::commands::error::AppError;

const SERVICE: &str = "com.autovideoeditor.admin";
const ACCOUNT: &str = "freesound-api-key";
const API: &str = "https://freesound.org/apiv2/search/text/";
const PREVIEW_HOST: &str = "https://cdn.freesound.org/";
pub const MAX_DOWNLOAD_BYTES: usize = 20 * 1024 * 1024;

fn entry() -> Result<Entry, AppError> {
    Entry::new(SERVICE, ACCOUNT).map_err(keychain_error)
}

fn keychain_error(e: keyring::Error) -> AppError {
    AppError::new("The system keychain is not available, so the key could not be saved or read.", e.to_string())
}

pub fn save_key(raw: &str) -> Result<(), AppError> {
    let key = raw.trim();
    if key.is_empty() || key.len() > 200 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::new("Please paste only the Freesound key (no spaces).", "The key was empty or contained spaces."));
    }
    entry()?.set_password(key).map_err(keychain_error)
}

pub fn key_is_set() -> Result<bool, AppError> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(keychain_error(e)),
    }
}

pub fn delete_key() -> Result<(), AppError> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

fn require_key() -> Result<String, AppError> {
    entry()?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => AppError::new("Please save your Freesound key first.", "No Freesound key in the keychain."),
        other => keychain_error(other),
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundHit {
    pub id: u64,
    pub name: String,
    pub username: String,
    pub tags: Vec<String>,
    pub duration: f64,
    pub license: String,
    /// A small MP3 preview (https only).
    pub preview_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub total: u64,
    pub hits: Vec<SoundHit>,
}

/// Only the CC0 ("zero") licence is accepted, even if the server were to send something else.
pub fn is_cc0(license: &str) -> bool {
    license.contains("publicdomain/zero") || license.eq_ignore_ascii_case("Creative Commons 0")
}

pub fn parse_search(json: &Value) -> SearchPage {
    let hits = json
        .get("results")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let license = item.get("license")?.as_str()?.to_string();
                    let preview = item.pointer("/previews/preview-hq-mp3")?.as_str()?.to_string();
                    if !is_cc0(&license) || !allowed_preview(&preview) {
                        return None;
                    }
                    Some(SoundHit {
                        id: item.get("id")?.as_u64()?,
                        name: item.get("name")?.as_str()?.chars().take(120).collect(),
                        username: item.get("username").and_then(Value::as_str).unwrap_or_default().to_string(),
                        tags: item.get("tags").and_then(Value::as_array).map(|t| t.iter().filter_map(|v| v.as_str().map(str::to_string)).take(20).collect()).unwrap_or_default(),
                        duration: item.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
                        license,
                        preview_url: preview,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    SearchPage { total: json.get("count").and_then(Value::as_u64).unwrap_or(0), hits }
}

pub fn allowed_preview(url: &str) -> bool {
    url.starts_with(PREVIEW_HOST) && !url.contains(char::is_whitespace)
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The address of one search request.
pub fn search_url(query: &str, page: u32, max_seconds: f64) -> String {
    let filter = format!("license:\"Creative Commons 0\" duration:[0.05 TO {max_seconds}]");
    format!(
        "{API}?query={}&filter={}&fields=id,name,tags,duration,license,previews,username&page_size=15&page={}",
        url_encode(query.trim()),
        url_encode(&filter),
        page.max(1)
    )
}

pub async fn search(query: &str, page: u32) -> Result<SearchPage, AppError> {
    if query.trim().is_empty() || query.chars().count() > 100 {
        return Err(AppError::new("Please type a short search word, like \"whoosh\".", "empty or long query"));
    }
    let key = require_key()?;
    let auth = secret_header("Token ", &key)?;
    let url = search_url(query, page, 15.0);
    let client = http()?;
    let response = send(|| client.get(&url).header(reqwest::header::AUTHORIZATION, auth.clone())).await.map_err(|e| match e {
        ApiError::InvalidKey(d) => AppError::new("Freesound did not accept the key. Please check it.", d),
        other => other.into(),
    })?;
    Ok(parse_search(&read_json(response).await?))
}

/// Downloads one preview MP3 (only from Freesound's own server).
pub async fn download_preview(url: &str) -> Result<Vec<u8>, AppError> {
    if !allowed_preview(url) {
        return Err(AppError::new("That sound address is not from Freesound, so it was not downloaded.", url.to_string()));
    }
    let client = http()?;
    let mut response = send(|| client.get(url)).await?;
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| AppError::new("The download was interrupted. Please try again.", e.to_string()))? {
        data.extend_from_slice(&chunk);
        if data.len() > MAX_DOWNLOAD_BYTES {
            return Err(AppError::new("The sound file is too big.", url.to_string()));
        }
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cc0_sounds_with_freesound_previews_are_listed() {
        let json = serde_json::json!({"count": 3, "results": [
            {"id": 1, "name": "whoosh", "username": "a", "tags": ["fast"], "duration": 1.2, "license": "http://creativecommons.org/publicdomain/zero/1.0/", "previews": {"preview-hq-mp3": "https://cdn.freesound.org/previews/1/1_1-hq.mp3"}},
            {"id": 2, "name": "by", "license": "http://creativecommons.org/licenses/by/4.0/", "previews": {"preview-hq-mp3": "https://cdn.freesound.org/previews/2/2.mp3"}},
            {"id": 3, "name": "evil", "license": "http://creativecommons.org/publicdomain/zero/1.0/", "previews": {"preview-hq-mp3": "https://evil.example/x.mp3"}},
        ]});
        let page = parse_search(&json);
        assert_eq!(page.total, 3);
        assert_eq!(page.hits.len(), 1);
        assert_eq!(page.hits[0].id, 1);
    }

    #[test]
    fn the_search_address_asks_for_cc0_only_and_is_encoded() {
        let url = search_url("big hit!", 2, 15.0);
        assert!(url.contains("query=big%20hit%21"));
        assert!(url.contains("Creative%20Commons%200"));
        assert!(url.ends_with("&page=2"));
        assert!(!url.contains(' '));
    }

    #[test]
    fn downloads_are_limited_to_freesound() {
        assert!(allowed_preview("https://cdn.freesound.org/previews/1/2.mp3"));
        assert!(!allowed_preview("http://cdn.freesound.org/previews/1/2.mp3"));
        assert!(!allowed_preview("https://cdn.freesound.org.evil.com/x"));
    }
}
