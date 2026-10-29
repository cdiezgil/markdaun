/// OAuth 2.0 (PKCE) flow for subscription-based LLM providers.
///
/// ## Google (Antigravity / Cloud Code Assist)
/// Local TCP server on fixed port 51121. Browser redirects automatically.
/// Uses client_id + client_secret (Google desktop-app client for Code Assist CLI).
/// Source: github.com/Rahularya01/pi-antigravity (MIT)
///
/// ## Anthropic (Claude Pro/Max)
/// Redirect URI is https://console.anthropic.com/oauth/code/callback (HTTPS).
/// User pastes the code from the browser address bar.
/// Source: pi-coding-agent examples/extensions/custom-provider-anthropic (MIT)
use super::error::LlmError;
use super::secrets::SecretStore;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead as _, BufReader, Write as _};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;

// ─── Provider ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OAuthProvider {
    Google,
    Anthropic,
}

impl OAuthProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            OAuthProvider::Google => "google",
            OAuthProvider::Anthropic => "anthropic",
        }
    }

    pub fn keyring_account(self) -> String {
        format!("llm-oauth:{}", self.as_str())
    }
}

// ─── Config per provider ─────────────────────────────────────────────────────

struct ProviderConfig {
    auth_url: &'static str,
    token_url: &'static str,
    client_id: &'static str,
    client_secret: Option<&'static str>,
    scopes: &'static str,
    redirect_uri: &'static str,
    local_port: u16,
}

fn config(provider: OAuthProvider) -> ProviderConfig {
    match provider {
        OAuthProvider::Google => ProviderConfig {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            // Desktop-app client registered for Google Code Assist CLI.
            // Credentials live in oauth_creds.rs (git-ignored).
            client_id: super::oauth_creds::GOOGLE_CLIENT_ID,
            client_secret: Some(super::oauth_creds::GOOGLE_CLIENT_SECRET),
            scopes: "https://www.googleapis.com/auth/aicode \
                     https://www.googleapis.com/auth/cloud-platform \
                     https://www.googleapis.com/auth/userinfo.email \
                     https://www.googleapis.com/auth/userinfo.profile \
                     https://www.googleapis.com/auth/cclog \
                     https://www.googleapis.com/auth/experimentsandconfigs",
            redirect_uri: "http://localhost:51121/oauth-callback",
            local_port: 51121,
        },
        OAuthProvider::Anthropic => ProviderConfig {
            auth_url: "https://claude.ai/oauth/authorize",
            token_url: "https://console.anthropic.com/v1/oauth/token",
            client_id: super::oauth_creds::ANTHROPIC_CLIENT_ID,
            client_secret: None,
            scopes: "org:create_api_key user:profile user:inference",
            redirect_uri: "https://console.anthropic.com/oauth/code/callback",
            local_port: 0,
        },
    }
}

// ─── Stored tokens ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) when access_token expires.
    pub expires_at: i64,
    /// Google: GCP project id from Code Assist discovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Email (display only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────

fn pkce_pair() -> (String, String) {
    let mut raw = [0u8; 32];
    for (i, chunk) in raw.chunks_mut(4).enumerate() {
        let b = uuid::Uuid::new_v4();
        chunk.copy_from_slice(&b.as_bytes()[i % 12..i % 12 + 4]);
    }
    let verifier = URL_SAFE_NO_PAD.encode(raw);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()).as_slice());
    (verifier, challenge)
}

