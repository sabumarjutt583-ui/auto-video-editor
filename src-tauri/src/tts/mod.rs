//! Voice-over from text with Gemini's speech models.
//!
//! The script is cut into pieces (split.rs), every piece is spoken by the model, the finished pieces are kept in the
//! project (so a failed run continues where it stopped and nothing is paid for twice), then they are tidied
//! (wav.rs) and joined into one WAV file that the Voice step takes like any uploaded voice.

pub mod split;
pub mod voices;
pub mod wav;

use std::path::{Path, PathBuf};

use crate::library::hash::sha256_hex;

/// Target loudness of the speech parts of every piece (dBFS), so a quiet piece and a loud one match.
pub const TARGET_DB: f64 = -20.0;
/// Silence kept at the edges of a piece after trimming (ms).
const EDGE_MS: u32 = 60;
/// Pause between two pieces inside a paragraph, and where a paragraph ends (ms).
const GAP_MS: u32 = 180;
const PARAGRAPH_GAP_MS: u32 = 450;

/// The text sent to the model: the style note (if any) in front of the words. "Say in a calm, warm voice:" is how the speech models are directed.
pub fn spoken_text(style: &str, text: &str) -> String {
    let style = style.trim().trim_end_matches([':', '.']);
    if style.is_empty() {
        text.to_string()
    } else {
        format!("Say {style}:\n\n{text}")
    }
}

/// Names a finished piece: the same words, voice, model and style give the same name, so it is found again.
pub fn piece_key(model: &str, voice: &str, style: &str, text: &str) -> String {
    sha256_hex(format!("{model}\u{1f}{voice}\u{1f}{style}\u{1f}{text}").as_bytes())[..16].to_string()
}

pub fn piece_file(folder: &Path, index: usize, key: &str) -> PathBuf {
    folder.join(format!("piece_{:03}_{key}.wav", index + 1))
}

/// A finished piece from an earlier run (None when it is not there or cannot be read).
pub fn load_piece(folder: &Path, index: usize, key: &str) -> Option<(Vec<i16>, u32)> {
    let bytes = std::fs::read(piece_file(folder, index, key)).ok()?;
    wav::read_wav(&bytes).filter(|(samples, _)| !samples.is_empty())
}

pub fn save_piece(folder: &Path, index: usize, key: &str, samples: &[i16], rate: u32) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    let target = piece_file(folder, index, key);
    let temp = target.with_extension("tmp");
    std::fs::write(&temp, wav::wav_bytes(samples, rate))?;
    std::fs::rename(&temp, &target)
}

/// Removes pieces of other runs (other words, voice or model) and half-written files.
pub fn clean_folder(folder: &Path, keep: &[PathBuf]) {
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let ours = name.starts_with("piece_") && (name.ends_with(".wav") || name.ends_with(".tmp"));
        if ours && !keep.contains(&entry.path()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Tidies every piece (silence at the edges, same loudness) and joins them with pauses. `pieces` = samples and "a paragraph ends here".
pub fn assemble(pieces: &[(Vec<i16>, bool)], rate: u32) -> Vec<i16> {
    let mut out: Vec<i16> = Vec::new();
    for (index, (samples, paragraph_end)) in pieces.iter().enumerate() {
        let tidy = wav::match_loudness(&wav::trim_silence(samples, rate, EDGE_MS), TARGET_DB);
        out.extend_from_slice(&tidy);
        if index + 1 < pieces.len() {
            out.extend(wav::silence(rate, if *paragraph_end { PARAGRAPH_GAP_MS } else { GAP_MS }));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-tts-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn tone(len: usize, amp: i16) -> Vec<i16> {
        (0..len).map(|i| if i % 2 == 0 { amp } else { -amp }).collect()
    }

    #[test]
    fn the_style_note_goes_in_front() {
        assert_eq!(spoken_text("", "Hello."), "Hello.");
        assert_eq!(spoken_text("  ", "Hello."), "Hello.");
        assert_eq!(spoken_text("in a calm, warm voice.", "Hello."), "Say in a calm, warm voice:\n\nHello.");
    }

    #[test]
    fn a_piece_name_changes_with_everything_that_changes_the_sound() {
        let base = piece_key("m", "Kore", "", "Hello.");
        assert_eq!(base, piece_key("m", "Kore", "", "Hello."));
        assert_ne!(base, piece_key("m2", "Kore", "", "Hello."));
        assert_ne!(base, piece_key("m", "Puck", "", "Hello."));
        assert_ne!(base, piece_key("m", "Kore", "calm", "Hello."));
        assert_ne!(base, piece_key("m", "Kore", "", "Hello!"));
        assert_eq!(base.len(), 16);
    }

    #[test]
    fn finished_pieces_are_found_again_and_old_ones_are_cleaned() {
        let dir = temp("cache");
        save_piece(&dir, 0, "aaaa", &tone(500, 3000), 24_000).unwrap();
        save_piece(&dir, 1, "bbbb", &tone(500, 3000), 24_000).unwrap();
        std::fs::write(dir.join("piece_003_cccc.tmp"), b"half").unwrap();
        std::fs::write(dir.join("voice.wav"), b"keep me").unwrap();
        assert_eq!(load_piece(&dir, 0, "aaaa").unwrap().0.len(), 500);
        assert!(load_piece(&dir, 0, "zzzz").is_none());
        clean_folder(&dir, &[piece_file(&dir, 0, "aaaa")]);
        assert!(load_piece(&dir, 0, "aaaa").is_some());
        assert!(load_piece(&dir, 1, "bbbb").is_none());
        assert!(!dir.join("piece_003_cccc.tmp").exists());
        assert!(dir.join("voice.wav").exists(), "other files are never touched");
    }

    #[test]
    fn pieces_are_joined_with_pauses_and_the_same_loudness() {
        let rate = 24_000;
        let mut quiet = wav::silence(rate, 300);
        quiet.extend(tone(24_000, 1500));
        quiet.extend(wav::silence(rate, 300));
        let loud = tone(24_000, 12_000);
        let joined = assemble(&[(quiet, false), (loud, true), (tone(24_000, 6_000), true)], rate);
        let seconds = wav::seconds(&joined, rate);
        // 3 s of speech + two edge paddings on the first piece + a short pause + a paragraph pause + small paddings.
        assert!(seconds > 3.6 && seconds < 4.2, "{seconds}");
        let db = |from: usize, to: usize| wav::speech_rms_db(&joined[from..to]).unwrap();
        let (a, b) = (db(10_000, 20_000), db(40_000, 50_000));
        assert!((a - b).abs() < 1.0, "{a} {b}");
        assert!(assemble(&[], rate).is_empty());
    }
}
