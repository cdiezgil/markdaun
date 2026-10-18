use super::shortcut::*;
use std::cell::RefCell;
use std::collections::HashSet;
use tempfile::NamedTempFile;

#[derive(Default)]
struct Fake {
    taken: HashSet<String>,
    active: RefCell<Vec<String>>,
}

impl Fake {
    fn taken(accels: &[&str]) -> Self {
        Self { taken: accels.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }
}

impl ShortcutRegistrar for Fake {
    fn register(&self, accel: &str) -> Result<(), String> {
        if self.taken.contains(accel) {
            return Err(format!("HotKey already registered: {accel}"));
        }
        self.active.borrow_mut().push(accel.to_string());
        Ok(())
    }
    fn unregister(&self, accel: &str) -> Result<(), String> {
        self.active.borrow_mut().retain(|a| a != accel);
        Ok(())
    }
}

fn db() -> NamedTempFile {
    NamedTempFile::new().unwrap()
}

#[test]
fn default_shortcut_depends_on_the_platform() {
    let d = default_shortcut();
    if cfg!(target_os = "macos") {
        assert_eq!(d, "Alt+Cmd+N");
    } else {
        assert_eq!(d, "Ctrl+Alt+N");
    }
    assert!(validate_accelerator(d).is_ok());
}

#[test]
fn validation_needs_a_modifier_and_a_key() {
    for ok in ["Alt+Cmd+N", "Ctrl+Alt+N", "CommandOrControl+Shift+K", "Alt+F5", " Ctrl+Alt+N "] {
        assert!(validate_accelerator(ok).is_ok(), "{ok}");
    }
    for bad in ["", "N", "Shift+N", "Alt+", "Alt+Cmd", "Hola+N", "Alt+Cmd+N+M"] {
        assert_eq!(validate_accelerator(bad), Err("invalid_shortcut".to_string()), "{bad}");
    }
    assert_eq!(validate_accelerator(" Ctrl+Alt+N ").unwrap(), "Ctrl+Alt+N");
}

#[test]
fn startup_registers_the_default_when_nothing_is_saved() {
    let (f, state, file) = (Fake::default(), ShortcutState::default(), db());
    let cfg = register_saved(&f, &state, file.path());
    assert_eq!(*f.active.borrow(), [default_shortcut()]);
    assert_eq!(cfg.shortcut, default_shortcut());
    assert_eq!(cfg.error, None);
    assert_eq!(cfg.default_shortcut, default_shortcut());
}

#[test]
fn startup_reports_a_shortcut_taken_by_another_app() {
    let (f, state, file) = (Fake::taken(&["Alt+Cmd+N", "Ctrl+Alt+N"]), ShortcutState::default(), db());
    let cfg = register_saved(&f, &state, file.path());
    assert!(f.active.borrow().is_empty());
    assert!(cfg.error.as_deref().unwrap().contains("already registered"), "{:?}", cfg.error);
    // The error is what Settings reads later.
    assert_eq!(load_config(&state, file.path()).error, cfg.error);
}

#[test]
fn changing_the_shortcut_swaps_the_registration_and_persists() {
    let (f, state, file) = (Fake::default(), ShortcutState::default(), db());
    register_saved(&f, &state, file.path());
    let cfg = set_shortcut(&f, &state, file.path(), "Ctrl+Shift+K").unwrap();
    assert_eq!(cfg.shortcut, "Ctrl+Shift+K");
    assert_eq!(*f.active.borrow(), ["Ctrl+Shift+K"], "the old one was released");
    assert_eq!(load_config(&state, file.path()).shortcut, "Ctrl+Shift+K");

    // A fresh start picks the saved shortcut.
    let (f2, state2) = (Fake::default(), ShortcutState::default());
    assert_eq!(register_saved(&f2, &state2, file.path()).shortcut, "Ctrl+Shift+K");
    assert_eq!(*f2.active.borrow(), ["Ctrl+Shift+K"]);
}

#[test]
fn a_taken_shortcut_is_rejected_and_the_previous_one_stays() {
    let (f, state, file) = (Fake::taken(&["Alt+Shift+Q"]), ShortcutState::default(), db());
    register_saved(&f, &state, file.path());
    let err = set_shortcut(&f, &state, file.path(), "Alt+Shift+Q").unwrap_err();
    assert!(err.starts_with("shortcut_unavailable:") && err.contains("already registered"), "{err}");
    assert_eq!(*f.active.borrow(), [default_shortcut()]);
    assert_eq!(load_config(&state, file.path()).shortcut, default_shortcut());
}

#[test]
fn an_invalid_shortcut_touches_nothing() {
    let (f, state, file) = (Fake::default(), ShortcutState::default(), db());
    register_saved(&f, &state, file.path());
    assert_eq!(set_shortcut(&f, &state, file.path(), "N").unwrap_err(), "invalid_shortcut");
    assert_eq!(*f.active.borrow(), [default_shortcut()]);
}

#[test]
fn setting_the_current_shortcut_again_is_a_no_op_and_clears_a_stale_error() {
    let (f, state, file) = (Fake::default(), ShortcutState::default(), db());
    register_saved(&f, &state, file.path());
    set_shortcut(&f, &state, file.path(), default_shortcut()).unwrap();
    assert_eq!(f.active.borrow().len(), 1);
    assert_eq!(load_config(&state, file.path()).error, None);
}

#[test]
fn a_failed_startup_is_fixed_by_choosing_another_shortcut() {
    let (f, state, file) = (Fake::taken(&["Alt+Cmd+N", "Ctrl+Alt+N"]), ShortcutState::default(), db());
    register_saved(&f, &state, file.path());
    let cfg = set_shortcut(&f, &state, file.path(), "Ctrl+Shift+K").unwrap();
    assert_eq!(cfg.error, None);
    assert_eq!(*f.active.borrow(), ["Ctrl+Shift+K"]);
}
