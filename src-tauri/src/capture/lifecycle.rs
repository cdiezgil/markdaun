//! App lifecycle around the menu-bar presence: closing hides windows, *Salir*
//! goes through the exit guard, and the tray menu. The decisions are plain
//! functions (tested); the window and tray calls are thin glue around them.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

pub const MAIN_WINDOW: &str = "main";
pub const QUICK_WINDOW: &str = "quick-capture";
/// Sent to the main window when the user asks to quit; the frontend runs the
/// unsynced-changes guard and then calls `quit_app`.
pub const REQUEST_QUIT_EVENT: &str = "request-quit";
/// Sent to the quick-capture window each time it is shown.
pub const QUICK_OPEN_EVENT: &str = "quick-capture-open";

pub const TRAY_OPEN: &str = "tray-open";
pub const TRAY_QUICK: &str = "tray-quick-capture";
pub const TRAY_QUIT: &str = "tray-quit";
pub const TRAY_ITEMS: [(&str, &str); 3] = [
    (TRAY_OPEN, "Abrir MarkDaun"),
    (TRAY_QUICK, "Captura rápida"),
    (TRAY_QUIT, "Salir"),
];

#[derive(Debug, PartialEq, Eq)]
pub enum CloseAction {
    Hide,
}

/// Closing a window never ends the app: it keeps living in the menu bar.
pub fn on_close_requested(_label: &str) -> CloseAction {
    CloseAction::Hide
}

#[derive(Debug, PartialEq, Eq)]
pub enum ExitAction {
    Allow,
    AskGuard,
}

/// `code` is `Some` for an explicit `app.exit(code)`; `None` for user-driven
/// requests (Cmd+Q, last window gone), which must go through the guard.
pub fn exit_action(code: Option<i32>, quit_confirmed: bool) -> ExitAction {
    if code.is_some() || quit_confirmed {
        ExitAction::Allow
    } else {
        ExitAction::AskGuard
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TrayAction {
    OpenMain,
    QuickCapture,
    Quit,
}

pub fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        TRAY_OPEN => Some(TrayAction::OpenMain),
        TRAY_QUICK => Some(TrayAction::QuickCapture),
        TRAY_QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}

/// Set once the user (through the guard) really wants to quit.
#[derive(Default)]
pub struct QuitFlag(AtomicBool);

impl QuitFlag {
    pub fn confirm(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_confirmed(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

// ─── Glue ─────────────────────────────────────────────────────────────────────

pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn show_quick_capture<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window(QUICK_WINDOW) {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit(QUICK_OPEN_EVENT, ());
    }
}

pub fn hide_quick_capture<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window(QUICK_WINDOW) {
        let _ = w.hide();
    }
}

/// Brings the main window up and asks the frontend to run the exit guard.
pub fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    show_main(app);
    let _ = app.emit_to(MAIN_WINDOW, REQUEST_QUIT_EVENT, ());
}

pub fn is_main_visible<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.get_webview_window(MAIN_WINDOW)
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}
