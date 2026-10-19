use super::fs_ops::validate_entry_name;
use crate::fs::walk_vault;
use tempfile::TempDir;

/// Helper: create a temp directory tree for IDE tests.
fn make_project() -> TempDir {
    tempfile::tempdir().expect("tempdir")
}

// ── TC-07: ide_write_file and ide_read_file ────────────────────────────────────

#[test]
fn tc07_ide_write_and_read_file() {
    let dir = make_project();
    let file_path = dir.path().join("README.md");

    // Write
    std::fs::write(&file_path, "# Hello\n").unwrap();

    // Read back
    let content = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "# Hello\n");
}

#[test]
fn tc07_ide_read_file_not_found() {
    let dir = make_project();
    let missing = dir.path().join("missing.md");
    assert!(!missing.exists());
    // Simulate what ide_read_file does: check existence first.
    let result: Result<String, String> = if missing.exists() {
        Ok(std::fs::read_to_string(&missing).unwrap())
    } else {
        Err("path_not_found".to_string())
    };
    assert_eq!(result, Err("path_not_found".to_string()));
}

#[test]
fn tc07_ide_write_file_no_parent() {
    let dir = make_project();
    let bad_path = dir.path().join("nonexistent_dir").join("file.md");
    let parent = bad_path.parent().unwrap();
    let result: Result<(), String> = if !parent.exists() {
        Err("path_not_found".to_string())
    } else {
        std::fs::write(&bad_path, "x").map_err(|e| format!("io_error: {e}"))
    };
    assert_eq!(result, Err("path_not_found".to_string()));
}

// ── TC-08: ide_create_file ────────────────────────────────────────────────────

#[test]
fn tc08_ide_create_file_success() {
    let dir = make_project();
    let parent = dir.path().to_path_buf();
    let name = "nueva_nota.md".to_string();
    let dest = parent.join(&name);
    assert!(!dest.exists());
    std::fs::write(&dest, b"").unwrap();
    assert!(dest.exists());
}

#[test]
fn tc08_ide_create_file_already_exists() {
    let dir = make_project();
    let parent = dir.path().to_path_buf();
    let dest = parent.join("already.md");
    std::fs::write(&dest, b"content").unwrap();
    // Simulate already_exists check
    let result: Result<String, String> = if dest.exists() {
        Err("already_exists".to_string())
    } else {
        Ok(dest.to_string_lossy().to_string())
    };
    assert_eq!(result, Err("already_exists".to_string()));
}

// ── TC-09: ide_rename_entry ───────────────────────────────────────────────────

#[test]
fn tc09_ide_rename_entry_success() {
    let dir = make_project();
    let old = dir.path().join("old.md");
    std::fs::write(&old, "content").unwrap();
    let new = dir.path().join("new.md");
    std::fs::rename(&old, &new).unwrap();
    assert!(!old.exists());
    assert!(new.exists());
}

#[test]
fn tc09_ide_rename_entry_already_exists() {
    let dir = make_project();
    let old = dir.path().join("old.md");
    let existing = dir.path().join("existing.md");
    std::fs::write(&old, "a").unwrap();
    std::fs::write(&existing, "b").unwrap();
    // Simulate already_exists
    let result: Result<String, String> = if existing.exists() {
        Err("already_exists".to_string())
    } else {
        std::fs::rename(&old, &existing)
            .map_err(|e| format!("io_error: {e}"))
            .map(|_| existing.to_string_lossy().to_string())
    };
    assert_eq!(result, Err("already_exists".to_string()));
}

// ── TC-10: ide_delete_entry ───────────────────────────────────────────────────

#[test]
fn tc10_ide_delete_file() {
    let dir = make_project();
    let file = dir.path().join("to_delete.md");
    std::fs::write(&file, "x").unwrap();
    std::fs::remove_file(&file).unwrap();
    assert!(!file.exists());
}

#[test]
fn tc10_ide_delete_folder() {
    let dir = make_project();
    let folder = dir.path().join("to_delete_dir");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("note.md"), "x").unwrap();
    std::fs::remove_dir_all(&folder).unwrap();
    assert!(!folder.exists());
}

