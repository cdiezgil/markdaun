use super::vault::{get_active_vault_inner, set_active_vault_inner};
use tempfile::tempdir;

/// TC-01, TC-03: persists vault path and retrieves it
#[test]
fn persists_path() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("config.db");
    let vault_dir = tempdir().unwrap();
    let vault_path = vault_dir.path().to_str().unwrap();

    set_active_vault_inner(&db_path, vault_path).unwrap();
    let result = get_active_vault_inner(&db_path).unwrap();
    assert_eq!(result, Some(vault_path.to_string()));
}

/// TC-02: returns None when no vault is set
#[test]
fn none_when_unset() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("config.db");

    let result = get_active_vault_inner(&db_path).unwrap();
    assert_eq!(result, None);
}

/// TC-19: rejects path that does not exist
#[test]
fn rejects_nonexistent() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("config.db");

    let result = set_active_vault_inner(&db_path, "/this/path/does/not/exist/ever");
    assert_eq!(result, Err("path_not_found".to_string()));
}

/// rejects a file path (not a directory) as vault
#[test]
fn rejects_file_as_vault() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("config.db");
    let file_path = tmp.path().join("file.txt");
    std::fs::write(&file_path, b"hello").unwrap();

    let result = set_active_vault_inner(&db_path, file_path.to_str().unwrap());
    assert_eq!(result, Err("not_a_directory".to_string()));
}
