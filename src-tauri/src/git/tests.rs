#![allow(clippy::unwrap_used)]

use crate::git::sync::{
    git_connect_apply_inner, git_connect_preview_inner, git_pull_inner, git_push_inner,
    git_status_inner, push_branch, ConnectAction, ConnectCase, ConnectChoice, GitError,
    PushStatus,
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
    git_push_inner(vault_dir.path(), &url, "", false).unwrap();

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
    git_push_inner(vault_dir.path(), &url, "", false).unwrap();

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


// ─── Fixtures for multi-device scenarios (local bare repos, no network) ───────

fn commit_all(repo: &git2::Repository, msg: &str) -> git2::Oid {
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index
        .update_all(["*"].iter(), None)
        .unwrap();
    index.write().unwrap();
    let oid = index.write_tree().unwrap();
    let tree = repo.find_tree(oid).unwrap();
    let sig = git2::Signature::now("Seed", "seed@test.com").unwrap();
    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|t| repo.find_commit(t).ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("refs/heads/main"), &sig, &sig, msg, &tree, &parents)
        .unwrap()
}

/// Seed `url` with `n` notes (`note-<i>.md`) through a throw-away repo.
fn seed_remote(url: &str, n: usize) {
    let work = TempDir::new().unwrap();
    let repo = git2::Repository::init(work.path()).unwrap();
    repo.set_head("refs/heads/main").unwrap();
    std::fs::write(work.path().join(".gitignore"), ".markdaun/\n").unwrap();
    for i in 0..n {
        std::fs::write(work.path().join(format!("note-{i}.md")), format!("note {i}")).unwrap();
    }
    commit_all(&repo, "seed");
    repo.remote("origin", url)
        .unwrap()
        .push(&["refs/heads/main:refs/heads/main"], None)
        .unwrap();
}

/// A real clone of the remote: another device that is in sync with it.
fn clone_device(url: &str) -> TempDir {
    let dir = TempDir::new().unwrap();
    git2::build::RepoBuilder::new()
        .branch("main")
        .clone(url, dir.path())
        .unwrap();
    dir
}

/// Another device edits `files`, commits and pushes (normal push).
fn peer_commit_and_push(dir: &Path, files: &[(&str, &str)]) {
    let repo = git2::Repository::open(dir).unwrap();
    for (name, content) in files {
        if let Some(parent) = Path::new(name).parent() {
            std::fs::create_dir_all(dir.join(parent)).unwrap();
        }
        std::fs::write(dir.join(name), content).unwrap();
    }
    commit_all(&repo, "peer edit");
    repo.find_remote("origin")
        .unwrap()
        .push(&["refs/heads/main:refs/heads/main"], None)
        .unwrap();
}

fn tree_files(repo: &git2::Repository, oid: git2::Oid) -> Vec<String> {
    let tree = repo.find_commit(oid).unwrap().tree().unwrap();
    let mut out = Vec::new();
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, e| {
        if e.kind() == Some(git2::ObjectType::Blob) {
            out.push(format!("{dir}{}", e.name().unwrap()));
        }
        git2::TreeWalkResult::Ok
    })
    .unwrap();
    out.sort();
    out
}

fn blob_at(repo: &git2::Repository, oid: git2::Oid, path: &str) -> String {
    let tree = repo.find_commit(oid).unwrap().tree().unwrap();
    let entry = tree.get_path(Path::new(path)).unwrap();
    let blob = repo.find_blob(entry.id()).unwrap();
    String::from_utf8_lossy(blob.content()).into_owned()
}

fn is_ancestor(repo: &git2::Repository, ancestor: git2::Oid, of: git2::Oid) -> bool {
    ancestor == of || repo.graph_descendant_of(of, ancestor).unwrap()
}

fn conflict_copies(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("(conflicto "))
        .collect();
    v.sort();
    v
}

fn empty_vault_with_noise() -> TempDir {
    // Only `.gitignore` + `.markdaun/` + an empty folder: NOT content.
    let vault = TempDir::new().unwrap();
    std::fs::write(vault.path().join(".gitignore"), ".markdaun/\n").unwrap();
    std::fs::create_dir(vault.path().join(".markdaun")).unwrap();
    std::fs::write(vault.path().join(".markdaun/config.db"), "x").unwrap();
    std::fs::create_dir(vault.path().join("Inbox")).unwrap();
    vault
}

// ─── Regression: 2026-10-18 incident (force push wiped the remote) ────────────

