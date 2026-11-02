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
use crate::git::sync::ConnectAction;
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

// ─── TC-65: spawn_vault_sync is triggered on successful pull/connect ───────────────
//
// spawn_vault_sync requires AppHandle and cannot be unit-tested here.
// These tests verify the success paths of configure_inner that the Tauri
// layer builds on (the same paths that trigger spawn_vault_sync in prod).

#[test]
fn tc_65a_configure_inner_sync_pushes_local_notes_to_empty_remote() {
    let vault = vault_with_file();
    let (_remote_dir, remote_url) = bare_remote();
    let (_db_dir, db_path) = mem_db();

    let result = configure_inner(
        &db_path,
        &remote_url,
        "unused-pat",
        vault.path().to_str().unwrap(),
        ConnectChoice::Sync,
    );

    assert!(result.is_ok(), "TC-65a: configure_inner should succeed");
    assert_eq!(
        result.unwrap().action,
        ConnectAction::Pushed,
        "TC-65a: local notes pushed to empty remote"
    );
}

#[test]
fn tc_65b_configure_inner_download_clones_remote_into_empty_vault() {
    // Step 1: populate a bare remote via a first vault.
    let source_vault = vault_with_file();
    let (_remote_dir, remote_url) = bare_remote();
    let (_db_dir1, db_path1) = mem_db();
    configure_inner(
        &db_path1,
        &remote_url,
        "unused-pat",
        source_vault.path().to_str().unwrap(),
        ConnectChoice::Sync,
    )
    .expect("TC-65b setup: push to remote");

    // Step 2: download remote into an empty vault.
    let empty_vault = TempDir::new().unwrap();
    let (_db_dir2, db_path2) = mem_db();
    let result = configure_inner(
        &db_path2,
        &remote_url,
        "unused-pat",
        empty_vault.path().to_str().unwrap(),
        ConnectChoice::Download,
    );

    assert!(result.is_ok(), "TC-65b: configure_inner download should succeed");
    assert_eq!(
        result.unwrap().action,
        ConnectAction::Cloned,
        "TC-65b: remote downloaded into empty vault"
    );
}

// ─── Automatic sync runner: one cycle against a bare remote ────────────────────

mod runner_cycle {
    use super::{bare_remote, mem_db, vault_with_file};
    use crate::commands::sync_cmd::{configure_inner, configure_locked};
    use crate::db::ConfigDb;
    use crate::git::runner::{confirm_allowed, run_cycle_inner, CycleMode, SyncLocks};
    use crate::git::scheduler::Outcome;
    use crate::git::state;
    use crate::git::ConnectChoice;
    use std::path::Path;
    use tempfile::TempDir;

    /// A connected vault with `n` notes already pushed to `url`.
    fn connected_vault(url: &str, db_path: &Path, n: usize) -> TempDir {
        let dir = TempDir::new().unwrap();
        for i in 0..n {
            std::fs::write(dir.path().join(format!("note{i}.md")), format!("# {i}")).unwrap();
        }
        configure_inner(db_path, url, "pat", dir.path().to_str().unwrap(), ConnectChoice::Sync)
            .unwrap();
        dir
    }

    /// Number of `.md` notes on the remote's `main`.
    fn remote_notes(url: &str) -> usize {
        let repo = git2::Repository::open_bare(url.trim_start_matches("file://")).unwrap();
        let tree = repo
            .find_reference("refs/heads/main")
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .tree()
            .unwrap();
        tree.iter()
            .filter(|e| e.name().is_some_and(|n| n.ends_with(".md")))
            .count()
    }

    fn delete_notes(vault: &Path, n: usize) {
        for i in 0..n {
            std::fs::remove_file(vault.join(format!("note{i}.md"))).unwrap();
        }
    }

    #[test]
    fn deletion_guard_sets_paused_reason() {
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();
        let vault = connected_vault(&url, &db_path, 12);
        delete_notes(vault.path(), 11);
        let db = ConfigDb::open(&db_path).unwrap();
        let c = db.connection();

        let run = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::Auto);
        assert_eq!(run.outcome, Outcome::Paused);
        assert!(run.error.is_none(), "{:?}", run.error);
        assert!(run.report.unwrap().needs_confirmation.is_some());
        assert_eq!(state::paused_reason(c).as_deref(), Some("deletion"));
        assert_eq!(remote_notes(&url), 12, "guard must block the push");

