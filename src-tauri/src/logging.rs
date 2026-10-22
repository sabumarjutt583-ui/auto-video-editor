//! Log files in the app data folder: `app.log`, and up to 4 older ones (`app.1.log` ... `app.4.log`).
//!
//! What is written: when something goes wrong, the friendly message and a short technical text.
//! API keys are blanked out. Long texts (which could be parts of a script or a prompt) are cut short
//! unless Debug logging is turned on in Settings.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

const FILE: &str = "app.log";
const MAX_FILE_BYTES: u64 = 1_000_000;
const KEEP_OLD: usize = 4;
const SHORT: usize = 300;
const LONG: usize = 4000;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static DEBUG: AtomicBool = AtomicBool::new(false);
static WRITE: Mutex<()> = Mutex::new(());

/// Starts logging into `dir` (created if needed). Only the first call counts.
pub fn init(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    let _ = DIR.set(dir);
    info("app", &format!("Auto Video Editor {} started on {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS));
}

/// The log folder (None before `init`).
pub fn dir() -> Option<&'static Path> {
    DIR.get().map(PathBuf::as_path)
}

pub fn set_debug(on: bool) {
    DEBUG.store(on, Ordering::Relaxed);
}

fn is_secret_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '~' | '+' | '/' | '=')
}

/// Blanks out anything that looks like a key: `gsk_…` (Groq), `AIza…` (Google), `sk-…`,
/// the word after `Bearer `/`Token `, and the value of `key=` / `token=`.
pub fn redact(text: &str) -> String {
    let markers: [(&str, bool); 8] = [("gsk_", true), ("AIza", true), ("sk-", true), ("Bearer ", false), ("Token ", false), ("key=", false), ("token=", false), ("api_key\":\"", false)];
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    'scan: while !rest.is_empty() {
        for (marker, keep_marker_in_secret) in markers {
            if rest.starts_with(marker) {
                let after = &rest[marker.len()..];
                let secret_len = after.char_indices().find(|(_, c)| !is_secret_char(*c)).map_or(after.len(), |(i, _)| i);
                let secret_len = after[..secret_len].trim_end_matches('.').len();
                if secret_len >= 4 || keep_marker_in_secret && secret_len >= 8 {
                    out.push_str(if keep_marker_in_secret { "" } else { marker });
                    out.push_str("[hidden]");
                    rest = &after[secret_len..];
                    continue 'scan;
                }
            }
        }
        let c = rest.chars().next().unwrap_or(' ');
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

fn shorten(text: &str, limit: usize) -> String {
    let flat: String = text.chars().map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
    if flat.chars().count() <= limit {
        return flat;
    }
    format!("{}… (cut)", flat.chars().take(limit).collect::<String>())
}

/// The text of one log line for a message, with keys hidden and long text cut.
pub fn format_line(level: &str, target: &str, message: &str, debug: bool) -> String {
    let limit = if debug { LONG } else { SHORT };
    format!("{} {level:<5} [{target}] {}", crate::clock::timestamp(), shorten(&redact(message), limit))
}

fn rotate(dir: &Path) {
    let name = |n: usize| if n == 0 { dir.join(FILE) } else { dir.join(format!("app.{n}.log")) };
    let _ = fs::remove_file(name(KEEP_OLD));
    for n in (0..KEEP_OLD).rev() {
        let _ = fs::rename(name(n), name(n + 1));
    }
}

fn append(dir: &Path, line: &str) {
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let path = dir.join(FILE);
    if fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_FILE_BYTES) {
        rotate(dir);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

fn write(level: &str, target: &str, message: &str) {
    let Some(dir) = DIR.get() else { return };
    append(dir, &format_line(level, target, message, DEBUG.load(Ordering::Relaxed)));
}

pub fn info(target: &str, message: &str) {
    write("INFO", target, message);
}
pub fn warn(target: &str, message: &str) {
    write("WARN", target, message);
}
pub fn error(target: &str, message: &str) {
    write("ERROR", target, message);
}
/// Only written when Debug logging is on.
pub fn debug(target: &str, message: &str) {
    if DEBUG.load(Ordering::Relaxed) {
        write("DEBUG", target, message);
    }
}

/// Puts every log file (oldest first) into one text file in `dest_dir`, with a short header for support.
pub fn export(dir: &Path, dest_dir: &Path, header: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("{e} ({})", dest_dir.display()))?;
    let target = dest_dir.join(format!("auto-video-editor-logs-{}.txt", crate::clock::timestamp().replace([' ', ':'], "-")));
    let mut text = format!("{header}\n{}\n\n", "-".repeat(40));
    for n in (0..=KEEP_OLD).rev() {
        let path = if n == 0 { dir.join(FILE) } else { dir.join(format!("app.{n}.log")) };
        if let Ok(content) = fs::read_to_string(&path) {
            text.push_str(&redact(&content));
        }
    }
    fs::write(&target, text).map_err(|e| format!("{e} ({})", target.display()))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keys_are_hidden() {
        assert_eq!(redact("Incorrect API key provided: gsk_abcDEF1234567890xyz. Try again"), "Incorrect API key provided: [hidden]. Try again");
        assert_eq!(redact("https://x/y?key=AIzaSyA1234567890abcdefghij&z=1"), "https://x/y?key=[hidden]&z=1");
        assert_eq!(redact("Authorization: Bearer abc.def-123"), "Authorization: Bearer [hidden]");
        assert_eq!(redact("Token 0123456789abcdef"), "Token [hidden]");
        assert_eq!(redact("normal text, key words, sk"), "normal text, key words, sk");
        assert_eq!(redact("한국어 gsk_12345678 한국어"), "한국어 [hidden] 한국어");
        assert_eq!(redact(""), "");
    }

    #[test]
    fn long_texts_are_cut_unless_debug() {
        let long = "word ".repeat(200);
        assert!(format_line("INFO", "t", &long, false).chars().count() < 400);
        assert!(format_line("INFO", "t", &long, true).chars().count() > 900);
        assert!(!format_line("INFO", "t", "a\nb", false).contains('\n'));
    }

    #[test]
    fn files_rotate_and_keep_a_few() {
        let dir = temp("rotate");
        let big = "x".repeat(400_000);
        for _ in 0..30 {
            append(&dir, &big);
        }
        let mut names: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, vec!["app.1.log", "app.2.log", "app.3.log", "app.4.log", "app.log"]);
        assert!(fs::metadata(dir.join(FILE)).unwrap().len() < 2_000_000);
    }

    #[test]
    fn export_collects_the_files_in_order_without_keys() {
        let dir = temp("export-src");
        fs::write(dir.join("app.1.log"), "old line gsk_abcdefgh1234\n").unwrap();
        fs::write(dir.join("app.log"), "new line\n").unwrap();
        let out = temp("export-dst");
        let file = export(&dir, &out, "Auto Video Editor 0.1.0 (test)").unwrap();
        let text = fs::read_to_string(file).unwrap();
        assert!(text.starts_with("Auto Video Editor 0.1.0"));
        assert!(text.find("old line").unwrap() < text.find("new line").unwrap());
        assert!(!text.contains("gsk_abc"));
    }
}