#[test]
fn incident_empty_vault_vs_1000_note_remote_is_never_overwritten() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 1000);
    let before = remote_head(&bare);
    let vault = empty_vault_with_noise();

    let preview = git_connect_preview_inner(vault.path(), &url, "").unwrap();
    assert_eq!(preview.case, ConnectCase::LocalEmpty);
    assert_eq!(preview.remote_count, 1000);
    assert_eq!(preview.local_count, 0);
    assert_eq!(remote_head(&bare), before, "preview must not push anything");
    assert!(!vault.path().join(".git").exists(), "preview must not touch the vault");

    let result =
        git_connect_apply_inner(vault.path(), &url, "", ConnectChoice::Download).unwrap();
    assert_eq!(result.action, ConnectAction::Cloned);
    assert_eq!(remote_head(&bare), before, "remote history must be untouched");
    assert_eq!(tree_files(&bare, before).len(), 1000 + 1); // + .gitignore
    assert!(vault.path().join("note-999.md").exists());
    assert!(vault.path().join("note-0.md").exists());
    assert!(
        vault.path().join(".markdaun/config.db").exists(),
        ".markdaun/ must be kept"
    );
}

// ─── Connect ──────────────────────────────────────────────────────────────────

#[test]
fn connect_remote_empty_pushes_local_notes() {
    let vault = TempDir::new().unwrap();
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    std::fs::write(vault.path().join("note.md"), "# Hello").unwrap();

    let preview = git_connect_preview_inner(vault.path(), &url, "").unwrap();
    assert_eq!(preview.case, ConnectCase::RemoteEmpty);
    assert_eq!(preview.local_count, 1);

    let result = git_connect_apply_inner(vault.path(), &url, "", ConnectChoice::Sync).unwrap();
    assert_eq!(result.action, ConnectAction::Pushed);
    let files = tree_files(&bare, remote_head(&bare));
    assert!(files.contains(&"note.md".to_string()));
    let gi = std::fs::read_to_string(vault.path().join(".gitignore")).unwrap();
    assert!(gi.contains(".markdaun/"));
}

#[test]
fn connect_remote_empty_and_local_empty_does_not_ask_anything_destructive() {
    let vault = empty_vault_with_noise();
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);
    let preview = git_connect_preview_inner(vault.path(), &url, "").unwrap();
    assert_eq!(preview.case, ConnectCase::RemoteEmpty);
    assert_eq!(preview.local_count, 0);
}

#[test]
fn connect_both_have_content_merges_without_force_and_keeps_both_versions() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 3); // note-0..2
    let before = remote_head(&bare);

    let vault = TempDir::new().unwrap();
    std::fs::write(vault.path().join("local-only.md"), "mine").unwrap();
    std::fs::write(vault.path().join("note-0.md"), "LOCAL VERSION").unwrap();

    let preview = git_connect_preview_inner(vault.path(), &url, "").unwrap();
    assert_eq!(preview.case, ConnectCase::BothHaveContent);
    assert_eq!((preview.remote_count, preview.local_count), (3, 2));

    let result = git_connect_apply_inner(vault.path(), &url, "", ConnectChoice::Sync).unwrap();
    assert_eq!(result.action, ConnectAction::Merged);
    assert_eq!(result.conflicts.len(), 1, "note-0.md exists on both sides");

    let after = remote_head(&bare);
    assert!(is_ancestor(&bare, before, after), "original remote history kept (no force)");
    assert_eq!(bare.find_commit(after).unwrap().parent_count(), 2, "merge commit");
    let files = tree_files(&bare, after);
    for f in ["note-0.md", "note-1.md", "note-2.md", "local-only.md"] {
        assert!(files.contains(&f.to_string()), "missing {f} in {files:?}");
    }
    assert_eq!(blob_at(&bare, after, "note-0.md"), "LOCAL VERSION");
    let copy = &result.conflicts[0];
    assert!(copy.starts_with("note-0 (conflicto ") && copy.ends_with(").md"), "{copy}");
    assert_eq!(blob_at(&bare, after, copy), "note 0", "remote version preserved");
    assert!(vault.path().join(copy).exists());
}

#[test]
fn connect_cancel_leaves_remote_and_vault_untouched() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 5);
    let before = remote_head(&bare);
    let vault = TempDir::new().unwrap();
    std::fs::write(vault.path().join("mine.md"), "mine").unwrap();

    // Cancel == never calling apply: only the preview ran.
    git_connect_preview_inner(vault.path(), &url, "").unwrap();

    assert_eq!(remote_head(&bare), before);
    assert!(!vault.path().join(".git").exists(), "repo must not be configured");
    assert!(vault.path().join("mine.md").exists());
}

#[test]
fn connect_apply_with_stale_choice_is_rejected_without_changes() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 5);
    let before = remote_head(&bare);
    let vault = TempDir::new().unwrap();
    std::fs::write(vault.path().join("mine.md"), "mine").unwrap();

    // The user agreed to "download" a LocalEmpty case, but the vault has notes.
    let err = git_connect_apply_inner(vault.path(), &url, "", ConnectChoice::Download)
        .unwrap_err();
    assert!(matches!(err, GitError::StateChanged));
    assert_eq!(remote_head(&bare), before);
    assert!(!vault.path().join(".git").exists());
}

