use super::lifecycle::*;

#[test]
fn closing_any_window_hides_it_instead_of_quitting() {
    assert_eq!(on_close_requested(MAIN_WINDOW), CloseAction::Hide);
    assert_eq!(on_close_requested(QUICK_WINDOW), CloseAction::Hide);
}

#[test]
fn only_an_explicit_exit_or_a_confirmed_quit_ends_the_app() {
    // Cmd+Q / "last window closed" arrive without an exit code: ask the guard.
    assert_eq!(exit_action(None, false), ExitAction::AskGuard);
    // `app.exit(0)` carries a code.
    assert_eq!(exit_action(Some(0), false), ExitAction::Allow);
    // The guard approved (flag set by `quit_app`).
    assert_eq!(exit_action(None, true), ExitAction::Allow);
}

#[test]
fn quit_flag_is_off_until_confirmed() {
    let flag = QuitFlag::default();
    assert!(!flag.is_confirmed());
    flag.confirm();
    assert!(flag.is_confirmed());
}

#[test]
fn tray_menu_items_map_to_actions() {
    assert_eq!(tray_action(TRAY_OPEN), Some(TrayAction::OpenMain));
    assert_eq!(tray_action(TRAY_QUICK), Some(TrayAction::QuickCapture));
    assert_eq!(tray_action(TRAY_QUIT), Some(TrayAction::Quit));
    assert_eq!(tray_action("otro"), None);
}

#[test]
fn tray_labels_are_spanish() {
    let labels: Vec<&str> = TRAY_ITEMS.iter().map(|(_, l)| *l).collect();
    assert_eq!(labels, ["Abrir MarkDaun", "Captura rápida", "Salir"]);
    // Every menu id has an action.
    assert!(TRAY_ITEMS.iter().all(|(id, _)| tray_action(id).is_some()));
}

#[test]
fn quit_event_and_open_event_names_are_stable() {
    // The frontend listens for these exact names.
    assert_eq!(REQUEST_QUIT_EVENT, "request-quit");
    assert_eq!(QUICK_OPEN_EVENT, "quick-capture-open");
}
