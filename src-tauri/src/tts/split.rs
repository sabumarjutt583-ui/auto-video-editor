//! Cuts a script into pieces the voice model can read in one go. Pieces end at sentence ends.

/// How much one piece may "weigh". A letter weighs 1, a Korean / Japanese / Chinese character 2 (it carries more sound),
/// so a piece is about 1,200 English letters (a minute and a half of speech) or about 600 Korean characters.
pub const DEFAULT_BUDGET: f64 = 1200.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub text: String,
    /// The last sentence of this piece also ends a paragraph (a longer pause follows).
    pub paragraph_end: bool,
}

fn is_wide(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11FF | 0x3040..=0x30FF | 0x3130..=0x318F | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

pub fn weight(text: &str) -> f64 {
    text.chars().map(|c| if is_wide(c) { 2.0 } else { 1.0 }).sum()
}

fn is_end_mark(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？' | '؟' | '۔' | '।')
}

fn is_wide_end(c: char) -> bool {
    matches!(c, '。' | '！' | '？')
}

/// Sentences of one paragraph. A `.` only ends a sentence before a space or the end (so "3.5" stays whole).
fn sentences(paragraph: &str) -> Vec<String> {
    let chars: Vec<char> = paragraph.chars().collect();
    let mut out = Vec::new();
    let mut current = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        current.push(c);
        if is_end_mark(c) {
            // Keep closing quotes and further marks with the sentence.
            while i + 1 < chars.len() && (is_end_mark(chars[i + 1]) || matches!(chars[i + 1], '"' | '\'' | '”' | '’' | ')' | '」' | '』')) {
                i += 1;
                current.push(chars[i]);
            }
            let next = chars.get(i + 1);
            if next.is_none() || next.is_some_and(|n| n.is_whitespace()) || is_wide_end(c) {
                out.push(current.trim().to_string());
                current.clear();
            }
        }
        i += 1;
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out.retain(|s| !s.is_empty());
    out
}

/// A sentence that is too long alone is cut at commas, then at spaces, then anywhere.
fn cut_long(sentence: &str, budget: f64) -> Vec<String> {
    if weight(sentence) <= budget {
        return vec![sentence.to_string()];
    }
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut last_soft = 0usize;
    for c in sentence.chars() {
        current.push(c);
        if matches!(c, ',' | ';' | ':' | '、' | '，' | '；' | ' ') {
            last_soft = current.len();
        }
        if weight(&current) >= budget {
            let cut = if last_soft > 0 { last_soft } else { current.len() };
            let rest = current.split_off(cut);
            parts.push(current.trim().to_string());
            current = rest;
            last_soft = 0;
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts.retain(|p| !p.is_empty());
    parts
}

/// Cuts the script into pieces of at most `budget` weight (a single unbreakable sentence may be a little over).
pub fn split_script(script: &str, budget: f64) -> Vec<Chunk> {
    let budget = budget.max(50.0);
    let normalized = script.replace("\r\n", "\n").replace('\r', "\n");
    let mut pieces: Vec<(String, bool)> = Vec::new();
    for paragraph in normalized.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        let flat = paragraph.split('\n').map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
        let list: Vec<String> = sentences(&flat).into_iter().flat_map(|s| cut_long(&s, budget)).collect();
        let last = list.len().saturating_sub(1);
        for (index, sentence) in list.into_iter().enumerate() {
            pieces.push((sentence, index == last));
        }
    }
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current = String::new();
    let mut current_weight = 0.0;
    let mut paragraph_end = false;
    for (sentence, ends_paragraph) in pieces {
        let w = weight(&sentence);
        // +1 is the space that joins two sentences.
        if !current.is_empty() && current_weight + 1.0 + w > budget {
            chunks.push(Chunk { text: std::mem::take(&mut current), paragraph_end });
            current_weight = 0.0;
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&sentence);
        current_weight += w + if current_weight > 0.0 { 1.0 } else { 0.0 };
        paragraph_end = ends_paragraph;
    }
    if !current.is_empty() {
        chunks.push(Chunk { text: current, paragraph_end: true });
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_piece() {
        let chunks = split_script("Hello there. How are you?", DEFAULT_BUDGET);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Hello there. How are you?");
        assert!(chunks[0].paragraph_end);
    }

    #[test]
    fn pieces_end_at_sentence_ends_and_stay_in_order() {
        let script = (1..=40).map(|n| format!("This is sentence number {n} of the story.")).collect::<Vec<_>>().join(" ");
        let chunks = split_script(&script, 300.0);
        assert!(chunks.len() > 3);
        for chunk in &chunks {
            assert!(chunk.text.ends_with("story."), "{}", chunk.text);
            assert!(weight(&chunk.text) <= 300.0);
        }
        let joined = chunks.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ");
        assert_eq!(joined, script, "nothing is lost or reordered");
    }

    #[test]
    fn decimals_and_abbreviation_free_numbers_are_not_cut() {
        let s = sentences("The price rose by 3.5 percent. Then it fell.");
        assert_eq!(s, vec!["The price rose by 3.5 percent.".to_string(), "Then it fell.".to_string()]);
    }

    #[test]
    fn korean_counts_double_and_japanese_full_stops_split() {
        assert_eq!(weight("안녕"), 4.0);
        assert_eq!(weight("ab"), 2.0);
        let s = sentences("今日は雨です。明日は晴れです。");
        assert_eq!(s.len(), 2);
        let ko = "안녕하세요. 오늘은 날씨가 좋습니다. ".repeat(60);
        let chunks = split_script(&ko, 400.0);
        assert!(chunks.len() >= 3);
        assert!(chunks.iter().all(|c| weight(&c.text) <= 400.0));
    }

    #[test]
    fn a_very_long_sentence_is_cut_at_commas() {
        let long = format!("{}.", (1..=80).map(|n| format!("word{n}")).collect::<Vec<_>>().join(", "));
        let chunks = split_script(&long, 200.0);
        assert!(chunks.len() > 2);
        assert!(chunks.iter().all(|c| weight(&c.text) <= 210.0));
    }

    #[test]
    fn paragraph_ends_are_marked() {
        let script = "Alpha beta gamma delta epsilon zeta eta. Theta iota kappa lambda mu nu xi omicron.\n\nPi rho sigma tau.";
        let chunks = split_script(script, 50.0);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.iter().map(|c| c.paragraph_end).collect::<Vec<_>>(), vec![false, true, true]);
        assert_eq!(chunks[2].text, "Pi rho sigma tau.");
    }

    #[test]
    fn empty_script_has_no_pieces() {
        assert!(split_script("  \n\n ", DEFAULT_BUDGET).is_empty());
    }
}
