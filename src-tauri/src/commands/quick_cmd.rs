//! Tauri commands for quick capture, its global shortcut and the quit guard.

use super::brain_cmd::app_db_path;
use super::vault::get_active_vault_inner;
use super::vault_index::spawn_index_update;
use crate::capture::clip::ClipOptions;
use crate::capture::lifecycle::{hide_quick_capture, is_main_visible, QuitFlag, MAIN_WINDOW};
use crate::capture::quick::{save_quick_capture, QuickInput, QuickOutcome};
use crate::capture::shortcut::{self, QuickConfig, ShortcutRegistrar, ShortcutState};
use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// Event the main window listens to (refresh the inbox, show the toast).
pub const CAPTURED_EVENT: &str = "inbox-captured";

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct QuickSummary {
    /// `note`, `image` or `clip`.
    pub kind: &'static str,
    /// Vault-relative path of the main item written.
    pub rel_path: String,
    /// For clips: whether the page could be clipped.
    pub clipped: Option<bool>,
    pub failure: Option<String>,
}

fn rel(vault: &Path, p: &Path) -> String {
    p.strip_prefix(vault)
        .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default()
}

pub fn summarize_quick(vault: &Path, outcome: &QuickOutcome) -> QuickSummary {
    match outcome {
        QuickOutcome::Note { path } => QuickSummary { kind: "note", rel_path: rel(vault, path), clipped: None, failure: None },
        QuickOutcome::Image { image, note } => QuickSummary {
            kind: "image",
            rel_path: rel(vault, note.as_deref().unwrap_or(image)),
            clipped: None,
            failure: None,
        },
        QuickOutcome::Clip(r) => QuickSummary {
            kind: "clip",
            rel_path: rel(vault, &r.note_path),
            clipped: Some(r.clipped),
            failure: r.failure.clone(),
        },
    }
}

pub fn written_paths(outcome: &QuickOutcome) -> Vec<PathBuf> {
    match outcome {
        QuickOutcome::Note { path } => vec![path.clone()],
        QuickOutcome::Image { image, note } => std::iter::once(image.clone()).chain(note.clone()).collect(),
        QuickOutcome::Clip(r) => vec![r.note_path.clone()],
    }
}

/// Raw base64 or a `data:` URL.
pub fn decode_image(b64: &str) -> Result<Vec<u8>, String> {
    let payload = b64.split_once("base64,").map(|(_, p)| p).unwrap_or(b64);
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|_| "invalid_image".to_string())
}

/// Registers shortcuts through the global-shortcut plugin.
pub struct PluginRegistrar<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> ShortcutRegistrar for PluginRegistrar<R> {
    fn register(&self, accel: &str) -> Result<(), String> {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as KeyState};
        self.0
            .global_shortcut()
            .on_shortcut(accel, |app, _shortcut, event| {
                if event.state() == KeyState::Pressed {
                    crate::capture::lifecycle::show_quick_capture(app);
                }
            })
            .map_err(|e| e.to_string())
    }
    fn unregister(&self, accel: &str) -> Result<(), String> {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        self.0.global_shortcut().unregister(accel).map_err(|e| e.to_string())
    }
}

pub(crate) fn notify_saved(app: &tauri::AppHandle) {
    use tauri_plugin_notification::{NotificationExt, PermissionState};
    let n = app.notification();
    if !matches!(n.permission_state(), Ok(PermissionState::Granted)) {
        let _ = n.request_permission();
    }
    let _ = n.builder().title("MarkDaun").body("Guardado en Entrada").show();
}

/// Saves a quick capture into the active vault's `Entrada/`, closes the
/// capture window and tells the main window (or the system, if it is hidden).
#[tauri::command]
pub async fn quick_capture_save(
    app: tauri::AppHandle,
    text: String,
    image_b64: Option<String>,
) -> Result<QuickSummary, String> {
    let db = app_db_path(&app)?;
    let vault = get_active_vault_inner(&db)?.ok_or_else(|| "no_vault".to_string())?;
    let image = image_b64.as_deref().map(decode_image).transpose()?;
    let input = QuickInput { text, image };
    let now = chrono::Local::now().naive_local();
    let outcome = save_quick_capture(Path::new(&vault), &input, now, &ClipOptions::default()).await?;
    let summary = summarize_quick(Path::new(&vault), &outcome);
    let added: Vec<String> = written_paths(&outcome).iter().map(|p| p.to_string_lossy().to_string()).collect();
    spawn_index_update(&app, vault, vec![], added);
    hide_quick_capture(&app);
    let _ = app.emit_to(MAIN_WINDOW, CAPTURED_EVENT, summary.clone());
    if !is_main_visible(&app) {
        notify_saved(&app);
    }
    Ok(summary)
}

#[tauri::command]
pub async fn quick_capture_hide(app: tauri::AppHandle) -> Result<(), String> {
    hide_quick_capture(&app);
    Ok(())
}

#[tauri::command]
pub async fn quick_capture_get_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, ShortcutState>,
) -> Result<QuickConfig, String> {
    Ok(shortcut::load_config(&state, &app_db_path(&app)?))
}

#[tauri::command]
pub async fn quick_capture_set_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, ShortcutState>,
    shortcut: String,
) -> Result<QuickConfig, String> {
    shortcut::set_shortcut(&PluginRegistrar(app.clone()), &state, &app_db_path(&app)?, &shortcut)
}

/// Really quits (after the frontend's exit guard approved it).
#[tauri::command]
pub async fn quit_app(app: tauri::AppHandle, flag: tauri::State<'_, QuitFlag>) -> Result<(), String> {
    flag.confirm();
    app.exit(0);
    Ok(())
}
