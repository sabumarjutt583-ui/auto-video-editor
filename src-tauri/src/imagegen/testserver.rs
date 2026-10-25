//! A local imitation of Gemini's page and the shared tool, for tests only (no Google needed).
//! `127.0.0.1:PORT/gemini` is the Gemini page; the tool is served from `localhost:PORT`, which the
//! browser sees as another site, so it runs in its own process exactly like Google's sandboxed frame.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::config::EngineConfig;

const GEMINI: &str = include_str!("testdata/gemini_page.html");
const TOOL: &str = include_str!("testdata/tool_page.html");
const CHAT: &str = include_str!("testdata/gemini_chat.html");

pub struct TestServer {
    pub port: u16,
    pub signed_in: Arc<AtomicBool>,
    /// How often the fake chat page was loaded / a message was sent in it.
    pub chat_loads: Arc<AtomicUsize>,
    pub chat_sends: Arc<AtomicUsize>,
}

/// Keeps the block between `<!--NAME-->` and `<!--/NAME-->` or drops it.
pub fn keep_block(page: &str, name: &str, keep: bool) -> String {
    let open = format!("<!--{name}-->");
    let close = format!("<!--/{name}-->");
    let (Some(start), Some(end)) = (page.find(&open), page.find(&close)) else { return page.to_string() };
    if keep {
        format!("{}{}{}", &page[..start], &page[start + open.len()..end], &page[end + close.len()..])
    } else {
        format!("{}{}", &page[..start], &page[end + close.len()..])
    }
}

impl TestServer {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let signed_in = Arc::new(AtomicBool::new(true));
        let flag = signed_in.clone();
        let chat_loads = Arc::new(AtomicUsize::new(0));
        let chat_sends = Arc::new(AtomicUsize::new(0));
        let (loads, sends) = (chat_loads.clone(), chat_sends.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let flag = flag.clone();
                let (loads, sends) = (loads.clone(), sends.clone());
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 8192];
                    let count = socket.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let signed = flag.load(Ordering::SeqCst);
                    let (status, body) = match path.split('?').next().unwrap_or("/") {
                        "/gemini" => {
                            let page = keep_block(&keep_block(GEMINI, "SIGNED_IN", signed), "SIGNED_OUT", !signed);
                            // Signed out: no tool is offered, like Gemini's page for a visitor.
                            ("200 OK", page.replace("__TOOL_ORIGIN__", &format!("http://localhost:{port}")))
                        }
                        "/tool" => ("200 OK", TOOL.to_string()),
                        "/chat" => {
                            loads.fetch_add(1, Ordering::SeqCst);
                            ("200 OK", CHAT.to_string())
                        }
                        "/video.mp4" => ("200 OK", format!("\0\0\0 ftypisom{}", "x".repeat(4000))),
                        "/beacon" => {
                            sends.fetch_add(1, Ordering::SeqCst);
                            ("200 OK", String::new())
                        }
                        "/favicon.ico" => ("404 Not Found", String::new()),
                        _ => ("404 Not Found", "not found".to_string()),
                    };
                    let head = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(body.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        Self { port, signed_in, chat_loads, chat_sends }
    }

    pub fn gemini_url(&self) -> String {
        format!("http://127.0.0.1:{}/gemini", self.port)
    }

    /// The bundled configuration pointed at this server.
    pub fn config(&self) -> EngineConfig {
        let mut config = EngineConfig::bundled();
        config.tool_url = self.gemini_url();
        config.timing.poll_ms = 300;
        config.timing.page_load_timeout_ms = 30_000;
        config.timing.submit_confirm_ms = 5_000;
        config.timing.lost_card_ms = 4_000;
        config.chat.url = format!("http://127.0.0.1:{}/chat", self.port);
        config.chat.timing.poll_ms = 250;
        config.chat.timing.page_ready_ms = 15_000;
        config.chat.timing.reply_start_ms = 4_000;
        config.chat.timing.stable_ms = 2_500;
        config.chat.timing.finish_stable_ms = 800;
        config.chat.timing.think_max_ms = 20_000;
        config
    }
}

/// A Chromium to test with: `AVE_TEST_CHROME`, or a Playwright download. `None` skips the test.
pub fn test_browser() -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("AVE_TEST_CHROME").map(std::path::PathBuf::from).filter(|p| p.is_file()) {
        return Some(path);
    }
    let root = std::path::Path::new("/opt/pw-browsers");
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let candidate = entry.path().join("chrome-linux").join("chrome");
        if entry.file_name().to_string_lossy().starts_with("chromium-") && candidate.is_file() {
            return Some(candidate);
        }
    }
    super::browser::locator::find(None)
}

/// Extra browser switches a test needs (Chromium refuses to start as root without them).
pub fn test_args() -> Vec<String> {
    vec!["--no-sandbox".to_string(), "--disable-gpu".to_string(), "--disable-dev-shm-usage".to_string()]
}

pub fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ave-it-{name}-{}-{:x}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}
