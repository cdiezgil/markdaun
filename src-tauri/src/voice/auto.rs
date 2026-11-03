//! Recordings that reach `Entrada/` through GitHub sync (uploaded by the phone)
//! have no transcript yet: find them so the desktop transcribes them itself.

use super::jobs::VoiceJobs;
use crate::commands::inbox::{AUDIO_EXTS, INBOX_DIR};
use std::path::Path;

/// Vault-relative audio paths directly inside `Entrada/` that exist, have no
/// `<stem>.md` next to them and have no job running.
pub fn pending_transcriptions(vault: &Path, candidates: &[String], jobs: &VoiceJobs) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for rel in candidates {
        let path = Path::new(rel);
        let in_inbox = path.parent() == Some(Path::new(INBOX_DIR))
            && path.components().all(|c| matches!(c, std::path::Component::Normal(_)));
        let audio = path
            .extension()
            .map(|e| AUDIO_EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()))
            .unwrap_or(false);
        if !in_inbox || !audio || out.contains(rel) || jobs.is_active(rel) {
            continue;
        }
        let abs = vault.join(path);
        if abs.is_file() && !abs.with_extension("md").exists() {
            out.push(rel.clone());
        }
    }
    out
}

/// Every file directly inside `Entrada/`, as vault-relative paths.
pub fn inbox_files(vault: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(vault.join(INBOX_DIR)) else { return Vec::new() };
    let mut files: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| format!("{INBOX_DIR}/{}", e.file_name().to_string_lossy()))
        .collect();
    files.sort();
    files
}

#[cfg(test)]
#[path = "auto_tests.rs"]
mod tests;
