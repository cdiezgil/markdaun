//! Inbox (`Entrada/`), trash (`.markdaun/papelera/`) and source archiving.
//! The inbox is the single landing place for incoming material; digesting an
//! item turns it into notes and archives the original under `<folder>/Fuentes/`.

use super::brain_cmd::app_db_path;
use super::fs_ops::{assert_within_vault, finish_relocation, MoveOutcome};
use super::vault_index::spawn_index_update;
use crate::db::{ConfigDb, ConversationsDb};
use crate::fs::naming::unique_name;
use crate::fs::tree::APP_DIR;
use crate::voice::jobs::{JobState, VoiceJobs};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

pub const INBOX_DIR: &str = "Entrada";
pub const SOURCES_DIR: &str = "Fuentes";
const TRASH_DIR: &str = "papelera";

// ─── Inbox ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InboxKind {
    Md,
    Txt,
    Pdf,
    Image,
    Docx,
    Pptx,
    /// A voice recording waiting for (or failed) transcription.
    Audio,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct InboxItem {
    pub name: String,
    pub path: String,
    /// Vault-relative, `/` separators.
    pub rel_path: String,
    pub kind: InboxKind,
    pub size: u64,
    /// Creation (else modification) time, ms since the epoch.
    pub added_ms: i64,
    /// Whether digestion handles this type yet.
    pub supported: bool,
    /// Transcription state of a voice recording; `None` for everything else.
    pub voice: Option<VoiceInfo>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceStateKind {
    Downloading,
    Transcribing,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VoiceInfo {
    pub state: VoiceStateKind,
    pub detail: Option<String>,
    /// Model download progress, 0..1, when known.
    pub progress: Option<f32>,
}

/// Audio containers a recording (or a future import) may arrive in.
const AUDIO_EXTS: [&str; 8] = ["m4a", "mp4", "webm", "ogg", "opus", "wav", "mp3", "aac"];
/// Media a note can link next to itself (recordings, pasted captures).
const LINKED_MEDIA_EXTS: [&str; 9] = ["m4a", "mp4", "webm", "ogg", "opus", "wav", "mp3", "aac", "png"];
const INTERRUPTED: &str = "Transcripción interrumpida";

fn classify(name: &str) -> InboxKind {
    match name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).as_deref() {
        Some("md") => InboxKind::Md,
        Some("txt") => InboxKind::Txt,
        Some("pdf") => InboxKind::Pdf,
        Some("docx") => InboxKind::Docx,
        Some("pptx") => InboxKind::Pptx,
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") => InboxKind::Image,
        Some(e) if AUDIO_EXTS.contains(&e) => InboxKind::Audio,
        _ => InboxKind::Other,
    }
}

fn ms_of(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Creates `Entrada/` when missing and returns its path.
pub fn inbox_ensure_inner(vault: &Path) -> Result<PathBuf, String> {
    let dir = vault.join(INBOX_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("io_error: {e}"))?;
    Ok(dir)
}

/// Files directly inside `Entrada/` (folders and hidden files are not items),
/// newest first.
#[cfg(test)]
pub fn inbox_list_inner(vault: &Path) -> Result<Vec<InboxItem>, String> {
    inbox_list_with_jobs(vault, &VoiceJobs::default())
}

/// [`inbox_list_inner`] with the live transcription state of voice recordings.
/// A recording without transcript and without a running job is shown as
/// interrupted (the app may have quit mid-transcription), so it can be retried.
pub fn inbox_list_with_jobs(vault: &Path, jobs: &VoiceJobs) -> Result<Vec<InboxItem>, String> {
    let dir = inbox_ensure_inner(vault)?;
    let mut items: Vec<InboxItem> = std::fs::read_dir(&dir)
        .map_err(|e| format!("io_error: {e}"))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().ok()?;
            if !meta.is_file() || name.starts_with('.') {
                return None;
            }
            let kind = classify(&name);
            let rel_path = format!("{INBOX_DIR}/{name}");
            let voice = if kind == InboxKind::Audio {
                // Its transcript note stands for it.
                if e.path().with_extension("md").exists() {
                    return None;
                }
                Some(voice_info(jobs.get(&rel_path)))
            } else {
                None
            };
            Some(InboxItem {
                path: e.path().to_string_lossy().to_string(),
                rel_path,
                voice,
                size: meta.len(),
                added_ms: ms_of(meta.created()).or_else(|| ms_of(meta.modified())).unwrap_or(0),
                supported: !matches!(kind, InboxKind::Other | InboxKind::Audio),
                kind,
                name,
            })
        })
        .collect();
    items.sort_by(|a, b| b.added_ms.cmp(&a.added_ms).then_with(|| a.name.cmp(&b.name)));
    Ok(items)
}

