//! Vault-wide Second Brain indexing: incremental sync, per-path updates and
//! the note listing injected into the chat prompt. The embedder is injected
//! (`EmbedFn`) so the logic is testable without the ONNX model.

use crate::commands::brain_cmd::{app_db_path, model_cache_dir, vectors_db_path, IndexProgress, INDEX_PROGRESS_EVENT};
use crate::commands::vault::get_active_vault_inner;
use crate::db::ConfigDb;
use crate::llm::embeddings::EMBED_MODEL_ID;
use crate::capture::office::{extract_office, is_office_name};
use crate::db::{Fingerprint, VectorsDb};
use crate::llm::{chunk_text, embed_text, load_model, EmbedderState};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub type EmbedFn<'a> = dyn Fn(&str) -> Result<Vec<f32>, String> + 'a;

/// Maximum number of note paths listed in the chat system prompt.
pub const LISTING_CAP: usize = 300;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub indexed: usize,
    pub failed: usize,
    pub removed: usize,
}

// ─── Vault listing ────────────────────────────────────────────────────────────

fn walk_files(vault: &Path, keep: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = walkdir::WalkDir::new(vault)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| keep(e.path()))
        .map(|e| e.into_path())
        .collect();
    files.sort();
    files
}

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case(ext))
}

/// Whether the Brain indexes this file: Markdown notes plus Word/PowerPoint
/// documents (through their extracted text).
fn is_indexable(path: &Path) -> bool {
    has_ext(path, "md") || path.file_name().is_some_and(|n| is_office_name(&n.to_string_lossy()))
}

/// Absolute paths of every `.md` file in the vault, sorted. Hidden entries
/// (`.git`, `.markdaun`, …) are skipped.
pub fn list_vault_notes(vault: &Path) -> Vec<PathBuf> {
    walk_files(vault, |p| has_ext(p, "md"))
}

/// Every file the Brain indexes (notes and Office documents), sorted.
pub fn list_indexable_files(vault: &Path) -> Vec<PathBuf> {
    walk_files(vault, is_indexable)
}

/// The text that gets chunked and embedded for one file.
fn indexable_text(file: &Path, bytes: &[u8]) -> Result<String, String> {
    match file.file_name().map(|n| n.to_string_lossy().to_string()) {
        Some(name) if is_office_name(&name) => extract_office(&name, bytes).map(|e| e.markdown),
        _ => Ok(String::from_utf8_lossy(bytes).to_string()),
    }
}

/// Vault-relative path with `/` separators.
pub fn relative_note_path(vault: &Path, file: &Path) -> String {
    let rel = file.strip_prefix(vault).unwrap_or(file);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// Compact index of the vault for the system prompt: note count plus up to
/// [`LISTING_CAP`] paths sorted alphabetically.
pub fn vault_note_listing(rel_paths: &[String]) -> String {
    if rel_paths.is_empty() {
        return "La bóveda no tiene notas.".to_string();
    }
    let mut sorted: Vec<&String> = rel_paths.iter().collect();
    sorted.sort();
    let n = sorted.len();
    let noun = if n == 1 { "nota" } else { "notas" };
    let mut out = format!("La bóveda tiene {n} {noun}:");
    for p in sorted.iter().take(LISTING_CAP) {
        out.push_str("\n- ");
        out.push_str(p);
    }
    if n > LISTING_CAP {
        out.push_str(&format!("\n… y {} más", n - LISTING_CAP));
    }
    out
}

// ─── Indexing core ────────────────────────────────────────────────────────────

fn vault_key(vault: &Path) -> String {
    vault.to_string_lossy().to_string()
}

/// FNV-1a 64: stable across Rust versions, which `DefaultHasher` is not.
fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn stat_fingerprint(path: &Path) -> Result<(i64, i64), String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0);
    Ok((mtime, meta.len() as i64))
}

/// Chunk, embed and store one note. The embedded (and stored) text of each
/// chunk starts with `Nota: <relative path>` so name-based questions match.
/// Nothing is stored (and no fingerprint written) if any chunk fails, so the
/// file is retried by the next sync.
pub fn index_file(vdb: &VectorsDb, vault: &Path, file: &Path, embed: &EmbedFn) -> Result<(), String> {
    let (mtime_ns, size) = stat_fingerprint(file)?;
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    index_content(vdb, vault, file, &bytes, Fingerprint { mtime_ns, size, hash: content_hash(&bytes) }, embed)
}

