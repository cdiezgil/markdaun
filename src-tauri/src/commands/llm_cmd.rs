use crate::commands::brain_cmd::app_db_path;
use crate::llm::connection::{AuthSource, Connection, Engine};
use crate::llm::engines::cli;
use crate::llm::env::LlmEnv;
use crate::llm::error::LlmError;
use crate::llm::secrets::{connection_account, KeyringStore};
use crate::llm::store::{ActiveSelection, LlmStore};
use crate::llm::validate::{self, fingerprint, Emit, ProgressEvent, ValidationStore};
use serde::Serialize;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResult {
    pub token: String,
    pub available: Vec<String>,
    pub verified: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDetection {
    pub installed: bool,
    pub path: Option<String>,
}

/// A freshly typed secret wins; otherwise an existing API-key connection falls
/// back to its keyring entry (editing without re-typing the key).
fn effective_secret(env: &LlmEnv, draft: &Connection, typed: Option<String>) -> Result<Option<String>, LlmError> {
    if let Some(s) = typed.filter(|s| !s.is_empty()) {
        return Ok(Some(s));
    }
    if matches!(draft.auth, AuthSource::ApiKey) && !draft.id.is_empty() {
        return env.secret_for(draft);
    }
    Ok(None)
}

pub async fn validate_inner(
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: &Connection,
    typed_secret: Option<String>,
    emit: Emit<'_>,
) -> Result<ValidateResult, LlmError> {
    let secret = effective_secret(env, draft, typed_secret)?;
    let validated = validate::run(draft, secret.as_deref(), env, emit).await?;
    let token = vs.issue(fingerprint(draft, secret.as_deref()), validated.verified.clone());
    Ok(ValidateResult { token, available: validated.available, verified: validated.verified })
}

/// Test-completes one extra model and adds it to the token's verified set.
pub async fn verify_model_inner(
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: &Connection,
    typed_secret: Option<String>,
    token: &str,
    model: &str,
) -> Result<(), LlmError> {
    let secret = effective_secret(env, draft, typed_secret)?;
    validate::test_completion(draft, model, secret.as_deref(), env).await?;
    vs.add_verified(token, fingerprint(draft, secret.as_deref()), model)
}

pub fn save_inner(
    db_path: &Path,
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: Connection,
    typed_secret: Option<String>,
    token: &str,
) -> Result<Connection, LlmError> {
    draft.validate_shape()?;
    if draft.models.is_empty() {
        return Err(LlmError::BadResponse("select at least one model".into()));
    }
    let secret = effective_secret(env, &draft, typed_secret.clone())?;
    if matches!(draft.auth, AuthSource::ApiKey) && secret.is_none() {
        return Err(LlmError::Unauthorized);
    }
    vs.consume(token, fingerprint(&draft, secret.as_deref()), &draft.models)?;

    let store = LlmStore::open(db_path)?;
    let saved = store.upsert(draft)?;
    let account = connection_account(&saved.id);
    match (&saved.auth, typed_secret.filter(|s| !s.is_empty())) {
        (AuthSource::ApiKey, Some(s)) => env.secrets.set(&account, &s)?,
        (AuthSource::ApiKey, None) => {}
        _ => env.secrets.delete(&account)?,
    }
    if store.get_active()?.is_none() {
        store.set_active(&saved.id, &saved.models[0])?;
    }
    Ok(saved)
}

pub fn list_inner(db_path: &Path) -> Result<Vec<Connection>, LlmError> {
    LlmStore::open(db_path)?.list()
}

pub fn delete_inner(db_path: &Path, env: &LlmEnv, id: &str) -> Result<(), LlmError> {
    LlmStore::open(db_path)?.delete(id)?;
    env.secrets.delete(&connection_account(id))
}

pub fn set_active_inner(db_path: &Path, connection_id: &str, model: &str) -> Result<ActiveSelection, LlmError> {
    LlmStore::open(db_path)?.set_active(connection_id, model)
}

pub fn get_active_inner(db_path: &Path) -> Result<Option<ActiveSelection>, LlmError> {
    LlmStore::open(db_path)?.get_active()
}

pub fn detect_cli_inner(env: &LlmEnv, engine: Engine) -> CliDetection {
    match cli::detect(engine, env.resolver.as_ref()) {
        Ok(p) => CliDetection { installed: true, path: Some(p.to_string_lossy().to_string()) },
        Err(_) => CliDetection { installed: false, path: None },
    }
}

/// Best-effort legacy migration at startup; failures are logged, never fatal.
pub fn run_startup_migration(app: &tauri::AppHandle) {
    let result = app_db_path(app)
        .map_err(LlmError::Storage)
        .and_then(|p| LlmStore::open(&p))
        .and_then(|s| s.migrate_legacy(&KeyringStore).and_then(|_| s.migrate_vision()));
    if let Err(e) = result {
        eprintln!("[llm] legacy migration skipped: {e}");
    }
}

// ── Tauri commands (thin wrappers) ────────────────────────────────────────────

#[tauri::command]
pub async fn llm_validate(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
) -> Result<ValidateResult, LlmError> {
    let emit = move |ev: ProgressEvent| {
        let _ = app.emit("llm-validate-progress", ev);
    };
    validate_inner(&env, &vs, &draft, secret, &emit).await
}

#[tauri::command]
pub async fn llm_verify_model(
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
    token: String,
    model: String,
) -> Result<(), LlmError> {
    verify_model_inner(&env, &vs, &draft, secret, &token, &model).await
}

#[tauri::command]
pub async fn llm_save_connection(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
    validation_token: String,
) -> Result<Connection, LlmError> {
    let db_path = app_db_path(&app).map_err(LlmError::Storage)?;
    save_inner(&db_path, &env, &vs, draft, secret, &validation_token)
}

#[tauri::command]
pub async fn llm_list_connections(app: tauri::AppHandle) -> Result<Vec<Connection>, LlmError> {
    list_inner(&app_db_path(&app).map_err(LlmError::Storage)?)
}

#[tauri::command]
pub async fn llm_delete_connection(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    id: String,
) -> Result<(), LlmError> {
    delete_inner(&app_db_path(&app).map_err(LlmError::Storage)?, &env, &id)
}

#[tauri::command]
pub async fn llm_set_active(
    app: tauri::AppHandle,
    connection_id: String,
    model: String,
) -> Result<ActiveSelection, LlmError> {
    set_active_inner(&app_db_path(&app).map_err(LlmError::Storage)?, &connection_id, &model)
}

#[tauri::command]
pub async fn llm_get_active(app: tauri::AppHandle) -> Result<Option<ActiveSelection>, LlmError> {
    get_active_inner(&app_db_path(&app).map_err(LlmError::Storage)?)
}

#[tauri::command]
pub async fn llm_detect_cli(env: tauri::State<'_, LlmEnv>, engine: Engine) -> Result<CliDetection, LlmError> {
    Ok(detect_cli_inner(&env, engine))
}
