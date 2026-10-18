#![allow(clippy::unwrap_used)]

//! Tests for sync_cmd inner functions.
//!
//! The inner functions (`configure_inner`, `get_config_inner`, `disconnect_inner`)
//! operate only on the ConfigDb — they do NOT touch the system keyring.
//! This makes them fully testable without a mock keyring or AppHandle.
//! The Tauri command layer (`github_configure`, `github_disconnect`) adds keyring
//! operations on top, but those require an AppHandle and are not unit-tested here.

use crate::commands::sync_cmd::{configure_inner, disconnect_inner, get_config_inner};
use crate::db::ConfigDb;
use crate::git::ConnectChoice;
use tempfile::TempDir;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Create a temp DB file and pre-open it (creates tables).
fn mem_db() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("config.db");
    ConfigDb::open(&path).unwrap();
    (dir, path)
}

/// Create a small vault with a visible file so vault_has_files returns true.
fn vault_with_file() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("note.md"), "# Hello").unwrap();
    dir
}

/// Create a bare git repo and return its file:// URL.
fn bare_remote() -> (TempDir, String) {
    let dir = TempDir::new().unwrap();
    git2::Repository::init_bare(dir.path()).unwrap();
    let url = format!("file://{}", dir.path().display());
    (dir, url)
}

// ─── TC-12: PAT is stored in keyring (not DB) ─────────────────────────────────
//
// Architecture invariant: `configure_inner` persists only `github_repo_url` in DB.
// The PAT is handled exclusively by the Tauri command layer (github_configure).
// This test verifies:
//   a) configure_inner succeeds
//   b) DB contains `github_repo_url` = the URL
//   c) DB does NOT contain the PAT as a value anywhere

#[test]
fn pat_stored_in_keyring_not_db() {
    let vault = vault_with_file();
    let (_remote_dir, remote_url) = bare_remote();
    let (_db_dir, db_path) = mem_db();

    let result = configure_inner(
        &db_path,
        &remote_url,
        "my-secret-pat",
        vault.path().to_str().unwrap(),
        ConnectChoice::Sync,
    );
    assert!(result.is_ok(), "TC-12: configure_inner should succeed");

    // DB must store the repo URL
    let db = ConfigDb::open(&db_path).unwrap();
    let stored_url = db.get("github_repo_url").unwrap();
    assert_eq!(
        stored_url.as_deref(),
        Some(remote_url.as_str()),
        "TC-12: DB must store github_repo_url"
    );

    // DB must NOT contain the PAT as a key
    let pat_as_key = db.get("my-secret-pat").unwrap();
    assert!(pat_as_key.is_none(), "TC-12: PAT must not be stored as a DB key");

    // DB must NOT contain the PAT inside the URL value
    let url_has_pat = stored_url
        .map(|u| u.contains("my-secret-pat"))
        .unwrap_or(false);
    assert!(!url_has_pat, "TC-12: URL stored in DB must not contain the PAT");
}

// ─── TC-13: get_config_inner returns URL, never PAT ───────────────────────────

#[test]
fn get_config_does_not_return_pat() {
    let vault = vault_with_file();
    let (_remote_dir, remote_url) = bare_remote();
    let (_db_dir, db_path) = mem_db();

    configure_inner(
        &db_path,
        &remote_url,
        "super-secret",
        vault.path().to_str().unwrap(),
        ConnectChoice::Sync,
    )
    .unwrap();

    let config = get_config_inner(&db_path).unwrap();
    let url = config.expect("TC-13: should return Some(repo_url)");

    assert_eq!(url, remote_url, "TC-13: must return the stored repo URL");
    assert!(
        !url.contains("super-secret"),
        "TC-13: returned value must not contain the PAT"
    );
}

// ─── TC-14: disconnect_inner clears URL from DB ───────────────────────────────

#[test]
fn disconnect_removes_url_and_pat() {
    let vault = vault_with_file();
    let (_remote_dir, remote_url) = bare_remote();
    let (_db_dir, db_path) = mem_db();

    configure_inner(
        &db_path,
        &remote_url,
        "another-pat",
        vault.path().to_str().unwrap(),
        ConnectChoice::Sync,
    )
    .unwrap();

    // Verify URL is present
    assert!(get_config_inner(&db_path).unwrap().is_some());

    disconnect_inner(&db_path).unwrap();

    // URL must now be gone
    let after = get_config_inner(&db_path).unwrap();
    assert!(
        after.is_none(),
        "TC-14: github_repo_url must be cleared after disconnect"
    );
}
