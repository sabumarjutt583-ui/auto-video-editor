//! File names that are safe on every system.

use std::path::Path;

const MAX_NAME: usize = 120;

/// The last part of `raw` made safe for Windows, macOS and Linux. `None` if nothing usable is left.
pub fn safe_file_name(raw: &str) -> Option<String> {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.starts_with('.') {
        return None;
    }
    let trimmed = trimmed.trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().count() <= MAX_NAME {
        return Some(trimmed);
    }
    // Keep the extension when shortening.
    let path = Path::new(&trimmed);
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let stem: String = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").chars().take(MAX_NAME - extension.chars().count() - 1).collect();
    Some(if extension.is_empty() { stem } else { format!("{stem}.{extension}") })
}

/// `name`, or `name (2).ext`, `name (3).ext`... when a file with that name is already in `dir`.
pub fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|e| e.to_str());
    for number in 2..10_000 {
        let candidate = match extension {
            Some(ext) => format!("{stem} ({number}).{ext}"),
            None => format!("{stem} ({number})"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_folders_and_bad_characters() {
        assert_eq!(safe_file_name("C:\\a\\b\\S01_000.0-005.1.png").as_deref(), Some("S01_000.0-005.1.png"));
        assert_eq!(safe_file_name("../../etc/pass:wd?.png").as_deref(), Some("pass_wd_.png"));
        assert_eq!(safe_file_name("  ..  "), None);
        assert_eq!(safe_file_name(".hidden.png"), None);
        assert_eq!(safe_file_name(""), None);
    }

    #[test]
    fn long_names_keep_their_extension() {
        let long = format!("{}.png", "a".repeat(300));
        let short = safe_file_name(&long).unwrap();
        assert!(short.chars().count() <= MAX_NAME);
        assert!(short.ends_with(".png"));
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = std::env::temp_dir().join("ave-names-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_name(&dir, "a.png"), "a.png");
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        assert_eq!(unique_name(&dir, "a.png"), "a (2).png");
        std::fs::write(dir.join("a (2).png"), b"x").unwrap();
        assert_eq!(unique_name(&dir, "a.png"), "a (3).png");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
