use crate::db::ConfigDb;
use crate::git::{
    git_connect_apply_inner, git_connect_preview_inner, git_pull_inner, git_push_inner,
    git_status_inner, ConnectChoice, ConnectPreview, ConnectResult, SyncResult,
};
use std::path::{Path, PathBuf};
use tauri::Manager;

const KEYRING_SERVICE: &str = "markdaun";
const KEYRING_USER: &str = "github-pat";

fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("config.db"))
}

/// Validate that the URL starts with `https://`.
fn validate_https_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err("invalid_url".to_string())
    }
}

// ─── Inner helpers (DB + git only, no keyring — fully testable) ───────────────

/// Look at the remote without touching the vault (nothing is persisted).
pub fn connect_preview_inner(
    repo_url: &str,
    pat: &str,
    vault_path: &str,
) -> Result<ConnectPreview, String> {
    git_connect_preview_inner(Path::new(vault_path), repo_url, pat)
        .map_err(|e| format!("git_error: {e}"))
}

/// Connect the vault after the user confirmed `choice`, and persist the repo URL in DB.
/// The PAT is intentionally NOT stored here; the Tauri command layer handles keyring.
pub fn configure_inner(
    db_path: &Path,
    repo_url: &str,
    pat: &str,
    vault_path: &str,
    choice: ConnectChoice,
) -> Result<ConnectResult, String> {
    let result = git_connect_apply_inner(Path::new(vault_path), repo_url, pat, choice)
        .map_err(|e| format!("git_error: {e}"))?;

    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    db.set("github_repo_url", repo_url)
        .map_err(|e| e.to_string())?;
    Ok(result)
}

/// Return the stored `repo_url`, or `None` if not configured.
/// The PAT is NEVER returned (it is not stored in DB).
pub fn get_config_inner(db_path: &Path) -> Result<Option<String>, String> {
    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    let url = db.get("github_repo_url").map_err(|e| e.to_string())?;
    Ok(url.filter(|s| !s.is_empty()))
}

/// Clear the repo URL from DB.
/// PAT removal from keyring is done in the Tauri command layer.
pub fn disconnect_inner(db_path: &Path) -> Result<(), String> {
    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    db.set("github_repo_url", "").map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn github_connect_preview(
    repo_url: String,
    pat: String,
    vault_path: String,
) -> Result<ConnectPreview, String> {
    validate_https_url(&repo_url)?;
    connect_preview_inner(&repo_url, &pat, &vault_path)
}

#[tauri::command]
pub async fn github_connect_apply(
    app: tauri::AppHandle,
    repo_url: String,
    pat: String,
    vault_path: String,
    choice: ConnectChoice,
) -> Result<ConnectResult, String> {
    validate_https_url(&repo_url)?;
    let db_path = app_db_path(&app)?;
    let result = configure_inner(&db_path, &repo_url, &pat, &vault_path, choice)?;

    // Store PAT in keyring AFTER successful git operation — never in DB
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring_error: {e}"))?;
    entry
        .set_password(&pat)
        .map_err(|e| format!("keyring_error: {e}"))?;

    Ok(result)
}

#[tauri::command]
pub async fn github_get_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db_path = app_db_path(&app)?;
    get_config_inner(&db_path)
}

#[tauri::command]
pub async fn github_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app_db_path(&app)?;
    // Clear URL from DB
    disconnect_inner(&db_path)?;
    // Remove PAT from keyring (best effort — ignore if not found)
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub async fn github_push(
    app: tauri::AppHandle,
    confirm_deletions: Option<bool>,
) -> Result<SyncResult, String> {
    let db_path = app_db_path(&app)?;
    let db = ConfigDb::open(&db_path).map_err(|e| e.to_string())?;

    let repo_url = db
        .get("github_repo_url")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "not_configured".to_string())?;

    let vault_path = db
        .get("active_vault")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "not_configured".to_string())?;

    let pat = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring_error: {e}"))?
        .get_password()
        .map_err(|e| format!("keyring_error: {e}"))?;

    git_push_inner(
        Path::new(&vault_path),
        &repo_url,
        &pat,
        confirm_deletions.unwrap_or(false),
    )
        .map_err(|e| format!("git_error: {e}"))
}

#[tauri::command]
pub async fn github_pull(app: tauri::AppHandle) -> Result<SyncResult, String> {
    let db_path = app_db_path(&app)?;
    let db = ConfigDb::open(&db_path).map_err(|e| e.to_string())?;

    let repo_url = db
        .get("github_repo_url")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "not_configured".to_string())?;

    let vault_path = db
        .get("active_vault")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "not_configured".to_string())?;

    let pat = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring_error: {e}"))?
        .get_password()
        .map_err(|e| format!("keyring_error: {e}"))?;

    git_pull_inner(Path::new(&vault_path), &repo_url, &pat)
        .map_err(|e| format!("git_error: {e}"))
}

#[tauri::command]
pub async fn github_status(app: tauri::AppHandle) -> Result<bool, String> {
    let db_path = app_db_path(&app)?;
    let db = ConfigDb::open(&db_path).map_err(|e| e.to_string())?;

    let vault_path = db
        .get("active_vault")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "not_configured".to_string())?;

    git_status_inner(Path::new(&vault_path)).map_err(|e| format!("git_error: {e}"))
}
