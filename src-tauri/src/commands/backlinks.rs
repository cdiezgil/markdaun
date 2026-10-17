use crate::graph::extract_links;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// A note that links to another note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Backlink {
    pub path: String,
    /// File name without the `.md` extension.
    pub name: String,
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| format!("io_error: {e}"))?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

/// Notes (other than `target`) whose wikilinks or Markdown links resolve to
/// `target`, sorted by name. Reuses the graph engine's link extraction.
pub fn compute_backlinks(vault: &Path, target: &Path) -> Result<Vec<Backlink>, String> {
    let all_files = collect_files(vault)?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("io_error: {e}"))?;
    let mut out: Vec<Backlink> = Vec::new();
    for file in &all_files {
        let is_md = file
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("md"));
        if !is_md || file.canonicalize().ok().as_ref() == Some(&target_canon) {
            continue;
        }
        let links_here = extract_links(file, vault, &all_files)
            .into_iter()
            .any(|(_, t)| t == target_canon);
        if links_here {
            let name = file
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(Backlink {
                path: file.to_string_lossy().to_string(),
                name,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Notes that link to `path` (for the editor's "Enlazada desde" section).
#[tauri::command]
pub async fn get_backlinks(path: String, vault_path: String) -> Result<Vec<Backlink>, String> {
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err("vault_not_found".to_string());
    }
    let target = Path::new(&path);
    if !target.is_file() {
        return Err("not_found".to_string());
    }
    compute_backlinks(vault, target)
}

