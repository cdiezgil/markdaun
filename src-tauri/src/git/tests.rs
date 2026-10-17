#![allow(clippy::unwrap_used)]

use crate::git::sync::{
    git_connect_inner, git_pull_inner, git_push_inner, git_status_inner, ConnectAction,
};
use std::path::Path;
use tempfile::TempDir;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Create an empty bare repo and return its `file://` URL.
fn bare_repo(dir: &TempDir) -> (git2::Repository, String) {
    let repo = git2::Repository::init_bare(dir.path()).unwrap();
    let url = format!("file://{}", dir.path().display());
    (repo, url)
}

/// Init a repo, write a file, commit it, and set up `origin` pointing at `remote_url`.
/// HEAD is set to `refs/heads/main` so status comparisons work correctly.
fn init_with_commit(dir: &Path, remote_url: &str) -> git2::Repository {
    let repo = git2::Repository::init(dir).unwrap();
    // Point HEAD at main before committing so status comparisons work
    repo.set_head("refs/heads/main").unwrap();
    let file = dir.join("readme.md");
    std::fs::write(&file, "hello").unwrap();

    {
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("readme.md")).unwrap();
        index.write().unwrap();
        let oid = index.write_tree().unwrap();
        let tree = repo.find_tree(oid).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();
    }
    repo.remote("origin", remote_url).unwrap();
    repo
}

/// Push the current `refs/heads/main` to the bare remote (no auth needed for file://).
fn push_to_remote(repo: &git2::Repository) {
    let mut remote = repo.find_remote("origin").unwrap();
    remote
        .push(&["refs/heads/main:refs/heads/main"], None)
        .unwrap();
}

/// Return the HEAD commit OID of the remote bare repo.
fn remote_head(bare: &git2::Repository) -> git2::Oid {
    bare.find_reference("refs/heads/main")
        .unwrap()
        .target()
        .unwrap()
}

// ─── TC-01: status detects modified file ──────────────────────────────────────

#[test]
fn status_detects_modified_file() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    let _ = bare;

    init_with_commit(vault_dir.path(), &url);
    // Modify a file without committing
    std::fs::write(vault_dir.path().join("readme.md"), "changed").unwrap();

    let result = git_status_inner(vault_dir.path()).unwrap();
    assert!(result, "TC-01: should detect modified file");
}

// ─── TC-02: status clean repo returns false ───────────────────────────────────

#[test]
fn status_clean_repo_returns_false() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    let _ = bare;

    init_with_commit(vault_dir.path(), &url);
    // Nothing modified — should be clean
    let result = git_status_inner(vault_dir.path()).unwrap();
    assert!(!result, "TC-02: clean repo should return false");
}

// ─── TC-03: status non-git dir returns false ──────────────────────────────────

#[test]
fn status_non_git_dir_returns_false() {
    let dir = TempDir::new().unwrap();
    // No .git directory
    let result = git_status_inner(dir.path()).unwrap();
    assert!(!result, "TC-03: non-git dir should return false");
}

// ─── TC-04: push creates commit in remote ─────────────────────────────────────

#[test]
fn push_creates_commit_in_remote() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);

    // Init vault with an initial commit and push it first
    init_with_commit(vault_dir.path(), &url);
    {
        let repo = git2::Repository::open(vault_dir.path()).unwrap();
        let mut remote = repo.find_remote("origin").unwrap();
        remote
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
    }

    // Now modify a file and call git_push_inner
    std::fs::write(vault_dir.path().join("readme.md"), "updated").unwrap();
    git_push_inner(vault_dir.path(), &url, "").unwrap();

    // The remote should now have the commit
    let remote_head_oid = remote_head(&bare);
    let remote_head_commit = bare.find_commit(remote_head_oid).unwrap();
    // TC-04: commit exists in remote
    assert!(remote_head_commit.message().is_some(), "TC-04: remote has commit");
}

// ─── TC-05: push commit message format ────────────────────────────────────────

