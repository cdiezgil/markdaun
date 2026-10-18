use crate::db::h1_follow::H1FollowDb;
use crate::db::ConversationsDb;
use crate::fs::naming::{sanitize_file_stem, unique_name};
use crate::fs::relink::relink_vault;
use crate::fs::{VaultEntry, walk_vault};
use super::brain_cmd::app_db_path;
use super::vault_index::spawn_index_update;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Result of a rename/move: the new location plus the notes whose links were
/// rewritten (so the UI can reload one that is open).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MoveOutcome {
    pub path: String,
    pub rewritten: Vec<String>,
}

fn rel_of(vault: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(vault).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Bookkeeping after `old` was moved/renamed to `new` on disk (both inside
/// `vault`, lexically): rewrites links vault-wide, retargets Brain scopes and
/// carries the H1-follow state. Shared by rename, move and source archiving.
/// `keep_follow` false clears the follow state at the new path (manual rename).
pub(crate) fn finish_relocation(
    vault: &Path,
    old: &Path,
    new: &Path,
    db_path: Option<&Path>,
    keep_follow: bool,
) -> Result<Vec<String>, String> {
    let rewritten = relink_vault(vault, old, new)?
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if let (Some(db), Some(old_rel), Some(new_rel)) = (db_path, rel_of(vault, old), rel_of(vault, new)) {
        let vault_key = vault.to_string_lossy().to_string();
        ConversationsDb::open(db)
            .and_then(|c| c.remap_scope_paths(&vault_key, &old_rel, &new_rel))
            .map_err(|e| format!("io_error: {e}"))?;
        let follow = H1FollowDb::open(db).map_err(|e| format!("io_error: {e}"))?;
        follow.rekey(&vault_key, &old_rel, &new_rel).map_err(|e| format!("io_error: {e}"))?;
        if !keep_follow {
            follow.set_following(&vault_key, &new_rel, false).map_err(|e| format!("io_error: {e}"))?;
        }
    }
    Ok(rewritten)
}

fn index_after_move(app: &tauri::AppHandle, vault_path: String, old: String, new: &str, rewritten: &[String]) {
    let mut added = vec![new.to_string()];
    added.extend(rewritten.iter().filter(|p| p.as_str() != new).cloned());
    spawn_index_update(app, vault_path, vec![old], added);
}

/// Security guard: ensures `path` is strictly within `vault_root`.
/// Both paths are canonicalized before comparison.
pub fn assert_within_vault(path: &Path, vault_root: &Path) -> Result<(), String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;
    let canonical_vault = vault_root
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;

    if !canonical_path.starts_with(&canonical_vault) {
        return Err("path_outside_vault".to_string());
    }
    Ok(())
}

/// Validates a user-supplied entry name (note or folder).
/// Rejects empty/blank names and anything that could act as a path.
pub fn validate_entry_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("invalid_name".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("invalid_name".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid_name".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_vault_tree(vault_path: String) -> Result<Vec<VaultEntry>, String> {
    let root = Path::new(&vault_path);
    walk_vault(root).map_err(|e| format!("io_error: {e}"))
}

#[tauri::command]
pub async fn create_note(
    parent_path: String,
    name: String,
    vault_path: String,
) -> Result<String, String> {
    let parent = Path::new(&parent_path);
    let vault = Path::new(&vault_path);

    assert_within_vault(parent, vault)?;
    validate_entry_name(&name)?;

    let name_with_ext = if name.to_lowercase().ends_with(".md") {
        name.clone()
    } else {
        format!("{name}.md")
    };
    let dest = parent.join(&name_with_ext);

    if dest.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::write(&dest, b"").map_err(|e| format!("io_error: {e}"))?;

    let canonical = dest
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_folder(
    parent_path: String,
    name: String,
    vault_path: String,
) -> Result<String, String> {
    let parent = Path::new(&parent_path);
    let vault = Path::new(&vault_path);

    assert_within_vault(parent, vault)?;
    validate_entry_name(&name)?;

    let dest = parent.join(&name);

    if dest.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::create_dir(&dest).map_err(|e| format!("io_error: {e}"))?;

    let canonical = dest
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Renames an entry on disk and fixes links, scopes and follow state.
/// `keep_follow` is false for manual renames (they stop H1 following).
pub fn rename_entry_inner(
    entry_path: &Path,
    new_name: &str,
    vault: &Path,
    db_path: Option<&Path>,
    keep_follow: bool,
) -> Result<MoveOutcome, String> {
    assert_within_vault(entry_path, vault)?;
    validate_entry_name(new_name)?;

    let parent = entry_path
        .parent()
        .ok_or_else(|| "io_error: no parent".to_string())?;
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::rename(entry_path, &new_path).map_err(|e| format!("io_error: {e}"))?;
    let rewritten = finish_relocation(vault, entry_path, &new_path, db_path, keep_follow)?;
    Ok(MoveOutcome { path: new_path.to_string_lossy().to_string(), rewritten })
}

#[tauri::command]
pub async fn rename_entry(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
    vault_path: String,
) -> Result<MoveOutcome, String> {
    let db = app_db_path(&app)?;
    let out = rename_entry_inner(Path::new(&path), &new_name, Path::new(&vault_path), Some(&db), false)?;
    index_after_move(&app, vault_path, path, &out.path, &out.rewritten);
    Ok(out)
}

/// Result of renaming a note after its H1.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TitleRename {
    /// Whether the note still follows its H1 (false: nothing was touched).
    pub following: bool,
    pub path: String,
    pub rewritten: Vec<String>,
}

/// Renames a note that follows its H1 to the sanitised `title`, resolving
/// collisions with " 2", " 3"… An empty title or an unchanged name is a no-op.
pub fn rename_from_title_inner(
    note_path: &Path,
    title: &str,
    vault: &Path,
    db_path: &Path,
) -> Result<TitleRename, String> {
    assert_within_vault(note_path, vault)?;
    let unchanged = |following: bool| TitleRename {
        following,
        path: note_path.to_string_lossy().to_string(),
        rewritten: vec![],
    };
    let vault_key = vault.to_string_lossy().to_string();
    let rel = rel_of(vault, note_path).ok_or_else(|| "path_outside_vault".to_string())?;
    let follow = H1FollowDb::open(db_path).map_err(|e| format!("io_error: {e}"))?;
    if !follow.is_following(&vault_key, &rel).map_err(|e| format!("io_error: {e}"))? {
        return Ok(unchanged(false));
    }
    let Some(stem) = sanitize_file_stem(title) else { return Ok(unchanged(true)) };
    let current = note_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if current == stem {
        return Ok(unchanged(true));
    }
    let parent = note_path.parent().ok_or_else(|| "io_error: no parent".to_string())?;
    // A change of letter case alone is the same name on case-insensitive disks.
    let dest: PathBuf = if current.to_lowercase() == stem.to_lowercase() {
        parent.join(format!("{stem}.md"))
    } else {
        unique_name(parent, &stem, "md")
    };
    std::fs::rename(note_path, &dest).map_err(|e| format!("io_error: {e}"))?;
    let rewritten = finish_relocation(vault, note_path, &dest, Some(db_path), true)?;
    Ok(TitleRename { following: true, path: dest.to_string_lossy().to_string(), rewritten })
}

#[tauri::command]
pub async fn rename_note_from_title(
    app: tauri::AppHandle,
    path: String,
    title: String,
    vault_path: String,
) -> Result<TitleRename, String> {
    let db = app_db_path(&app)?;
    let out = rename_from_title_inner(Path::new(&path), &title, Path::new(&vault_path), &db)?;
    if out.path != path {
        index_after_move(&app, vault_path, path, &out.path, &out.rewritten);
    }
    Ok(out)
}

/// Creates `Sin título.md` (or `Sin título 2.md`…) with an empty H1 in
/// `parent`, registered as following its H1.
pub fn create_untitled_inner(parent: &Path, vault: &Path, db_path: &Path) -> Result<PathBuf, String> {
    assert_within_vault(parent, vault)?;
    let dest = unique_name(parent, "Sin título", "md");
    std::fs::write(&dest, "# \n").map_err(|e| format!("io_error: {e}"))?;
    let rel = rel_of(vault, &dest).ok_or_else(|| "path_outside_vault".to_string())?;
    H1FollowDb::open(db_path)
        .and_then(|f| f.set_following(&vault.to_string_lossy(), &rel, true))
        .map_err(|e| format!("io_error: {e}"))?;
    Ok(dest)
}

#[tauri::command]
pub async fn create_untitled_note(
    app: tauri::AppHandle,
    parent_path: String,
    vault_path: String,
) -> Result<String, String> {
    let db = app_db_path(&app)?;
    let dest = create_untitled_inner(Path::new(&parent_path), Path::new(&vault_path), &db)?;
    let abs = dest.to_string_lossy().to_string();
    spawn_index_update(&app, vault_path, vec![], vec![abs.clone()]);
    Ok(abs)
}

/// Moves an entry (note or folder) into a destination folder. Testable core.
pub fn move_entry_inner(
    source_path: &Path,
    dest_folder_path: &Path,
    vault_path: &Path,
) -> Result<String, String> {
    assert_within_vault(source_path, vault_path)?;
    assert_within_vault(dest_folder_path, vault_path)?;

    if !dest_folder_path.is_dir() {
        return Err("dest_not_folder".to_string());
    }

    let canonical_source = source_path
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;
    let canonical_dest_folder = dest_folder_path
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;

    // Reject moving a folder into itself or one of its own subfolders
    if canonical_dest_folder.starts_with(&canonical_source) {
        return Err("cannot_move_into_subtree".to_string());
    }

    let file_name = source_path
        .file_name()
        .ok_or_else(|| "io_error: invalid source path".to_string())?;
    let dest = dest_folder_path.join(file_name);

    if dest.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::rename(source_path, &dest).map_err(|e| format!("io_error: {e}"))?;

    let canonical = dest
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Moves an entry and fixes links, scopes and follow state.
pub fn move_with_relink(
    source: &Path,
    dest_folder: &Path,
    vault: &Path,
    db_path: Option<&Path>,
) -> Result<MoveOutcome, String> {
    move_entry_inner(source, dest_folder, vault)?;
    let new = dest_folder.join(source.file_name().ok_or_else(|| "io_error: invalid source path".to_string())?);
    let rewritten = finish_relocation(vault, source, &new, db_path, true)?;
    Ok(MoveOutcome { path: new.to_string_lossy().to_string(), rewritten })
}

#[tauri::command]
pub async fn move_entry(
    app: tauri::AppHandle,
    source_path: String,
    dest_folder_path: String,
    vault_path: String,
) -> Result<MoveOutcome, String> {
    let db = app_db_path(&app)?;
    let out = move_with_relink(
        Path::new(&source_path),
        Path::new(&dest_folder_path),
        Path::new(&vault_path),
        Some(&db),
    )?;
    index_after_move(&app, vault_path, source_path, &out.path, &out.rewritten);
    Ok(out)
}

#[tauri::command]
pub async fn delete_entry(
    app: tauri::AppHandle,
    path: String,
    vault_path: String,
) -> Result<(), String> {
    let entry_path = Path::new(&path);
    let vault = Path::new(&vault_path);

    // Security: assert within vault (handles path traversal — TC-23)
    assert_within_vault(entry_path, vault)?;

    // Prevent deleting the vault root itself
    let canonical_path = entry_path
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;
    let canonical_vault = vault
        .canonicalize()
        .map_err(|_| "path_not_found".to_string())?;

    if canonical_path == canonical_vault {
        return Err("cannot_delete_vault_root".to_string());
    }

    if entry_path.is_dir() {
        std::fs::remove_dir_all(entry_path).map_err(|e| format!("io_error: {e}"))?;
    } else {
        std::fs::remove_file(entry_path).map_err(|e| format!("io_error: {e}"))?;
    }

    if let (Ok(db), Some(rel)) = (app_db_path(&app), rel_of(vault, entry_path)) {
        let _ = H1FollowDb::open(&db).and_then(|f| f.remove(&vault_path, &rel));
    }
    spawn_index_update(&app, vault_path, vec![path], vec![]);
    Ok(())
}

/// Picks a non-existing destination path inside `dest_dir` for `file_name`,
/// adding a `_N` suffix on collision.
pub(crate) fn unique_dest(dest_dir: &Path, file_name: &str) -> std::path::PathBuf {
    let dest = dest_dir.join(file_name);
    if !dest.exists() {
        return dest;
    }
    let stem = std::path::Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = std::path::Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();

    let mut counter = 1u32;
    loop {
        let candidate = dest_dir.join(format!("{stem}_{counter}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Imports dropped file bytes into the vault (HTML5 drop; no source path available).
#[tauri::command]
pub async fn import_file_data(
    app: tauri::AppHandle,
    dest_folder_path: String,
    file_name: String,
    contents: Vec<u8>,
    vault_path: String,
) -> Result<String, String> {
    let dest_dir = Path::new(&dest_folder_path);
    let vault = Path::new(&vault_path);

    assert_within_vault(dest_dir, vault)?;

    // Browsers may report the full source path; keep only the final name.
    let file_name = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "io_error: invalid file name".to_string())?;

    let dest = unique_dest(dest_dir, file_name);
    std::fs::write(&dest, contents).map_err(|e| format!("io_error: {e}"))?;

    let canonical = dest
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    let abs = canonical.to_string_lossy().to_string();
    spawn_index_update(&app, vault_path, vec![], vec![abs.clone()]);
    Ok(abs)
}

#[tauri::command]
pub async fn import_files(
    app: tauri::AppHandle,
    dest_folder_path: String,
    source_paths: Vec<String>,
    vault_path: String,
) -> Result<Vec<String>, String> {
    let dest_dir = Path::new(&dest_folder_path);
    let vault = Path::new(&vault_path);

    assert_within_vault(dest_dir, vault)?;

    let mut result_paths = Vec::new();

    for src_str in &source_paths {
        let src = Path::new(src_str);
        let filename = src
            .file_name()
            .ok_or_else(|| "io_error: invalid source path".to_string())?
            .to_string_lossy()
            .to_string();

        let dest = unique_dest(dest_dir, &filename);

        std::fs::copy(src, &dest).map_err(|e| format!("io_error: {e}"))?;

        let canonical = dest
            .canonicalize()
            .map_err(|e| format!("io_error: {e}"))?;
        result_paths.push(canonical.to_string_lossy().to_string());
    }

    spawn_index_update(&app, vault_path, vec![], result_paths.clone());
    Ok(result_paths)
}
