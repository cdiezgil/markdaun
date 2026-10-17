//! Commands that let the Second Brain chat create or extend Markdown notes.
//! Every path is relative to the vault and validated before touching disk.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    Create,
    Append,
}

impl WriteMode {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "create" => Ok(Self::Create),
            "append" => Ok(Self::Append),
            _ => Err("invalid_mode".to_string()),
        }
    }
}

const INVALID: &str = "invalid_path";

/// Validates `rel` lexically (relative, no `..`, `.md`) and against symlink
/// escapes (deepest existing ancestor must canonicalize inside the vault).
fn resolve(vault: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let is_md = rel_path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if rel.is_empty() || !is_md || rel_path.is_absolute() {
        return Err(INVALID.into());
    }
    if !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(INVALID.into());
    }
    let canonical_vault = vault.canonicalize().map_err(|_| INVALID.to_string())?;
    let full = canonical_vault.join(rel_path);
    let mut ancestor = full.parent().ok_or_else(|| INVALID.to_string())?;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(|| INVALID.to_string())?;
    }
    let canonical_ancestor = ancestor.canonicalize().map_err(|_| INVALID.to_string())?;
    if !canonical_ancestor.starts_with(&canonical_vault) {
        return Err(INVALID.into());
    }
    Ok(full)
}

pub(crate) fn write_note_inner(
    vault: &Path,
    rel: &str,
    content: &str,
    mode: WriteMode,
) -> Result<String, String> {
    let full = resolve(vault, rel)?;
    match mode {
        WriteMode::Create => {
            if full.exists() {
                return Err("already_exists".into());
            }
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("io_error: {e}"))?;
            }
            std::fs::write(&full, content).map_err(|e| format!("io_error: {e}"))?;
        }
        WriteMode::Append => {
            if !full.is_file() {
                return Err("not_found".into());
            }
            let existing = std::fs::read_to_string(&full).map_err(|e| format!("io_error: {e}"))?;
            let merged = format!(
                "{}\n\n{}\n",
                existing.trim_end_matches('\n'),
                content.trim_end_matches('\n')
            );
            std::fs::write(&full, merged).map_err(|e| format!("io_error: {e}"))?;
        }
    }
    Ok(full.to_string_lossy().to_string())
}

pub(crate) fn note_exists_inner(vault: &Path, rel: &str) -> Result<bool, String> {
    Ok(resolve(vault, rel)?.is_file())
}

pub(crate) fn read_note_tail_inner(vault: &Path, rel: &str, lines: usize) -> Result<String, String> {
    let full = resolve(vault, rel)?;
    if !full.is_file() {
        return Err("not_found".into());
    }
    let text = std::fs::read_to_string(&full).map_err(|e| format!("io_error: {e}"))?;
    let all: Vec<&str> = text.trim_end_matches('\n').lines().collect();
    let start = all.len().saturating_sub(lines);
    Ok(all[start..].join("\n"))
}

/// Phase B hook: re-embed a note after the chat wrote it. Intentionally a
/// no-op until it is wired to the embedding update path.
fn reindex_after_write(_abs_path: &str, _vault_path: &str) {}

#[tauri::command]
pub async fn chat_write_note(
    path: String,
    content: String,
    mode: String,
    vault_path: String,
) -> Result<String, String> {
    let mode = WriteMode::parse(&mode)?;
    let abs = write_note_inner(Path::new(&vault_path), &path, &content, mode)?;
    reindex_after_write(&abs, &vault_path);
    Ok(abs)
}

#[tauri::command]
pub async fn note_exists(path: String, vault_path: String) -> Result<bool, String> {
    note_exists_inner(Path::new(&vault_path), &path)
}

#[tauri::command]
pub async fn read_note_tail(
    path: String,
    vault_path: String,
    lines: usize,
) -> Result<String, String> {
    read_note_tail_inner(Path::new(&vault_path), &path, lines)
}
