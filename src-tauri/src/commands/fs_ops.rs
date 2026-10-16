use crate::fs::{VaultEntry, walk_vault};
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
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_entry(path: String, vault_path: String) -> Result<(), String> {
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

    Ok(())
}

#[tauri::command]
pub async fn import_files(
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
            .ok_or_else(|| "io_error: invalid source path".to_string())?;

        // Resolve destination with suffix if needed
        let mut dest = dest_dir.join(filename);
        if dest.exists() {
            let stem = src
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("file");
            let ext = src
                .extension()
                .and_then(|s| s.to_str())
                .map(|e| format!(".{e}"))
                .unwrap_or_default();

            let mut counter = 1u32;
            loop {
                let candidate = dest_dir.join(format!("{stem}_{counter}{ext}"));
                if !candidate.exists() {
                    dest = candidate;
                    break;
                }
                counter += 1;
            }
        }

        std::fs::copy(src, &dest).map_err(|e| format!("io_error: {e}"))?;

        let canonical = dest
            .canonicalize()
            .map_err(|e| format!("io_error: {e}"))?;
        result_paths.push(canonical.to_string_lossy().to_string());
    }

    Ok(result_paths)
}
