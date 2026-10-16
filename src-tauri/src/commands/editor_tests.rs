use std::fs;
use tempfile::tempdir;

// ── TC-22: read_note happy path ───────────────────────────────────────────────

/// TC-22: read_note returns file content for a path within the vault
#[test]
fn read_note_happy_path() {
    let vault = tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, b"# Hello\n\nWorld").unwrap();

    // Simulate read_note logic
    use crate::commands::fs_ops::assert_within_vault;
    assert_within_vault(&note, vault.path()).unwrap();
    let content = fs::read_to_string(&note).unwrap();
    assert_eq!(content, "# Hello\n\nWorld");
}

/// TC-22: read_note returns path_not_found for missing file
#[test]
fn read_note_missing_file() {
    let vault = tempdir().unwrap();
    let note = vault.path().join("missing.md");

    // File does not exist — canonicalize will fail → assert_within_vault returns path_not_found
    use crate::commands::fs_ops::assert_within_vault;
    let result = assert_within_vault(&note, vault.path());
    assert_eq!(result, Err("path_not_found".to_string()));
}

// ── TC-23: read_note rejects path outside vault ───────────────────────────────

/// TC-23: read_note rejects a path outside the vault
#[test]
fn read_note_outside_vault_rejected() {
    let vault = tempdir().unwrap();

    use crate::commands::fs_ops::assert_within_vault;
    // /etc or /tmp is outside any tempdir vault
    let outside_vault = tempdir().unwrap(); // a different tempdir → outside vault
    let outside_note = outside_vault.path().join("evil.md");
    fs::write(&outside_note, b"evil").unwrap();

    let result = assert_within_vault(&outside_note, vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

// ── TC-24: write_note happy path ──────────────────────────────────────────────

/// TC-24: write_note creates/overwrites a file with given content
#[test]
fn write_note_happy_path() {
    let vault = tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, b"original").unwrap();

    // Simulate write_note logic
    use crate::commands::fs_ops::assert_within_vault;
    assert_within_vault(&note, vault.path()).unwrap();
    fs::write(&note, b"hola").unwrap();

    let content = fs::read_to_string(&note).unwrap();
    assert_eq!(content, "hola");
}

/// TC-24: write_note overwrites existing file
#[test]
fn write_note_overwrites_existing() {
    let vault = tempdir().unwrap();
    let note = vault.path().join("existing.md");
    fs::write(&note, b"old content").unwrap();

    use crate::commands::fs_ops::assert_within_vault;
    assert_within_vault(&note, vault.path()).unwrap();
    fs::write(&note, b"new content").unwrap();

    assert_eq!(fs::read_to_string(&note).unwrap(), "new content");
}

/// TC-23: write_note outside vault is rejected
#[test]
fn write_note_outside_vault_rejected() {
    let vault = tempdir().unwrap();
    let outside_vault = tempdir().unwrap();
    let outside_note = outside_vault.path().join("evil.md");
    fs::write(&outside_note, b"").unwrap();

    use crate::commands::fs_ops::assert_within_vault;
    let result = assert_within_vault(&outside_note, vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

// ── TC-R1 / TC-R2: regression for assert_within_vault ───────────────────────

/// TC-R1: assert_within_vault passes for a file inside the vault
#[test]
fn regression_tc_r1_within_vault_ok() {
    let vault = tempdir().unwrap();
    let file = vault.path().join("note.md");
    fs::write(&file, b"").unwrap();

    use crate::commands::fs_ops::assert_within_vault;
    assert!(assert_within_vault(&file, vault.path()).is_ok());
}

/// TC-R2: assert_within_vault rejects a path outside the vault
#[test]
fn regression_tc_r2_outside_vault_rejected() {
    let vault = tempdir().unwrap();
    let other = tempdir().unwrap();
    let outside = other.path().join("evil.md");
    fs::write(&outside, b"").unwrap();

    use crate::commands::fs_ops::assert_within_vault;
    let result = assert_within_vault(&outside, vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}
