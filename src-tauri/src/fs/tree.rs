use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Md,
    Image,
    Pdf,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub file_type: Option<FileKind>,
    pub children: Option<Vec<VaultEntry>>,
}

#[derive(Debug, Error)]
pub enum FsError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("WalkDir error: {0}")]
    WalkDir(#[from] walkdir::Error),
}

fn classify_extension(name: &str) -> FileKind {
    let ext = name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "md" => FileKind::Md,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => FileKind::Image,
        "pdf" => FileKind::Pdf,
        _ => FileKind::Other,
    }
}

fn build_tree(dir: &Path) -> Result<Vec<VaultEntry>, FsError> {
    let mut dirs: Vec<VaultEntry> = Vec::new();
    let mut files: Vec<VaultEntry> = Vec::new();

    let read_dir = std::fs::read_dir(dir)?;
    let mut entries: Vec<_> = read_dir
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let meta = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();
        let canonical = entry.path().canonicalize()?;
        let path_str = canonical.to_string_lossy().to_string();

        if meta.is_dir() {
            let children = build_tree(&entry.path())?;
            dirs.push(VaultEntry {
                name,
                path: path_str,
                kind: EntryKind::Folder,
                file_type: None,
                children: Some(children),
            });
        } else if meta.is_file() {
            let file_type = classify_extension(&name);
            files.push(VaultEntry {
                name,
                path: path_str,
                kind: EntryKind::File,
                file_type: Some(file_type),
                children: None,
            });
        }
    }

    // Dirs first (alphabetical), then files (alphabetical)
    dirs.extend(files);
    Ok(dirs)
}

pub fn walk_vault(root: &Path) -> Result<Vec<VaultEntry>, FsError> {
    build_tree(root)
}
