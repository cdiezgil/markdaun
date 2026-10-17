use super::chat_notes::{note_exists_inner, read_note_tail_inner, write_note_inner, WriteMode};
use std::fs;
use tempfile::tempdir;

#[test]
fn create_writes_file_and_returns_absolute_path() {
    let v = tempdir().unwrap();
    let out = write_note_inner(v.path(), "a.md", "# Hi", WriteMode::Create).unwrap();
    assert!(std::path::Path::new(&out).is_absolute());
    assert_eq!(fs::read_to_string(v.path().join("a.md")).unwrap(), "# Hi");
}

#[test]
fn create_existing_fails_already_exists() {
    let v = tempdir().unwrap();
    fs::write(v.path().join("a.md"), "x").unwrap();
    let r = write_note_inner(v.path(), "a.md", "y", WriteMode::Create);
    assert_eq!(r, Err("already_exists".to_string()));
    assert_eq!(fs::read_to_string(v.path().join("a.md")).unwrap(), "x");
}

#[test]
fn create_makes_nested_folders() {
    let v = tempdir().unwrap();
    write_note_inner(v.path(), "x/y/z.md", "n", WriteMode::Create).unwrap();
    assert!(v.path().join("x/y/z.md").is_file());
}

#[test]
fn append_adds_blank_line_separator_and_single_trailing_newline() {
    let v = tempdir().unwrap();
    fs::write(v.path().join("a.md"), "old\n\n\n").unwrap();
    write_note_inner(v.path(), "a.md", "new\n\n", WriteMode::Append).unwrap();
    assert_eq!(fs::read_to_string(v.path().join("a.md")).unwrap(), "old\n\nnew\n");
}

#[test]
fn append_missing_fails_not_found() {
    let v = tempdir().unwrap();
    let r = write_note_inner(v.path(), "a.md", "n", WriteMode::Append);
    assert_eq!(r, Err("not_found".to_string()));
}

#[test]
fn rejects_parent_escape_absolute_and_non_md() {
    let v = tempdir().unwrap();
    for p in ["../evil.md", "a/../../evil.md", "/tmp/evil.md", "a.txt", "noext", ""] {
        assert_eq!(
            write_note_inner(v.path(), p, "n", WriteMode::Create),
            Err("invalid_path".to_string()),
            "{p}"
        );
        assert_eq!(note_exists_inner(v.path(), p), Err("invalid_path".to_string()), "{p}");
        assert_eq!(read_note_tail_inner(v.path(), p, 3), Err("invalid_path".to_string()), "{p}");
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlink_escape() {
    let v = tempdir().unwrap();
    let outside = tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), v.path().join("link")).unwrap();
    let r = write_note_inner(v.path(), "link/e.md", "n", WriteMode::Create);
    assert_eq!(r, Err("invalid_path".to_string()));
    assert!(!outside.path().join("e.md").exists());
}

#[test]
fn note_exists_reports_presence() {
    let v = tempdir().unwrap();
    assert_eq!(note_exists_inner(v.path(), "a.md"), Ok(false));
    fs::write(v.path().join("a.md"), "x").unwrap();
    assert_eq!(note_exists_inner(v.path(), "a.md"), Ok(true));
}

#[test]
fn read_tail_returns_last_lines() {
    let v = tempdir().unwrap();
    fs::write(v.path().join("a.md"), "1\n2\n3\n4\n5\n").unwrap();
    assert_eq!(read_note_tail_inner(v.path(), "a.md", 2).unwrap(), "4\n5");
    assert_eq!(read_note_tail_inner(v.path(), "a.md", 50).unwrap(), "1\n2\n3\n4\n5");
}

#[test]
fn read_tail_missing_is_not_found() {
    let v = tempdir().unwrap();
    assert_eq!(read_note_tail_inner(v.path(), "a.md", 2), Err("not_found".to_string()));
}
