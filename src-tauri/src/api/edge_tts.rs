//! Microsoft Edge TTS, called directly — no API key, no card, no account, no
//! model download, and no proxy server in between.
//!
//! Transport is implemented here; the v2 token module has separate upstream
//! attribution and licensing. The direct call works as follows:
//! 1. The tool opens a WebSocket to Microsoft's Edge speech endpoint. It looks
//!    like an Edge browser (User-Agent + Origin headers) and carries a
//!    time-based security token, `Sec-MS-GEC`: the current time, rounded down
//!    to a 5-minute window, expressed in Windows ticks (100-nanosecond steps
//!    since 1601-01-01), concatenated with Microsoft's trusted client token,
//!    hashed using the current client's v2 CS64/SHA-256 digest format.
//!    See edge_token.rs for source attribution. There is no user secret to store.
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
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use super::client::{http, read_json, send};
use super::error::ApiError;
use crate::api::gemini_tts::Spoken;

/// The Edge speech endpoint (WebSocket). The trailing part is built per call
/// with the trusted client token, a connection id, and the Sec-MS-GEC token.
const WS_BASE: &str = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/// The voice list endpoint (plain HTTPS GET).
const VOICES_URL: &str = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";
/// Microsoft's trusted client token, as used by public Edge TTS clients. It is
/// not a user secret: it is the same constant every Edge TTS client sends.
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Public client protocol parameters, checked against the maintained v2 client.
// Keep endpoint, version, token and subprotocol together when updating.
const SEC_MS_GEC_VERSION: &str = "2-143.0.3650.75";
/// An Edge browser user agent, so the endpoint treats the call like Read Aloud.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
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
    let parts: Vec<&str> = voice.splitn(3, '-').collect();
    let name = if parts.len() == 3 {
        format!("Microsoft Server Speech Text to Speech Voice ({}-{}, {})", parts[0], parts[1], parts[2])
    } else { voice.to_string() };
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"en-US\"><voice name=\"{}\"><prosody rate=\"{}\" volume=\"{}\">{}</prosody></voice></speak>",
        escape_xml(&name),
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
/// client token, in the v2 uppercase CS64-SHA256 format.
pub fn sec_ms_gec(unix_secs: u64) -> String {
    let ticks = windows_ticks(unix_secs);
    let rounded = ticks - ticks % 3_000_000_000;
    super::edge_token::token(format!("{rounded}{TRUSTED_CLIENT_TOKEN}").as_bytes())
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
    format!("{:032x}", nanos ^ (u128::from(n) << 64) ^ (u128::from(std::process::id()) << 32))
}

fn speech_timestamp(unix_secs: u64) -> String {
    let date = rfc1123(unix_secs);
    // The service uses JavaScript Date.toString(), not an HTTP date.
    format!("{} {} {} {} {} GMT+0000 (Coordinated Universal Time)", &date[..3], &date[8..11], &date[5..7], &date[12..16], &date[17..25])
}

/// The first message of a call: the output format and boundary settings.
pub fn config_message(timestamp: &str) -> String {
    format!(
        "X-Timestamp:{timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"}},\"outputFormat\":\"{OUTPUT_FORMAT}\"}}}}}}}}\r\n"
    )
}

/// The second message of a call: the SSML document, with its headers.
pub fn ssml_message(request: &str, timestamp: &str, ssml: &str) -> String {
    format!("X-RequestId:{request}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{timestamp}Z\r\nPath:ssml\r\n\r\n{ssml}")
}

/// Finds the header block of one WebSocket frame (`headers\r\n\r\npayload`).
fn header_end(frame: &[u8]) -> Option<usize> {
    frame.windows(4).position(|w| w == b"\r\n\r\n")
}

/// The audio bytes of one frame, when its headers say `Path:audio`.
pub fn extract_audio(frame: &[u8]) -> Option<&[u8]> {
    let end = header_end(frame)?;
    let header = std::str::from_utf8(&frame[..end]).ok()?;
    if header.lines().any(|line| line.trim() == "Path:audio") {
        Some(&frame[end + 4..])
    } else {
        None
    }
}

