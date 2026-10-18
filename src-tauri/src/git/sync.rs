//! Safe, non-destructive GitHub sync.
//!
//! Invariant: no operation here deletes or overwrites data on either side
//! without an explicit confirmation. There are no force pushes and no hard
//! resets. Divergence is resolved with real merges; when the same note changed
//! on both sides, both versions are kept (the remote one as a conflict copy).

use chrono::{Local, Utc};
use git2::{
    build::CheckoutBuilder, ErrorCode, FetchOptions, IndexConflict, IndexEntry, Oid,
    PushOptions, RemoteCallbacks, Repository, Tree,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashSet;
use std::path::Path;
use std::rc::Rc;
use thiserror::Error;

/// Remote-tracking ref for the synced branch.
const REMOTE_REF: &str = "refs/remotes/origin/main";
/// Minimum number of tracked remote files before the deletion guard can fire.
const GUARD_MIN_FILES: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectAction {
    /// Local notes were committed and pushed to an empty remote.
    Pushed,
    /// The remote notes were downloaded into an empty vault.
    Cloned,
    /// Both sides had notes; they were merged and pushed.
    Merged,
}

/// How the local vault and the remote repository compare at connect time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectCase {
    RemoteEmpty,
    LocalEmpty,
    BothHaveContent,
}

/// What the user agreed to in the connect dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectChoice {
    Download,
    Sync,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPreview {
    pub case: ConnectCase,
    pub remote_count: usize,
    pub local_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub action: ConnectAction,
    /// Vault-relative paths of conflict copies created while merging.
    pub conflicts: Vec<String>,
}

/// The push would delete a large share of the notes tracked on the remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionWarning {
    pub deleted: usize,
    pub total: usize,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Vault-relative paths of conflict copies created while merging.
    pub conflicts: Vec<String>,
    /// Set when the push was NOT performed and needs the user's confirmation.
    pub needs_confirmation: Option<DeletionWarning>,
}

#[derive(Debug, Error)]
pub enum GitError {
    #[error("git: {0}")]
    Git(#[from] git2::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("state_changed: the repository or the folder changed since the preview")]
    StateChanged,
    #[error("push_rejected: {0}")]
    PushRejected(String),
}

// ─── Small helpers ────────────────────────────────────────────────────────────

fn callbacks(pat: &str) -> RemoteCallbacks<'static> {
    let pat = pat.to_string();
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |_url, _user, _allowed| git2::Cred::userpass_plaintext("x-token", &pat));
    cb
}

fn signature() -> Result<git2::Signature<'static>, git2::Error> {
    git2::Signature::now("MarkDaun", "app@markdaun.local")
}

fn is_noise(name: &str) -> bool {
    name == ".DS_Store"
}

/// Open the vault repo, or init it with `main` as the unborn branch.
fn open_or_init(vault_path: &Path) -> Result<Repository, GitError> {
    std::fs::create_dir_all(vault_path)?;
    if vault_path.join(".git").exists() {
        return Ok(Repository::open(vault_path)?);
    }
    let repo = Repository::init(vault_path)?;
    repo.set_head("refs/heads/main")?;
    Ok(repo)
}

fn set_origin(repo: &Repository, remote_url: &str) -> Result<(), GitError> {
    match repo.find_remote("origin") {
        Ok(_) => repo.remote_set_url("origin", remote_url)?,
        Err(_) => {
            repo.remote("origin", remote_url)?;
        }
    }
    Ok(())
}

