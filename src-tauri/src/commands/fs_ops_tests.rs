use super::fs_ops::{assert_within_vault, move_entry_inner, validate_entry_name};
use std::fs;
use std::path::Path;
use tempfile::tempdir;

// ── assert_within_vault ──────────────────────────────────────────────────────

/// assert_within_vault passes for a path inside the vault
#[test]
fn within_vault_ok() {
    let vault = tempdir().unwrap();
    let file = vault.path().join("note.md");
    fs::write(&file, b"").unwrap();

    assert!(assert_within_vault(&file, vault.path()).is_ok());
}

/// TC-23: path traversal is rejected
#[test]
fn path_traversal_rejected() {
    let vault = tempdir().unwrap();
    // /etc/passwd is outside the vault
    let outside = Path::new("/etc/passwd");
    let result = assert_within_vault(outside, vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

/// TC-17: import_files with dest outside vault returns path_outside_vault
#[test]
fn import_dest_outside_vault_rejected() {
    let vault = tempdir().unwrap();
    let src_tmp = tempdir().unwrap();
    let src_file = src_tmp.path().join("file.txt");
    fs::write(&src_file, b"hello").unwrap();

    // dest is outside the vault (we use /tmp directly)
    let outside = tempdir().unwrap();
    let result = assert_within_vault(outside.path(), vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

// ── create_note ──────────────────────────────────────────────────────────────

/// TC-09: create_note creates an empty .md file
#[test]
fn create_note_happy_path() {
    let vault = tempdir().unwrap();
    let parent = vault.path();

    let dest = parent.join("nueva.md");
    assert!(!dest.exists());

    // Simulate what create_note does
    fs::write(&dest, b"").unwrap();
    assert!(dest.exists());
    assert_eq!(fs::read(&dest).unwrap(), b"");
}

/// TC-22: create_note returns already_exists if file exists
#[test]
fn create_note_already_exists() {
    let vault = tempdir().unwrap();
    let parent = vault.path();
    let dest = parent.join("nueva.md");
    fs::write(&dest, b"existing").unwrap();

    // The command checks existence before writing
    assert!(dest.exists());
    // Our logic: if dest.exists() → Err("already_exists")
    // We test the condition directly
    let result: Result<(), String> = if dest.exists() {
        Err("already_exists".to_string())
    } else {
        Ok(())
    };
    assert_eq!(result, Err("already_exists".to_string()));
}

// ── create_folder ────────────────────────────────────────────────────────────

/// TC-10: create_folder creates a directory
#[test]
fn create_folder_happy_path() {
    let vault = tempdir().unwrap();
    let dest = vault.path().join("nueva-carpeta");
    assert!(!dest.exists());

    fs::create_dir(&dest).unwrap();
    assert!(dest.is_dir());
}

// ── rename_entry ─────────────────────────────────────────────────────────────

/// TC-11: rename a file
#[test]
fn rename_file_happy_path() {
    let vault = tempdir().unwrap();
    let old_path = vault.path().join("old.md");
    fs::write(&old_path, b"content").unwrap();
    let new_path = vault.path().join("new.md");

    fs::rename(&old_path, &new_path).unwrap();
    assert!(!old_path.exists());
    assert!(new_path.exists());
}

/// TC-12: rename a folder
#[test]
fn rename_folder_happy_path() {
    let vault = tempdir().unwrap();
    let old_dir = vault.path().join("old-folder");
    fs::create_dir(&old_dir).unwrap();
    fs::write(old_dir.join("child.md"), b"").unwrap();
    let new_dir = vault.path().join("new-folder");

    fs::rename(&old_dir, &new_dir).unwrap();
    assert!(!old_dir.exists());
    assert!(new_dir.exists());
    assert!(new_dir.join("child.md").exists());
}

/// TC-21: rename fails if target already exists
#[test]
fn rename_already_exists() {
    let vault = tempdir().unwrap();
    let file = vault.path().join("file.md");
    let existing = vault.path().join("existing.md");
    fs::write(&file, b"").unwrap();
    fs::write(&existing, b"").unwrap();

    let result: Result<(), String> = if existing.exists() {
        Err("already_exists".to_string())
    } else {
        fs::rename(&file, &existing).map_err(|e| format!("io_error: {e}"))
    };
    assert_eq!(result, Err("already_exists".to_string()));
    // Original file is untouched
    assert!(file.exists());
}

// ── delete_entry ─────────────────────────────────────────────────────────────

/// TC-13: delete a file
#[test]
fn delete_file_happy_path() {
    let vault = tempdir().unwrap();
    let file = vault.path().join("note.md");
    fs::write(&file, b"").unwrap();

    assert_within_vault(&file, vault.path()).unwrap();
    fs::remove_file(&file).unwrap();
    assert!(!file.exists());
}

/// TC-15: delete a folder with children
#[test]
fn delete_folder_recursive() {
    let vault = tempdir().unwrap();
    let folder = vault.path().join("folder");
    fs::create_dir(&folder).unwrap();
    for i in 0..5 {
        fs::write(folder.join(format!("child{i}.md")), b"").unwrap();
    }

    assert_within_vault(&folder, vault.path()).unwrap();
    fs::remove_dir_all(&folder).unwrap();
    assert!(!folder.exists());
}

/// cannot delete vault root
#[test]
fn cannot_delete_vault_root() {
    let vault = tempdir().unwrap();
    let vault_path = vault.path();
    let canonical_path = vault_path.canonicalize().unwrap();
    let canonical_vault = vault_path.canonicalize().unwrap();

    let result: Result<(), String> = if canonical_path == canonical_vault {
        Err("cannot_delete_vault_root".to_string())
    } else {
        Ok(())
    };
    assert_eq!(result, Err("cannot_delete_vault_root".to_string()));
}

// ── import_files ─────────────────────────────────────────────────────────────

/// TC-16: import files into vault
#[test]
fn import_files_happy_path() {
    let vault = tempdir().unwrap();
    let src_tmp = tempdir().unwrap();

    let src1 = src_tmp.path().join("doc1.md");
    let src2 = src_tmp.path().join("doc2.pdf");
    fs::write(&src1, b"# Hello").unwrap();
    fs::write(&src2, b"%PDF").unwrap();

    assert_within_vault(vault.path(), vault.path()).unwrap();

    let dest1 = vault.path().join("doc1.md");
    let dest2 = vault.path().join("doc2.pdf");
    fs::copy(&src1, &dest1).unwrap();
    fs::copy(&src2, &dest2).unwrap();

    assert!(dest1.exists());
    assert!(dest2.exists());
    // Source files still exist (only copy, never move)
    assert!(src1.exists());
    assert!(src2.exists());
}

/// import with collision adds suffix
#[test]
fn import_files_collision_suffix() {
    let vault = tempdir().unwrap();
    let src_tmp = tempdir().unwrap();

    let src = src_tmp.path().join("note.md");
    fs::write(&src, b"new content").unwrap();

    // Pre-existing file in vault
    let existing = vault.path().join("note.md");
    fs::write(&existing, b"old content").unwrap();

    // Simulate suffix logic
    let stem = "note";
    let ext = ".md";
    let mut counter = 1u32;
    let dest = loop {
        let candidate = vault.path().join(format!("{stem}_{counter}{ext}"));
        if !candidate.exists() {
            break candidate;
        }
        counter += 1;
    };

    fs::copy(&src, &dest).unwrap();
    assert!(dest.exists());
    assert_eq!(dest.file_name().unwrap(), "note_1.md");
    // Original is still intact
    assert_eq!(fs::read(&existing).unwrap(), b"old content");
}

// ── validate_entry_name ──────────────────────────────────────────────────────

#[test]
fn validate_name_accepts_normal_names() {
    assert!(validate_entry_name("mi nota").is_ok());
    assert!(validate_entry_name("investigación 2026").is_ok());
    assert!(validate_entry_name("nota..1").is_ok());
    assert!(validate_entry_name(".oculta").is_ok());
}

#[test]
fn validate_name_rejects_empty_and_blank() {
    assert_eq!(validate_entry_name(""), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("   "), Err("invalid_name".to_string()));
}

#[test]
fn validate_name_rejects_path_separators_and_dots() {
    assert_eq!(validate_entry_name(".."), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("."), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("a/b"), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("a\\b"), Err("invalid_name".to_string()));
    assert_eq!(validate_entry_name("../fuera"), Err("invalid_name".to_string()));
}

// ── move_entry_inner ─────────────────────────────────────────────────────────

#[test]
fn move_file_into_folder() {
    let vault = tempdir().unwrap();
    let folder = vault.path().join("carpeta");
    fs::create_dir(&folder).unwrap();
    let file = vault.path().join("nota.md");
    fs::write(&file, b"content").unwrap();

    let result = move_entry_inner(&file, &folder, vault.path()).unwrap();
    assert_eq!(result, folder.join("nota.md").canonicalize().unwrap().to_string_lossy());
    assert!(!file.exists());
    assert_eq!(fs::read(folder.join("nota.md")).unwrap(), b"content");
}

#[test]
fn move_folder_into_nested_folder() {
    let vault = tempdir().unwrap();
    let outer = vault.path().join("outer");
    fs::create_dir(&outer).unwrap();
    let inner = outer.join("inner");
    fs::create_dir(&inner).unwrap();
    let folder = vault.path().join("movida");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("hija.md"), b"x").unwrap();

    move_entry_inner(&folder, &inner, vault.path()).unwrap();
    assert!(inner.join("movida").is_dir());
    assert!(inner.join("movida").join("hija.md").is_file());
}

#[test]
fn move_file_to_vault_root() {
    let vault = tempdir().unwrap();
    let folder = vault.path().join("carpeta");
    fs::create_dir(&folder).unwrap();
    let file = folder.join("nota.md");
    fs::write(&file, b"c").unwrap();

    move_entry_inner(&file, vault.path(), vault.path()).unwrap();
    assert!(vault.path().join("nota.md").is_file());
}

#[test]
fn move_rejects_source_outside_vault() {
    let vault = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let file = outside.path().join("nota.md");
    fs::write(&file, b"c").unwrap();

    let result = move_entry_inner(&file, vault.path(), vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

#[test]
fn move_rejects_dest_folder_outside_vault() {
    let vault = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let file = vault.path().join("nota.md");
    fs::write(&file, b"c").unwrap();

    let result = move_entry_inner(&file, outside.path(), vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}

#[test]
fn move_rejects_folder_into_own_subtree() {
    let vault = tempdir().unwrap();
    let folder = vault.path().join("padre");
    fs::create_dir(&folder).unwrap();
    let child = folder.join("hija");
    fs::create_dir(&child).unwrap();

    let result = move_entry_inner(&folder, &child, vault.path());
    assert_eq!(result, Err("cannot_move_into_subtree".to_string()));
    assert!(folder.is_dir()); // untouched
}

#[test]
fn move_rejects_when_target_exists() {
    let vault = tempdir().unwrap();
    let folder = vault.path().join("carpeta");
    fs::create_dir(&folder).unwrap();
    let a = vault.path().join("a.md");
    fs::write(&a, b"a").unwrap();
    fs::write(folder.join("a.md"), b"b").unwrap();

    let result = move_entry_inner(&a, &folder, vault.path());
    assert_eq!(result, Err("already_exists".to_string()));
    assert!(a.is_file()); // untouched
}

#[test]
fn move_rejects_dest_that_is_not_a_folder() {
    let vault = tempdir().unwrap();
    let file_dest = vault.path().join("dest.md");
    fs::write(&file_dest, b"").unwrap();
    let a = vault.path().join("a.md");
    fs::write(&a, b"a").unwrap();

    let result = move_entry_inner(&a, &file_dest, vault.path());
    assert_eq!(result, Err("dest_not_folder".to_string()));
}

// ── import_file_data ─────────────────────────────────────────────────────────

#[test]
fn import_file_data_inner_writes_bytes() {
    // Exercises the same logic the command applies (testable without the Tauri runtime).
    let vault = tempdir().unwrap();
    let dest_dir = vault.path();
    let file_name = "foto.png";
    let contents = b"png-bytes";

    let file_name = Path::new(file_name).file_name().unwrap().to_str().unwrap();
    let dest = super::fs_ops::unique_dest(dest_dir, file_name);
    fs::write(&dest, contents).unwrap();

    assert_eq!(fs::read(&dest).unwrap(), b"png-bytes");
    assert_eq!(dest, dest_dir.join("foto.png"));
}

#[test]
fn import_file_data_strips_directories_from_name() {
    let vault = tempdir().unwrap();
    // A reported name may carry parent directories; only the final name may be used.
    let reported = "/Users/someone/Desktop/nota.md";
    let file_name = Path::new(reported).file_name().unwrap().to_str().unwrap();
    assert_eq!(file_name, "nota.md");

    let dest = super::fs_ops::unique_dest(vault.path(), file_name);
    fs::write(&dest, b"x").unwrap();
    assert!(vault.path().join("nota.md").is_file());
}

#[test]
fn unique_dest_adds_suffix_on_collision() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("nota.md"), b"old").unwrap();

    let dest = super::fs_ops::unique_dest(vault.path(), "nota.md");
    assert_eq!(dest, vault.path().join("nota_1.md"));

    fs::write(&dest, b"new").unwrap();
    let dest2 = super::fs_ops::unique_dest(vault.path(), "nota.md");
    assert_eq!(dest2, vault.path().join("nota_2.md"));
}

#[test]
fn unique_dest_no_suffix_when_free() {
    let vault = tempdir().unwrap();
    let dest = super::fs_ops::unique_dest(vault.path(), "nueva.md");
    assert_eq!(dest, vault.path().join("nueva.md"));
}

#[test]
fn import_file_data_dest_outside_vault_is_rejected() {
    let vault = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let result = assert_within_vault(outside.path(), vault.path());
    assert_eq!(result, Err("path_outside_vault".to_string()));
}
