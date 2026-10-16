// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(warnings)]

mod commands;
mod db;
mod fs;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault_dialog,
            commands::get_active_vault,
            commands::set_active_vault,
            commands::list_vault_tree,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::delete_entry,
            commands::import_files,
            commands::read_note,
            commands::write_note,
            commands::pick_image_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