/// Fetch `main` into `refs/remotes/origin/main`. Returns false when the remote
/// has no `main` branch (empty repository). Network/auth errors propagate.
fn fetch_main(repo: &Repository, pat: &str) -> Result<bool, GitError> {
    let mut remote = repo.find_remote("origin")?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(callbacks(pat));
    // NOTE: `Remote::list()` is avoided on purpose: git2 0.19 builds a slice from a
    // null pointer when the remote is empty (UB; aborts in debug builds).
    match remote.fetch(
        &["+refs/heads/main:refs/remotes/origin/main"],
        Some(&mut opts),
        None,
    ) {
        Ok(()) => Ok(true),
        // The remote exists but has no `main` branch yet.
        Err(e) if e.code() == ErrorCode::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

fn remote_tip(repo: &Repository) -> Option<Oid> {
    repo.find_reference(REMOTE_REF).ok().and_then(|r| r.target())
}

fn head_oid(repo: &Repository) -> Option<Oid> {
    repo.head().ok().and_then(|h| h.target())
}

/// Paths of every file in `tree` (excluding `.gitignore` and OS noise).
fn tree_paths(tree: &Tree) -> Result<HashSet<String>, git2::Error> {
    let mut out = HashSet::new();
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            if let Some(name) = entry.name() {
                let path = format!("{dir}{name}");
                if path != ".gitignore" && !is_noise(name) {
                    out.insert(path);
                }
            }
        }
        git2::TreeWalkResult::Ok
    })?;
    Ok(out)
}

fn count_local_content(dir: &Path, top_level: bool) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut n = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if is_noise(&name) {
            continue;
        }
        if top_level && matches!(name.as_ref(), ".git" | ".gitignore" | ".markdaun") {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            n += count_local_content(&entry.path(), false);
        } else {
            n += 1;
        }
    }
    n
}

/// Notes in the vault, ignoring `.git/`, `.gitignore`, `.markdaun/`, `.DS_Store`
/// and empty folders.
fn local_content_count(vault_path: &Path) -> usize {
    count_local_content(vault_path, true)
}

fn classify(remote_count: usize, local_count: usize) -> ConnectCase {
    if remote_count == 0 {
        ConnectCase::RemoteEmpty
    } else if local_count == 0 {
        ConnectCase::LocalEmpty
    } else {
        ConnectCase::BothHaveContent
    }
}

fn remote_content_count(repo: &Repository) -> Result<usize, GitError> {
    match remote_tip(repo) {
        Some(oid) => Ok(tree_paths(&repo.find_commit(oid)?.tree()?)?.len()),
        None => Ok(0),
    }
}

/// Add `.markdaun/` to the `.gitignore` in the vault if it is not already present.
fn ensure_gitignore(vault_path: &Path) -> Result<(), std::io::Error> {
    let gitignore_path = vault_path.join(".gitignore");
    let entry = ".markdaun/";

    let current = if gitignore_path.exists() {
        std::fs::read_to_string(&gitignore_path)?
    } else {
        String::new()
    };

    if current
        .lines()
        .any(|l| l.trim() == entry.trim_end_matches('/') || l.trim() == entry)
    {
        return Ok(());
    }

    let new_content = if current.is_empty() {
        format!("{}\n", entry)
    } else if current.ends_with('\n') {
        format!("{}{}\n", current, entry)
    } else {
        format!("{}\n{}\n", current, entry)
    };

    std::fs::write(&gitignore_path, new_content)
}

// ─── Committing local changes ─────────────────────────────────────────────────

/// Stage every change (additions, edits AND deletions) and commit it on top of
/// the current HEAD. Returns false when there was nothing to commit.
fn commit_local_changes(repo: &Repository) -> Result<bool, GitError> {
    if let Some(workdir) = repo.workdir() {
        ensure_gitignore(workdir)?;
    }
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    let tree_oid = index.write_tree()?;

    let parent = head_oid(repo).and_then(|oid| repo.find_commit(oid).ok());
    if let Some(p) = &parent {
        if p.tree_id() == tree_oid {
            return Ok(false);
        }
    }
    let tree = repo.find_tree(tree_oid)?;
    let sig = signature()?;
    let msg = format!("MarkDaun sync — {}", Utc::now().to_rfc3339());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("refs/heads/main"), &sig, &sig, &msg, &tree, &parents)?;
    Ok(true)
}

// ─── Merging ──────────────────────────────────────────────────────────────────