fn index_content(
    vdb: &VectorsDb,
    vault: &Path,
    file: &Path,
    bytes: &[u8],
    fp: Fingerprint,
    embed: &EmbedFn,
) -> Result<(), String> {
    let content = indexable_text(file, bytes)?;
    let rel = relative_note_path(vault, file);
    let mut embedded: Vec<(usize, String, Vec<f32>)> = Vec::new();
    for (i, chunk) in chunk_text(&content, 1500, 200).into_iter().enumerate() {
        let text = format!("Nota: {rel}\n\n{chunk}");
        let emb = embed(&text)?;
        embedded.push((i, text, emb));
    }
    let refs: Vec<(usize, &str, &[f32])> = embedded.iter().map(|(i, t, e)| (*i, t.as_str(), e.as_slice())).collect();
    let key = vault_key(vault);
    let file_key = file.to_string_lossy().to_string();
    vdb.upsert_file_chunks(&key, &file_key, &refs).map_err(|e| e.to_string())?;
    vdb.set_fingerprint(&key, &file_key, &fp).map_err(|e| e.to_string())
}

/// Index a file, or every note under a folder. Failures are logged.
pub fn index_path(vdb: &VectorsDb, vault: &Path, path: &Path, embed: &EmbedFn) {
    let files = if path.is_dir() {
        list_indexable_files(path)
    } else if is_indexable(path) {
        vec![path.to_path_buf()]
    } else {
        vec![]
    };
    for f in files {
        if let Err(e) = index_file(vdb, vault, &f, embed) {
            eprintln!("[vault_index] cannot index {}: {e}", f.display());
        }
    }
}

/// Forget a file, or every indexed note under a folder (already gone or not).
pub fn remove_path(vdb: &VectorsDb, vault: &Path, path: &Path) {
    let key = vault_key(vault);
    let p = path.to_string_lossy().to_string();
    for r in [vdb.delete_file(&key, &p), vdb.delete_tree(&key, &p)] {
        if let Err(e) = r {
            eprintln!("[vault_index] cannot remove {p}: {e}");
        }
    }
}

/// Bring the index in line with the vault: embed new/changed notes, drop
/// vanished ones. `emit` reports progress over the notes that need embedding.
pub fn sync_vault(
    vdb: &VectorsDb,
    vault: &Path,
    embed: &EmbedFn,
    emit: &dyn Fn(IndexProgress),
) -> Result<SyncReport, String> {
    let key = vault_key(vault);
    let stored: HashMap<String, Fingerprint> = vdb.fingerprints(&key).map_err(|e| e.to_string())?;
    let notes = list_indexable_files(vault);
    let present: HashSet<String> = notes.iter().map(|n| n.to_string_lossy().to_string()).collect();
    let mut report = SyncReport::default();

    // Drop notes that no longer exist.
    for gone in vdb.indexed_files(&key).map_err(|e| e.to_string())? {
        if !present.contains(&gone) {
            vdb.delete_file(&key, &gone).map_err(|e| e.to_string())?;
            report.removed += 1;
        }
    }

    // Find notes that need (re)embedding.
    let mut todo: Vec<(PathBuf, Vec<u8>, Fingerprint)> = Vec::new();
    for note in notes {
        let file_key = note.to_string_lossy().to_string();
        let (mtime_ns, size) = match stat_fingerprint(&note) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[vault_index] cannot stat {file_key}: {e}");
                continue;
            }
        };
        let old = stored.get(&file_key);
        if old.is_some_and(|o| o.mtime_ns == mtime_ns && o.size == size) {
            continue;
        }
        let bytes = match std::fs::read(&note) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[vault_index] cannot read {file_key}: {e}");
                continue;
            }
        };
        let fp = Fingerprint { mtime_ns, size, hash: content_hash(&bytes) };
        if old.is_some_and(|o| o.hash == fp.hash) {
            // Touched but identical: just refresh the cheap fingerprint.
            vdb.set_fingerprint(&key, &file_key, &fp).map_err(|e| e.to_string())?;
            continue;
        }
        todo.push((note, bytes, fp));
    }

    let total = todo.len();
    if total == 0 {
        return Ok(report);
    }
    emit(IndexProgress { done: 0, total });
    for (i, (note, bytes, fp)) in todo.into_iter().enumerate() {
        match index_content(vdb, vault, &note, &bytes, fp, embed) {
            Ok(()) => report.indexed += 1,
            Err(e) => {
                report.failed += 1;
                eprintln!("[vault_index] cannot index {}: {e}", note.display());
            }
        }
        emit(IndexProgress { done: i + 1, total });
    }
    Ok(report)
}

