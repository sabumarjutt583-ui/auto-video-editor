//! Opening a few fixed web pages in the system browser.
//!
//! The frontend sends a name, never an address, and only the pages listed here can be opened.

use std::process::Command;

use serde::Deserialize;

use crate::commands::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalLink {
    GroqKeys,
    GeminiKeys,
    CloudflareTokens,
}

impl ExternalLink {
    fn url(self) -> &'static str {
        match self {
            ExternalLink::GroqKeys => "https://console.groq.com/keys",
            ExternalLink::GeminiKeys => "https://aistudio.google.com/apikey",
            ExternalLink::CloudflareTokens => "https://dash.cloudflare.com/profile/api-tokens",
        }
    }
}

#[tauri::command]
pub fn open_external_link(link: ExternalLink) -> Result<(), AppError> {
    let url = link.url();
    open_in_browser(url).map_err(|error| {
        AppError::new(
            "The page could not be opened in your browser. You can copy the address and open it yourself.",
            format!("{url}: {error}"),
        )
    })
}

fn open_in_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    let mut child = command.spawn()?;
    // Wait in the background so the finished helper process does not linger.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_listed_key_pages_can_be_opened() {
        assert_eq!(ExternalLink::GroqKeys.url(), "https://console.groq.com/keys");
        assert_eq!(ExternalLink::GeminiKeys.url(), "https://aistudio.google.com/apikey");
        assert_eq!(ExternalLink::CloudflareTokens.url(), "https://dash.cloudflare.com/profile/api-tokens");
    }

    #[test]
    fn unknown_link_names_are_rejected() {
        assert!(serde_json::from_str::<ExternalLink>("\"groq_keys\"").is_ok());
        assert!(serde_json::from_str::<ExternalLink>("\"https://evil.example\"").is_err());
    }
}
