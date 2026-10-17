use crate::fs::{VaultEntry, walk_vault};
use super::vault_index::spawn_index_update;
use std::path::Path;

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

#[tauri::command]
pub async fn rename_entry(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
    vault_path: String,
) -> Result<String, String> {
    let entry_path = Path::new(&path);
    let vault = Path::new(&vault_path);

    assert_within_vault(entry_path, vault)?;

    let parent = entry_path
        .parent()
        .ok_or_else(|| "io_error: no parent".to_string())?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::rename(entry_path, &new_path).map_err(|e| format!("io_error: {e}"))?;

    let canonical = new_path
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    let new_abs = canonical.to_string_lossy().to_string();
    spawn_index_update(&app, vault_path, vec![path], vec![new_abs.clone()]);
    Ok(new_abs)
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

#[tauri::command]
pub async fn move_entry(
    app: tauri::AppHandle,
    source_path: String,
    dest_folder_path: String,
    vault_path: String,
) -> Result<String, String> {
    let dest = move_entry_inner(
        Path::new(&source_path),
        Path::new(&dest_folder_path),
        Path::new(&vault_path),
    )?;
    spawn_index_update(&app, vault_path, vec![source_path], vec![dest.clone()]);
    Ok(dest)
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