// ─── Tauri glue ───────────────────────────────────────────────────────────────

/// Vaults currently being synced; a second request for the same vault is skipped.
#[derive(Default)]
pub struct IndexLocks(Mutex<HashSet<String>>);

pub struct SyncGuard<'a>(&'a IndexLocks, String);

impl IndexLocks {
    pub fn try_acquire(&self, vault: &str) -> Option<SyncGuard<'_>> {
        let mut set = self.0.lock().unwrap_or_else(|p| p.into_inner());
        set.insert(vault.to_string()).then(|| SyncGuard(self, vault.to_string()))
    }
}

impl Drop for SyncGuard<'_> {
    fn drop(&mut self) {
        self.0 .0.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.1);
    }
}

/// Embedder backed by the shared model, loaded lazily on first use so a
/// no-op sync never triggers the model download.
fn model_embedder(state: Arc<EmbedderState>, cache_dir: PathBuf) -> impl Fn(&str) -> Result<Vec<f32>, String> {
    move |text| {
        let model = state
            .get_or_try_init(|| load_model(&cache_dir))
            .map_err(|e| format!("embed_error: {e}"))?;
        embed_text(&model, text).map_err(|e| format!("embed_error: {e}"))
    }
}

/// Sync the vault index in the background (never blocks the caller).
pub fn spawn_vault_sync(app: &tauri::AppHandle, vault_path: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let locks = app.state::<IndexLocks>();
            let Some(_guard) = locks.try_acquire(&vault_path) else {
                return Ok(());
            };
            let vdb = VectorsDb::open(&vectors_db_path(&app)?).map_err(|e| e.to_string())?;
            let embed = model_embedder(app.state::<Arc<EmbedderState>>().inner().clone(), model_cache_dir(&app)?);
            let emit = |p: IndexProgress| {
                let _ = app.emit(INDEX_PROGRESS_EVENT, p);
            };
            sync_vault(&vdb, Path::new(&vault_path), &embed, &emit).map(|_| ())
        })
        .await;
        match result {
            Ok(Err(e)) => eprintln!("[vault_index] sync failed: {e}"),
            Err(e) => eprintln!("[vault_index] sync task failed: {e}"),
            Ok(Ok(())) => {}
        }
    });
}

/// Forces re-embedding of every indexable file under `folder` (and subfolders),
/// ignoring stored fingerprints. Emits `IndexProgress` before the first file
/// and after each one. Returns a `SyncReport` with `indexed` + `failed` counts.
pub fn reindex_folder_core(
    vdb: &VectorsDb,
    vault: &Path,
    folder: &Path,
    embed: &EmbedFn,
    emit: &dyn Fn(IndexProgress),
) -> SyncReport {
    let files = list_indexable_files(folder);
    let total = files.len();
    let mut report = SyncReport::default();
    if total == 0 {
        return report;
    }
    emit(IndexProgress { done: 0, total });
    for (i, file) in files.into_iter().enumerate() {
        match index_file(vdb, vault, &file, embed) {
            Ok(()) => report.indexed += 1,
            Err(e) => {
                report.failed += 1;
                eprintln!("[vault_index] cannot reindex {}: {e}", file.display());
            }
        }
        emit(IndexProgress { done: i + 1, total });
    }
    report
}