        // While paused, automatic cycles keep committing but never push.
        std::fs::write(vault.path().join("new.md"), "# new").unwrap();
        let again = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::Auto);
        assert_eq!(again.outcome, Outcome::Paused);
        let report = again.report.unwrap();
        assert!(!report.pushed);
        assert!(report.needs_confirmation.is_none());
        assert_eq!(remote_notes(&url), 12);
        assert_eq!(state::paused_reason(c).as_deref(), Some("deletion"));
        assert_eq!(state::last_success(c), None);
    }

    #[test]
    fn confirm_clears_pause_and_pushes() {
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();
        let vault = connected_vault(&url, &db_path, 12);
        delete_notes(vault.path(), 11);
        let db = ConfigDb::open(&db_path).unwrap();
        let c = db.connection();
        run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::Auto);

        // "Sincronizar ahora" re-checks the guard: the dialog comes back.
        let manual = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::Manual);
        assert_eq!(manual.outcome, Outcome::Paused);
        assert!(manual.report.unwrap().needs_confirmation.is_some());
        assert_eq!(remote_notes(&url), 12);

        let run = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::ConfirmDeletions);
        assert_eq!(run.outcome, Outcome::Ok);
        assert!(run.report.unwrap().pushed);
        assert_eq!(state::paused_reason(c), None);
        assert!(state::last_success(c).is_some());
        assert_eq!(remote_notes(&url), 1);
    }

    #[test]
    fn confirm_without_persisted_pause_still_trips_guard() {
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();
        let vault = connected_vault(&url, &db_path, 12);
        delete_notes(vault.path(), 11);
        let db = ConfigDb::open(&db_path).unwrap();
        let c = db.connection();
        assert_eq!(state::paused_reason(c), None);

        // A stale "Continuar" with no deletion pause on record.
        let run = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::ConfirmDeletions);
        assert_eq!(run.outcome, Outcome::Paused);
        assert!(run.report.unwrap().needs_confirmation.is_some());
        assert_eq!(remote_notes(&url), 12, "guard must still block the push");
        assert_eq!(state::paused_reason(c).as_deref(), Some("deletion"));
    }

    #[test]
    fn confirm_requires_a_deletion_pause() {
        let (_d, db_path) = mem_db();
        let db = ConfigDb::open(&db_path).unwrap();
        let c = db.connection();
        assert!(confirm_allowed(c).is_err());
        state::set_paused_reason(c, Some("other")).unwrap();
        assert!(confirm_allowed(c).is_err());
        state::set_paused_reason(c, Some("deletion")).unwrap();
        assert!(confirm_allowed(c).is_ok());
    }

    #[test]
    fn manual_cycle_lifts_pause_once_files_are_restored() {
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();
        let vault = connected_vault(&url, &db_path, 12);
        let db = ConfigDb::open(&db_path).unwrap();
        let c = db.connection();
        state::set_paused_reason(c, Some("deletion")).unwrap();

        let run = run_cycle_inner(c, vault.path(), &url, "pat", CycleMode::Manual);
        assert_eq!(run.outcome, Outcome::Ok);
        assert_eq!(state::paused_reason(c), None);
    }

    #[test]
    fn conflicts_persist_across_cycles() {
        let (_r, url) = bare_remote();
        let (_da, db_a) = mem_db();
        let (_db, db_b) = mem_db();
        let a = vault_with_file();
        configure_inner(&db_a, &url, "pat", a.path().to_str().unwrap(), ConnectChoice::Sync)
            .unwrap();
        let b = TempDir::new().unwrap();
        configure_inner(&db_b, &url, "pat", b.path().to_str().unwrap(), ConnectChoice::Download)
            .unwrap();

        std::fs::write(a.path().join("note.md"), "# from A").unwrap();
        std::fs::write(b.path().join("note.md"), "# from B").unwrap();
        let ca = ConfigDb::open(&db_a).unwrap();
        let cb = ConfigDb::open(&db_b).unwrap();
        assert_eq!(
            run_cycle_inner(ca.connection(), a.path(), &url, "pat", CycleMode::Auto).outcome,
            Outcome::Ok
        );

        let first = run_cycle_inner(cb.connection(), b.path(), &url, "pat", CycleMode::Auto);
        assert_eq!(first.outcome, Outcome::Ok);
        let conflicts = first.report.unwrap().conflicts;
        assert_eq!(conflicts.len(), 1, "{conflicts:?}");
        assert_eq!(state::pending_conflicts(cb.connection()), conflicts);

        let second = run_cycle_inner(cb.connection(), b.path(), &url, "pat", CycleMode::Auto);
        assert!(second.report.unwrap().conflicts.is_empty());
        assert_eq!(state::pending_conflicts(cb.connection()), conflicts);
    }

    #[test]
    fn offline_maps_to_offline_outcome() {
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();
        let vault = connected_vault(&url, &db_path, 1);
        let db = ConfigDb::open(&db_path).unwrap();
        let run = run_cycle_inner(
            db.connection(),
            vault.path(),
            "https://127.0.0.1:1/none.git",
            "pat",
            CycleMode::Auto,
        );
        assert_eq!(run.outcome, Outcome::Offline, "{:?}", run.error);
        assert!(run.report.is_none());
    }

    #[test]
    fn connect_apply_and_cycle_share_lock() {
        let locks = SyncLocks::default();
        let vault = vault_with_file();
        let vault_str = vault.path().to_str().unwrap();
        let (_r, url) = bare_remote();
        let (_d, db_path) = mem_db();

        let lock = locks.for_vault(vault_str);
        let guard = lock.try_lock().unwrap();
        let err = configure_locked(&locks, &db_path, &url, "pat", vault_str, ConnectChoice::Sync)
            .unwrap_err();
        assert_eq!(err, "sync_busy");
        assert!(!vault.path().join(".git").exists(), "vault must stay untouched");

        drop(guard);
        assert!(configure_locked(&locks, &db_path, &url, "pat", vault_str, ConnectChoice::Sync)
            .is_ok());
    }
}
