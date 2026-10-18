//! Global shortcut for quick capture: validation, persistence in `config.db`
//! and registration through an injectable registrar (the plugin in the app,
//! a fake in tests).

use crate::db::ConfigDb;
use serde::Serialize;
use std::path::Path;
use std::str::FromStr;
use std::sync::Mutex;
use tauri_plugin_global_shortcut::{Modifiers, Shortcut};

pub const CONFIG_KEY: &str = "quick_capture_shortcut";

pub fn default_shortcut() -> &'static str {
    if cfg!(target_os = "macos") {
        "Alt+Cmd+N"
    } else {
        "Ctrl+Alt+N"
    }
}

/// Checks the accelerator parses and has a modifier besides Shift; returns it trimmed.
pub fn validate_accelerator(accel: &str) -> Result<String, String> {
    let accel = accel.trim();
    let invalid = || "invalid_shortcut".to_string();
    let parsed = Shortcut::from_str(accel).map_err(|_| invalid())?;
    let real_modifiers = Modifiers::ALT | Modifiers::CONTROL | Modifiers::META | Modifiers::SUPER;
    if !parsed.mods.intersects(real_modifiers) {
        return Err(invalid());
    }
    Ok(accel.to_string())
}

pub trait ShortcutRegistrar {
    fn register(&self, accel: &str) -> Result<(), String>;
    fn unregister(&self, accel: &str) -> Result<(), String>;
}

/// What is registered right now and the last registration failure.
#[derive(Default)]
pub struct ShortcutState {
    registered: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct QuickConfig {
    pub shortcut: String,
    pub default_shortcut: String,
    /// Why the shortcut is not active (e.g. taken by another app).
    pub error: Option<String>,
}

fn saved(db_path: &Path) -> Option<String> {
    ConfigDb::open(db_path).ok()?.get(CONFIG_KEY).ok().flatten().filter(|s| !s.is_empty())
}

pub fn load_config(state: &ShortcutState, db_path: &Path) -> QuickConfig {
    QuickConfig {
        shortcut: saved(db_path).unwrap_or_else(|| default_shortcut().to_string()),
        default_shortcut: default_shortcut().to_string(),
        error: state.error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    }
}

/// Registers the saved (or default) shortcut at startup. A failure is kept for
/// Settings instead of aborting the app.
pub fn register_saved(reg: &dyn ShortcutRegistrar, state: &ShortcutState, db_path: &Path) -> QuickConfig {
    let accel = saved(db_path)
        .and_then(|s| validate_accelerator(&s).ok())
        .unwrap_or_else(|| default_shortcut().to_string());
    match reg.register(&accel) {
        Ok(()) => {
            *state.registered.lock().unwrap_or_else(|p| p.into_inner()) = Some(accel);
            *state.error.lock().unwrap_or_else(|p| p.into_inner()) = None;
        }
        Err(reason) => {
            *state.registered.lock().unwrap_or_else(|p| p.into_inner()) = None;
            *state.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(reason);
        }
    }
    load_config(state, db_path)
}

/// Switches to `accel`: the new one must register before the old one is
/// released, so a refused shortcut never leaves the user without any.
pub fn set_shortcut(
    reg: &dyn ShortcutRegistrar,
    state: &ShortcutState,
    db_path: &Path,
    accel: &str,
) -> Result<QuickConfig, String> {
    let accel = validate_accelerator(accel)?;
    let current = state.registered.lock().unwrap_or_else(|p| p.into_inner()).clone();
    if current.as_deref() != Some(accel.as_str()) {
        reg.register(&accel).map_err(|reason| format!("shortcut_unavailable: {reason}"))?;
        if let Some(old) = current {
            let _ = reg.unregister(&old);
        }
        *state.registered.lock().unwrap_or_else(|p| p.into_inner()) = Some(accel.clone());
    }
    *state.error.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    db.set(CONFIG_KEY, &accel).map_err(|e| e.to_string())?;
    Ok(load_config(state, db_path))
}
