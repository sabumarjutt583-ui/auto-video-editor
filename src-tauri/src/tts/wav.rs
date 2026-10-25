//! Raw voice samples from the model: tidy them (cut the silence at the edges, even out the loudness) and write WAV files.

pub const SAMPLE_RATE: u32 = 24_000;

/// The sample rate named in a mime type like `audio/L16;codec=pcm;rate=24000` (24000 when not named).
pub fn rate_from_mime(mime: &str) -> u32 {
    mime.split(';').filter_map(|part| part.trim().strip_prefix("rate=")).filter_map(|v| v.trim().parse::<u32>().ok()).next().filter(|r| (8_000..=96_000).contains(r)).unwrap_or(SAMPLE_RATE)
}

/// 16-bit little-endian mono PCM bytes to samples.
pub fn samples_from_pcm(bytes: &[u8]) -> Vec<i16> {
    bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
}

/// A mono 16-bit WAV file.
pub fn wav_bytes(samples: &[i16], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Reads a mono 16-bit WAV written by `wav_bytes` (or any plain PCM WAV). Returns the samples and the rate.
pub fn read_wav(bytes: &[u8]) -> Option<(Vec<i16>, u32)> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12;
    let mut rate = SAMPLE_RATE;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let len = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            rate = u32::from_le_bytes([bytes[body + 4], bytes[body + 5], bytes[body + 6], bytes[body + 7]]);
        }
        if id == b"data" {
            let end = (body + len).min(bytes.len());
            return Some((samples_from_pcm(&bytes[body..end]), rate));
        }
        pos = body + len + (len % 2);
    }
    None
}

/// Cuts silence from the start and end, keeping `keep_ms` of it.
pub fn trim_silence(samples: &[i16], rate: u32, keep_ms: u32) -> Vec<i16> {
    let threshold = 300i16; // about -40 dBFS
    let Some(first) = samples.iter().position(|s| s.abs() > threshold) else { return Vec::new() };
    let last = samples.iter().rposition(|s| s.abs() > threshold).unwrap_or(first);
    let keep = (rate as usize * keep_ms as usize) / 1000;
    let from = first.saturating_sub(keep);
    let to = (last + 1 + keep).min(samples.len());
    samples[from..to].to_vec()
}

/// Loudness of the speech parts in dBFS (RMS of the samples above the silence threshold). None when there is no speech.
pub fn speech_rms_db(samples: &[i16]) -> Option<f64> {
    let loud: Vec<f64> = samples.iter().filter(|s| s.abs() > 300).map(|s| f64::from(*s) / 32768.0).collect();
    if loud.len() < 100 {
        return None;
    }
    let mean_square = loud.iter().map(|v| v * v).sum::<f64>() / loud.len() as f64;
    Some(10.0 * mean_square.log10())
}

/// Scales the samples so the speech is about `target_db` loud, without clipping (the peak stays under 0.97).
pub fn match_loudness(samples: &[i16], target_db: f64) -> Vec<i16> {
    let Some(current) = speech_rms_db(samples) else { return samples.to_vec() };
    let peak = samples.iter().map(|s| f64::from(s.unsigned_abs())).fold(0.0, f64::max) / 32768.0;
    let mut gain = 10f64.powf((target_db - current) / 20.0);
    if peak * gain > 0.97 {
        gain = 0.97 / peak.max(1e-9);
    }
    samples.iter().map(|s| (f64::from(*s) * gain).round().clamp(-32768.0, 32767.0) as i16).collect()
}

/// `ms` of silence.
pub fn silence(rate: u32, ms: u32) -> Vec<i16> {
    vec![0; (rate as usize * ms as usize) / 1000]
}

pub fn seconds(samples: &[i16], rate: u32) -> f64 {
    samples.len() as f64 / f64::from(rate.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(len: usize, amp: i16) -> Vec<i16> {
        (0..len).map(|i| if i % 2 == 0 { amp } else { -amp }).collect()
    }

    #[test]
    fn rate_is_read_from_the_mime_type() {
        assert_eq!(rate_from_mime("audio/L16;codec=pcm;rate=24000"), 24_000);
        assert_eq!(rate_from_mime("audio/L16; rate=16000"), 16_000);
        assert_eq!(rate_from_mime("audio/wav"), SAMPLE_RATE);
        assert_eq!(rate_from_mime("audio/L16;rate=999999999"), SAMPLE_RATE);
    }

    #[test]
    fn wav_round_trips() {
        let samples = tone(100, 1000);
        let bytes = wav_bytes(&samples, 24_000);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 200);
        let (back, rate) = read_wav(&bytes).unwrap();
        assert_eq!((back, rate), (samples, 24_000));
        assert!(read_wav(b"not a wav file at all, really not a wav file at all!!").is_none());
    }

    #[test]
    fn silence_at_the_edges_is_trimmed_but_a_little_is_kept() {
        let mut samples = silence(1000, 500);
        samples.extend(tone(1000, 5000));
        samples.extend(silence(1000, 500));
        let trimmed = trim_silence(&samples, 1000, 40);
        assert_eq!(trimmed.len(), 1000 + 40 + 40);
        assert!(trim_silence(&silence(1000, 300), 1000, 40).is_empty());
    }

    #[test]
    fn loudness_is_matched_without_clipping() {
        let quiet = tone(2000, 1000);
        let loud = tone(2000, 12000);
        let target = -20.0;
        let a = speech_rms_db(&match_loudness(&quiet, target)).unwrap();
        let b = speech_rms_db(&match_loudness(&loud, target)).unwrap();
        assert!((a - target).abs() < 0.5 && (b - target).abs() < 0.5, "{a} {b}");
        let hot = tone(2000, 30000);
        let boosted = match_loudness(&hot, -1.0);
        assert!(boosted.iter().all(|s| s.abs() as f64 <= 0.97 * 32768.0 + 1.0));
        assert_eq!(match_loudness(&silence(1000, 100), -20.0), silence(1000, 100));
    }

    #[test]
    fn seconds_are_counted() {
        assert_eq!(seconds(&silence(24_000, 1500), 24_000), 1.5);
    }
}
