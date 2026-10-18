use super::tree::{EntryKind, FileKind, VaultEntry};
use super::walk_vault;
use std::fs;
use tempfile::tempdir;

fn find_entry<'a>(entries: &'a [VaultEntry], name: &str) -> Option<&'a VaultEntry> {
    entries.iter().find(|e| e.name == name)
}

/// TC-04: walk_vault returns sorted tree (dirs first, then files, both alphabetical)
#[test]
fn walk_vault_sorted_tree() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Create files and dirs in non-alphabetical order
    fs::create_dir(root.join("beta_dir")).unwrap();
    fs::create_dir(root.join("alpha_dir")).unwrap();
    fs::write(root.join("z_file.md"), b"").unwrap();
    fs::write(root.join("a_file.md"), b"").unwrap();

    let tree = walk_vault(root).unwrap();

    assert!(tree.len() >= 4);
    // First two should be dirs (alphabetical)
    assert_eq!(tree[0].kind, EntryKind::Folder);
    assert_eq!(tree[0].name, "alpha_dir");
    assert_eq!(tree[1].kind, EntryKind::Folder);
    assert_eq!(tree[1].name, "beta_dir");
    // Then files (alphabetical)
    assert_eq!(tree[2].kind, EntryKind::File);
    assert_eq!(tree[2].name, "a_file.md");
    assert_eq!(tree[3].kind, EntryKind::File);
    assert_eq!(tree[3].name, "z_file.md");
}

/// TC-05: walk_vault classifies file types correctly (case-insensitive extensions)
#[test]
fn walk_vault_file_types() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    fs::write(root.join("a.md"), b"").unwrap();
    fs::write(root.join("b.PNG"), b"").unwrap();
    fs::write(root.join("c.pdf"), b"").unwrap();
    fs::write(root.join("d.py"), b"").unwrap();
    fs::write(root.join("e.jpg"), b"").unwrap();
    fs::write(root.join("f.svg"), b"").unwrap();

    let tree = walk_vault(root).unwrap();

    let a = find_entry(&tree, "a.md").expect("a.md not found");
    assert_eq!(a.file_type, Some(FileKind::Md));

    let b = find_entry(&tree, "b.PNG").expect("b.PNG not found");
    assert_eq!(b.file_type, Some(FileKind::Image));

    let c = find_entry(&tree, "c.pdf").expect("c.pdf not found");
    assert_eq!(c.file_type, Some(FileKind::Pdf));

    let d = find_entry(&tree, "d.py").expect("d.py not found");
    assert_eq!(d.file_type, Some(FileKind::Other));

    let e = find_entry(&tree, "e.jpg").expect("e.jpg not found");
    assert_eq!(e.file_type, Some(FileKind::Image));

    let f = find_entry(&tree, "f.svg").expect("f.svg not found");
    assert_eq!(f.file_type, Some(FileKind::Image));
}

/// TC-20: walk_vault handles nested directories correctly (3 levels)
#[test]
fn walk_vault_nested() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // sub1/sub2/nota.md
    fs::create_dir(root.join("sub1")).unwrap();
    fs::create_dir(root.join("sub1").join("sub2")).unwrap();
    fs::write(root.join("sub1").join("sub2").join("nota.md"), b"").unwrap();

    let tree = walk_vault(root).unwrap();

    let sub1 = find_entry(&tree, "sub1").expect("sub1 not found");
    assert_eq!(sub1.kind, EntryKind::Folder);

    let children1 = sub1.children.as_ref().expect("sub1 has no children");
    let sub2 = find_entry(children1, "sub2").expect("sub2 not found");
    assert_eq!(sub2.kind, EntryKind::Folder);

    let children2 = sub2.children.as_ref().expect("sub2 has no children");
    let nota = find_entry(children2, "nota.md").expect("nota.md not found");
    assert_eq!(nota.kind, EntryKind::File);
    assert_eq!(nota.file_type, Some(FileKind::Md));
}

/// The app's own `.markdaun/` folder (trash, internals) never shows in the tree.
#[test]
fn walk_vault_hides_markdaun_folder() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join(".markdaun/papelera")).unwrap();
    fs::write(root.join(".markdaun/papelera/x.md"), b"").unwrap();
    fs::write(root.join("note.md"), b"").unwrap();

    let tree = walk_vault(root).unwrap();
    assert!(find_entry(&tree, ".markdaun").is_none());
    assert!(find_entry(&tree, "note.md").is_some());
}
