//! Test-only helpers: scriptable HTTP/TLS mock server and fake executables.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    /// Path including the query string.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub struct MockResponse {
    pub status: u16,
    pub body: String,
    pub delay_ms: u64,
    pub headers: Vec<(String, String)>,
}

impl MockResponse {
    pub fn json(status: u16, body: &str) -> Self {
        Self { status, body: body.to_string(), delay_ms: 0, headers: Vec::new() }
    }
    /// Redirect response; `location` may be relative (e.g. `/blob/x`).
    pub fn redirect(status: u16, location: &str) -> Self {
        Self::json(status, "").with_header("Location", location)
    }
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
    pub fn delayed(mut self, ms: u64) -> Self {
        self.delay_ms = ms;
        self
    }
}

pub struct MockServer {
    pub url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl MockServer {
    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

type Handler = Arc<dyn Fn(&Recorded) -> MockResponse + Send + Sync>;
type Log = Arc<Mutex<Vec<Recorded>>>;

fn read_request<S: Read>(stream: &mut S) -> Option<Recorded> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    while buf.len() < header_end + len {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let end = (header_end + len).min(buf.len());
    let body = String::from_utf8_lossy(&buf[header_end..end]).to_string();
    Some(Recorded { method, path, headers, body })
}

fn serve<S: Read + Write>(mut stream: S, handler: &Handler, log: &Log) {
    let Some(req) = read_request(&mut stream) else { return };
    log.lock().unwrap().push(req.clone());
    let resp = handler(&req);
    if resp.delay_ms > 0 {
        thread::sleep(Duration::from_millis(resp.delay_ms));
    }
    let extra: String = resp.headers.iter().map(|(k, v)| format!("{k}: {v}\r\n")).collect();
    let out = format!(
        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        resp.status,
        resp.body.len(),
        resp.body
    );
    let _ = stream.write_all(out.as_bytes());
    let _ = stream.flush();
}

/// Plain-HTTP server on a random port; one thread per connection, never stops
/// (fine for tests). The handler decides every response.
pub fn spawn<F>(handler: F) -> MockServer
where
    F: Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let handler: Handler = Arc::new(handler);
    let log2 = log.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (h, l) = (handler.clone(), log2.clone());
            thread::spawn(move || serve(stream, &h, &l));
        }
    });
    MockServer { url: format!("http://127.0.0.1:{port}"), requests: log }
}

/// HTTPS server with a fresh self-signed certificate for `127.0.0.1`.
/// Returns the server and the certificate in PEM (use as `ca_cert_path` content).
pub fn spawn_tls<F>(handler: F) -> (MockServer, String)
where
    F: Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
{
    let ck = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()]).unwrap();
    let pem = ck.cert.pem();
    let cert_der = ck.cert.der().clone();
    let key_der = rustls::pki_types::PrivateKeyDer::try_from(ck.key_pair.serialize_der()).unwrap();
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .unwrap();
    let config = Arc::new(config);

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let handler: Handler = Arc::new(handler);
    let log2 = log.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (h, l, cfg) = (handler.clone(), log2.clone(), config.clone());
            thread::spawn(move || {
                let Ok(conn) = rustls::ServerConnection::new(cfg) else { return };
                serve(rustls::StreamOwned::new(conn, stream), &h, &l);
            });
        }
    });
    (MockServer { url: format!("https://127.0.0.1:{port}"), requests: log }, pem)
}

/// A TCP port nobody listens on (bind, read the port, drop the listener).
pub fn closed_port_url() -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    format!("http://127.0.0.1:{port}")
}

/// Writes an executable `sh` script into `dir` and returns its path (unix only).
#[cfg(unix)]
pub fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    {
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(format!("#!/bin/sh\n{body}\n").as_bytes()).unwrap();
        f.sync_all().unwrap();
    }
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

use super::auth::Clock;
use super::env::LlmEnv;
use super::proc::FixedResolver;
use super::secrets::MemorySecretStore;
use std::sync::atomic::{AtomicI64, Ordering};

/// Controllable clock for token-cache tests.
pub struct FakeClock(AtomicI64);

impl FakeClock {
    pub fn new(now: i64) -> Self {
        Self(AtomicI64::new(now))
    }
    pub fn set(&self, now: i64) {
        self.0.store(now, Ordering::SeqCst);
    }
    pub fn advance(&self, secs: i64) {
        self.0.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// LlmEnv with in-memory secrets, a fake clock and the given fake binaries.
pub fn test_env(resolver: FixedResolver, timeout_ms: u64) -> LlmEnv {
    LlmEnv::new(
        Arc::new(resolver),
        Arc::new(FakeClock::new(1_000)),
        Arc::new(MemorySecretStore::default()),
        Duration::from_millis(timeout_ms),
    )
}