#[test]
fn connect_unrelated_local_history_is_merged_not_replaced() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let before = remote_head(&bare);

    // Vault that already has its own (unrelated) history, like the old orphan commits.
    let vault = TempDir::new().unwrap();
    init_with_commit(vault.path(), "file:///nonexistent");
    git_connect_apply_inner(vault.path(), &url, "", ConnectChoice::Sync).unwrap();

    let after = remote_head(&bare);
    assert!(is_ancestor(&bare, before, after));
    let files = tree_files(&bare, after);
    assert!(files.contains(&"readme.md".to_string()));
    assert!(files.contains(&"note-1.md".to_string()));
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

#[test]
fn pull_fast_forward_preserves_uncommitted_local_edits() {
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("extra.md", "extra")]);

    // Uncommitted local work on the vault.
    std::fs::write(vault.path().join("note-0.md"), "edited locally").unwrap();
    std::fs::write(vault.path().join("draft.md"), "draft").unwrap();

    let res = git_pull_inner(vault.path(), &url, "").unwrap();

    assert!(res.conflicts.is_empty());
    assert_eq!(std::fs::read_to_string(vault.path().join("extra.md")).unwrap(), "extra");
    assert_eq!(
        std::fs::read_to_string(vault.path().join("note-0.md")).unwrap(),
        "edited locally"
    );
    assert_eq!(std::fs::read_to_string(vault.path().join("draft.md")).unwrap(), "draft");
}

#[test]
fn pull_fast_forward_without_local_changes_is_a_plain_fast_forward() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("extra.md", "extra")]);

    git_pull_inner(vault.path(), &url, "").unwrap();

    let repo = git2::Repository::open(vault.path()).unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap(), remote_head(&bare));
    assert!(vault.path().join("extra.md").exists());
}

#[test]
fn pull_divergence_creates_merge_commit_with_both_parents() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("remote_file.md", "remote")]);
    let remote_tip = remote_head(&bare);

    // Local commit that was never pushed.
    std::fs::write(vault.path().join("local_file.md"), "local").unwrap();
    commit_all(&git2::Repository::open(vault.path()).unwrap(), "local");

    let res = git_pull_inner(vault.path(), &url, "").unwrap();
    assert!(res.conflicts.is_empty());

    assert!(vault.path().join("remote_file.md").exists());
    assert!(vault.path().join("local_file.md").exists(), "local work must survive");
    let repo = git2::Repository::open(vault.path()).unwrap();
    let head = repo.find_commit(repo.head().unwrap().target().unwrap()).unwrap();
    assert_eq!(head.parent_count(), 2);
    assert!(is_ancestor(&repo, remote_tip, head.id()));
}

#[test]
fn pull_conflict_keeps_both_versions_with_conflict_filename() {
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("note-0.md", "REMOTE EDIT")]);
    std::fs::write(vault.path().join("note-0.md"), "LOCAL EDIT").unwrap();

    let res = git_pull_inner(vault.path(), &url, "").unwrap();

    assert_eq!(res.conflicts.len(), 1);
    let copies = conflict_copies(vault.path());
    assert_eq!(copies, res.conflicts);
    let name = &copies[0];
    assert!(name.starts_with("note-0 (conflicto 20") && name.ends_with(").md"), "{name}");
    // "YYYY-MM-DD HH-mm"
    let stamp = name
        .trim_start_matches("note-0 (conflicto ")
        .trim_end_matches(").md");
    assert_eq!(stamp.len(), 16, "{stamp}");
    assert_eq!(std::fs::read_to_string(vault.path().join("note-0.md")).unwrap(), "LOCAL EDIT");
    assert_eq!(std::fs::read_to_string(vault.path().join(name)).unwrap(), "REMOTE EDIT");
}

#[test]
fn pull_conflict_in_subfolder_keeps_copy_in_same_folder() {
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);
    {
        let seed = TempDir::new().unwrap();
        let repo = git2::Repository::init(seed.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        std::fs::create_dir(seed.path().join("Area")).unwrap();
        std::fs::write(seed.path().join("Area/a.md"), "base").unwrap();
        commit_all(&repo, "seed");
        repo.remote("origin", &url)
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
    }
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("Area/a.md", "remote")]);
    std::fs::write(vault.path().join("Area/a.md"), "local").unwrap();

    let res = git_pull_inner(vault.path(), &url, "").unwrap();
    assert_eq!(res.conflicts.len(), 1);
    assert!(res.conflicts[0].starts_with("Area/a (conflicto "), "{:?}", res.conflicts);
    assert!(vault.path().join(&res.conflicts[0]).exists());
}

