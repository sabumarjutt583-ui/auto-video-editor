//! Small text helpers for the ASS generator.

/// Scripts written without spaces between words (the same set the app's word splitter uses).
pub fn is_no_space(c: char) -> bool {
    matches!(c as u32,
        0x2E80..=0x2FDF | 0x3005..=0x3007 | 0x3021..=0x3029 | 0x3038..=0x303B | 0x3040..=0x30FF | 0x31F0..=0x31FF
        | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF66..=0xFF9F | 0x20000..=0x2FA1F
        | 0x0E00..=0x0E7F | 0x0E80..=0x0EFF | 0x1780..=0x17FF | 0x1000..=0x109F)
}

/// Joins words with a space, except between two characters of a no-space script (Chinese, Japanese, Thai...), like the app's `joinWords`.
pub fn join_words<'a>(words: impl IntoIterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for word in words {
        let word = word.trim();
        if word.is_empty() {
            continue;
        }
        if let (Some(last), Some(first)) = (out.chars().last(), word.chars().next()) {
            if !(is_no_space(last) && is_no_space(first)) {
                out.push(' ');
            }
        }
        out.push_str(word);
    }
    out
}

/// Makes text safe inside an ASS "Text" field: braces would start override tags.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '\n' | '\r' => out.push(' '),
            _ => out.push(c),
        }
    }
    out
}

/// "#RRGGBB" to the ASS color "&H00BBGGRR" (with an alpha byte: 00 opaque, FF clear).
pub fn color(hex: &str, alpha: u8) -> String {
    let digits = hex.trim().trim_start_matches('#');
    let value = if digits.len() == 6 { u32::from_str_radix(digits, 16).unwrap_or(0xFFFFFF) } else { 0xFFFFFF };
    let (r, g, b) = ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
    format!("&H{alpha:02X}{b:02X}{g:02X}{r:02X}")
}

/// Seconds to the ASS time "H:MM:SS.cc".
pub fn time(seconds: f64) -> String {
    let total = (seconds.max(0.0) * 100.0).round() as u64;
    let (cs, secs) = (total % 100, total / 100);
    format!("{}:{:02}:{:02}.{:02}", secs / 3600, (secs / 60) % 60, secs % 60, cs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_has_centiseconds_and_carries() {
        assert_eq!(time(0.0), "0:00:00.00");
        assert_eq!(time(3661.239), "1:01:01.24");
        assert_eq!(time(59.999), "0:01:00.00");
        assert_eq!(time(-3.0), "0:00:00.00");
    }

    #[test]
    fn colors_are_bgr() {
        assert_eq!(color("#FF8000", 0), "&H000080FF");
        assert_eq!(color("00ff00", 0x40), "&H4000FF00");
        assert_eq!(color("nonsense", 0), "&H00FFFFFF");
    }

    #[test]
    fn spaces_only_where_the_script_uses_them() {
        assert_eq!(join_words(["Hello", "world"]), "Hello world");
        assert_eq!(join_words(["안녕하세요", "여러분"]), "안녕하세요 여러분");
        assert_eq!(join_words(["今", "日", "は"]), "今日は");
        assert_eq!(join_words(["नमस्ते", "दुनिया"]), "नमस्ते दुनिया");
    }

    #[test]
    fn braces_and_newlines_are_escaped() {
        assert_eq!(escape("a {b} c\nd"), "a \\{b\\} c d");
    }
}
