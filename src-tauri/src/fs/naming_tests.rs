use super::naming::{sanitize_file_stem, unique_name};
use std::fs;
use tempfile::tempdir;

#[test]
fn keeps_plain_titles() {
    assert_eq!(sanitize_file_stem("Mi nota"), Some("Mi nota".to_string()));
    assert_eq!(sanitize_file_stem("Investigación 2026"), Some("Investigación 2026".to_string()));
}

#[test]
fn replaces_invalid_characters_with_dash() {
    assert_eq!(sanitize_file_stem("a/b\\c:d*e?f\"g<h>i|j"), Some("a-b-c-d-e-f-g-h-i-j".to_string()));
}

#[test]
fn replaces_control_characters() {
    assert_eq!(sanitize_file_stem("a\tb\nc\u{0}d"), Some("a-b-c-d".to_string()));
}

#[test]
fn trims_spaces_and_dots() {
    assert_eq!(sanitize_file_stem("  .. hola ..  "), Some("hola".to_string()));
    assert_eq!(sanitize_file_stem("nota."), Some("nota".to_string()));
}

#[test]
fn empty_or_unusable_titles_give_none() {
    assert_eq!(sanitize_file_stem(""), None);
    assert_eq!(sanitize_file_stem("   "), None);
    assert_eq!(sanitize_file_stem(" . . "), None);
}

#[test]
fn only_invalid_characters_become_dashes_not_none() {
    assert_eq!(sanitize_file_stem("???"), Some("---".to_string()));
}

#[test]
fn long_titles_are_truncated_on_char_boundaries() {
    let title = "ñ".repeat(300);
    let out = sanitize_file_stem(&title).unwrap();
    assert_eq!(out.chars().count(), 120);
}

#[test]
fn windows_reserved_names_get_a_suffix() {
    assert_eq!(sanitize_file_stem("CON"), Some("CON-".to_string()));
    assert_eq!(sanitize_file_stem("lpt1"), Some("lpt1-".to_string()));
    assert_eq!(sanitize_file_stem("console"), Some("console".to_string()));
}

#[test]
fn unique_name_returns_base_when_free() {
    let dir = tempdir().unwrap();
    assert_eq!(unique_name(dir.path(), "Sin título", "md"), dir.path().join("Sin título.md"));
}

#[test]
fn unique_name_appends_counter_on_collision() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("Sin título.md"), b"").unwrap();
    assert_eq!(unique_name(dir.path(), "Sin título", "md"), dir.path().join("Sin título 2.md"));
    fs::write(dir.path().join("Sin título 2.md"), b"").unwrap();
    assert_eq!(unique_name(dir.path(), "Sin título", "md"), dir.path().join("Sin título 3.md"));
}
