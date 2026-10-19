// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(warnings)]

mod capture;
mod commands;
mod db;
mod fs;
mod graph;
mod git;
mod llm;
mod voice;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .on_permission_request(|webview, kind| capture::permissions::decide(webview.label(), &kind))
        .manage(llm::env::LlmEnv::production())
        .manage(llm::validate::ValidationStore::default())
        .manage(std::sync::Arc::new(llm::EmbedderState::default()))
        .manage(commands::vault_index::IndexLocks::default())
        .manage(voice::jobs::VoiceJobs::default())
        .manage(voice::transcribe::EngineState::default())
        .manage(capture::shortcut::ShortcutState::default())
        .manage(capture::lifecycle::QuitFlag::default())
        .on_window_event(|window, event| {
            // Closing a window hides it: the app stays in the menu bar and
            // *Salir* (tray / Cmd+Q) goes through the exit guard.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match capture::lifecycle::on_close_requested(window.label()) {
                    capture::lifecycle::CloseAction::Hide => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(|app| {
            use tauri::Manager;
            commands::run_startup_migration(app.handle());
            commands::sync_active_vault_index(app.handle());
            capture::tray::build(app.handle())?;
            if let Ok(db) = commands::brain_cmd::app_db_path(app.handle()) {
                let registrar = commands::quick_cmd::PluginRegistrar(app.handle().clone());
                let state = app.state::<capture::shortcut::ShortcutState>();
                let cfg = capture::shortcut::register_saved(&registrar, &state, &db);
                if let Some(e) = cfg.error {
                    eprintln!("[quick_capture] cannot register {}: {e}", cfg.shortcut);
                }
            }
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
            commands::github_connect_preview,
            commands::github_connect_apply,
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
            commands::inbox_ensure,
            commands::inbox_list,
            commands::inbox_discard,
            commands::inbox_list_areas,
            commands::inbox_get_last_area,
            commands::inbox_set_last_area,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_delete,
            commands::archive_source,
            commands::brain_digest,
            commands::inbox_clip_url,
            commands::quick_capture_save,
            commands::quick_capture_hide,
            commands::quick_capture_save_audio,
            commands::voice_retry,
            commands::voice_get_config,
            commands::voice_set_model,
            commands::voice_download_model,
            commands::quick_capture_get_config,
            commands::quick_capture_set_shortcut,
            commands::quit_app,
            commands::ide_open_folder_dialog,
            commands::ide_list_tree,
            commands::ide_read_file,
            commands::ide_write_file,
            commands::ide_create_file,
            commands::ide_create_folder,
            commands::ide_rename_entry,
            commands::ide_delete_entry,
            commands::ide_get_projects,
            commands::ide_save_projects,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| match event {
        // Cmd+Q and friends arrive without an exit code: ask the unsynced-changes guard first.
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            use tauri::Manager;
            let confirmed = handle.state::<capture::lifecycle::QuitFlag>().is_confirmed();
            if capture::lifecycle::exit_action(code, confirmed) == capture::lifecycle::ExitAction::AskGuard {
                api.prevent_exit();
                capture::lifecycle::request_quit(handle);
            }
        }
        // Dock icon clicked while every window is hidden.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => capture::lifecycle::show_main(handle),
        _ => {}
    });
}