#[test]
fn push_commit_message_format() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);

    init_with_commit(vault_dir.path(), &url);
    // Push the initial commit first
    {
        let repo = git2::Repository::open(vault_dir.path()).unwrap();
        push_to_remote(&repo);
    }

    std::fs::write(vault_dir.path().join("readme.md"), "v2").unwrap();
    git_push_inner(vault_dir.path(), &url, "").unwrap();

    let head_oid = remote_head(&bare);
    let commit = bare.find_commit(head_oid).unwrap();
    let msg = commit.message().unwrap_or("");
    // TC-05: message format
    assert!(
        msg.starts_with("MarkDaun sync — "),
        "TC-05: commit message should start with 'MarkDaun sync — ', got: {msg}"
    );
    // The suffix should be a valid RFC3339 timestamp
    let suffix = msg.trim_start_matches("MarkDaun sync — ").trim();
    assert!(
        suffix.contains('T') && (suffix.contains('+') || suffix.contains('Z') || suffix.ends_with('Z')),
        "TC-05: suffix should look like RFC3339, got: {suffix}"
    );
}

// ─── TC-06: pull fast-forward ─────────────────────────────────────────────────

#[test]
fn pull_fast_forward() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let upstream_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    let _ = bare;

    // Set up vault and push initial commit to remote
    init_with_commit(vault_dir.path(), &url);
    {
        let repo = git2::Repository::open(vault_dir.path()).unwrap();
        push_to_remote(&repo);
    }

    // Push a second commit from a different "upstream" clone
    init_with_commit(upstream_dir.path(), &url);
    std::fs::write(upstream_dir.path().join("extra.md"), "extra").unwrap();
    {
        let repo = git2::Repository::open(upstream_dir.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("extra.md")).unwrap();
        index.write().unwrap();
        let oid = index.write_tree().unwrap();
        let tree = repo.find_tree(oid).unwrap();
        let sig = git2::Signature::now("Test", "t@t.com").unwrap();
        let parent_oid = repo
            .head()
            .unwrap()
            .resolve()
            .unwrap()
            .target()
            .unwrap();
        let parent = repo.find_commit(parent_oid).unwrap();
        repo.commit(
            Some("refs/heads/main"),
            &sig,
            &sig,
            "second commit",
            &tree,
            &[&parent],
        )
        .unwrap();
        push_to_remote(&repo);
    }

    // Vault is behind — pull should fast-forward
    git_pull_inner(vault_dir.path(), &url, "").unwrap();

    // The extra.md file should now exist in the vault
    assert!(
        vault_dir.path().join("extra.md").exists(),
        "TC-06: extra.md should be present after fast-forward pull"
    );
}

// ─── TC-07: pull reset hard on divergence ─────────────────────────────────────

#[test]
fn pull_reset_hard_on_divergence() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let upstream_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    let _ = bare;

    // Set up vault and push initial commit to remote
    init_with_commit(vault_dir.path(), &url);
    {
        let repo = git2::Repository::open(vault_dir.path()).unwrap();
        push_to_remote(&repo);
    }

    // Push a remote commit (different file)
    init_with_commit(upstream_dir.path(), &url);
    std::fs::write(upstream_dir.path().join("remote_file.md"), "remote").unwrap();
    {
        let repo = git2::Repository::open(upstream_dir.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("remote_file.md")).unwrap();
        index.write().unwrap();
        let oid = index.write_tree().unwrap();
        let tree = repo.find_tree(oid).unwrap();
        let sig = git2::Signature::now("R", "r@r.com").unwrap();
        let parent_oid = repo.head().unwrap().resolve().unwrap().target().unwrap();
        let parent = repo.find_commit(parent_oid).unwrap();
        repo.commit(
            Some("refs/heads/main"),
            &sig,
            &sig,
            "remote commit",
            &tree,
            &[&parent],
        )
        .unwrap();
        push_to_remote(&repo);
    }

    // Make a LOCAL divergent commit in vault
    std::fs::write(vault_dir.path().join("local_file.md"), "local").unwrap();
    {
        let repo = git2::Repository::open(vault_dir.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("local_file.md")).unwrap();
        index.write().unwrap();
        let oid = index.write_tree().unwrap();
        let tree = repo.find_tree(oid).unwrap();
        let sig = git2::Signature::now("L", "l@l.com").unwrap();
        let parent_oid = repo.head().unwrap().resolve().unwrap().target().unwrap();
        let parent = repo.find_commit(parent_oid).unwrap();
        repo.commit(
            Some("refs/heads/main"),
            &sig,
            &sig,
            "local commit",
            &tree,
            &[&parent],
        )
        .unwrap();
    }

    // Pull — remote wins
    git_pull_inner(vault_dir.path(), &url, "").unwrap();

    // remote_file.md should be present; local_file.md may be gone
    assert!(
        vault_dir.path().join("remote_file.md").exists(),
        "TC-07: remote_file.md should exist after reset hard"
    );
}