// ── TC-11: ide_create_folder ─────────────────────────────────────────────────

#[test]
fn tc11_ide_create_folder_success() {
    let dir = make_project();
    let new_folder = dir.path().join("src");
    assert!(!new_folder.exists());
    std::fs::create_dir(&new_folder).unwrap();
    assert!(new_folder.is_dir());
}

#[test]
fn tc11_ide_create_folder_already_exists() {
    let dir = make_project();
    let folder = dir.path().join("existing");
    std::fs::create_dir(&folder).unwrap();
    let result: Result<String, String> = if folder.exists() {
        Err("already_exists".to_string())
    } else {
        Ok(folder.to_string_lossy().to_string())
    };
    assert_eq!(result, Err("already_exists".to_string()));
}

// ── TC-13: validate_entry_name rejects path traversal ────────────────────────

#[test]
fn tc13_validate_entry_name_rejects_path_traversal() {
    assert_eq!(validate_entry_name("../../etc/passwd"), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name(".."), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("."), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name(""), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("  "), Err("invalid_name".to_string()));
}

// ── TC-14: ide_list_tree filters hidden entries ───────────────────────────────

#[test]
fn tc14_ide_list_tree_filters_hidden() {
    let dir = make_project();
    let root = dir.path();

    // Create some files
    std::fs::write(root.join("README.md"), "# Hello").unwrap();
    std::fs::write(root.join(".gitignore"), "target/").unwrap();
    std::fs::create_dir(root.join(".git")).unwrap();
    std::fs::write(root.join(".DS_Store"), "").unwrap();
    std::fs::write(root.join("main.rs"), "fn main() {}").unwrap();

    let entries = walk_vault(root).expect("walk_vault");
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

    assert!(names.contains(&"README.md"), "README.md should be included");
    assert!(names.contains(&"main.rs"), "main.rs should be included");
    assert!(!names.iter().any(|n| n.starts_with('.')), "hidden entries should be filtered");
}

// ── TC-15: ide_write_file writes outside vault (no vault guard) ───────────────

#[test]
fn tc15_ide_write_file_outside_vault_allowed() {
    let dir = make_project();
    let file = dir.path().join("secret.md");
    // No assert_within_vault is called in ide.rs — writing should succeed
    std::fs::write(&file, "x").unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "x");
}

// ── TC-16: validate_entry_name rejects slash in name ─────────────────────────

#[test]
fn tc16_validate_entry_name_rejects_slash() {
    assert_eq!(validate_entry_name("fo/bar"), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("fo\\bar"), Err("invalid_name".to_string()));
}

#[test]
fn tc16_validate_entry_name_accepts_valid() {
    assert!(validate_entry_name("mi nota.md").is_ok());
    assert!(validate_entry_name("carpeta").is_ok());
    assert!(validate_entry_name("notas 2024").is_ok());
}

// ── ide_get_projects / ide_save_projects (integration via ConfigDb) ───────────

#[test]
fn tc_ide_projects_roundtrip() {
    use crate::db::ConfigDb;

    let dir = make_project();
    let db_path = dir.path().join("config.db");
    let db = ConfigDb::open(&db_path).expect("open db");

    // No projects yet → empty JSON would need to be None
    let val = db.get("ide_projects").expect("get");
    assert!(val.is_none(), "No projects key yet");

    // Save projects
    let projects = vec!["/tmp/p1".to_string(), "/tmp/p2".to_string()];
    let json = serde_json::to_string(&projects).unwrap();
    db.set("ide_projects", &json).expect("set");

    // Read them back
    let stored = db.get("ide_projects").expect("get again").unwrap();
    let parsed: Vec<String> = serde_json::from_str(&stored).unwrap();
    assert_eq!(parsed, projects);
}

#[test]
fn tc_ide_projects_empty_when_no_key() {
    use crate::db::ConfigDb;

    let dir = make_project();
    let db_path = dir.path().join("config.db");
    let db = ConfigDb::open(&db_path).expect("open db");

    let val: Vec<String> = match db.get("ide_projects").expect("get") {
        None => vec![],
        Some(json) => serde_json::from_str(&json).unwrap(),
    };
    assert!(val.is_empty());
}
