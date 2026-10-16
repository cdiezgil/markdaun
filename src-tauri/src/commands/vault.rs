use crate::db::ConfigDb;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Inner helper: set the active vault in the config db.
/// Extracted for testability.
pub fn set_active_vault_inner(db_path: &Path, vault_path: &str) -> Result<(), String> {
    let p = Path::new(vault_path);
    if !p.exists() {
        return Err("path_not_found".to_string());
    }
    if !p.is_dir() {
        return Err("not_a_directory".to_string());
    }
    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    db.set("active_vault", vault_path)
        .map_err(|e| e.to_string())
}

/// Inner helper: get the active vault from the config db.
/// Extracted for testability.
pub fn get_active_vault_inner(db_path: &Path) -> Result<Option<String>, String> {
    let db = ConfigDb::open(db_path).map_err(|e| e.to_string())?;
    db.get("active_vault").map_err(|e| e.to_string())
}

fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("config.db"))
}

#[tauri::command]
pub async fn open_vault_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => {
            let path_str = path.to_string();
            let db_path = app_db_path(&app)?;
            set_active_vault_inner(&db_path, &path_str)?;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_active_vault(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db_path = app_db_path(&app)?;
    get_active_vault_inner(&db_path)
}

#[tauri::command]
pub async fn set_active_vault(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let db_path = app_db_path(&app)?;
    set_active_vault_inner(&db_path, &path)
}
