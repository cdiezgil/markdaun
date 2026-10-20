//! Tauri commands for voice notes: saving a recording from quick capture,
//! background transcription, retry, and the model settings.

use super::brain_cmd::app_db_path;
use super::quick_cmd::{notify_saved, QuickSummary, CAPTURED_EVENT};
use super::vault::get_active_vault_inner;
use super::vault_index::spawn_index_update;
use crate::capture::lifecycle::{hide_quick_capture, is_main_visible, MAIN_WINDOW};
use crate::db::ConfigDb;
use crate::llm::embeddings::HF_BASE_URL;
use crate::models_mirror::Mirror;
use crate::voice::jobs::{parse_recorded, run_job, VoiceJobs};
use crate::voice::model::{download_model, is_downloaded, model_path, spec_for, ModelSpec, DEFAULT_MODEL, MODELS};
use crate::voice::save::save_recording;
use crate::voice::transcribe::{EngineState, Transcriber};
use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// The inbox changed because of a transcription (refresh it).
pub const VOICE_EVENT: &str = "voice-changed";
/// Progress of a model download started from Settings.
pub const MODEL_PROGRESS_EVENT: &str = "voice-model-progress";
const MODEL_KEY: &str = "voice_model";

// ─── Model choice ─────────────────────────────────────────────────────────────

/// The selected model id (the default when none is chosen or the stored one is gone).
pub fn model_get(db_path: &Path) -> String {
    ConfigDb::open(db_path)
        .ok()
        .and_then(|db| db.get(MODEL_KEY).ok().flatten())
        .filter(|id| spec_for(id).is_some())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

pub fn model_set(db_path: &Path, id: &str) -> Result<(), String> {
    if spec_for(id).is_none() {
        return Err("unknown_model".to_string());
    }
    ConfigDb::open(db_path).and_then(|db| db.set(MODEL_KEY, id)).map_err(|e| format!("db_error: {e}"))
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub approx_mb: u32,
    pub downloaded: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct VoiceConfig {
    pub model: String,
    pub models: Vec<ModelInfo>,
}

pub fn config_snapshot(db_path: &Path, models_dir: &Path) -> VoiceConfig {
    VoiceConfig {
        model: model_get(db_path),
        models: MODELS
            .iter()
            .map(|m| ModelInfo { id: m.id, label: m.label, approx_mb: m.approx_mb, downloaded: is_downloaded(models_dir, m) })
            .collect(),
    }
}

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("whisper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn voice_get_config(app: tauri::AppHandle) -> Result<VoiceConfig, String> {
    Ok(config_snapshot(&app_db_path(&app)?, &models_dir(&app)?))
}

#[tauri::command]
pub async fn voice_set_model(app: tauri::AppHandle, model: String) -> Result<VoiceConfig, String> {
    let db = app_db_path(&app)?;
    model_set(&db, &model)?;
    Ok(config_snapshot(&db, &models_dir(&app)?))
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelProgress {
    pub id: String,
    pub done: u64,
    pub total: Option<u64>,
}

/// Downloads a model ahead of time (Settings), emitting `voice-model-progress`.
#[tauri::command]
pub async fn voice_download_model(app: tauri::AppHandle, model: String) -> Result<VoiceConfig, String> {
    let spec = *spec_for(&model).ok_or_else(|| "unknown_model".to_string())?;
    let dir = models_dir(&app)?;
    let emitter = app.clone();
    let id = model.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut throttle = Throttle::new();
        download_model(HF_BASE_URL, &Mirror::production(), &dir, &spec, &mut |done, total| {
            if throttle.ready(done, total) {
                let _ = emitter.emit(MODEL_PROGRESS_EVENT, ModelProgress { id: id.clone(), done, total });
            }
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(config_snapshot(&app_db_path(&app)?, &models_dir(&app)?))
}

/// Lets a progress callback through at most every 250 ms (and at the end).
struct Throttle(Instant);

impl Throttle {
    fn new() -> Self {
        Self(Instant::now() - Duration::from_secs(1))
    }
    fn ready(&mut self, done: u64, total: Option<u64>) -> bool {
        let finished = total == Some(done);
        if finished || self.0.elapsed() >= Duration::from_millis(250) {
            self.0 = Instant::now();
            return true;
        }
        false
    }
}

// ─── Transcription jobs ───────────────────────────────────────────────────────

/// Transcribes the inbox recording `rel` in the background: fetches the model
/// on first use, then writes the note next to the audio. Jobs run one at a
/// time (the model uses the whole machine).
fn start_job(app: tauri::AppHandle, vault: String, rel: String) {
    std::thread::spawn(move || {
        let jobs = app.state::<VoiceJobs>();
        let engines = app.state::<EngineState>();
        let _turn = engines.queue();
        let audio = Path::new(&vault).join(&rel);
        let stem = audio.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let recorded = parse_recorded(&stem).unwrap_or_else(|| chrono::Local::now().naive_local());
        let (Ok(db), Ok(dir)) = (app_db_path(&app), models_dir(&app)) else { return };
        let model_id = model_get(&db);
        let spec: ModelSpec = *spec_for(&model_id).unwrap_or(&MODELS[0]);
        let emitter = app.clone();
        let announce = move || {
            let _ = emitter.emit(VOICE_EVENT, ());
        };
        let outcome = run_job(
            &jobs,
            &rel,
            &audio,
            recorded,
            spec.id,
            |progress| {
                let mut throttle = Throttle::new();
                download_model(HF_BASE_URL, &Mirror::production(), &dir, &spec, &mut |done, total| {
                    if throttle.ready(done, total) {
                        progress(done, total);
                    }
                })?;
                let engine = engines.get_or_load(spec.id, &model_path(&dir, &spec))?;
                Ok(engine as Arc<dyn Transcriber>)
            },
            &announce,
        );
        match outcome {
            Ok(md) => spawn_index_update(&app, vault, vec![], vec![md.to_string_lossy().to_string()]),
            Err(e) => eprintln!("[voice] transcription of {rel} failed: {e}"),
        }
    });
}

/// Saves a recording from the quick-capture window into the inbox, closes the
/// window and starts transcribing in the background.
#[tauri::command]
pub async fn quick_capture_save_audio(
    app: tauri::AppHandle,
    audio_b64: String,
    mime: String,
) -> Result<QuickSummary, String> {
    let db = app_db_path(&app)?;
    let vault = get_active_vault_inner(&db)?.ok_or_else(|| "no_vault".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_b64.trim())
        .map_err(|_| "invalid_audio".to_string())?;
    let now = chrono::Local::now().naive_local();
    let (_, rel) = save_recording(Path::new(&vault), &bytes, &mime, now)?;
    let summary = QuickSummary { kind: "voice", rel_path: rel.clone(), clipped: None, failure: None };
    start_job(app.clone(), vault, rel);
    hide_quick_capture(&app);
    let _ = app.emit_to(MAIN_WINDOW, CAPTURED_EVENT, summary.clone());
    if !is_main_visible(&app) {
        notify_saved(&app);
    }
    Ok(summary)
}

/// Retries the transcription of a recording that failed (or was interrupted).
#[tauri::command]
pub async fn voice_retry(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, VoiceJobs>,
    vault_path: String,
    rel_path: String,
) -> Result<(), String> {
    let rel = Path::new(&rel_path);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("invalid_path".to_string());
    }
    if !Path::new(&vault_path).join(rel).is_file() {
        return Err("path_not_found".to_string());
    }
    if jobs.is_active(&rel_path) {
        return Ok(());
    }
    start_job(app, vault_path, rel_path);
    Ok(())
}