fn conflict_copy_name(path: &str, stamp: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let p = Path::new(path);
    let dir = p
        .parent()
        .map(|d| d.to_string_lossy().replace('\\', "/"))
        .filter(|d| !d.is_empty());
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let prefix = dir.map(|d| format!("{d}/")).unwrap_or_default();
    let mut candidate = format!("{prefix}{stem} (conflicto {stamp}){ext}");
    let mut n = 2;
    while taken(&candidate) {
        candidate = format!("{prefix}{stem} (conflicto {stamp} {n}){ext}");
        n += 1;
    }
    candidate
}

fn stage0(mut entry: IndexEntry) -> IndexEntry {
    entry.flags &= !0x3000; // clear the merge-stage bits
    entry
}

fn conflict_path(c: &IndexConflict) -> Option<String> {
    c.our
        .as_ref()
        .or(c.their.as_ref())
        .or(c.ancestor.as_ref())
        .map(|e| String::from_utf8_lossy(&e.path).into_owned())
}

/// Union of the lines of two `.gitignore` versions (ours first).
fn union_lines(a: &[u8], b: &[u8]) -> Vec<u8> {
    let a = String::from_utf8_lossy(a);
    let b = String::from_utf8_lossy(b);
    let mut seen = HashSet::new();
    let mut out = String::new();
    for line in a.lines().chain(b.lines()) {
        if seen.insert(line.to_string()) {
            out.push_str(line);
            out.push('\n');
        }
    }
    out.into_bytes()
}

/// Merge `origin/main` into the (fully committed) local `main`.
/// Returns the conflict copies that were created.
fn merge_remote(repo: &Repository, stamp: &str) -> Result<Vec<String>, GitError> {
    let Some(theirs) = remote_tip(repo) else {
        return Ok(vec![]);
    };
    let Some(ours) = head_oid(repo) else {
        // Unborn local branch: just adopt the remote history.
        repo.reference("refs/heads/main", theirs, true, "adopt remote")?;
        repo.set_head("refs/heads/main")?;
        repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
        return Ok(vec![]);
    };
    if ours == theirs || repo.graph_descendant_of(ours, theirs)? {
        return Ok(vec![]); // up to date (or we are ahead)
    }
    if repo.graph_descendant_of(theirs, ours)? {
        // Fast-forward. Everything local is committed, so this loses nothing.
        repo.reference("refs/heads/main", theirs, true, "fast-forward")?;
        repo.set_head("refs/heads/main")?;
        repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
        return Ok(vec![]);
    }

    let our_commit = repo.find_commit(ours)?;
    let their_commit = repo.find_commit(theirs)?;
    let base_tree = match repo.merge_base(ours, theirs) {
        Ok(base) => repo.find_commit(base)?.tree()?,
        // Unrelated histories: merge against an empty ancestor.
        Err(_) => repo.find_tree(repo.treebuilder(None)?.write()?)?,
    };
    let our_tree = our_commit.tree()?;
    let their_tree = their_commit.tree()?;
    let mut idx = repo.merge_trees(&base_tree, &our_tree, &their_tree, None)?;

    let mut copies = Vec::new();
    if idx.has_conflicts() {
        let conflicts: Vec<IndexConflict> = idx.conflicts()?.collect::<Result<_, _>>()?;
        for c in conflicts {
            let Some(path) = conflict_path(&c) else { continue };
            for stage in 1..=3 {
                let _ = idx.remove(Path::new(&path), stage);
            }
            match (c.our, c.their) {
                (Some(o), Some(t)) if path == ".gitignore" => {
                    let a = repo.find_blob(o.id)?;
                    let b = repo.find_blob(t.id)?;
                    let merged = union_lines(a.content(), b.content());
                    let mut e = stage0(o);
                    e.id = repo.blob(&merged)?;
                    e.file_size = merged.len() as u32;
                    idx.add(&e)?;
                }
                (Some(o), Some(t)) => {
                    // Same note edited on both sides: local keeps the path,
                    // the remote version becomes a conflict copy.
                    idx.add(&stage0(o))?;
                    let name = conflict_copy_name(&path, stamp, &|n| {
                        idx.get_path(Path::new(n), 0).is_some()
                            || our_tree.get_path(Path::new(n)).is_ok()
                            || their_tree.get_path(Path::new(n)).is_ok()
                    });
                    let mut copy = stage0(t);
                    copy.path = name.clone().into_bytes();
                    idx.add(&copy)?;
                    copies.push(name);
                }
                // Edited on one side, deleted on the other: keep the file.
                (Some(e), None) | (None, Some(e)) => idx.add(&stage0(e))?,
                (None, None) => {}
            }
        }
    }

    let tree_oid = idx.write_tree_to(repo)?;
    let tree = repo.find_tree(tree_oid)?;
    let sig = signature()?;
    let msg = format!("MarkDaun merge — {}", Utc::now().to_rfc3339());
    repo.commit(
        Some("refs/heads/main"),
        &sig,
        &sig,
        &msg,
        &tree,
        &[&our_commit, &their_commit],
    )?;
    // Everything local was committed before merging, so forcing is lossless.
    repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
    Ok(copies)
}