fn voice_info(state: Option<JobState>) -> VoiceInfo {
    match state {
        Some(JobState::Transcribing) => VoiceInfo { state: VoiceStateKind::Transcribing, detail: None, progress: None },
        Some(JobState::Downloading { done, total }) => VoiceInfo {
            state: VoiceStateKind::Downloading,
            detail: None,
            progress: total.filter(|t| *t > 0).map(|t| (done as f64 / t as f64) as f32),
        },
        Some(JobState::Error(detail)) => VoiceInfo { state: VoiceStateKind::Error, detail: Some(detail), progress: None },
        None => VoiceInfo { state: VoiceStateKind::Error, detail: Some(INTERRUPTED.to_string()), progress: None },
    }
}

/// Media files next to the note `md` that it links to (`<stem>.<ext>`), such
/// as a voice recording or a pasted capture. Returns their extensions.
fn linked_media(md: &Path) -> Vec<String> {
    let Some(stem) = md.file_stem().map(|s| s.to_string_lossy().to_string()) else { return vec![] };
    if !md.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
        return vec![];
    }
    let Ok(text) = std::fs::read_to_string(md) else { return vec![] };
    LINKED_MEDIA_EXTS
        .iter()
        .filter(|ext| md.with_extension(ext).is_file())
        .filter(|ext| {
            let name = format!("{stem}.{ext}");
            let encoded = name.replace('%', "%25").replace(' ', "%20");
            text.contains(&name) || text.contains(&encoded)
        })
        .map(|e| e.to_string())
        .collect()
}

// ─── Trash ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TrashItem {
    pub id: String,
    pub name: String,
    /// Vault-relative location it came from.
    pub original_path: String,
    pub deleted_ms: i64,
    pub size: u64,
}

fn trash_root(vault: &Path) -> PathBuf {
    vault.join(APP_DIR).join(TRASH_DIR)
}

/// Layout: `papelera/<id>/origin.txt` and `papelera/<id>/data/<name>`.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-')
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

/// Rebases `p` onto `vault` when they only differ by symlinks / canonical form.
fn within(vault: &Path, p: &Path) -> Result<PathBuf, String> {
    assert_within_vault(p, vault)?;
    if p.starts_with(vault) {
        return Ok(p.to_path_buf());
    }
    let (cv, cp) = (
        vault.canonicalize().map_err(|_| "path_not_found".to_string())?,
        p.canonicalize().map_err(|_| "path_not_found".to_string())?,
    );
    let rel = cp.strip_prefix(&cv).map_err(|_| "path_outside_vault".to_string())?;
    Ok(vault.join(rel))
}

/// Moves `path` into the vault trash (nothing is deleted).
pub fn inbox_discard_inner(path: &Path, vault: &Path) -> Result<(), String> {
    // A note's recording goes with it (each in its own trash slot).
    let media: Vec<PathBuf> = linked_media(path).iter().map(|e| path.with_extension(e)).collect();
    discard_one(path, vault)?;
    for m in media {
        discard_one(&m, vault)?;
    }
    Ok(())
}

fn discard_one(path: &Path, vault: &Path) -> Result<(), String> {
    let path = within(vault, path)?;
    let rel = rel_of(vault, &path).ok_or_else(|| "path_outside_vault".to_string())?;
    let name = path.file_name().ok_or_else(|| "io_error: invalid path".to_string())?;
    let root = trash_root(vault);
    let stamp = chrono::Utc::now().timestamp_millis();
    let mut n = 0;
    let slot = loop {
        let id = if n == 0 { stamp.to_string() } else { format!("{stamp}-{n}") };
        let slot = root.join(&id);
        if !slot.exists() {
            break slot;
        }
        n += 1;
    };
    let data = slot.join("data");
    std::fs::create_dir_all(&data).map_err(|e| format!("io_error: {e}"))?;
    std::fs::write(slot.join("origin.txt"), &rel).map_err(|e| format!("io_error: {e}"))?;
    std::fs::rename(&path, data.join(name)).map_err(|e| format!("io_error: {e}"))?;
    Ok(())
}

fn trash_entry(slot: &Path) -> Option<TrashItem> {
    let id = slot.file_name()?.to_string_lossy().to_string();
    if !valid_id(&id) {
        return None;
    }
    let original_path = std::fs::read_to_string(slot.join("origin.txt")).ok()?;
    let file = std::fs::read_dir(slot.join("data")).ok()?.filter_map(|e| e.ok()).next()?;
    Some(TrashItem {
        name: file.file_name().to_string_lossy().to_string(),
        size: file.metadata().map(|m| if m.is_file() { m.len() } else { 0 }).unwrap_or(0),
        deleted_ms: id.split('-').next().and_then(|s| s.parse().ok()).unwrap_or(0),
        original_path,
        id,
    })
}

