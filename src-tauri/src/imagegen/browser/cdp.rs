//! The Chrome DevTools Protocol client: JSON messages over the WebSocket, answers matched by id,
//! events broadcast, and "flattened" sessions so that a page and the tool's cross-site iframe
//! (a separate process for the browser) can each be driven by their own session id. Events are not used.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{oneshot, Mutex};

use super::ws::{self, Incoming, WsWriter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpError {
    /// The browser answered with an error (`code`, `message`).
    Protocol(i64, String),
    /// The connection is gone: the browser was closed or crashed.
    Closed,
    Timeout(String),
    /// The page's own code threw while we evaluated something.
    Script(String),
    Other(String),
}

impl std::fmt::Display for CdpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Protocol(code, message) => write!(f, "browser error {code}: {message}"),
            Self::Closed => write!(f, "the browser connection was closed"),
            Self::Timeout(what) => write!(f, "timed out: {what}"),
            Self::Script(message) => write!(f, "page script error: {message}"),
            Self::Other(message) => write!(f, "{message}"),
        }
    }
}

type Pending = StdMutex<HashMap<u64, oneshot::Sender<Result<Value, CdpError>>>>;

struct Inner {
    writer: Mutex<WsWriter>,
    next_id: AtomicU64,
    pending: Pending,
    closed: AtomicBool,
}

#[derive(Clone)]
pub struct Cdp {
    inner: Arc<Inner>,
}

pub const CALL_TIMEOUT: Duration = Duration::from_secs(30);

impl Cdp {
    pub async fn connect(port: u16, path: &str) -> Result<Self, CdpError> {
        let (mut reader, writer) = ws::connect("127.0.0.1", port, path).await.map_err(|e| CdpError::Other(e.to_string()))?;
        let inner = Arc::new(Inner { writer: Mutex::new(writer), next_id: AtomicU64::new(1), pending: StdMutex::new(HashMap::new()), closed: AtomicBool::new(false) });
        let task = inner.clone();
        tokio::spawn(async move {
            loop {
                match reader.next().await {
                    Ok(Incoming::Text(text)) => task.dispatch(&text),
                    Ok(Incoming::Ping(payload)) => {
                        let _ = task.writer.lock().await.send_pong(&payload).await;
                    }
                    Ok(Incoming::Closed) | Err(_) => break,
                }
            }
            task.closed.store(true, Ordering::SeqCst);
            let waiting: Vec<_> = task.pending.lock().map(|mut p| p.drain().collect()).unwrap_or_default();
            for (_, sender) in waiting {
                let _ = sender.send(Err(CdpError::Closed));
            }
        });
        Ok(Self { inner })
    }

    pub fn is_closed(&self) -> bool {
        self.inner.closed.load(Ordering::SeqCst)
    }

    pub async fn call(&self, method: &str, params: Value, session: Option<&str>) -> Result<Value, CdpError> {
        self.call_with_timeout(method, params, session, CALL_TIMEOUT).await
    }