fn conflict_stamp() -> String {
    Local::now().format("%Y-%m-%d %H-%M").to_string()
}

// ─── Pushing ──────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PushStatus {
    Pushed,
    Rejected(String),
}

/// One push attempt of `main` (never forced).
pub(crate) fn push_branch(repo: &Repository, pat: &str) -> Result<PushStatus, GitError> {
    let rejected: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let sink = Rc::clone(&rejected);
    let mut cb = callbacks(pat);
    cb.push_update_reference(move |_name, status| {
        if let Some(msg) = status {
            *sink.borrow_mut() = Some(msg.to_string());
        }
        Ok(())
    });
    let mut opts = PushOptions::new();
    opts.remote_callbacks(cb);
    let mut remote = repo.find_remote("origin")?;
    match remote.push(&["refs/heads/main:refs/heads/main"], Some(&mut opts)) {
        Ok(()) => match rejected.borrow_mut().take() {
            Some(msg) => Ok(PushStatus::Rejected(msg)),
            None => Ok(PushStatus::Pushed),
        },
        Err(e) if e.code() == ErrorCode::NotFastForward => {
            Ok(PushStatus::Rejected(e.message().to_string()))
        }
        Err(e) => Err(e.into()),
    }
}

/// Push; when rejected as non-fast-forward, fetch + merge and retry once.
fn push_with_retry(
    repo: &Repository,
    pat: &str,
    conflicts: &mut Vec<String>,
) -> Result<(), GitError> {
    match push_branch(repo, pat)? {
        PushStatus::Pushed => Ok(()),
        PushStatus::Rejected(_) => {
            fetch_main(repo, pat)?;
            conflicts.extend(merge_remote(repo, &conflict_stamp())?);
            match push_branch(repo, pat)? {
                PushStatus::Pushed => Ok(()),
                PushStatus::Rejected(msg) => Err(GitError::PushRejected(msg)),
            }
        }
    }
}

