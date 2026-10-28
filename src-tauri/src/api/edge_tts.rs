//! Microsoft Edge TTS, called directly — no API key, no card, no account, no
//! model download, and no proxy server in between.
//!
//! How the direct call works (restated from public implementations of the same
//! protocol; no implementation was copied verbatim):
//! 1. The tool opens a WebSocket to Microsoft's Edge speech endpoint. It looks
//!    like an Edge browser (User-Agent + Origin headers) and carries a
//!    time-based security token, `Sec-MS-GEC`: the current time, rounded down
//!    to a 5-minute window, expressed in Windows ticks (100-nanosecond steps
//!    since 1601-01-01), concatenated with Microsoft's trusted client token,
//!    SHA-256 hashed, in uppercase hex. There is no secret to store.
//! 2. First message: `speech.config` JSON — MP3 output
//!    (`audio-24khz-48kbitrate-mono-mp3`), word boundaries on (so the app
//!    could time words), sentence boundaries off.
//! 3. Second message: SSML — the text wrapped in `<speak><voice
//!    name="..."><prosody rate volume>text</prosody></voice></speak>`, with
//!    XML characters escaped so a `<` in the script cannot break the document.
//! 4. The server streams audio chunks (`Path:audio`) until `Path:turn.end`.
//!    The tool collects the MP3 bytes and decodes them with the bundled
//!    FFmpeg sidecar into the same 24 kHz mono PCM the Gemini path produces,
//!    so the rest of the pipeline (piece cache, joining, Whisper timing) is
//!    identical for both providers.
//!
//! Edge TTS is UNOFFICIAL: Microsoft runs it for the Edge browser's Read
//! Aloud feature, not as a public API. It may change, limit, or block
//! requests at any time, with no guarantee. That is why the provider is
//! opt-in, clearly labelled, and never silently substituted for Gemini: if an
//! Edge call fails, the error names Edge TTS and the user switches provider
//! by hand. Pitch is deliberately not promised: upstream edge-tts removed
//! pitch control (6.x) because the endpoint ignores it; rate and volume are
//! the adjustable controls.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use std::process::Stdio;
use tokio_tungstenite::tungstenite::protocol::Message;

use super::client::{http, read_json, send};
use super::error::ApiError;
use crate::api::gemini_tts::Spoken;
use crate::library::hash::sha256_hex;

/// The Edge speech endpoint (WebSocket). The trailing part is built per call
/// with the trusted client token, a connection id, and the Sec-MS-GEC token.
const WS_BASE: &str = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/// The voice list endpoint (plain HTTPS GET).
const VOICES_URL: &str = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";
/// Microsoft's trusted client token, as used by public Edge TTS clients. It is
/// not a user secret: it is the same constant every Edge TTS client sends.
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB9E8145B1D5F5E5";
/// An Edge browser user agent, so the endpoint treats the call like Read Aloud.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const ORIGIN: &str = "https://www.bing.com";
const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
/// Reading one piece takes the service up to a couple of minutes at most.
const SPEAK_TIMEOUT: Duration = Duration::from_secs(240);
/// How long a fetched voice list is reused before it is fetched again.
const VOICE_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// One Microsoft voice, as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeVoice {
    /// e.g. `ko-KR-SunHiNeural`.
    pub name: String,
    /// e.g. `ko-KR`.
    pub locale: String,
    /// `Female`, `Male`, or empty when the list did not say.
    pub gender: String,
}

/// The built-in list (name, locale, gender), used only when the live list
/// cannot be fetched, so the voice picker is never empty. It is labelled a
/// fallback in the UI, not the full list (Microsoft lists hundreds of voices).
const FALLBACK: &[(&str, &str, &str)] = &[
    ("en-US-AriaNeural", "en-US", "Female"),
    ("en-US-GuyNeural", "en-US", "Male"),
    ("en-US-JennyNeural", "en-US", "Female"),
    ("es-ES-AlvaroNeural", "es-ES", "Male"),
    ("es-ES-ElviraNeural", "es-ES", "Female"),
    ("ko-KR-SunHiNeural", "ko-KR", "Female"),
    ("ko-KR-InJoonNeural", "ko-KR", "Male"),
];

/// The built-in fallback voices as owned values.
pub fn fallback_voices() -> Vec<EdgeVoice> {
    FALLBACK
        .iter()
        .map(|(name, locale, gender)| EdgeVoice {
            name: (*name).to_string(),
            locale: (*locale).to_string(),
            gender: (*gender).to_string(),
        })
        .collect()
}

