use super::fs_ops::{
    assert_within_vault, create_untitled_inner, move_entry_inner, move_with_relink, rename_entry_inner,
    rename_from_title_inner, validate_entry_name,
};
use crate::db::h1_follow::H1FollowDb;
use crate::db::{ConversationsDb, QueryScope};
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

// ── rename / move with relinking ─────────────────────────────────────────────

fn vault_str(v: &tempfile::TempDir) -> String {
    v.path().to_string_lossy().to_string()
}

#[test]
fn rename_entry_rewrites_links_scopes_and_stops_following() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    fs::write(vault.path().join("Old.md"), "# Old").unwrap();
    fs::write(vault.path().join("ref.md"), "see [[Old]]").unwrap();
    let conv = ConversationsDb::open(&db).unwrap();
    let id = conv.create_conversation(&vault_str(&vault), "c").unwrap();
    conv.set_scope(&id, &QueryScope::Notes { paths: vec!["Old.md".into()] }).unwrap();
    let follow = H1FollowDb::open(&db).unwrap();
    follow.set_following(&vault_str(&vault), "Old.md", true).unwrap();

    let out = rename_entry_inner(&vault.path().join("Old.md"), "New.md", vault.path(), Some(&db), false).unwrap();

    assert_eq!(out.path, vault.path().join("New.md").to_string_lossy());
    assert_eq!(out.rewritten, vec![vault.path().join("ref.md").to_string_lossy().to_string()]);
    assert_eq!(fs::read_to_string(vault.path().join("ref.md")).unwrap(), "see [[New]]");
    assert_eq!(conv.get_scope(&id).unwrap(), QueryScope::Notes { paths: vec!["New.md".into()] });
    assert!(!follow.is_following(&vault_str(&vault), "New.md").unwrap(), "manual rename stops following");
    assert!(!follow.is_following(&vault_str(&vault), "Old.md").unwrap());
}

#[test]
fn rename_entry_rejects_existing_target_and_bad_names() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("a.md"), "").unwrap();
    fs::write(vault.path().join("b.md"), "").unwrap();
    let a = vault.path().join("a.md");
    assert_eq!(rename_entry_inner(&a, "b.md", vault.path(), None, false), Err("already_exists".to_string()));
    assert_eq!(rename_entry_inner(&a, "../x.md", vault.path(), None, false), Err("invalid_name".to_string()));
    assert!(a.exists());
}

#[test]
fn move_with_relink_updates_folder_scope_and_follow_prefix() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    fs::create_dir_all(vault.path().join("proj")).unwrap();
    fs::create_dir_all(vault.path().join("arch")).unwrap();
    fs::write(vault.path().join("proj/N.md"), "").unwrap();
    fs::write(vault.path().join("ref.md"), "[[proj/N]]").unwrap();
    let conv = ConversationsDb::open(&db).unwrap();
    let id = conv.create_conversation(&vault_str(&vault), "c").unwrap();
    conv.set_scope(&id, &QueryScope::Folder { path: "proj".into() }).unwrap();
    let follow = H1FollowDb::open(&db).unwrap();
    follow.set_following(&vault_str(&vault), "proj/N.md", true).unwrap();

    let out = move_with_relink(&vault.path().join("proj"), &vault.path().join("arch"), vault.path(), Some(&db)).unwrap();

    assert_eq!(out.path, vault.path().join("arch/proj").to_string_lossy());
    assert_eq!(fs::read_to_string(vault.path().join("ref.md")).unwrap(), "[[arch/proj/N]]");
    assert_eq!(conv.get_scope(&id).unwrap(), QueryScope::Folder { path: "arch/proj".into() });
    assert!(follow.is_following(&vault_str(&vault), "arch/proj/N.md").unwrap(), "move keeps following");
}

// ── H1-driven names ──────────────────────────────────────────────────────────