    pub async fn call_with_timeout(&self, method: &str, params: Value, session: Option<&str>, timeout: Duration) -> Result<Value, CdpError> {
        if self.is_closed() {
            return Err(CdpError::Closed);
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().map_err(|_| CdpError::Closed)?.insert(id, sender);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        let sent = self.inner.writer.lock().await.send_text(&message.to_string()).await;
        if sent.is_err() {
            self.forget(id);
            return Err(CdpError::Closed);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(CdpError::Closed),
            Err(_) => {
                self.forget(id);
                Err(CdpError::Timeout(method.to_string()))
            }
        }
    }

    fn forget(&self, id: u64) {
        if let Ok(mut pending) = self.inner.pending.lock() {
            pending.remove(&id);
        }
    }

    /// Runs a JavaScript expression in the page or frame of `session` and returns its value.
    /// Promises are awaited. A thrown error becomes `CdpError::Script`.
    pub async fn evaluate(&self, session: &str, expression: &str) -> Result<Value, CdpError> {
        self.evaluate_in(session, None, expression).await
    }

    /// Like `evaluate`, inside one execution context (used for frames of the same process).
    pub async fn evaluate_in(&self, session: &str, context_id: Option<i64>, expression: &str) -> Result<Value, CdpError> {
        let mut params = json!({ "expression": expression, "returnByValue": true, "awaitPromise": true });
        if let Some(id) = context_id {
            params["contextId"] = json!(id);
        }
        let result = self.call("Runtime.evaluate", params, Some(session)).await?;
        if let Some(exception) = result.get("exceptionDetails") {
            let text = exception.pointer("/exception/description").or_else(|| exception.get("text")).and_then(Value::as_str).unwrap_or("script error");
            return Err(CdpError::Script(text.chars().take(300).collect()));
        }
        Ok(result.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    pub async fn close(&self) {
        self.inner.writer.lock().await.close().await;
    }
}

impl Inner {
    fn dispatch(&self, text: &str) {
        let Ok(value) = serde_json::from_str::<Value>(text) else { return };
        if let Some(id) = value.get("id").and_then(Value::as_u64) {
            let sender = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
            let Some(sender) = sender else { return };
            let result = match value.get("error") {
                Some(error) => Err(CdpError::Protocol(error.get("code").and_then(Value::as_i64).unwrap_or(0), error.get("message").and_then(Value::as_str).unwrap_or("").to_string())),
                None => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = sender.send(result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imagegen::browser::ws::{encode_frame, parse_frame, Opcode, Parsed};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn server_text(text: &str) -> Vec<u8> {
        let mut out = vec![0x81];
        let n = text.len();
        if n < 126 {
            out.push(n as u8);
        } else {
            out.push(126);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        out.extend_from_slice(text.as_bytes());
        out
    }

    /// A fake browser: answers `Test.echo` with its params, `Test.fail` with an error,
    /// ignores `Test.silent`, and sends an event after the first call.
    async fn fake_browser() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut seen = Vec::new();
            let mut byte = [0u8; 1];
            while !seen.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).await.unwrap();
                seen.push(byte[0]);
            }
            socket.write_all(b"HTTP/1.1 101 Switching Protocols\r\n\r\n").await.unwrap();
            let mut buffer = Vec::new();
            let mut chunk = vec![0u8; 8192];
            loop {
                let n = socket.read(&mut chunk).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                buffer.extend_from_slice(&chunk[..n]);
                while let Parsed::Frame(frame, used) = parse_frame(&buffer) {
                    buffer.drain(..used);
                    if frame.opcode == Opcode::Close {
                        return;
                    }
                    let request: Value = serde_json::from_slice(&frame.payload).unwrap();
                    let id = request["id"].clone();
                    let reply = match request["method"].as_str().unwrap() {
                        "Test.echo" => Some(json!({ "id": id, "result": request["params"], "sessionId": request.get("sessionId") })),
                        "Test.fail" => Some(json!({ "id": id, "error": { "code": -32000, "message": "nope" } })),
                        "Runtime.evaluate" => Some(if request["params"]["expression"] == "boom" {
                            json!({ "id": id, "result": { "exceptionDetails": { "text": "Uncaught", "exception": { "description": "ReferenceError: boom" } } } })
                        } else {
                            json!({ "id": id, "result": { "result": { "type": "number", "value": 42 } } })
                        }),
                        _ => None,
                    };
                    if let Some(reply) = reply {
                        socket.write_all(&server_text(&reply.to_string())).await.unwrap();
                        let event = json!({ "method": "Page.loadEventFired", "params": { "timestamp": 1 }, "sessionId": "S1" });
                        socket.write_all(&server_text(&event.to_string())).await.unwrap();
                    }
                }
            }
        });
        let _ = encode_frame(Opcode::Text, b"", [0; 4]);
        port
    }

    #[tokio::test]
    async fn answers_are_matched_by_id_and_errors_are_typed() {
        let port = fake_browser().await;
        let cdp = Cdp::connect(port, "/devtools/browser/x").await.unwrap();
        let echoed = cdp.call("Test.echo", json!({ "a": 1 }), None).await.unwrap();
        assert_eq!(echoed, json!({ "a": 1 }));
        assert_eq!(cdp.call("Test.fail", json!({}), None).await, Err(CdpError::Protocol(-32000, "nope".into())));
    }

    #[tokio::test]
    async fn evaluate_returns_values_and_script_errors() {
        let port = fake_browser().await;
        let cdp = Cdp::connect(port, "/x").await.unwrap();
        assert_eq!(cdp.evaluate("S1", "1+1").await.unwrap(), json!(42));
        assert!(matches!(cdp.evaluate("S1", "boom").await, Err(CdpError::Script(m)) if m.contains("ReferenceError")));
    }

    #[tokio::test]
    async fn a_silent_browser_times_out_and_a_closed_one_fails_waiting_calls() {
        let port = fake_browser().await;
        let cdp = Cdp::connect(port, "/x").await.unwrap();
        let silent = cdp.call_with_timeout("Test.silent", json!({}), None, Duration::from_millis(150)).await;
        assert_eq!(silent, Err(CdpError::Timeout("Test.silent".into())));
        // Closing from our side ends the reader; later calls fail at once.
        cdp.close().await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(cdp.call("Test.echo", json!({}), None).await, Err(CdpError::Closed));
    }
}