/// Trashed items, newest first.
pub fn trash_list_inner(vault: &Path) -> Result<Vec<TrashItem>, String> {
    let root = trash_root(vault);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut items: Vec<TrashItem> = std::fs::read_dir(&root)
        .map_err(|e| format!("io_error: {e}"))?
        .filter_map(|e| e.ok())
        .filter_map(|e| trash_entry(&e.path()))
        .collect();
    items.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(items)
}

fn slot_of(vault: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid_id".to_string());
    }
    let slot = trash_root(vault).join(id);
    if !slot.is_dir() {
        return Err("not_found".to_string());
    }
    Ok(slot)
}

/// Puts a trashed item back where it came from (recreating the folder, and
/// adding " 2"… when the name is taken). Returns the restored path.
pub fn trash_restore_inner(id: &str, vault: &Path) -> Result<PathBuf, String> {
    let slot = slot_of(vault, id)?;
    let item = trash_entry(&slot).ok_or_else(|| "not_found".to_string())?;
    let rel = Path::new(&item.original_path);
    if rel.is_absolute() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("invalid_path".to_string());
    }
    let target = vault.join(rel);
    let parent = target.parent().ok_or_else(|| "invalid_path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("io_error: {e}"))?;
    let dest = if target.exists() {
        let stem = target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = target.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        unique_name(parent, &stem, &ext)
    } else {
        target
    };
    std::fs::rename(slot.join("data").join(&item.name), &dest).map_err(|e| format!("io_error: {e}"))?;
    std::fs::remove_dir_all(&slot).map_err(|e| format!("io_error: {e}"))?;
    Ok(dest)
}

/// Permanently deletes one trashed item.
pub fn trash_delete_inner(id: &str, vault: &Path) -> Result<(), String> {
    let slot = slot_of(vault, id)?;
    std::fs::remove_dir_all(slot).map_err(|e| format!("io_error: {e}"))
}

// ─── Archiving ────────────────────────────────────────────────────────────────

/// Moves `source` to `<target_folder>/Fuentes/<file>` (collisions get " 2"),
/// rewriting links vault-wide. `target_folder` is vault-relative ('' = root).
pub fn archive_source_inner(
    source: &Path,
    target_folder: &str,
    vault: &Path,
    db_path: Option<&Path>,
) -> Result<MoveOutcome, String> {
    let source = within(vault, source)?;
    let rel = Path::new(target_folder);
    if rel.is_absolute() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("invalid_path".to_string());
    }
    let dir = vault.join(rel).join(SOURCES_DIR);
    // A symlinked folder must not lead outside the vault.
    let mut ancestor = dir.as_path();
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(|| "invalid_path".to_string())?;
    }
    assert_within_vault(ancestor, vault)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("io_error: {e}"))?;

    let stem = source.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = source.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    // A clipped note travels with its `<stem>_assets/` images.
    let assets_src = source.with_file_name(format!("{stem}_assets"));
    let with_assets = assets_src.is_dir();
    // ...and with the recordings / captures it links to.
    let media = linked_media(&source);
    let dest = free_destination(&dir, &stem, &ext, with_assets, &media);

    let mut rewritten: Vec<String> = Vec::new();
    if with_assets {
        let dest_stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let assets_dest = dir.join(format!("{dest_stem}_assets"));
        std::fs::rename(&assets_src, &assets_dest).map_err(|e| format!("io_error: {e}"))?;
        rewritten.extend(finish_relocation(vault, &assets_src, &assets_dest, db_path, true)?);
    }
    let dest_stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    for m in &media {
        let from = source.with_extension(m);
        let to = dir.join(format!("{dest_stem}.{m}"));
        std::fs::rename(&from, &to).map_err(|e| format!("io_error: {e}"))?;
        for p in finish_relocation(vault, &from, &to, db_path, true)? {
            if !rewritten.contains(&p) {
                rewritten.push(p);
            }
        }
    }
    std::fs::rename(&source, &dest).map_err(|e| format!("io_error: {e}"))?;
    for p in finish_relocation(vault, &source, &dest, db_path, true)? {
        if !rewritten.contains(&p) {
            rewritten.push(p);
        }
    }
    Ok(MoveOutcome { path: dest.to_string_lossy().to_string(), rewritten })
}

/// `<stem>.<ext>` in `dir`, numbered (" 2"…) until the name is free; with
/// `assets`, `<stem>_assets/` must be free too, and so must `<stem>.<m>` for
/// every linked media extension.
fn free_destination(dir: &Path, stem: &str, ext: &str, assets: bool, media: &[String]) -> PathBuf {
    let mut n = 1;
    loop {
        let name = if n == 1 { stem.to_string() } else { format!("{stem} {n}") };
        let candidate = dir.join(if ext.is_empty() { name.clone() } else { format!("{name}.{ext}") });
        if !candidate.exists()
            && !(assets && dir.join(format!("{name}_assets")).exists())
            && !media.iter().any(|m| dir.join(format!("{name}.{m}")).exists())
        {
            return candidate;
        }
        n += 1;
    }
}

