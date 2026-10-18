use super::inbox::{
    archive_source_inner, folder_tree, inbox_discard_inner, inbox_ensure_inner, inbox_list_inner,
    trash_delete_inner, trash_list_inner, trash_restore_inner, InboxKind,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn ensure_creates_entrada_once() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    assert!(dir.is_dir());
    assert_eq!(dir.file_name().unwrap(), "Entrada");
    // Idempotent, keeps content.
    fs::write(dir.join("a.txt"), "x").unwrap();
    inbox_ensure_inner(vault.path()).unwrap();
    assert!(dir.join("a.txt").exists());
}

#[test]
fn list_reports_types_support_and_sorts_newest_first() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    for name in ["a.md", "b.txt", "c.pdf", "d.PNG", "e.svg", "f.docx"] {
        fs::write(dir.join(name), "12345").unwrap();
        // Distinct modification times, increasing with the file name.
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    fs::create_dir(dir.join("sub")).unwrap(); // folders are not items
    fs::write(dir.join(".hidden"), "x").unwrap();

    let items = inbox_list_inner(vault.path()).unwrap();
    let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["f.docx", "e.svg", "d.PNG", "c.pdf", "b.txt", "a.md"]);

    let by = |n: &str| items.iter().find(|i| i.name == n).unwrap();
    assert_eq!(by("a.md").kind, InboxKind::Md);
    assert_eq!(by("b.txt").kind, InboxKind::Txt);
    assert_eq!(by("c.pdf").kind, InboxKind::Pdf);
    assert_eq!(by("d.PNG").kind, InboxKind::Image);
    assert_eq!(by("e.svg").kind, InboxKind::Image);
    assert_eq!(by("f.docx").kind, InboxKind::Other);
    assert!(by("a.md").supported && by("e.svg").supported);
    assert!(!by("f.docx").supported);
    assert_eq!(by("a.md").size, 5);
    assert_eq!(by("a.md").rel_path, "Entrada/a.md");
    assert!(by("a.md").added_ms > 0);
}

#[test]
fn list_creates_missing_entrada() {
    let vault = tempdir().unwrap();
    assert!(inbox_list_inner(vault.path()).unwrap().is_empty());
    assert!(vault.path().join("Entrada").is_dir());
}

#[test]
fn discard_moves_to_trash_and_restore_brings_it_back() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    let file = dir.join("acta.md");
    fs::write(&file, "contenido").unwrap();

    inbox_discard_inner(&file, vault.path()).unwrap();
    assert!(!file.exists());

    let trash = trash_list_inner(vault.path()).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].name, "acta.md");
    assert_eq!(trash[0].original_path, "Entrada/acta.md");
    assert!(vault.path().join(".markdaun/papelera").is_dir());

    let restored = trash_restore_inner(&trash[0].id, vault.path()).unwrap();
    assert_eq!(fs::read_to_string(&restored).unwrap(), "contenido");
    assert!(restored.ends_with("Entrada/acta.md"));
    assert!(trash_list_inner(vault.path()).unwrap().is_empty());
}

#[test]
fn restore_avoids_overwriting_and_recreates_folder() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    let file = dir.join("a.txt");
    fs::write(&file, "uno").unwrap();
    inbox_discard_inner(&file, vault.path()).unwrap();
    fs::write(&file, "dos").unwrap(); // same name now taken
    let id = trash_list_inner(vault.path()).unwrap()[0].id.clone();
    let restored = trash_restore_inner(&id, vault.path()).unwrap();
    assert_eq!(restored.file_name().unwrap(), "a 2.txt");
    assert_eq!(fs::read_to_string(&file).unwrap(), "dos");

    // Original folder gone: it is recreated.
    fs::remove_dir_all(&dir).unwrap();
    fs::create_dir_all(vault.path().join("Mutua")).unwrap();
    let f2 = vault.path().join("Mutua/x.md");
    fs::write(&f2, "x").unwrap();
    inbox_discard_inner(&f2, vault.path()).unwrap();
    fs::remove_dir_all(vault.path().join("Mutua")).unwrap();
    let id = trash_list_inner(vault.path()).unwrap()[0].id.clone();
    let r = trash_restore_inner(&id, vault.path()).unwrap();
    assert!(r.ends_with("Mutua/x.md") && r.exists());
}

