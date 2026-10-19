use crate::db::ConfigDb;
use crate::fs::{walk_vault, VaultEntry};
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::fs_ops::validate_entry_name;

// ── DB path helper ─────────────────────────────────────────────────────────────

fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("config.db"))
}

const IDE_PROJECTS_KEY: &str = "ide_projects";

// ── Commands ───────────────────────────────────────────────────────────────────

/// Abre el diálogo del SO para seleccionar una carpeta. Devuelve None si el
/// usuario cancela.
#[tauri::command]
pub async fn ide_open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

/// Lista el árbol de una carpeta externa (delega en walk_vault).
/// Devuelve error "path_not_found" si root_path no existe.
#[tauri::command]
pub async fn ide_list_tree(root_path: String) -> Result<Vec<VaultEntry>, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("path_not_found".to_string());
    }
    walk_vault(root).map_err(|e| format!("io_error: {e}"))
}

/// Lee el contenido UTF-8 de cualquier fichero. Sin guardia de vault.
/// Error "path_not_found" si no existe. Error "io_error: <msg>" en otros fallos.
#[tauri::command]
pub async fn ide_read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("path_not_found".to_string());
    }
    std::fs::read_to_string(p).map_err(|e| format!("io_error: {e}"))
}

/// Escribe contenido en cualquier fichero. Sin guardia de vault.
/// Error "path_not_found" si el directorio padre no existe.
#[tauri::command]
pub async fn ide_write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    let parent = p.parent().ok_or_else(|| "path_not_found".to_string())?;
    if !parent.exists() {
        return Err("path_not_found".to_string());
    }
    std::fs::write(p, content).map_err(|e| format!("io_error: {e}"))
}

/// Crea un fichero .md en parent_path con nombre name.
/// Valida name con validate_entry_name. Error "already_exists" si existe.
/// Devuelve la ruta canónica del nuevo fichero.
#[tauri::command]
pub async fn ide_create_file(parent_path: String, name: String) -> Result<String, String> {
    validate_entry_name(&name)?;

    let parent = Path::new(&parent_path);
    if !parent.exists() {
        return Err("path_not_found".to_string());
    }

    let name_with_ext = if name.to_lowercase().ends_with(".md") {
        name.clone()
    } else {
        format!("{name}.md")
    };
    let dest = parent.join(&name_with_ext);

    if dest.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::write(&dest, b"").map_err(|e| format!("io_error: {e}"))?;
    let canonical = dest.canonicalize().map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Crea una carpeta en parent_path con nombre name.
/// Valida name. Error "already_exists" si existe.
#[tauri::command]
pub async fn ide_create_folder(parent_path: String, name: String) -> Result<String, String> {
    validate_entry_name(&name)?;

    let parent = Path::new(&parent_path);
    if !parent.exists() {
        return Err("path_not_found".to_string());
    }

    let dest = parent.join(&name);
    if dest.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::create_dir(&dest).map_err(|e| format!("io_error: {e}"))?;
    let canonical = dest.canonicalize().map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Renombra una entrada (fichero o carpeta). Valida new_name.
/// No hace relink de wikilinks. Error "already_exists" si ya existe el destino.
/// Devuelve la nueva ruta canónica.
#[tauri::command]
pub async fn ide_rename_entry(path: String, new_name: String) -> Result<String, String> {
    validate_entry_name(&new_name)?;

    let entry_path = Path::new(&path);
    if !entry_path.exists() {
        return Err("path_not_found".to_string());
    }

    let parent = entry_path
        .parent()
        .ok_or_else(|| "io_error: no parent".to_string())?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err("already_exists".to_string());
    }

    std::fs::rename(entry_path, &new_path).map_err(|e| format!("io_error: {e}"))?;
    // new_path now exists after rename; canonicalize it
    let canonical = new_path.canonicalize().map_err(|e| format!("io_error: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Elimina un fichero (remove_file) o carpeta (remove_dir_all).
#[tauri::command]
pub async fn ide_delete_entry(path: String) -> Result<(), String> {
    let entry_path = Path::new(&path);
    if !entry_path.exists() {
        return Err("path_not_found".to_string());
    }
    if entry_path.is_dir() {
        std::fs::remove_dir_all(entry_path).map_err(|e| format!("io_error: {e}"))
    } else {
        std::fs::remove_file(entry_path).map_err(|e| format!("io_error: {e}"))
    }
}

/// Lee la lista de proyectos IDE de ConfigDb (clave "ide_projects", JSON array).
/// Devuelve [] si no existe la clave.
#[tauri::command]
pub async fn ide_get_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db_path = app_db_path(&app)?;
    let db = ConfigDb::open(&db_path).map_err(|e| e.to_string())?;
    match db.get(IDE_PROJECTS_KEY).map_err(|e| e.to_string())? {
        None => Ok(vec![]),
        Some(json) => serde_json::from_str::<Vec<String>>(&json)
            .map_err(|e| format!("io_error: {e}")),
    }
}

/// Persiste la lista de proyectos IDE en ConfigDb.
#[tauri::command]
pub async fn ide_save_projects(
    app: tauri::AppHandle,
    projects: Vec<String>,
) -> Result<(), String> {
    let db_path = app_db_path(&app)?;
    let db = ConfigDb::open(&db_path).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&projects).map_err(|e| format!("io_error: {e}"))?;
    db.set(IDE_PROJECTS_KEY, &json).map_err(|e| e.to_string())
}