// ─── Folder tree for the digestion prompt ─────────────────────────────────────

/// Vault-relative folders (sorted, `/` separators) down to `max_depth` levels,
/// leaving out hidden folders, `Entrada/` and every `Fuentes/`.
pub fn folder_tree(vault: &Path, max_depth: usize) -> Vec<String> {
    let mut out: Vec<String> = walkdir::WalkDir::new(vault)
        .min_depth(1)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.')
                && name != SOURCES_DIR
                && !(e.depth() == 1 && name == INBOX_DIR)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
        .filter_map(|e| rel_of(vault, e.path()))
        .collect();
    out.sort();
    out
}

// ─── Areas ────────────────────────────────────────────────────────────────────

/// Digestion areas: the vault's top-level folders, sorted, without `Entrada/`
/// and hidden folders. The vault root itself is an implicit extra area ('').
pub fn list_areas(vault: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(vault)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with('.') && n != INBOX_DIR)
        .collect();
    out.sort();
    out
}

fn last_area_key(vault_path: &str) -> String {
    format!("last_digest_area:{vault_path}")
}

/// The area used by the previous digestion in this vault ('' = vault root).
pub fn last_area_get(db_path: &Path, vault_path: &str) -> Option<String> {
    ConfigDb::open(db_path).ok()?.get(&last_area_key(vault_path)).ok().flatten()
}

pub fn last_area_set(db_path: &Path, vault_path: &str, area: &str) -> Result<(), String> {
    ConfigDb::open(db_path)
        .and_then(|db| db.set(&last_area_key(vault_path), area))
        .map_err(|e| format!("db_error: {e}"))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn inbox_ensure(vault_path: String) -> Result<String, String> {
    inbox_ensure_inner(Path::new(&vault_path)).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn inbox_list(jobs: tauri::State<'_, VoiceJobs>, vault_path: String) -> Result<Vec<InboxItem>, String> {
    inbox_list_with_jobs(Path::new(&vault_path), &jobs)
}

#[tauri::command]
pub async fn inbox_discard(app: tauri::AppHandle, path: String, vault_path: String) -> Result<(), String> {
    inbox_discard_inner(Path::new(&path), Path::new(&vault_path))?;
    spawn_index_update(&app, vault_path, vec![path], vec![]);
    Ok(())
}

#[tauri::command]
pub async fn trash_list(vault_path: String) -> Result<Vec<TrashItem>, String> {
    trash_list_inner(Path::new(&vault_path))
}

#[tauri::command]
pub async fn trash_restore(app: tauri::AppHandle, id: String, vault_path: String) -> Result<String, String> {
    let dest = trash_restore_inner(&id, Path::new(&vault_path))?;
    let abs = dest.to_string_lossy().to_string();
    spawn_index_update(&app, vault_path, vec![], vec![abs.clone()]);
    Ok(abs)
}

#[tauri::command]
pub async fn trash_delete(id: String, vault_path: String) -> Result<(), String> {
    trash_delete_inner(&id, Path::new(&vault_path))
}

/// Archives a digested source; when `conversation_id` is given, the digestion
/// conversation is marked archived and follows the file to its new location.
#[tauri::command]
pub async fn archive_source(
    app: tauri::AppHandle,
    path: String,
    target_folder: String,
    vault_path: String,
    conversation_id: Option<String>,
) -> Result<MoveOutcome, String> {
    let db = app_db_path(&app)?;
    let vault = Path::new(&vault_path);
    let out = archive_source_inner(Path::new(&path), &target_folder, vault, Some(&db))?;
    if let (Some(id), Some(rel)) = (conversation_id, rel_of(vault, Path::new(&out.path))) {
        ConversationsDb::open(&db)
            .and_then(|c| c.mark_digest_archived(&id, &rel))
            .map_err(|e| format!("db_error: {e}"))?;
    }
    let mut added = vec![out.path.clone()];
    added.extend(out.rewritten.iter().filter(|p| **p != out.path).cloned());
    spawn_index_update(&app, vault_path, vec![path], added);
    Ok(out)
}

#[tauri::command]
pub async fn inbox_list_areas(vault_path: String) -> Result<Vec<String>, String> {
    Ok(list_areas(Path::new(&vault_path)))
}

#[tauri::command]
pub async fn inbox_get_last_area(app: tauri::AppHandle, vault_path: String) -> Result<Option<String>, String> {
    let db = app_db_path(&app)?;
    Ok(last_area_get(&db, &vault_path))
}

#[tauri::command]
pub async fn inbox_set_last_area(app: tauri::AppHandle, vault_path: String, area: String) -> Result<(), String> {
    let db = app_db_path(&app)?;
    last_area_set(&db, &vault_path, &area)
}