fn random_state() -> String {
    URL_SAFE_NO_PAD.encode(uuid::Uuid::new_v4().as_bytes())
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

pub fn build_auth_url(provider: OAuthProvider, challenge: &str, state: &str) -> String {
    let cfg = config(provider);
    let params = [
        ("client_id", cfg.client_id),
        ("response_type", "code"),
        ("redirect_uri", cfg.redirect_uri),
        ("scope", cfg.scopes),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ];
    let qs: String = params.iter()
        .map(|(k, v)| format!("{}={}", k, urlenc(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}?{}", cfg.auth_url, qs)
}

// ─── Local callback server ────────────────────────────────────────────────────

fn wait_for_callback(port: u16, expected_state: &str) -> Result<String, LlmError> {
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .map_err(|e| LlmError::BadResponse(format!("oauth: cannot bind port {port}: {e}")))?;

    // TcpListener has no set_read_timeout — use a channel + thread.
    listener.set_nonblocking(true).ok();
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(300);

    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(s) => break s,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err(LlmError::BadResponse("oauth: timed out waiting for browser".into()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(LlmError::BadResponse(format!("oauth: accept: {e}"))),
        }
    };
    stream.set_nonblocking(false).ok();

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| LlmError::BadResponse(e.to_string()))?);
    let mut line = String::new();
    reader.read_line(&mut line).ok();

    let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <!DOCTYPE html><html><head><title>MarkDaun</title>\
        <style>body{font-family:sans-serif;display:flex;justify-content:center;\
        align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#e0e0e0}</style>\
        </head><body><p>\u{2713}&nbsp;Autenticado. Puedes cerrar esta ventana.</p>\
        <script>window.close()</script></body></html>";
    stream.write_all(html.as_bytes()).ok();
    drop(stream);

    // "GET /oauth-callback?code=X&state=Y HTTP/1.1"
    let qs = line.split_whitespace().nth(1)
        .and_then(|p| p.split('?').nth(1))
        .unwrap_or("");
    let params: HashMap<&str, &str> = qs.split('&')
        .filter_map(|kv| { let mut it = kv.splitn(2, '='); Some((it.next()?, it.next()?)) })
        .collect();

    if let Some(err) = params.get("error") {
        return Err(LlmError::BadResponse(format!("oauth provider error: {err}")));
    }
    if params.get("state").copied().unwrap_or("") != expected_state {
        return Err(LlmError::BadResponse("oauth: state mismatch".into()));
    }
    params.get("code").map(|c| url_decode(c))
        .ok_or_else(|| LlmError::BadResponse("oauth: missing code in callback".into()))
}

// ─── Token exchange ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

async fn exchange(
    cfg: &ProviderConfig,
    grant: &str,
    code_or_refresh: &str,
    verifier: Option<&str>,
) -> Result<TokenResp, LlmError> {
    let client = reqwest::Client::new();
    let mut fields: Vec<(&str, &str)> = vec![
        ("grant_type", grant),
        ("client_id", cfg.client_id),
    ];
    if grant == "authorization_code" {
        fields.push(("code", code_or_refresh));
        fields.push(("redirect_uri", cfg.redirect_uri));
        if let Some(v) = verifier { fields.push(("code_verifier", v)); }
    } else {
        fields.push(("refresh_token", code_or_refresh));
    }
    if let Some(s) = cfg.client_secret {
        fields.push(("client_secret", s));
    }

    let resp = client.post(cfg.token_url).form(&fields)
        .timeout(Duration::from_secs(30)).send().await
        .map_err(|e| LlmError::BadResponse(format!("oauth: {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return if status.as_u16() == 400 || status.as_u16() == 401 {
            Err(LlmError::CliNotLoggedIn)
        } else {
            Err(LlmError::BadResponse(format!("oauth {status}: {body}")))
        };
    }
    serde_json::from_str(&body)
        .map_err(|e| LlmError::BadResponse(format!("oauth parse: {e}")))
}

// ─── Google helpers ───────────────────────────────────────────────────────────

async fn google_project(token: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://cloudcode-pa.googleapis.com/v1/cloudcode/user:validateAccount")
        .bearer_auth(token).header("Content-Type", "application/json").body("{}")
        .timeout(Duration::from_secs(8)).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("cloudaiCompanionProject")
        .or_else(|| json.get("projectId"))
        .and_then(|v| v.as_str()).map(String::from)
}

async fn google_email(token: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.googleapis.com/oauth2/v1/userinfo?alt=json")
        .bearer_auth(token).timeout(Duration::from_secs(8)).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("email").and_then(|v| v.as_str()).map(String::from)
}

// ─── OAuthTokenProvider ───────────────────────────────────────────────────────

const MARGIN: i64 = 300; // seconds before expiry to trigger refresh

pub struct OAuthTokenProvider {
    secrets: Arc<dyn SecretStore>,
    cache: Mutex<HashMap<String, OAuthTokens>>,
}

impl OAuthTokenProvider {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self { secrets, cache: Mutex::new(HashMap::new()) }
    }

    pub fn stored(&self, provider: OAuthProvider) -> Option<OAuthTokens> {
        let raw = self.secrets.get(&provider.keyring_account()).ok()??;
        serde_json::from_str(&raw).ok()
    }

    pub fn logout(&self, provider: OAuthProvider) -> Result<(), LlmError> {
        self.secrets.delete(&provider.keyring_account())?;
        self.cache.lock().unwrap().remove(provider.as_str());
        Ok(())
    }

    /// Returns a valid access_token, refreshing if expired.
    pub async fn token(&self, provider: OAuthProvider) -> Result<String, LlmError> {
        let now = chrono::Utc::now().timestamp();
        let key = provider.as_str().to_string();

        if let Some(t) = self.cache.lock().unwrap().get(&key) {
            if t.expires_at - now > MARGIN { return Ok(t.access_token.clone()); }
        }

        let raw = self.secrets.get(&provider.keyring_account())?.ok_or(LlmError::CliNotLoggedIn)?;
        let mut stored: OAuthTokens = serde_json::from_str(&raw).map_err(|_| LlmError::CliNotLoggedIn)?;

        if stored.expires_at - now > MARGIN {
            self.cache.lock().unwrap().insert(key, stored.clone());
            return Ok(stored.access_token.clone());
        }

        let rt = stored.refresh_token.clone().ok_or(LlmError::CliNotLoggedIn)?;
        let cfg = config(provider);
        let tr = exchange(&cfg, "refresh_token", &rt, None).await?;
        stored.access_token = tr.access_token;
        stored.expires_at = now + tr.expires_in.unwrap_or(3600);
        if let Some(new_rt) = tr.refresh_token { stored.refresh_token = Some(new_rt); }

        let json = serde_json::to_string(&stored).unwrap();
        self.secrets.set(&provider.keyring_account(), &json)?;
        self.cache.lock().unwrap().insert(key, stored.clone());
        Ok(stored.access_token)
    }

    // ── Google: full local-server flow ───────────────────────────────────────

    pub async fn login_google(&self) -> Result<OAuthTokens, LlmError> {
        let (verifier, challenge) = pkce_pair();
        let state = random_state();
        let cfg = config(OAuthProvider::Google);
        let auth_url = build_auth_url(OAuthProvider::Google, &challenge, &state);

        open::that(&auth_url)
            .map_err(|e| LlmError::BadResponse(format!("oauth: open browser: {e}")))?;

        let v = verifier.clone();
        let s = state.clone();
        let code = tokio::task::spawn_blocking(move || wait_for_callback(cfg.local_port, &s))
            .await
            .map_err(|e| LlmError::BadResponse(format!("oauth thread: {e}")))??;

        let cfg2 = config(OAuthProvider::Google);
        let tr = exchange(&cfg2, "authorization_code", &code, Some(&v)).await?;
        let now = chrono::Utc::now().timestamp();

        let (email, project_id) = tokio::join!(
            google_email(&tr.access_token),
            google_project(&tr.access_token),
        );

        let tokens = OAuthTokens {
            access_token: tr.access_token,
            refresh_token: tr.refresh_token,
            expires_at: now + tr.expires_in.unwrap_or(3600) - MARGIN,
            project_id,
            email,
        };
        let json = serde_json::to_string(&tokens).unwrap();
        self.secrets.set(&OAuthProvider::Google.keyring_account(), &json)?;
        self.cache.lock().unwrap().insert(OAuthProvider::Google.as_str().to_string(), tokens.clone());
        Ok(tokens)
    }

    // ── Anthropic: URL + paste flow ──────────────────────────────────────────

    /// Step 1: Returns (auth_url, verifier). Open auth_url in the browser,
    ///         then call finish_anthropic with the pasted code.
    pub fn start_anthropic_login(&self) -> (String, String) {
        let (verifier, challenge) = pkce_pair();
        let state = verifier.clone(); // Anthropic uses verifier as state
        let url = build_auth_url(OAuthProvider::Anthropic, &challenge, &state);
        (url, verifier)
    }

    /// Step 2: Exchange the code pasted by the user (may be "code#state" or just "code").
    pub async fn finish_anthropic_login(&self, pasted: &str, verifier: &str) -> Result<OAuthTokens, LlmError> {
        // Anthropic encodes code and state as "code#state" in the callback URL
        let code = pasted.split('#').next().unwrap_or(pasted).trim();
        let cfg = config(OAuthProvider::Anthropic);
        let tr = exchange(&cfg, "authorization_code", code, Some(verifier)).await?;
        let now = chrono::Utc::now().timestamp();

        let tokens = OAuthTokens {
            access_token: tr.access_token,
            refresh_token: tr.refresh_token,
            expires_at: now + tr.expires_in.unwrap_or(3600) - MARGIN,
            project_id: None,
            email: None,
        };
        let json = serde_json::to_string(&tokens).unwrap();
        self.secrets.set(&OAuthProvider::Anthropic.keyring_account(), &json)?;
        self.cache.lock().unwrap().insert(OAuthProvider::Anthropic.as_str().to_string(), tokens.clone());
        Ok(tokens)
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

fn urlenc(s: &str) -> String {
    s.bytes().flat_map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => vec![b as char],
        b' ' => vec!['+'],
        b => vec!['%', hex_digit(b >> 4), hex_digit(b & 0xf)],
    }).collect()
}

fn hex_digit(n: u8) -> char {
    (if n < 10 { b'0' + n } else { b'A' + n - 10 }) as char
}

fn url_decode(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h = chars.next().unwrap_or('0');
            let l = chars.next().unwrap_or('0');
            if let Ok(b) = u8::from_str_radix(&format!("{h}{l}"), 16) {
                out.push(b as char);
                continue;
            }
        }
        out.push(if c == '+' { ' ' } else { c });
    }
    out
}
