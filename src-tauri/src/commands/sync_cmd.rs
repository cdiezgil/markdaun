use super::vault_index::spawn_vault_sync;
use crate::db::ConfigDb;
use crate::git::error::SyncError;
use crate::git::runner::{self, CycleMode, SyncFinishedPayload, SyncLocks, SyncRunner};
use crate::git::scheduler::Trigger;
use crate::git::{
    git_connect_apply_inner, git_connect_preview_inner, git_status_inner, ConnectChoice,
    ConnectPreview, ConnectResult,
};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(crate) const KEYRING_SERVICE: &str = "markdaun";
pub(crate) const KEYRING_USER: &str = "github-pat";

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

/// `configure_inner` under the vault's sync lock: refuses with `sync_busy`
/// instead of racing a running sync cycle.
pub fn configure_locked(
    locks: &SyncLocks,
    db_path: &Path,
    repo_url: &str,
    pat: &str,
    vault_path: &str,
    choice: ConnectChoice,
) -> Result<ConnectResult, String> {
    let lock = locks.for_vault(vault_path);
    let _guard = lock.try_lock().map_err(|_| "sync_busy".to_string())?;
    configure_inner(db_path, repo_url, pat, vault_path, choice)
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
    let result = configure_locked(
        &app.state::<SyncRunner>().locks,
        &db_path,
        &repo_url,
        &pat,
        &vault_path,
        choice,
    )?;

    // Store PAT in keyring AFTER successful git operation — never in DB
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring_error: {e}"))?;
    entry
        .set_password(&pat)
        .map_err(|e| format!("keyring_error: {e}"))?;

    spawn_vault_sync(&app, vault_path);
    runner::restart(&app);

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
    runner::restart(&app);
    Ok(())
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

// ─── Automatic sync ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggerReason {
    Focus,
    Changed,
    Manual,
}

/// The frontend flushed its pending save and now holds saves.
#[tauri::command]
pub async fn sync_hold_ack(app: tauri::AppHandle) -> Result<(), SyncError> {
    app.state::<SyncRunner>().ack();
    Ok(())
}

#[tauri::command]
pub async fn sync_trigger(app: tauri::AppHandle, reason: TriggerReason) -> Result<(), SyncError> {
    if !app.state::<SyncRunner>().is_active() {
        return Err(SyncError::NotConfigured);
    }
    let t = match reason {
        TriggerReason::Focus => Trigger::Focus,
        TriggerReason::Changed => Trigger::Changed,
        TriggerReason::Manual => {
            app.state::<SyncRunner>().request_mode(CycleMode::Manual);
            Trigger::Manual
        }
    };
    runner::trigger(&app, t);
    Ok(())
}

/// "Continuar" in the deletion dialog: the next cycle pushes with
/// `confirm_deletions` and clears the pause once it succeeds. Refused when
/// no deletion pause is persisted.
#[tauri::command]
pub async fn sync_confirm_deletions(app: tauri::AppHandle) -> Result<(), SyncError> {
    if !app.state::<SyncRunner>().is_active() {
        return Err(SyncError::NotConfigured);
    }
    let db_path = app_db_path(&app).map_err(SyncError::Git)?;
    let db = ConfigDb::open(&db_path).map_err(|e| SyncError::Git(e.to_string()))?;
    runner::confirm_allowed(db.connection())?;
    app.state::<SyncRunner>()
        .request_mode(CycleMode::ConfirmDeletions);
    runner::trigger(&app, Trigger::Manual);
    Ok(())
}

#[tauri::command]
pub async fn sync_dismiss_conflicts(
    app: tauri::AppHandle,
) -> Result<SyncFinishedPayload, SyncError> {
    let db_path = app_db_path(&app).map_err(SyncError::Git)?;
    let db = ConfigDb::open(&db_path).map_err(|e| SyncError::Git(e.to_string()))?;
    crate::git::state::clear_conflicts(db.connection())
        .map_err(|e| SyncError::Git(e.to_string()))?;
    Ok(runner::current_state(&app))
}

#[tauri::command]
pub async fn sync_get_state(app: tauri::AppHandle) -> Result<SyncFinishedPayload, SyncError> {
    Ok(runner::current_state(&app))
}

/// Never fails: quitting must go ahead even when the last cycle could not.
#[tauri::command]
pub async fn sync_before_quit(app: tauri::AppHandle) -> Result<(), SyncError> {
    runner::before_quit(&app).await;
    Ok(())
}

// ─── Open-note conflict copy ──────────────────────────────────────────────────

/// Copies the current on-disk content of `path` (the remote version a cycle
/// just merged) to its sibling `<stem> (conflicto YYYY-MM-DD HH-mm).<ext>`.
/// Returns the copy's vault-relative, `/`-separated path.
pub fn write_conflict_copy_inner(path: &Path, vault: &Path) -> Result<String, String> {
    crate::commands::fs_ops::assert_within_vault(path, vault)?;
    let canonical_vault = vault.canonicalize().map_err(|_| "path_not_found".to_string())?;
    let canonical_path = path.canonicalize().map_err(|_| "path_not_found".to_string())?;
    let rel = canonical_path
        .strip_prefix(&canonical_vault)
        .map_err(|_| "path_outside_vault".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let name = crate::git::sync::conflict_copy_name(
        &rel,
        &crate::git::sync::conflict_stamp(),
        &|n| canonical_vault.join(n).exists(),
    );
    std::fs::copy(&canonical_path, canonical_vault.join(&name))
        .map_err(|e| format!("io_error: {e}"))?;
    Ok(name)
}

#[tauri::command]
pub async fn write_conflict_copy(path: String, vault_path: String) -> Result<String, String> {
    write_conflict_copy_inner(Path::new(&path), Path::new(&vault_path))
}