/// The default Edge voice when nothing is chosen yet.
pub const DEFAULT_EDGE_VOICE: &str = "en-US-AriaNeural";

/// Escapes the five XML characters, so script text can never break the SSML.
pub fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Clamps a percent and formats it the way SSML prosody wants: `+0%`, `-20%`.
fn format_percent(value: i32, min: i32, max: i32) -> String {
    let clamped = value.clamp(min, max);
    if clamped >= 0 {
        format!("+{clamped}%")
    } else {
        format!("{clamped}%")
    }
}

/// Builds the SSML document for one piece. Rate is clamped to -50..+100 and
/// volume to -100..+100; anything outside is brought inside, never rejected.
pub fn build_ssml(voice: &str, rate: i32, volume: i32, text: &str) -> String {
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"en-US\"><voice name=\"{}\"><prosody rate=\"{}\" volume=\"{}\">{}</prosody></voice></speak>",
        voice,
        format_percent(rate, -50, 100),
        format_percent(volume, -100, 100),
        escape_xml(text)
    )
}

/// Windows ticks for a Unix time: 100-nanosecond steps since 1601-01-01.
pub fn windows_ticks(unix_secs: u64) -> u64 {
    unix_secs
        .saturating_mul(10_000_000)
        .saturating_add(116_444_736_000_000_000)
}

/// The Sec-MS-GEC token for a Unix time: ticks rounded DOWN to a 5-minute
/// window (300 seconds = 3,000,000,000 ticks), concatenated with the trusted
/// client token, SHA-256 hashed, uppercase hex.
pub fn sec_ms_gec(unix_secs: u64) -> String {
    let ticks = windows_ticks(unix_secs);
    let rounded = ticks - ticks % 3_000_000_000;
    sha256_hex(format!("{rounded}{TRUSTED_CLIENT_TOKEN}").as_bytes()).to_uppercase()
}

/// A date in RFC 1123 form, e.g. `Mon, 01 Jan 2024 00:00:00 GMT`, for the
/// `X-Timestamp` header. Implemented by hand so no date crate is needed.
pub fn rfc1123(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let secs = unix_secs % 86_400;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    let weekday = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    let month_name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(month - 1) as usize];
    format!(
        "{weekday}, {day:02} {month_name} {year:04} {:02}:{:02}:{:02} GMT",
        secs / 3_600,
        (secs % 3_600) / 60,
        secs % 60
    )
}

/// A unique-enough id for one request: time in nanoseconds plus a counter, so
/// two pieces never share an id even in the same nanosecond.
pub fn request_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{n:x}-{}", std::process::id())
}

/// The first message of a call: the output format and boundary settings.
pub fn config_message(timestamp: &str) -> String {
    format!(
        "X-Timestamp:{timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataOptions\":{{\"sentenceBoundaryEnabled\":false,\"wordBoundaryEnabled\":true}},\"outputFormat\":\"{OUTPUT_FORMAT}\"}}}}}}}}"
    )
}

/// The second message of a call: the SSML document, with its headers.
pub fn ssml_message(request: &str, timestamp: &str, ssml: &str) -> String {
    format!("X-Timestamp:{timestamp}\r\nX-RequestId:{request}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{ssml}")
}

/// Finds the header block of one WebSocket frame (`headers\r\n\r\npayload`).
fn header_end(frame: &[u8]) -> Option<usize> {
    frame.windows(4).position(|w| w == b"\r\n\r\n")
}

/// The audio bytes of one frame, when its headers say `Path:audio`.
pub fn extract_audio(frame: &[u8]) -> Option<&[u8]> {
    let end = header_end(frame)?;
    let header = std::str::from_utf8(&frame[..end]).ok()?;
    if header.contains("Path:audio") {
        Some(&frame[end + 4..])
    } else {
        None
    }
}

/// Whether one frame ends the turn (`Path:turn.end`).
pub fn is_turn_end(frame: &[u8]) -> bool {
    let Some(end) = header_end(frame) else { return false };
    std::str::from_utf8(&frame[..end]).map(|h| h.contains("Path:turn.end")).unwrap_or(false)
}

