//! A small WebSocket client (RFC 6455) for the browser's DevTools port on `127.0.0.1`.
//! Only what is needed: text messages, fragments, ping/pong and close. Written by hand because the
//! project does not add dependencies without asking.

use std::io;

use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::TcpStream;

const MAX_MESSAGE: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opcode {
    Continuation,
    Text,
    Binary,
    Close,
    Ping,
    Pong,
}

impl Opcode {
    fn from_bits(bits: u8) -> Option<Self> {
        Some(match bits {
            0 => Self::Continuation,
            1 => Self::Text,
            2 => Self::Binary,
            8 => Self::Close,
            9 => Self::Ping,
            10 => Self::Pong,
            _ => return None,
        })
    }
    fn bits(self) -> u8 {
        match self {
            Self::Continuation => 0,
            Self::Text => 1,
            Self::Binary => 2,
            Self::Close => 8,
            Self::Ping => 9,
            Self::Pong => 10,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub fin: bool,
    pub opcode: Opcode,
    pub payload: Vec<u8>,
}

/// A client frame: always masked.
pub fn encode_frame(opcode: Opcode, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    out.push(0x80 | opcode.bits());
    match payload.len() {
        n if n < 126 => out.push(0x80 | n as u8),
        n if n <= 0xffff => {
            out.push(0x80 | 126);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            out.push(0x80 | 127);
            out.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    out.extend_from_slice(&mask);
    out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    /// Needs more bytes.
    Incomplete,
    Frame(Frame, usize),
    Invalid(&'static str),
}

/// Reads one frame from the start of `buf` (server frames are not masked, masked ones are accepted).
pub fn parse_frame(buf: &[u8]) -> Parsed {
    if buf.len() < 2 {
        return Parsed::Incomplete;
    }
    let fin = buf[0] & 0x80 != 0;
    let Some(opcode) = Opcode::from_bits(buf[0] & 0x0f) else { return Parsed::Invalid("unknown opcode") };
    let masked = buf[1] & 0x80 != 0;
    let mut length = u64::from(buf[1] & 0x7f);
    let mut at = 2;
    if length == 126 {
        if buf.len() < 4 {
            return Parsed::Incomplete;
        }
        length = u64::from(u16::from_be_bytes([buf[2], buf[3]]));
        at = 4;
    } else if length == 127 {
        if buf.len() < 10 {
            return Parsed::Incomplete;
        }
        length = u64::from_be_bytes(buf[2..10].try_into().unwrap_or([0; 8]));
        at = 10;
    }
    if length as usize > MAX_MESSAGE {
        return Parsed::Invalid("message too large");
    }
    let length = length as usize;
    let mask = if masked {
        if buf.len() < at + 4 {
            return Parsed::Incomplete;
        }
        let key = [buf[at], buf[at + 1], buf[at + 2], buf[at + 3]];
        at += 4;
        Some(key)
    } else {
        None
    };
    if buf.len() < at + length {
        return Parsed::Incomplete;
    }
    let mut payload = buf[at..at + length].to_vec();
    if let Some(key) = mask {
        for (i, byte) in payload.iter_mut().enumerate() {
            *byte ^= key[i % 4];
        }
    }
    Parsed::Frame(Frame { fin, opcode, payload }, at + length)
}

/// Mask bytes only have to differ from message to message (they are not a secret).
fn mask_key() -> [u8; 4] {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0x9e37_79b9);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let value = COUNTER.fetch_add(0x7f4a_7c15, Ordering::Relaxed) ^ nanos;
    value.to_be_bytes()
}

pub struct WsReader {
    half: ReadHalf<TcpStream>,
    buffer: Vec<u8>,
    message: Vec<u8>,
}

pub struct WsWriter {
    half: WriteHalf<TcpStream>,
}

/// Connects to `ws://host:port/path` (the DevTools address from `DevToolsActivePort` or `/json/version`).
pub async fn connect(host: &str, port: u16, path: &str) -> io::Result<(WsReader, WsWriter)> {
    let mut stream = TcpStream::connect((host, port)).await?;
    let key = crate::api::base64::encode(&mask_key().iter().chain(mask_key().iter()).chain(mask_key().iter()).chain(mask_key().iter()).copied().collect::<Vec<u8>>());
    // No Origin header: the browser then accepts the local connection without extra switches.
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
    stream.write_all(request.as_bytes()).await?;

    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 || stream.read(&mut byte).await? == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the browser closed the connection during the handshake"));
        }
        head.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&head);
    let status = text.lines().next().unwrap_or_default();
    if !status.contains(" 101") {
        return Err(io::Error::new(io::ErrorKind::ConnectionRefused, format!("the browser refused the DevTools connection: {status}")));
    }
    let (read, write) = tokio::io::split(stream);
    Ok((WsReader { half: read, buffer: Vec::new(), message: Vec::new() }, WsWriter { half: write }))
}

impl WsWriter {
    pub async fn send_text(&mut self, text: &str) -> io::Result<()> {
        self.half.write_all(&encode_frame(Opcode::Text, text.as_bytes(), mask_key())).await?;
        self.half.flush().await
    }

    pub async fn send_pong(&mut self, payload: &[u8]) -> io::Result<()> {
        self.half.write_all(&encode_frame(Opcode::Pong, payload, mask_key())).await?;
        self.half.flush().await
    }

    pub async fn close(&mut self) {
        let _ = self.half.write_all(&encode_frame(Opcode::Close, &[], mask_key())).await;
        let _ = self.half.shutdown().await;
    }
}

pub enum Incoming {
    Text(String),
    Ping(Vec<u8>),
    Closed,
}

impl WsReader {
    /// The next text message, a ping that must be answered, or `Closed`.
    pub async fn next(&mut self) -> io::Result<Incoming> {
        loop {
            match parse_frame(&self.buffer) {
                Parsed::Frame(frame, used) => {
                    self.buffer.drain(..used);
                    match frame.opcode {
                        Opcode::Close => return Ok(Incoming::Closed),
                        Opcode::Ping => return Ok(Incoming::Ping(frame.payload)),
                        Opcode::Pong => {}
                        Opcode::Text | Opcode::Binary | Opcode::Continuation => {
                            self.message.extend_from_slice(&frame.payload);
                            if self.message.len() > MAX_MESSAGE {
                                return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
                            }
                            if frame.fin {
                                let bytes = std::mem::take(&mut self.message);
                                return Ok(Incoming::Text(String::from_utf8_lossy(&bytes).into_owned()));
                            }
                        }
                    }
                }
                Parsed::Invalid(why) => return Err(io::Error::new(io::ErrorKind::InvalidData, why)),
                Parsed::Incomplete => {
                    let mut chunk = vec![0u8; 64 * 1024];
                    let count = self.half.read(&mut chunk).await?;
                    if count == 0 {
                        return Ok(Incoming::Closed);
                    }
                    self.buffer.extend_from_slice(&chunk[..count]);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_frame(opcode: Opcode, fin: bool, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![(if fin { 0x80 } else { 0 }) | opcode.bits()];
        match payload.len() {
            n if n < 126 => out.push(n as u8),
            n if n <= 0xffff => {
                out.push(126);
                out.extend_from_slice(&(n as u16).to_be_bytes());
            }
            n => {
                out.push(127);
                out.extend_from_slice(&(n as u64).to_be_bytes());
            }
        }
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn client_frames_are_masked_and_parse_back() {
        for size in [0usize, 5, 125, 126, 300, 70_000] {
            let payload: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
            let bytes = encode_frame(Opcode::Text, &payload, [1, 2, 3, 4]);
            assert_eq!(bytes[1] & 0x80, 0x80, "client frames carry the mask bit");
            match parse_frame(&bytes) {
                Parsed::Frame(frame, used) => {
                    assert_eq!(used, bytes.len());
                    assert_eq!(frame.payload, payload);
                    assert_eq!(frame.opcode, Opcode::Text);
                }
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn server_frames_of_every_length_class_parse() {
        for size in [3usize, 125, 126, 65_535, 65_536, 200_000] {
            let payload = vec![b'x'; size];
            let bytes = server_frame(Opcode::Text, true, &payload);
            assert!(matches!(parse_frame(&bytes), Parsed::Frame(f, n) if f.payload.len() == size && n == bytes.len()), "{size}");
        }
    }

    #[test]
    fn a_partial_frame_waits_for_more_bytes() {
        let bytes = server_frame(Opcode::Text, true, &vec![b'y'; 1000]);
        for cut in [0, 1, 2, 3, 500, bytes.len() - 1] {
            assert_eq!(parse_frame(&bytes[..cut]), Parsed::Incomplete, "cut at {cut}");
        }
    }

    #[test]
    fn two_frames_in_one_buffer_are_read_one_by_one() {
        let mut bytes = server_frame(Opcode::Text, true, b"one");
        bytes.extend(server_frame(Opcode::Text, true, b"two"));
        let Parsed::Frame(first, used) = parse_frame(&bytes) else { panic!() };
        assert_eq!(first.payload, b"one");
        let Parsed::Frame(second, _) = parse_frame(&bytes[used..]) else { panic!() };
        assert_eq!(second.payload, b"two");
    }

    #[test]
    fn unknown_opcodes_are_invalid() {
        assert!(matches!(parse_frame(&[0x83, 0x00]), Parsed::Invalid(_)));
    }

    #[tokio::test]
    async fn talks_to_a_local_server_with_fragments_and_a_ping() {
        use tokio::net::TcpListener;
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
            socket.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").await.unwrap();
            // Read the client's masked text frame and echo it back in two fragments, with a ping in between.
            let mut buf = vec![0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap();
            let Parsed::Frame(frame, _) = parse_frame(&buf[..n]) else { panic!("no frame") };
            let (a, b) = frame.payload.split_at(frame.payload.len() / 2);
            socket.write_all(&server_frame(Opcode::Text, false, a)).await.unwrap();
            socket.write_all(&server_frame(Opcode::Ping, true, b"hi")).await.unwrap();
            socket.write_all(&server_frame(Opcode::Continuation, true, b)).await.unwrap();
            socket.write_all(&server_frame(Opcode::Close, true, &[])).await.unwrap();
        });
        let (mut reader, mut writer) = connect("127.0.0.1", port, "/devtools/browser/x").await.unwrap();
        writer.send_text("{\"id\":1,\"method\":\"Browser.getVersion\"}").await.unwrap();
        assert!(matches!(reader.next().await.unwrap(), Incoming::Ping(p) if p == b"hi"));
        assert!(matches!(reader.next().await.unwrap(), Incoming::Text(t) if t == "{\"id\":1,\"method\":\"Browser.getVersion\"}"));
        assert!(matches!(reader.next().await.unwrap(), Incoming::Closed));
    }
}