#[test]
fn pull_local_deletion_is_not_resurrected_and_remote_edits_arrive() {
    let bare_dir = TempDir::new().unwrap();
    let (_, url) = bare_repo(&bare_dir);
    seed_remote(&url, 3);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("note-2.md", "edited remotely")]);
    std::fs::remove_file(vault.path().join("note-0.md")).unwrap();

    git_pull_inner(vault.path(), &url, "").unwrap();

    assert!(!vault.path().join("note-0.md").exists());
    assert_eq!(
        std::fs::read_to_string(vault.path().join("note-2.md")).unwrap(),
        "edited remotely"
    );
}

// ─── Push ─────────────────────────────────────────────────────────────────────

#[test]
fn push_commit_has_the_previous_head_as_parent_and_is_not_forced() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let before = remote_head(&bare);
    let vault = clone_device(&url);
    std::fs::write(vault.path().join("new.md"), "new").unwrap();

    git_push_inner(vault.path(), &url, "", false).unwrap();

    let after = remote_head(&bare);
    assert_ne!(after, before);
    let commit = bare.find_commit(after).unwrap();
    assert_eq!(commit.parent_count(), 1);
    assert_eq!(commit.parent_id(0).unwrap(), before);
}

#[test]
fn push_propagates_local_deletions() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 3);
    let vault = clone_device(&url);
    std::fs::remove_file(vault.path().join("note-1.md")).unwrap();

    git_push_inner(vault.path(), &url, "", false).unwrap();

    let files = tree_files(&bare, remote_head(&bare));
    assert!(!files.contains(&"note-1.md".to_string()));
    assert!(files.contains(&"note-0.md".to_string()));
}

#[test]
fn push_when_remote_moved_merges_and_pushes_without_losing_remote_work() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("from-peer.md", "peer")]);
    let peer_tip = remote_head(&bare);
    std::fs::write(vault.path().join("from-vault.md"), "vault").unwrap();

    git_push_inner(vault.path(), &url, "", false).unwrap();

    let after = remote_head(&bare);
    assert!(is_ancestor(&bare, peer_tip, after));
    let files = tree_files(&bare, after);
    assert!(files.contains(&"from-peer.md".to_string()));
    assert!(files.contains(&"from-vault.md".to_string()));
}

#[test]
fn push_branch_reports_non_fast_forward_rejection_instead_of_forcing() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 2);
    let vault = clone_device(&url);
    let peer = clone_device(&url);
    peer_commit_and_push(peer.path(), &[("from-peer.md", "peer")]);
    let peer_tip = remote_head(&bare);
    std::fs::write(vault.path().join("from-vault.md"), "vault").unwrap();
    let repo = git2::Repository::open(vault.path()).unwrap();
    commit_all(&repo, "local");

    let status = push_branch(&repo, "").unwrap();

    assert!(matches!(status, PushStatus::Rejected(_)), "{status:?}");
    assert_eq!(remote_head(&bare), peer_tip, "remote must be untouched");
}

#[test]
fn deletion_guard_blocks_push_above_threshold_until_confirmed() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 20);
    let before = remote_head(&bare);
    let vault = clone_device(&url);
    for i in 0..15 {
        std::fs::remove_file(vault.path().join(format!("note-{i}.md"))).unwrap();
    }

    let res = git_push_inner(vault.path(), &url, "", false).unwrap();
    let warn = res.needs_confirmation.expect("guard must trigger");
    assert_eq!((warn.deleted, warn.total), (15, 20));
    assert_eq!(remote_head(&bare), before, "nothing pushed while unconfirmed");

    let res = git_push_inner(vault.path(), &url, "", true).unwrap();
    assert!(res.needs_confirmation.is_none());
    assert_eq!(tree_files(&bare, remote_head(&bare)).len(), 5 + 1 /* .gitignore */);
}

#[test]
fn deletion_guard_does_not_trigger_below_threshold() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 20);
    let vault = clone_device(&url);
    for i in 0..10 {
        // exactly 50 % is allowed ("more than 50 %" triggers)
        std::fs::remove_file(vault.path().join(format!("note-{i}.md"))).unwrap();
    }

    let res = git_push_inner(vault.path(), &url, "", false).unwrap();

    assert!(res.needs_confirmation.is_none());
    assert_eq!(tree_files(&bare, remote_head(&bare)).len(), 10 + 1);
}

#[test]
fn deletion_guard_ignores_small_repositories() {
    let bare_dir = TempDir::new().unwrap();
    let (bare, url) = bare_repo(&bare_dir);
    seed_remote(&url, 5);
    let vault = clone_device(&url);
    for i in 0..5 {
        std::fs::remove_file(vault.path().join(format!("note-{i}.md"))).unwrap();
    }

    let res = git_push_inner(vault.path(), &url, "", false).unwrap();

    assert!(res.needs_confirmation.is_none(), "fewer than 10 files: no guard");
    assert_eq!(tree_files(&bare, remote_head(&bare)).len(), 1);
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

