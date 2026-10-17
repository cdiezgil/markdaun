use super::connection::{AuthSource, Connection};
use super::error::LlmError;
use super::proc::{self, BinaryResolver};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// What goes into the auth header (or nothing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    None,
    Secret(String),
}

pub trait Clock: Send + Sync {
    fn now_unix(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> i64 {
        chrono::Utc::now().timestamp()
    }
}

/// Tokens are refreshed when fewer than this many seconds remain.
pub const REFRESH_MARGIN_SECS: i64 = 300;

/// Obtains Entra ID tokens through `az account get-access-token`, cached per scope.
pub struct AzTokenProvider {
    resolver: Arc<dyn BinaryResolver>,
    clock: Arc<dyn Clock>,
    timeout: Duration,
    cache: Mutex<HashMap<String, (String, i64)>>,
}

fn looks_not_logged_in(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    ["az login", "not logged in", "aadsts", "interactive authentication is needed", "refresh token has expired"]
        .iter()
        .any(|m| s.contains(m))
}

fn parse_local_datetime(s: &str) -> Option<i64> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f").ok()?;
    chrono::Local.from_local_datetime(&naive).single().map(|d| d.timestamp())
}

/// Returns (token, expiry as unix seconds). Accepts `expires_on` (number or
/// numeric string) and falls back to the local-time `expiresOn` string.
fn parse_token(stdout: &str, now: i64) -> Result<(String, i64), LlmError> {
    let v: Value =
        serde_json::from_str(stdout.trim()).map_err(|e| LlmError::BadResponse(format!("az output: {e}")))?;
    let token = v
        .get("accessToken")
        .or_else(|| v.get("access_token"))
        .and_then(Value::as_str)
        .ok_or_else(|| LlmError::BadResponse("az output: missing accessToken".into()))?
        .to_string();
    let exp = v
        .get("expires_on")
        .and_then(|e| e.as_i64().or_else(|| e.as_str().and_then(|s| s.parse().ok())))
        .or_else(|| v.get("expiresOn").and_then(Value::as_str).and_then(parse_local_datetime))
        .unwrap_or(now + REFRESH_MARGIN_SECS);
    Ok((token, exp))
}

impl AzTokenProvider {
    pub fn new(resolver: Arc<dyn BinaryResolver>, clock: Arc<dyn Clock>, timeout: Duration) -> Self {
        Self { resolver, clock, timeout, cache: Mutex::new(HashMap::new()) }
    }

    pub async fn token(&self, scope: &str) -> Result<String, LlmError> {
        let now = self.clock.now_unix();
        {
            let cache = self.cache.lock().unwrap();
            if let Some((tok, exp)) = cache.get(scope) {
                if exp - now > REFRESH_MARGIN_SECS {
                    return Ok(tok.clone());
                }
            }
        }
        let bin = self.resolver.resolve("az").ok_or(LlmError::CliMissing)?;
        let args: Vec<String> = ["account", "get-access-token", "--scope", scope, "--output", "json"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let out = proc::run(&bin, &args, None, &[], &std::env::temp_dir(), self.timeout).await?;
        if out.code != Some(0) {
            if looks_not_logged_in(&out.stderr) {
                return Err(LlmError::CliNotLoggedIn);
            }
            let snippet: String = out.stderr.trim().chars().take(300).collect();
            return Err(LlmError::BadResponse(format!("az failed: {snippet}")));
        }
        let (tok, exp) = parse_token(&out.stdout, now)?;
        self.cache.lock().unwrap().insert(scope.to_string(), (tok.clone(), exp));
        Ok(tok)
    }
}

/// Turns the connection's `AuthSource` into a concrete credential.
/// `secret` is the keyring value (or the freshly typed one during validation).
pub async fn resolve(conn: &Connection, secret: Option<&str>, az: &AzTokenProvider) -> Result<Credential, LlmError> {
    match &conn.auth {
        AuthSource::None => Ok(Credential::None),
        AuthSource::ApiKey => match secret.filter(|s| !s.is_empty()) {
            Some(s) => Ok(Credential::Secret(s.to_string())),
            None => Err(LlmError::Unauthorized),
        },
        AuthSource::AzureCli { scope } => Ok(Credential::Secret(az.token(scope).await?)),
    }
}