/// Tauri command: force-reindex all indexable files under `folder_path`.
/// Returns `Ok(N)` where N is the number of successfully indexed files.
/// Returns `Err("indexing_in_progress")` if a sync is already running for this vault.
/// Returns `Err("invalid_folder_path")` if `folder_path` is outside `vault_path`.
#[tauri::command]
pub async fn brain_reindex_folder(
    app: tauri::AppHandle,
    embedder: tauri::State<'_, Arc<EmbedderState>>,
    vault_path: String,
    folder_path: String,
) -> Result<usize, String> {
    if !Path::new(&folder_path).starts_with(Path::new(&vault_path)) {
        return Err("invalid_folder_path".to_string());
    }
    let embedder = embedder.inner().clone();
    let result = tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let locks = app.state::<IndexLocks>();
        let Some(_guard) = locks.try_acquire(&vault_path) else {
            return Err("indexing_in_progress".to_string());
        };
        let vdb = VectorsDb::open(&vectors_db_path(&app)?).map_err(|e| e.to_string())?;
        let embed = model_embedder(embedder, model_cache_dir(&app)?);
        let emit = |p: IndexProgress| {
            let _ = app.emit(INDEX_PROGRESS_EVENT, p);
        };
        let report = reindex_folder_core(
            &vdb,
            Path::new(&vault_path),
            Path::new(&folder_path),
            &embed,
            &emit,
        );
        Ok(report.indexed)
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

/// After rename/move/delete/import: forget `removed` paths and index `added`
/// ones (folders recurse). Fire-and-forget; failures are logged.
pub fn spawn_index_update(app: &tauri::AppHandle, vault_path: String, removed: Vec<String>, added: Vec<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let vault = Path::new(&vault_path);
            let vdb = VectorsDb::open(&vectors_db_path(&app)?).map_err(|e| e.to_string())?;
            for r in &removed {
                remove_path(&vdb, vault, Path::new(r));
            }
            if added.is_empty() {
                return Ok(());
            }
            let embed = model_embedder(app.state::<Arc<EmbedderState>>().inner().clone(), model_cache_dir(&app)?);
            for a in &added {
                index_path(&vdb, vault, Path::new(a), &embed);
            }
            Ok(())
        })
        .await;
        match result {
            Ok(Err(e)) => eprintln!("[vault_index] update failed: {e}"),
            Err(e) => eprintln!("[vault_index] update task failed: {e}"),
            Ok(Ok(())) => {}
        }
    });
}

// ─── Embedding model migration ───────────────────────────────────────────────

/// Directory name of the superseded embedding model kept in the fastembed cache.
/// The migration removes this directory so the old ONNX weights are not kept.
pub const OLD_MODEL_DIR: &str = "all-MiniLM-L6-v2-onnx";

/// Check whether `config.db[\"embed_model\"]` matches [`EMBED_MODEL_ID`].
///
/// * If it does → return `false` (no action needed).
/// * If it does not (or is missing) → delete `vdb_path`, delete
///   `<cache_dir>/OLD_MODEL_DIR`, write the new key, return `true`.
///
/// This function is pure (no `AppHandle`) so it can be called from tests.
pub(crate) fn check_and_clear_embedding_index(
    db_path: &Path,
    vdb_path: &Path,
    cache_dir: &Path,
) -> bool {
    let Ok(cfg) = ConfigDb::open(db_path) else { return false };
    if cfg.get("embed_model").ok().flatten().as_deref() == Some(EMBED_MODEL_ID) {
        return false; // already up-to-date
    }

    // Clear vectors.db (will be recreated empty on next open).
    let _ = std::fs::remove_file(vdb_path);

    // Delete old model files from the fastembed cache.
    let old_dir = cache_dir.join(OLD_MODEL_DIR);
    let _ = std::fs::remove_dir_all(&old_dir);

    // Record the new model ID; best-effort (log on error, never fatal).
    if let Err(e) = cfg.set("embed_model", EMBED_MODEL_ID) {
        eprintln!("[embed_migration] cannot write embed_model key: {e}");
    }

    true
}

/// Called once at app startup (before `sync_active_vault_index`).
///
/// Detects a stale embedding index (different model than [`EMBED_MODEL_ID`]),
/// clears it, spawns a full vault re-index, and returns `true`.
/// Returns `false` when no migration was needed (common case after the first run).
pub fn run_embedding_migration(app: &tauri::AppHandle) -> bool {
    let Ok(db_path) = app_db_path(app) else { return false };
    let Ok(vdb_path) = vectors_db_path(app) else { return false };
    let Ok(cache_dir) = model_cache_dir(app) else { return false };

    if !check_and_clear_embedding_index(&db_path, &vdb_path, &cache_dir) {
        return false;
    }

    // Re-index the active vault in the background.
    let Ok(Some(vault)) = get_active_vault_inner(&db_path) else { return true };
    spawn_vault_sync(app, vault);
    true
}
