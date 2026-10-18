//! Tauri commands for the capture channels (URL clipping; quick capture is
//! added next to it).

use super::vault_index::spawn_index_update;
use crate::capture::clip::{clip_url, ClipOptions, ClipResult};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ClipSummary {
    /// Absolute path of the note written into `Entrada/`.
    pub path: String,
    /// Vault-relative path, `/` separators.
    pub rel_path: String,
    pub title: String,
    /// False when only a failure note could be written.
    pub clipped: bool,
    pub failure: Option<String>,
    pub words: usize,
    pub images_downloaded: usize,
    pub images_failed: usize,
}

pub fn summarize(vault: &Path, r: &ClipResult) -> ClipSummary {
    let rel = r
        .note_path
        .strip_prefix(vault)
        .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default();
    ClipSummary {
        path: r.note_path.to_string_lossy().to_string(),
        rel_path: rel,
        title: r.title.clone(),
        clipped: r.clipped,
        failure: r.failure.clone(),
        words: r.words,
        images_downloaded: r.images_downloaded,
        images_failed: r.images_failed,
    }
}

/// Clips a web page into `Entrada/`. Only an invalid URL is an error; any other
/// failure still writes a note with the link (see `ClipSummary::clipped`).
pub async fn clip_into_inbox(app: &tauri::AppHandle, url: &str, vault_path: &str) -> Result<ClipSummary, String> {
    let vault = Path::new(vault_path);
    let result = clip_url(vault, url, chrono::Local::now().naive_local(), &ClipOptions::default()).await?;
    let summary = summarize(vault, &result);
    spawn_index_update(app, vault_path.to_string(), vec![], vec![summary.path.clone()]);
    Ok(summary)
}

#[tauri::command]
pub async fn inbox_clip_url(app: tauri::AppHandle, url: String, vault_path: String) -> Result<ClipSummary, String> {
    clip_into_inbox(&app, &url, &vault_path).await
}