/// Whether a voice name looks like a Microsoft voice name (`ko-KR-SunHiNeural`:
/// letters, digits and dashes, at least one dash, at most 64 characters).
pub fn is_edge_voice(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.contains('-')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Parses the voice list answer: a JSON array of objects with `ShortName`,
/// `Locale` and `Gender`. Entries without a usable name are skipped.
pub fn parse_voices(answer: &serde_json::Value) -> Vec<EdgeVoice> {
    let Some(list) = answer.as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|item| {
            let name = item.get("ShortName")?.as_str()?;
            if !is_edge_voice(name) {
                return None;
            }
            Some(EdgeVoice {
                name: name.to_string(),
                locale: item.get("Locale").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                gender: item.get("Gender").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// Keeps only the voices for one language: `ko` matches `ko-KR`, `ko-KR`
/// matches exactly, and an empty language keeps everything.
pub fn filter_voices(voices: &[EdgeVoice], language: &str) -> Vec<EdgeVoice> {
    let language = language.trim().to_lowercase();
    if language.is_empty() {
        return voices.to_vec();
    }
    voices
        .iter()
        .filter(|v| {
            let locale = v.locale.to_lowercase();
            locale == language
                || (!language.contains('-') && locale.split('-').next() == Some(language.as_str()))
                || locale.starts_with(&format!("{language}-"))
        })
        .cloned()
        .collect()
}

static VOICE_CACHE: Mutex<Option<(Instant, Vec<EdgeVoice>)>> = Mutex::new(None);

fn cached_voices() -> Option<Vec<EdgeVoice>> {
    let guard = VOICE_CACHE.lock().ok()?;
    let (at, voices) = guard.as_ref()?;
    if at.elapsed() < VOICE_CACHE_TTL {
        Some(voices.clone())
    } else {
        None
    }
}

fn store_voices(voices: &[EdgeVoice]) {
    if let Ok(mut guard) = VOICE_CACHE.lock() {
        *guard = Some((Instant::now(), voices.to_vec()));
    }
}

/// Fetches the live voice list; on any failure returns the cached list, and
/// when there is none, the built-in fallback list. The caller can tell the
/// fallback apart because it is exactly `fallback_voices()`.
pub async fn voices() -> Vec<EdgeVoice> {
    let client = match http() {
        Ok(client) => client,
        Err(_) => return cached_voices().unwrap_or_else(|| fallback_voices()),
    };
    let url = format!("{VOICES_URL}?trustedclienttoken={TRUSTED_CLIENT_TOKEN}");
    let response = match send(|| {
        client
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .header("Origin", ORIGIN)
    })
    .await
    {
        Ok(response) => response,
        Err(_) => return cached_voices().unwrap_or_else(fallback_voices),
    };
    let Ok(answer) = read_json(response).await else {
        return cached_voices().unwrap_or_else(fallback_voices);
    };
    let parsed = parse_voices(&answer);
    if parsed.is_empty() {
        return cached_voices().unwrap_or_else(fallback_voices);
    }
    store_voices(&parsed);
    parsed
}

/// Decodes MP3 bytes into 24 kHz mono PCM with the bundled FFmpeg sidecar.
/// FFmpeg is already part of the tool, so no audio-decoding crate is needed.
async fn decode_mp3(mp3: &[u8]) -> Result<Spoken, ApiError> {
    let mut cmd = crate::ffmpeg::command(crate::ffmpeg::Tool::Ffmpeg)
        .map_err(|e| ApiError::Network(format!("Edge TTS: the video engine (FFmpeg) is missing, so the MP3 could not be decoded ({e}).")))?;
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg("pipe:0")
        .arg("-f")
        .arg("s16le")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("24000")
        .arg("pipe:1");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        ApiError::Network(format!("Edge TTS: FFmpeg could not be started to decode the MP3 ({e})."))
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(mp3).await;
        let _ = stdin.shutdown().await;
    }
    let out = child.wait_with_output().await.map_err(|e| {
        ApiError::Network(format!("Edge TTS: FFmpeg stopped while decoding the MP3 ({e})."))
    })?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr);
        let detail = detail.chars().take(300).collect::<String>();
        return Err(ApiError::BadResponse(format!(
            "Edge TTS: FFmpeg could not decode the MP3 audio ({detail})."
        )));
    }
    if out.stdout.len() < 2 {
        return Err(ApiError::BadResponse(
            "Edge TTS: the decoded audio came out empty.".to_string(),
        ));
    }
    Ok(Spoken { pcm: out.stdout, rate: 24_000 })
}

async fn speak_inner(voice: &str, rate: i32, volume: i32, text: &str) -> Result<Vec<u8>, ApiError> {
    if !is_edge_voice(voice) {
        return Err(ApiError::BadResponse(format!(
            "Edge TTS: \"{voice}\" is not a Microsoft voice name (expected something like ko-KR-SunHiNeural)."
        )));
    }
    if text.trim().is_empty() {
        return Err(ApiError::BadResponse("Edge TTS: there is no text to speak.".to_string()));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let token = sec_ms_gec(now);
    let connection = request_id();
    let url = format!(
        "{WS_BASE}?TrustedClientToken={TRUSTED_CLIENT_TOKEN}&ConnectionId={connection}&Sec-MS-GEC={token}&Sec-MS-GEC-Version=1"
    );
    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(url)
        .header("User-Agent", USER_AGENT)
        .header("Origin", ORIGIN)
        .header("Sec-MS-GEC", token)
        .header("Sec-MS-GEC-Version", "1")
        .body(())
        .map_err(|e| ApiError::Network(format!("Edge TTS: the call could not be built ({e}).")))?;
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.map_err(|e| {
        ApiError::Network(format!(
            "Edge TTS (Microsoft, free and unofficial) could not be reached. Check the internet connection; Microsoft may also have changed or limited the endpoint. ({e})"
        ))
    })?;
    let timestamp = rfc1123(now);
    let request = request_id();
    ws.send(Message::Text(config_message(&timestamp).into())).await.map_err(|e| {
        ApiError::Network(format!("Edge TTS: the connection broke while sending the settings ({e})."))
    })?;
    let ssml = build_ssml(voice, rate, volume, text);
    ws.send(Message::Text(ssml_message(&request, &timestamp, &ssml).into())).await.map_err(|e| {
        ApiError::Network(format!("Edge TTS: the connection broke while sending the text ({e})."))
    })?;
    let mut audio: Vec<u8> = Vec::new();
    loop {
        let Some(message) = ws.next().await else { break };
        let message = message.map_err(|e| {
            ApiError::Network(format!("Edge TTS: the connection broke while the audio was coming back ({e})."))
        })?;
        match message {
            Message::Text(text) => {
                let bytes = text.as_bytes();
                if let Some(chunk) = extract_audio(bytes) {
                    audio.extend_from_slice(chunk);
                }
                if is_turn_end(bytes) {
                    break;
                }
            }
            Message::Binary(bytes) => {
                if let Some(chunk) = extract_audio(&bytes) {
                    audio.extend_from_slice(chunk);
                }
                if is_turn_end(&bytes) {
                    break;
                }
            }
            Message::Ping(payload) => {
                let _ = ws.send(Message::Pong(payload)).await;
            }
            Message::Pong(_) => {}
            Message::Close(_) => break,
            Message::Frame(_) => {}
        }
    }
    let _ = ws.close(None).await;
    if audio.is_empty() {
        return Err(ApiError::BadResponse(
            "Edge TTS: Microsoft sent no audio for this text. The voice name may be wrong, or Microsoft may have changed or limited the endpoint.".to_string(),
        ));
    }
    Ok(audio)
}

/// Speaks one piece with a Microsoft voice: direct WebSocket call, then MP3
/// decoding, into the same `Spoken` shape the Gemini path returns.
pub async fn speak(voice: &str, rate: i32, volume: i32, text: &str) -> Result<Spoken, ApiError> {
    let mp3 = tokio::time::timeout(SPEAK_TIMEOUT, speak_inner(voice, rate, volume, text))
        .await
        .map_err(|_| {
            ApiError::Network(
                "Edge TTS: Microsoft did not answer in time. Try again, or switch to Gemini for this script.".to_string(),
            )
        })??;
    decode_mp3(&mp3).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn xml_characters_are_escaped() {
        assert_eq!(escape_xml("a<b & \"c\" 'd' >e"), "a&lt;b &amp; &quot;c&quot; &apos;d&apos; &gt;e");
    }

    #[test]
    fn ssml_wraps_voice_rate_volume_and_escaped_text() {
        let ssml = build_ssml("ko-KR-SunHiNeural", 20, -10, "Hello <world> & friends.");
        assert!(ssml.contains("name=\"ko-KR-SunHiNeural\""));
        assert!(ssml.contains("rate=\"+20%\""));
        assert!(ssml.contains("volume=\"-10%\""));
        assert!(ssml.contains("Hello &lt;world&gt; &amp; friends."));
        assert!(ssml.starts_with("<speak"));
        assert!(ssml.ends_with("</speak>"));
    }

    #[test]
    fn percent_clamps_to_the_endpoint_range() {
        assert_eq!(format_percent(0, -50, 100), "+0%");
        assert_eq!(format_percent(-50, -50, 100), "-50%");
        assert_eq!(format_percent(999, -50, 100), "+100%");
        assert_eq!(format_percent(-999, -50, 100), "-50%");
    }

    #[test]
    fn rfc1123_dates_are_correct() {
        assert_eq!(rfc1123(0), "Thu, 01 Jan 1970 00:00:00 GMT");
        assert_eq!(rfc1123(1_704_067_200), "Mon, 01 Jan 2024 00:00:00 GMT");
        assert_eq!(rfc1123(1_704_067_200 + 3661), "Mon, 01 Jan 2024 01:01:01 GMT");
    }

    #[test]
    fn the_security_token_is_stable_inside_one_window_and_changes_after_it() {
        // 5-minute window: two times in the same window give the same token.
        let first = sec_ms_gec(1_704_067_200);
        let same_window = sec_ms_gec(1_704_067_200 + 299);
        let next_window = sec_ms_gec(1_704_067_200 + 300);
        assert_eq!(first, same_window);
        assert_ne!(first, next_window);
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
    }

    #[test]
    fn config_and_ssml_messages_carry_the_right_paths() {
        let config = config_message("Mon, 01 Jan 2024 00:00:00 GMT");
        assert!(config.contains("Path:speech.config"));
        assert!(config.contains("audio-24khz-48kbitrate-mono-mp3"));
        assert!(config.contains("wordBoundaryEnabled\":true"));
        let message = ssml_message("req-1", "Mon, 01 Jan 2024 00:00:00 GMT", "<speak>x</speak>");
        assert!(message.contains("X-RequestId:req-1"));
        assert!(message.contains("Path:ssml"));
        assert!(message.ends_with("<speak>x</speak>"));
    }

    #[test]
    fn audio_chunks_are_collected_until_turn_end() {
        let audio_frame = b"X-RequestId:r\r\nPath:audio\r\n\r\n\x01\x02\x03";
        let other_frame = b"X-RequestId:r\r\nPath:turn.start\r\n\r\n";
        let end_frame = b"X-RequestId:r\r\nPath:turn.end\r\n\r\n";
        assert_eq!(extract_audio(audio_frame), Some(&[1, 2, 3][..]));
        assert_eq!(extract_audio(other_frame), None);
        assert!(!is_turn_end(audio_frame));
        assert!(is_turn_end(end_frame));
    }

    #[test]
    fn voice_names_are_checked_and_lists_filter_by_language() {
        assert!(is_edge_voice("ko-KR-SunHiNeural"));
        assert!(!is_edge_voice("Kore"));
        assert!(!is_edge_voice("ko KR SunHi"));
        assert!(!is_edge_voice(""));
        let answer = json!([
            { "ShortName": "ko-KR-SunHiNeural", "Locale": "ko-KR", "Gender": "Female" },
            { "ShortName": "es-ES-AlvaroNeural", "Locale": "es-ES", "Gender": "Male" },
            { "ShortName": "Kore", "Locale": "", "Gender": "" }
        ]);
        let voices = parse_voices(&answer);
        assert_eq!(voices.len(), 2);
        assert_eq!(filter_voices(&voices, "ko").len(), 1);
        assert_eq!(filter_voices(&voices, "ko-KR").len(), 1);
        assert_eq!(filter_voices(&voices, "es").len(), 1);
        assert_eq!(filter_voices(&voices, "").len(), 2);
        assert_eq!(filter_voices(&voices, "fr").len(), 0);
    }

    #[test]
    fn the_fallback_list_covers_the_channels_the_user_makes() {
        let voices = fallback_voices();
        assert!(voices.iter().any(|v| v.name == "ko-KR-SunHiNeural"));
        assert!(voices.iter().any(|v| v.name == "ko-KR-InJoonNeural"));
        assert!(voices.iter().any(|v| v.name == "es-ES-AlvaroNeural"));
    }
}
