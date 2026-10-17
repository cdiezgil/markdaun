use super::connection::{AuthSource, Connection};
use super::engines::{self, ChatMessage};
use super::env::LlmEnv;
use super::error::LlmError;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

pub const TEST_PROMPT: &str = "Reply with the single word: ok";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Reach,
    Credential,
    Models,
    Completion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Running,
    Ok,
    Failed,
}

/// Payload of the `llm-validate-progress` event.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub step: Step,
    pub status: StepStatus,
    pub detail: Option<String>,
    pub error: Option<LlmError>,
}

pub type Emit<'a> = &'a (dyn Fn(ProgressEvent) + Send + Sync);

#[derive(Debug, Clone, PartialEq)]
pub struct Validated {
    /// Models listed by the endpoint (or the CLI's fixed list). Empty = unlisted.
    pub available: Vec<String>,
    /// Models that may be saved: listed ones plus every test-completed one.
    pub verified: Vec<String>,
}

fn step(emit: Emit<'_>, step: Step, status: StepStatus, detail: Option<String>, error: Option<LlmError>) {
    emit(ProgressEvent { step, status, detail, error });
}

fn fail(emit: Emit<'_>, s: Step, e: LlmError) -> LlmError {
    step(emit, s, StepStatus::Failed, None, Some(e.clone()));
    e
}

/// One real round trip with the given model. Never persists anything.
pub async fn test_completion(conn: &Connection, model: &str, secret: Option<&str>, env: &LlmEnv) -> Result<(), LlmError> {
    let msgs = [ChatMessage { role: "user".into(), content: TEST_PROMPT.into() }];
    let answer = engines::chat(conn, model, &msgs, secret, env).await?;
    if answer.trim().is_empty() {
        return Err(LlmError::BadResponse("empty completion".into()));
    }
    Ok(())
}

/// reach -> credential -> models -> completion. Stops at the first failure.
/// `conn.models[0]` is the model used for the test completion.
pub async fn run(conn: &Connection, secret: Option<&str>, env: &LlmEnv, emit: Emit<'_>) -> Result<Validated, LlmError> {
    conn.validate_shape()?;
    let test_model = conn
        .models
        .first()
        .cloned()
        .ok_or_else(|| LlmError::BadResponse("choose a model to test".into()))?;
    if matches!(conn.auth, AuthSource::ApiKey) && secret.is_none_or(str::is_empty) {
        return Err(fail(emit, Step::Credential, LlmError::Unauthorized));
    }

    // 1. Reach: list models (or detect the CLI binary).
    step(emit, Step::Reach, StepStatus::Running, None, None);
    let listed = engines::list_models(conn, secret, env).await;
    if let Err(e) = &listed {
        if matches!(e, LlmError::Unreachable | LlmError::TlsUntrusted | LlmError::Timeout | LlmError::CliMissing) {
            return Err(fail(emit, Step::Reach, e.clone()));
        }
    }
    step(emit, Step::Reach, StepStatus::Ok, None, None);

    // 2. Credential. Some providers reject /models for plan keys but accept chat,
    //    so an Unauthorized listing is re-checked with a real completion.
    //    CLIs are "logged in" only if a completion works.
    step(emit, Step::Credential, StepStatus::Running, None, None);
    if let Err(LlmError::CliNotLoggedIn) = &listed {
        return Err(fail(emit, Step::Credential, LlmError::CliNotLoggedIn));
    }
    let mut completed = false;
    if conn.engine.is_cli() || matches!(&listed, Err(LlmError::Unauthorized)) {
        if let Err(e) = test_completion(conn, &test_model, secret, env).await {
            return Err(fail(emit, Step::Credential, e));
        }
        completed = true;
    }
    step(emit, Step::Credential, StepStatus::Ok, None, None);

    // 3. Models (any other listing failure is treated as "unlisted").
    step(emit, Step::Models, StepStatus::Running, None, None);
    let available = listed.unwrap_or_default();
    let detail = if available.is_empty() { "unlisted".to_string() } else { format!("{} models", available.len()) };
    step(emit, Step::Models, StepStatus::Ok, Some(detail), None);

    // 4. Test completion.
    step(emit, Step::Completion, StepStatus::Running, None, None);
    if !completed {
        if let Err(e) = test_completion(conn, &test_model, secret, env).await {
            return Err(fail(emit, Step::Completion, e));
        }
    }
    step(emit, Step::Completion, StepStatus::Ok, None, None);

    let mut verified = available.clone();
    if !verified.contains(&test_model) {
        verified.push(test_model);
    }
    Ok(Validated { available, verified })
}

// ── validation tokens ─────────────────────────────────────────────────────────

/// Hash of everything that affects connectivity (not name / models / id) plus the
/// effective secret. In-process integrity check, not a security primitive.
pub fn fingerprint(conn: &Connection, secret: Option<&str>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&(
        conn.engine,
        &conn.base_url,
        &conn.auth,
        conn.auth_header,
        &conn.extra_headers,
        &conn.ca_cert_path,
        &conn.azure_api_version,
    ))
    .unwrap_or_default()
    .hash(&mut h);
    secret.unwrap_or("").hash(&mut h);
    h.finish()
}

struct Entry {
    fingerprint: u64,
    verified: HashSet<String>,
}

/// Tokens issued by a successful validation; required (and consumed) by save.
#[derive(Default)]
pub struct ValidationStore {
    inner: Mutex<HashMap<String, Entry>>,
}

impl ValidationStore {
    pub fn issue(&self, fingerprint: u64, verified: impl IntoIterator<Item = String>) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.inner
            .lock()
            .unwrap()
            .insert(token.clone(), Entry { fingerprint, verified: verified.into_iter().collect() });
        token
    }

    pub fn add_verified(&self, token: &str, fingerprint: u64, model: &str) -> Result<(), LlmError> {
        let mut map = self.inner.lock().unwrap();
        match map.get_mut(token) {
            Some(e) if e.fingerprint == fingerprint => {
                e.verified.insert(model.to_string());
                Ok(())
            }
            _ => Err(LlmError::NotValidated),
        }
    }

    /// Succeeds (and burns the token) only if the fingerprint matches and every
    /// model in `models` is verified. A failed attempt keeps the token.
    pub fn consume(&self, token: &str, fingerprint: u64, models: &[String]) -> Result<(), LlmError> {
        let mut map = self.inner.lock().unwrap();
        let ok = match map.get(token) {
            Some(e) => e.fingerprint == fingerprint && models.iter().all(|m| e.verified.contains(m)),
            None => false,
        };
        if !ok {
            return Err(LlmError::NotValidated);
        }
        map.remove(token);
        Ok(())
    }
}
