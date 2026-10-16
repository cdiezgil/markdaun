use chrono::Utc;
use git2::Repository;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, PartialEq)]
pub enum ConnectAction {
    Pushed,
    Cloned,
}

#[derive(Debug, Error)]
pub enum GitError {
    #[error("git: {0}")]
    Git(#[from] git2::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

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

/// Stage all changed files, create a timestamped commit (if there are changes),
/// then push `refs/heads/main` to `origin`.
pub fn git_push_inner(vault_path: &Path, remote_url: &str, pat: &str) -> Result<(), GitError> {
    let repo = Repository::open(vault_path)?;
    ensure_gitignore(vault_path)?;

    // Check for changes before committing
    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;

    if !statuses.is_empty() {
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let sig = git2::Signature::now("MarkDaun", "app@markdaun.local")?;
        let msg = format!("MarkDaun sync — {}", Utc::now().to_rfc3339());

        let parent_commit = repo
            .head()
            .ok()
            .and_then(|h| h.resolve().ok())
            .and_then(|h| h.target().and_then(|oid| repo.find_commit(oid).ok()));

        let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
        repo.commit(Some("refs/heads/main"), &sig, &sig, &msg, &tree, &parents)?;
    }

    // Ensure remote is pointing to remote_url
    let _remote_url_ref = remote_url; // may differ from stored; use as-is
    let mut remote = match repo.find_remote("origin") {
        Ok(r) => r,
        Err(_) => repo.remote("origin", remote_url)?,
    };

    let pat_owned = pat.to_string();
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        git2::Cred::userpass_plaintext("x-token", &pat_owned)
    });
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote.push(
        &["refs/heads/main:refs/heads/main"],
        Some(&mut push_opts),
    )?;
    Ok(())
}

/// Fetch `origin/main` and fast-forward if possible; otherwise reset hard (remote wins).
pub fn git_pull_inner(vault_path: &Path, remote_url: &str, pat: &str) -> Result<(), GitError> {
    let repo = Repository::open(vault_path)?;

    let pat_owned = pat.to_string();
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        git2::Cred::userpass_plaintext("x-token", &pat_owned)
    });

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    let mut remote = match repo.find_remote("origin") {
        Ok(r) => r,
        Err(_) => repo.remote("origin", remote_url)?,
    };
    remote.fetch(&["main"], Some(&mut fetch_opts), None)?;

    let fetch_head = repo.find_reference("FETCH_HEAD")?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

    if analysis.is_up_to_date() {
        return Ok(());
    }

    if analysis.is_fast_forward() {
        let refname = "refs/heads/main";
        match repo.find_reference(refname) {
            Ok(mut reference) => {
                reference.set_target(fetch_commit.id(), "Fast-Forward")?;
                repo.set_head(refname)?;
                repo.checkout_head(Some(
                    git2::build::CheckoutBuilder::default().force(),
                ))?;
            }
            Err(_) => {
                repo.reference(refname, fetch_commit.id(), true, "Fast-Forward")?;
                repo.set_head(refname)?;
                repo.checkout_head(Some(
                    git2::build::CheckoutBuilder::default().force(),
                ))?;
            }
        }
    } else {
        // Diverged — remote wins: hard reset
        let fetch_obj = repo.find_object(fetch_commit.id(), None)?;
        repo.reset(&fetch_obj, git2::ResetType::Hard, None)?;
        // Clean state
        repo.cleanup_state()?;
    }

    Ok(())
}

/// Connect a vault to a remote GitHub repository.
/// - If the vault has files: init (or open) the repo, commit everything, and push.
/// - If the vault is empty: clone the remote into the vault.
/// Returns what action was taken.
pub fn git_connect_inner(
    vault_path: &Path,
    remote_url: &str,
    pat: &str,
) -> Result<ConnectAction, GitError> {

    if vault_has_files(vault_path) {
        // Open or init a git repo
        let repo = if vault_path.join(".git").exists() {
            Repository::open(vault_path)?
        } else {
            let r = Repository::init(vault_path)?;
            // Ensure HEAD points to main (git2 defaults to master)
            r.set_head("refs/heads/main")?;
            r
        };

        // Set or update remote "origin"
        match repo.find_remote("origin") {
            Ok(_) => {
                repo.remote_set_url("origin", remote_url)?;
            }
            Err(_) => {
                repo.remote("origin", remote_url)?;
            }
        }

        ensure_gitignore(vault_path)?;

        // Stage all
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let sig = git2::Signature::now("MarkDaun", "app@markdaun.local")?;
        let msg = format!("MarkDaun sync — {}", Utc::now().to_rfc3339());

        repo.commit(Some("refs/heads/main"), &sig, &sig, &msg, &tree, &[])?;

        // Force-push
        let mut remote = repo.find_remote("origin")?;
        let pat_owned = pat.to_string();
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username, _allowed| {
            git2::Cred::userpass_plaintext("x-token", &pat_owned)
        });
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        remote.push(
            &["+refs/heads/main:refs/heads/main"],
            Some(&mut push_opts),
        )?;

        Ok(ConnectAction::Pushed)
    } else {
        // Clone into the vault directory
        let pat_owned = pat.to_string();
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username, _allowed| {
            git2::Cred::userpass_plaintext("x-token", &pat_owned)
        });

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        builder.branch("main"); // always clone the main branch
        builder.clone(remote_url, vault_path)?;

        ensure_gitignore(vault_path)?;

        Ok(ConnectAction::Cloned)
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

    // Check if entry is already present (any line that exactly matches)
    if current.lines().any(|l| l.trim() == entry.trim_end_matches('/') || l.trim() == entry) {
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

/// Returns true if the vault has at least one non-hidden file outside `.git`.
fn vault_has_files(vault_path: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(vault_path) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue; // skip hidden dirs/files (.git, .gitignore, etc.)
        }
        return true;
    }
    false
}