/// Binary speech frames start with a two-byte big-endian header length.
/// That prefix is not UTF-8 and the header need not have a blank-line separator.
fn extract_binary_audio(frame: &[u8]) -> Option<&[u8]> {
    let size = u16::from_be_bytes(frame.get(..2)?.try_into().ok()?) as usize;
    let end = 2 + size;
    let header = std::str::from_utf8(frame.get(2..end)?).ok()?;
    header.lines().any(|line| line.trim() == "Path:audio").then(|| &frame[end..])
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
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| {
        ApiError::Network(format!("Edge TTS: FFmpeg could not be started to decode the MP3 ({e})."))
    })?;
    let stdin = child.stdin.take();
    // Feed MP3 and drain PCM concurrently: either pipe can fill for long speech.
    let feed = async move {
        if let Some(mut stdin) = stdin {
            stdin.write_all(mp3).await?;
            stdin.shutdown().await?;
        }
        Ok::<(), std::io::Error>(())
    };
    let (written, output) = tokio::join!(feed, child.wait_with_output());
    let out = output.map_err(|e| {
        ApiError::Network(format!("Edge TTS: FFmpeg stopped while decoding the MP3 ({e})."))
    })?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr);
        let detail = detail.chars().take(300).collect::<String>();
        return Err(ApiError::BadResponse(format!(
            "Edge TTS: FFmpeg could not decode the MP3 audio ({detail})."
        )));
    }
    written.map_err(|e| ApiError::Network(format!("Edge TTS: audio could not be sent to FFmpeg ({e}).")))?;
    if out.stdout.len() < 2 {
        return Err(ApiError::BadResponse(
            "Edge TTS: the decoded audio came out empty.".to_string(),
        ));
    }
    Ok(Spoken { pcm: out.stdout, rate: 24_000 })
}

