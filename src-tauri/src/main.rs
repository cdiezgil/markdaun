// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(warnings)]

mod commands;
mod db;
mod fs;
mod graph;
mod git;
mod llm;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(llm::env::LlmEnv::production())
        .manage(llm::validate::ValidationStore::default())
        .manage(std::sync::Arc::new(llm::EmbedderState::default()))
        .manage(commands::vault_index::IndexLocks::default())
        .setup(|app| {
            commands::run_startup_migration(app.handle());
            commands::sync_active_vault_index(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault_dialog,
            commands::get_active_vault,
            commands::set_active_vault,
            commands::list_vault_tree,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::rename_note_from_title,
            commands::create_untitled_note,
            commands::move_entry,
            commands::delete_entry,
            commands::import_files,
            commands::import_file_data,
            commands::read_note,
            commands::write_note,
            commands::pick_image_file,
            commands::get_vault_graph,
            commands::get_backlinks,
            commands::save_node_position,
            commands::github_configure,
            commands::github_get_config,
            commands::github_disconnect,
            commands::github_push,
            commands::github_pull,
            commands::github_status,
            commands::brain_query,
            commands::brain_get_conversations,
            commands::brain_get_messages,
            commands::brain_set_conversation_scope,
            commands::brain_delete_conversation,
            commands::brain_update_embedding,
            commands::chat_write_note,
            commands::note_exists,
            commands::read_note_tail,
            commands::llm_validate,
            commands::llm_verify_model,
            commands::llm_test_vision,
            commands::llm_save_connection,
            commands::llm_list_connections,
            commands::llm_delete_connection,
            commands::llm_set_active,
            commands::llm_get_active,
            commands::llm_detect_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