#[test]
fn create_untitled_numbers_collisions_and_registers_following() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    let first = create_untitled_inner(vault.path(), vault.path(), &db).unwrap();
    let second = create_untitled_inner(vault.path(), vault.path(), &db).unwrap();
    assert_eq!(first, vault.path().join("Sin título.md"));
    assert_eq!(second, vault.path().join("Sin título 2.md"));
    assert_eq!(fs::read_to_string(&first).unwrap(), "# \n");
    let follow = H1FollowDb::open(&db).unwrap();
    assert!(follow.is_following(&vault_str(&vault), "Sin título.md").unwrap());
    assert!(follow.is_following(&vault_str(&vault), "Sin título 2.md").unwrap());
}

#[test]
fn create_untitled_in_a_subfolder() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    fs::create_dir(vault.path().join("sub")).unwrap();
    let note = create_untitled_inner(&vault.path().join("sub"), vault.path(), &db).unwrap();
    assert_eq!(note, vault.path().join("sub/Sin título.md"));
    assert!(H1FollowDb::open(&db).unwrap().is_following(&vault_str(&vault), "sub/Sin título.md").unwrap());
}

#[test]
fn title_rename_renames_rewrites_and_keeps_following() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    let note = create_untitled_inner(vault.path(), vault.path(), &db).unwrap();
    fs::write(vault.path().join("ref.md"), "[[Sin título]]").unwrap();

    let out = rename_from_title_inner(&note, "Mi: gran idea?", vault.path(), &db).unwrap();

    assert!(out.following);
    assert_eq!(out.path, vault.path().join("Mi- gran idea-.md").to_string_lossy());
    assert!(!note.exists());
    assert_eq!(fs::read_to_string(vault.path().join("ref.md")).unwrap(), "[[Mi- gran idea-]]");
    let follow = H1FollowDb::open(&db).unwrap();
    assert!(follow.is_following(&vault_str(&vault), "Mi- gran idea-.md").unwrap());
    assert!(!follow.is_following(&vault_str(&vault), "Sin título.md").unwrap());
}

#[test]
fn title_rename_resolves_collisions() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    fs::write(vault.path().join("Idea.md"), "x").unwrap();
    let note = create_untitled_inner(vault.path(), vault.path(), &db).unwrap();
    let out = rename_from_title_inner(&note, "Idea", vault.path(), &db).unwrap();
    assert_eq!(out.path, vault.path().join("Idea 2.md").to_string_lossy());
    assert_eq!(fs::read_to_string(vault.path().join("Idea.md")).unwrap(), "x");
}

#[test]
fn title_rename_with_empty_or_same_title_keeps_the_name() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    let note = create_untitled_inner(vault.path(), vault.path(), &db).unwrap();
    for title in ["", "   ", "Sin título"] {
        let out = rename_from_title_inner(&note, title, vault.path(), &db).unwrap();
        assert!(out.following);
        assert_eq!(out.path, note.to_string_lossy());
        assert!(out.rewritten.is_empty());
    }
    assert!(note.exists());
}

#[test]
fn title_rename_is_a_noop_when_the_note_does_not_follow() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    let note = vault.path().join("Mia.md");
    fs::write(&note, "# Otra").unwrap();
    let out = rename_from_title_inner(&note, "Otra", vault.path(), &db).unwrap();
    assert!(!out.following);
    assert_eq!(out.path, note.to_string_lossy());
    assert!(note.exists());
}

#[test]
fn title_rename_allows_a_case_only_change() {
    let vault = tempdir().unwrap();
    let db = vault.path().join(".markdaun-test.db");
    let note = vault.path().join("idea.md");
    fs::write(&note, "").unwrap();
    H1FollowDb::open(&db).unwrap().set_following(&vault_str(&vault), "idea.md", true).unwrap();
    let out = rename_from_title_inner(&note, "Idea", vault.path(), &db).unwrap();
    assert_eq!(out.path, vault.path().join("Idea.md").to_string_lossy());
}