// ─── TC-08: connect with files returns Pushed ─────────────────────────────────

#[test]
fn connect_with_files_returns_pushed() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);

    // Create a file in vault (non-hidden)
    std::fs::write(vault_dir.path().join("note.md"), "# Hello").unwrap();

    let result = git_connect_inner(vault_dir.path(), &url, "").unwrap();
    assert_eq!(result, ConnectAction::Pushed, "TC-08: should return Pushed");
}

// ─── TC-09: connect with empty vault returns Cloned ───────────────────────────

#[test]
fn connect_with_empty_vault_returns_cloned() {
    let bare_dir = TempDir::new().unwrap();
    let upstream_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);

    // Seed the remote with content via an upstream clone
    init_with_commit(upstream_dir.path(), &url);
    {
        let repo = git2::Repository::open(upstream_dir.path()).unwrap();
        push_to_remote(&repo);
    }

    // Use a non-existent path: git2 creates it during clone.
    // (Cloning into an existing dir varies by platform; use a fresh path.)
    let root = TempDir::new().unwrap();
    let vault_path = root.path().join("vault");

    let result = git_connect_inner(&vault_path, &url, "").unwrap();
    assert_eq!(result, ConnectAction::Cloned, "TC-09: should return Cloned");
    assert!(
        vault_path.join("readme.md").exists(),
        "TC-09: cloned files should be present in vault"
    );
}

// ─── TC-10: connect_creates_gitignore_entry (vault with files) ────────────────

#[test]
fn connect_creates_gitignore_entry_pushed() {
    let vault_dir = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);

    std::fs::write(vault_dir.path().join("note.md"), "# Note").unwrap();
    git_connect_inner(vault_dir.path(), &url, "").unwrap();

    let gitignore = std::fs::read_to_string(vault_dir.path().join(".gitignore")).unwrap();
    assert!(
        gitignore.contains(".markdaun/"),
        "TC-10: .gitignore should contain .markdaun/"
    );
}

// ─── TC-11: connect_creates_gitignore_entry (empty vault / clone) ─────────────

#[test]
fn connect_creates_gitignore_entry_cloned() {
    let root = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let upstream_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);

    init_with_commit(upstream_dir.path(), &url);
    {
        let repo = git2::Repository::open(upstream_dir.path()).unwrap();
        push_to_remote(&repo);
    }

    let vault_path = root.path().join("vault");
    git_connect_inner(&vault_path, &url, "").unwrap();

    let gitignore = std::fs::read_to_string(vault_path.join(".gitignore")).unwrap();
    assert!(
        gitignore.contains(".markdaun/"),
        "TC-11: .gitignore should contain .markdaun/ after clone"
    );
}

/// Regression: libgit2 was built without the `https` feature, so every
/// GitHub remote failed with "there is no TLS stream available".
#[test]
fn libgit2_is_built_with_https_support() {
    assert!(
        git2::Version::get().https(),
        "git2 must be compiled with the `https` feature to reach GitHub remotes"
    );
}