fn deletion_warning(repo: &Repository) -> Result<Option<DeletionWarning>, GitError> {
    let (Some(head), Some(tip)) = (head_oid(repo), remote_tip(repo)) else {
        return Ok(None);
    };
    let remote_paths = tree_paths(&repo.find_commit(tip)?.tree()?)?;
    let local_paths = tree_paths(&repo.find_commit(head)?.tree()?)?;
    let total = remote_paths.len();
    let deleted = remote_paths.difference(&local_paths).count();
    if total >= GUARD_MIN_FILES && deleted * 2 > total {
        Ok(Some(DeletionWarning { deleted, total }))
    } else {
        Ok(None)
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Returns true if the vault has uncommitted local changes (or untracked files).
/// Returns false if the vault is clean or if there is no `.git` directory.
pub fn git_status_inner(vault_path: &Path) -> Result<bool, GitError> {
    if !vault_path.join(".git").exists() {
        return Ok(false);
    }
    let repo = Repository::open(vault_path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(!statuses.is_empty())
}

/// Commit local changes on top of HEAD, merge anything new from the remote and
/// push (never forced). When the push would delete most of the remote notes it
/// is NOT performed unless `confirm_deletions` is true.
pub fn git_push_inner(
    vault_path: &Path,
    remote_url: &str,
    pat: &str,
    confirm_deletions: bool,
) -> Result<SyncResult, GitError> {
    let repo = Repository::open(vault_path)?;
    set_origin(&repo, remote_url)?;
    commit_local_changes(&repo)?;

    let mut conflicts = Vec::new();
    if fetch_main(&repo, pat)? {
        conflicts.extend(merge_remote(&repo, &conflict_stamp())?);
        if !confirm_deletions {
            if let Some(warning) = deletion_warning(&repo)? {
                return Ok(SyncResult {
                    conflicts,
                    needs_confirmation: Some(warning),
                });
            }
        }
    }
    push_with_retry(&repo, pat, &mut conflicts)?;
    Ok(SyncResult {
        conflicts,
        needs_confirmation: None,
    })
}

/// Commit local changes, fetch `origin/main` and merge it. Never discards
/// local work: divergence becomes a merge commit, same-note edits keep both
/// versions.
pub fn git_pull_inner(
    vault_path: &Path,
    remote_url: &str,
    pat: &str,
) -> Result<SyncResult, GitError> {
    let repo = Repository::open(vault_path)?;
    set_origin(&repo, remote_url)?;
    commit_local_changes(&repo)?;
    let conflicts = if fetch_main(&repo, pat)? {
        merge_remote(&repo, &conflict_stamp())?
    } else {
        vec![]
    };
    Ok(SyncResult {
        conflicts,
        needs_confirmation: None,
    })
}

/// Look at the remote WITHOUT touching the vault: fetch it into a throw-away
/// bare repository and classify local vs remote content.
pub fn git_connect_preview_inner(
    vault_path: &Path,
    remote_url: &str,
    pat: &str,
) -> Result<ConnectPreview, GitError> {
    let scratch = tempfile::TempDir::new()?;
    let repo = Repository::init_bare(scratch.path())?;
    repo.remote("origin", remote_url)?;
    fetch_main(&repo, pat)?;
    let remote_count = remote_content_count(&repo)?;
    let local_count = local_content_count(vault_path);
    Ok(ConnectPreview {
        case: classify(remote_count, local_count),
        remote_count,
        local_count,
    })
}

/// Connect the vault after the user confirmed `choice` for the previewed case.
/// If the situation changed since the preview, nothing is touched and
/// `StateChanged` is returned.
pub fn git_connect_apply_inner(
    vault_path: &Path,
    remote_url: &str,
    pat: &str,
    choice: ConnectChoice,
) -> Result<ConnectResult, GitError> {
    // Decide against a scratch copy first, so a mismatch leaves the vault untouched.
    let preview = git_connect_preview_inner(vault_path, remote_url, pat)?;
    let action = match (preview.case, choice) {
        (ConnectCase::RemoteEmpty, ConnectChoice::Sync) => ConnectAction::Pushed,
        (ConnectCase::LocalEmpty, ConnectChoice::Download) => ConnectAction::Cloned,
        (ConnectCase::BothHaveContent, ConnectChoice::Sync) => ConnectAction::Merged,
        _ => return Err(GitError::StateChanged),
    };

    let repo = open_or_init(vault_path)?;
    set_origin(&repo, remote_url)?;
    let has_remote = fetch_main(&repo, pat)?;
    let mut conflicts = Vec::new();

    if action == ConnectAction::Cloned && head_oid(&repo).is_none() {
        // Fresh folder: adopt the remote history; keep `.markdaun/` untouched.
        merge_remote(&repo, &conflict_stamp())?;
        ensure_gitignore(vault_path)?;
        return Ok(ConnectResult { action, conflicts });
    }

    commit_local_changes(&repo)?;
    if has_remote {
        conflicts.extend(merge_remote(&repo, &conflict_stamp())?);
    }
    if action != ConnectAction::Cloned {
        push_with_retry(&repo, pat, &mut conflicts)?;
    }
    Ok(ConnectResult { action, conflicts })
}
