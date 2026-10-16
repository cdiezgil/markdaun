use crate::commands::fs_ops::assert_within_vault;
use std::path::Path;

/// TC-22, TC-23: Read a note's UTF-8 content.
/// Path must be strictly within vault_path.
#[tauri::command]
pub async fn read_note(path: String, vault_path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let vault = Path::new(&vault_path);

    assert_within_vault(p, vault)?;

    std::fs::read_to_string(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "path_not_found".to_string()
        } else {
            format!("io_error: {e}")
        }
    })
}

/// TC-24: Write (create or overwrite) a note.
/// Path must be strictly within vault_path.
#[tauri::command]
pub async fn write_note(
    path: String,
    content: String,
    vault_path: String,
) -> Result<(), String> {
    let p = Path::new(&path);
    let vault = Path::new(&vault_path);

    assert_within_vault(p, vault)?;

    std::fs::write(p, content.as_bytes()).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "path_not_found".to_string()
        } else {
            format!("io_error: {e}")
        }
    })
}

/// TC-25, TC-26: Open the native file picker filtered to image types.
/// Returns Some(absolute_path) or None if the user cancels.
#[tauri::command]
pub async fn pick_image_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "gif", "webp", "svg"],
        )
        .blocking_pick_file();

    match result {
        Some(file_path) => Ok(Some(
            file_path
                .into_path()
                .map_err(|e| format!("dialog_error: {e}"))?
                .to_string_lossy()
                .to_string(),
        )),
        None => Ok(None),
    }
}