fn speech_request(url: &str, token: &str) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, ApiError> {
    // A hand-built Request is passed through unchanged by tungstenite. Start
    // from its URL conversion so Host/Upgrade/version/key are all present.
    let mut request = url.into_client_request()
        .map_err(|e| ApiError::Network(format!("Edge TTS: the call could not be built ({e}).")))?;
    for (name, value) in [("user-agent", USER_AGENT), ("origin", ORIGIN), ("sec-ms-gec", token), ("sec-ms-gec-version", SEC_MS_GEC_VERSION)] {
        request.headers_mut().insert(name, value.parse()
            .map_err(|e| ApiError::Network(format!("Edge TTS: an invalid request header ({e}).")))?);
    }
    Ok(request)
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
        "{WS_BASE}?TrustedClientToken={TRUSTED_CLIENT_TOKEN}&ConnectionId={connection}&Sec-MS-GEC={token}&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    );
    let request = speech_request(&url, &token)?;
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.map_err(|e| {
        if let tokio_tungstenite::tungstenite::Error::Http(response) = &e {
            let status = response.status().as_u16();
            if status == 401 || status == 403 {
                return ApiError::BadResponse(format!(
                    "Edge TTS: Microsoft rejected this speech connection (HTTP {status}). No audio was generated. This is a service rejection, not a missing Gemini API key. Try another configured voice provider."
                ));
            }
        }
        ApiError::Network(format!(
            "Edge TTS (Microsoft, free and unofficial) could not be reached. Check the internet connection; Microsoft may also have changed or limited the endpoint. ({e})"
        ))
    })?;
    let timestamp = speech_timestamp(now);
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
                if let Some(chunk) = extract_binary_audio(&bytes) {
                    audio.extend_from_slice(chunk);
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

    /// Retain the provider bytes so decoder faults can be separated from synthesis faults.
    #[tokio::test]
    #[ignore = "live diagnostic; writes only to AVE_LIVE_EDGE_OUTPUT"]
    async fn live_edge_capture_source() {
        let folder = std::path::PathBuf::from(std::env::var_os("AVE_LIVE_EDGE_OUTPUT").expect("output folder"));
        std::fs::create_dir_all(&folder).unwrap();
        let text = "안녕하세요. 오늘은 음성 품질을 확인합니다. 문장의 시작과 끝에서 소리가 깨지지 않는지 확인해 주세요. 자연스럽고 깨끗한 목소리로 이야기를 계속합니다.";
        let mp3 = tokio::time::timeout(SPEAK_TIMEOUT, speak_inner("ko-KR-InJoonNeural", 0, 0, text)).await.unwrap().unwrap();
        std::fs::write(folder.join("injoon-source.mp3"), &mp3).unwrap();
        assert!(crate::ffmpeg_job::sidecars_for_tests());
        let spoken = decode_mp3(&mp3).await.unwrap();
        let samples = crate::tts::wav::samples_from_pcm(&spoken.pcm);
        std::fs::write(folder.join("injoon-decoded.wav"), crate::tts::wav::wav_bytes(&samples, spoken.rate)).unwrap();
        eprintln!("captured {} MP3 bytes, {} PCM samples", mp3.len(), samples.len());
    }

    #[tokio::test]
    async fn long_mp3_is_fed_and_decoded_without_a_pipe_deadlock() {
        assert!(crate::ffmpeg_job::sidecars_for_tests(), "install the FFmpeg sidecar before this integration test");
        let output = crate::ffmpeg::command(crate::ffmpeg::Tool::Ffmpeg).unwrap()
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=45", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"])
            .output().await.unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(output.stdout.len() > 128 * 1024);
        let speech = tokio::time::timeout(Duration::from_secs(15), decode_mp3(&output.stdout)).await.expect("decoder must drain both pipes").unwrap();
        assert!(speech.pcm.len() > 40 * 24000 * 2);
    }

    #[test]
    fn speech_requests_include_standard_websocket_and_provider_headers() {
        let request = speech_request("wss://example.com/speech", "ABC123").unwrap();
        assert_eq!(request.headers()["host"], "example.com");
        assert_eq!(request.headers()["connection"], "Upgrade");
        assert_eq!(request.headers()["upgrade"], "websocket");
        assert_eq!(request.headers()["sec-websocket-version"], "13");
        assert_eq!(request.headers()["sec-websocket-key"].as_bytes().len(), 24);
        assert_eq!(request.headers()["sec-ms-gec"], "ABC123");
        assert_eq!(request.headers()["origin"], ORIGIN);
        assert_eq!(request.headers()["sec-ms-gec-version"], SEC_MS_GEC_VERSION);
        let id = request_id();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(speech_timestamp(0), "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)");
    }

    #[test]
    fn real_binary_frames_use_length_prefix_and_preserve_only_audio_payload() {
        let header = format!("X-RequestId:{}\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n", "a".repeat(100));
        let mut frame = (header.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(header.as_bytes());
        frame.extend_from_slice(&[0xff, 0xfb, 0, 7]);
        assert_eq!(extract_binary_audio(&frame), Some(&[0xff, 0xfb, 0, 7][..]));
        assert_eq!(extract_binary_audio(&[]), None);
        assert_eq!(extract_binary_audio(&[0, 30, 1]), None);
        let header = b"Path:audio.metadata\r\n";
        let mut metadata = (header.len() as u16).to_be_bytes().to_vec();
        metadata.extend_from_slice(header);
        assert_eq!(extract_binary_audio(&metadata), None);
    }

    /// Explicit live probe: never contacts Microsoft during ordinary unit tests.
    #[tokio::test]
    #[ignore = "contacts Microsoft; set AVE_LIVE_EDGE_OUTPUT to a writable output folder"]
    async fn live_edge_voice_smoke() {
        let folder = std::env::var_os("AVE_LIVE_EDGE_OUTPUT").expect("set AVE_LIVE_EDGE_OUTPUT");
        let folder = std::path::PathBuf::from(folder);
        std::fs::create_dir_all(&folder).expect("output folder");
        let available = voices().await;
        assert!(available.len() > FALLBACK.len(), "live voice list must be fetched, not just the fallback");
        for (voice, rate, text, file) in [
            ("en-US-AriaNeural", 0, "This is a short voice test for the automatic video editor. The finished audio should be clear and complete.", "edge-voice-sample.wav"),
            ("ur-PK-AsadNeural", 10, "یہ آٹو ویڈیو ایڈیٹر کی آواز کا ایک مختصر ٹیسٹ ہے۔ اب ہم اردو میں بھی آواز بنا رہے ہیں۔", "edge-voice-urdu-sample.wav"),
        ] {
            assert!(available.iter().any(|v| v.name == voice), "selected voice must be in the live list");
            let spoken = tokio::time::timeout(Duration::from_secs(45), speak(voice, rate, 0, text))
                .await.expect("live voice deadline").expect("live Edge speech generation");
            let samples = crate::tts::wav::samples_from_pcm(&spoken.pcm);
            assert!(samples.len() > spoken.rate as usize, "at least one second of audio");
            assert!(samples.iter().any(|s| s.unsigned_abs() > 100), "audio must not be silent");
            std::fs::write(folder.join(file), crate::tts::wav::wav_bytes(&samples, spoken.rate)).expect("save sample");
            eprintln!("Edge {voice}: {:.2} seconds saved to {file}", samples.len() as f64 / f64::from(spoken.rate));
        }
    }

    #[test]
    fn xml_characters_are_escaped() {
        assert_eq!(escape_xml("a<b & \"c\" 'd' >e"), "a&lt;b &amp; &quot;c&quot; &apos;d&apos; &gt;e");
    }

    #[test]
    fn ssml_wraps_voice_rate_volume_and_escaped_text() {
        let ssml = build_ssml("ko-KR-SunHiNeural", 20, -10, "Hello <world> & friends.");
        assert!(ssml.contains("name=\"Microsoft Server Speech Text to Speech Voice (ko-KR, SunHiNeural)\""));
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
        assert_eq!(first.len(), 81);
        let (cs64, sha256) = first.split_once('-').unwrap();
        assert_eq!((cs64.len(), sha256.len()), (16, 64));
        assert!(first.chars().all(|c| c == '-' || (c.is_ascii_hexdigit() && !c.is_ascii_lowercase())));
    }

    #[test]
    fn config_and_ssml_messages_carry_the_right_paths() {
        let config = config_message("Mon, 01 Jan 2024 00:00:00 GMT");
        assert!(config.contains("Path:speech.config"));
        assert!(config.contains("audio-24khz-48kbitrate-mono-mp3"));
        assert!(config.contains("wordBoundaryEnabled\":\"true\""));
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
        assert_eq!(extract_audio(b"Path:audio.metadata\r\nContent-Type:application/json\r\n\r\n{\"Metadata\":[]}"), None);
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
