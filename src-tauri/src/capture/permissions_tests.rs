use super::permissions::decide;
use tauri::webview::{PermissionKind, PermissionResponse};

#[test]
fn only_quick_capture_gets_the_microphone() {
    assert!(matches!(decide("quick-capture", &PermissionKind::Microphone), PermissionResponse::Allow));
    assert!(matches!(decide("main", &PermissionKind::Microphone), PermissionResponse::Deny));
}

#[test]
fn camera_and_screen_capture_are_always_denied() {
    for label in ["main", "quick-capture"] {
        assert!(matches!(decide(label, &PermissionKind::Camera), PermissionResponse::Deny));
        assert!(matches!(decide(label, &PermissionKind::DisplayCapture), PermissionResponse::Deny));
    }
}

#[test]
fn everything_else_keeps_the_platform_default() {
    assert!(matches!(decide("main", &PermissionKind::Notifications), PermissionResponse::Default));
}