#[test]
fn same_name_discards_do_not_collide_and_delete_is_permanent() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    for body in ["1", "2"] {
        let f = dir.join("n.txt");
        fs::write(&f, body).unwrap();
        inbox_discard_inner(&f, vault.path()).unwrap();
    }
    let trash = trash_list_inner(vault.path()).unwrap();
    assert_eq!(trash.len(), 2);
    trash_delete_inner(&trash[0].id, vault.path()).unwrap();
    assert_eq!(trash_list_inner(vault.path()).unwrap().len(), 1);
}

#[test]
fn trash_ids_cannot_escape_the_trash() {
    let vault = tempdir().unwrap();
    inbox_ensure_inner(vault.path()).unwrap();
    assert!(trash_delete_inner("../Entrada", vault.path()).is_err());
    assert!(trash_restore_inner("../../x", vault.path()).is_err());
    assert!(vault.path().join("Entrada").is_dir());
}

#[test]
fn discard_rejects_paths_outside_the_vault() {
    let vault = tempdir().unwrap();
    let other = tempdir().unwrap();
    let f = other.path().join("x.md");
    fs::write(&f, "x").unwrap();
    assert_eq!(inbox_discard_inner(&f, vault.path()), Err("path_outside_vault".to_string()));
}

#[test]
fn archive_moves_to_fuentes_with_collision_suffix_and_rewrites_links() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    fs::write(dir.join("acta.pdf"), "pdf").unwrap();
    fs::write(vault.path().join("nota.md"), "ver [[Entrada/acta.pdf]]").unwrap();

    let out = archive_source_inner(&dir.join("acta.pdf"), "Mutua/ProyectoX", vault.path(), None).unwrap();
    assert!(out.path.ends_with("Mutua/ProyectoX/Fuentes/acta.pdf"));
    assert!(!dir.join("acta.pdf").exists());
    assert!(vault.path().join("Mutua/ProyectoX/Fuentes/acta.pdf").exists());
    let nota = fs::read_to_string(vault.path().join("nota.md")).unwrap();
    assert!(nota.contains("Mutua/ProyectoX/Fuentes/acta"), "link rewritten: {nota}");

    // Second source with the same name -> " 2".
    fs::write(dir.join("acta.pdf"), "otro").unwrap();
    let out2 = archive_source_inner(&dir.join("acta.pdf"), "Mutua/ProyectoX", vault.path(), None).unwrap();
    assert!(out2.path.ends_with("Mutua/ProyectoX/Fuentes/acta 2.pdf"), "{}", out2.path);
}

#[test]
fn archive_into_vault_root_and_rejects_bad_folders() {
    let vault = tempdir().unwrap();
    let dir = inbox_ensure_inner(vault.path()).unwrap();
    fs::write(dir.join("a.txt"), "x").unwrap();
    let out = archive_source_inner(&dir.join("a.txt"), "", vault.path(), None).unwrap();
    assert!(out.path.ends_with("Fuentes/a.txt"));

    fs::write(dir.join("b.txt"), "x").unwrap();
    for bad in ["../fuera", "/abs", "a/../../b"] {
        assert!(archive_source_inner(&dir.join("b.txt"), bad, vault.path(), None).is_err(), "{bad}");
    }
    assert!(dir.join("b.txt").exists());
}

#[test]
fn folder_tree_excludes_entrada_fuentes_hidden_and_respects_depth() {
    let vault = tempdir().unwrap();
    let v = vault.path();
    for d in [
        "Personal",
        "Mutua/ProyectoX/Fuentes",
        "Mutua/ProyectoX/Actas",
        "Entrada/sub",
        ".markdaun/papelera",
        ".git/objects",
        "A/B/C/D/E",
    ] {
        fs::create_dir_all(v.join(d)).unwrap();
    }
    fs::write(v.join("Personal/n.md"), "x").unwrap();
    let tree = folder_tree(v, 4);
    assert!(tree.contains(&"Personal".to_string()));
    assert!(tree.contains(&"Mutua".to_string()));
    assert!(tree.contains(&"Mutua/ProyectoX".to_string()));
    assert!(tree.contains(&"Mutua/ProyectoX/Actas".to_string()));
    assert!(!tree.iter().any(|p| p.contains("Fuentes")));
    assert!(!tree.iter().any(|p| p.starts_with("Entrada")));
    assert!(!tree.iter().any(|p| p.contains(".markdaun") || p.contains(".git")));
    assert!(tree.contains(&"A/B/C/D".to_string()));
    assert!(!tree.contains(&"A/B/C/D/E".to_string()));
    let mut sorted = tree.clone();
    sorted.sort();
    assert_eq!(tree, sorted);
}
