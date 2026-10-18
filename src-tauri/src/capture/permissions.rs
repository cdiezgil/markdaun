//! Webview permission policy: only the quick-capture window may use the
//! microphone (voice notes); nothing else in the app records or films.

use tauri::webview::{PermissionKind, PermissionResponse};

pub const QUICK_CAPTURE_LABEL: &str = "quick-capture";

pub fn decide(webview_label: &str, kind: &PermissionKind) -> PermissionResponse {
    match kind {
        PermissionKind::Microphone if webview_label == QUICK_CAPTURE_LABEL => PermissionResponse::Allow,
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::DisplayCapture => PermissionResponse::Deny,
        _ => PermissionResponse::Default,
    }
}
