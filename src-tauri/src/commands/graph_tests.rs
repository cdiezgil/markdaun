use std::fs;
use std::path::Path;
use tempfile::tempdir;

use crate::db::NodePositionsDb;
use crate::fs::walk_vault;
use crate::graph::extract_links;

/// Helper: create a file inside a tempdir.
fn create_file(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, content).unwrap();
}

// ── TC-07: get_vault_graph returns all files as nodes ─────────────────────────

/// TC-07: vault with 3 .md and 1 .png → 4 nodes, png has kind "image"
#[test]
fn graph_returns_all_files_as_nodes() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "a.md", "");
    create_file(vault.path(), "b.md", "");
    create_file(vault.path(), "c.md", "");
    create_file(vault.path(), "img.png", "");

    let tree = walk_vault(vault.path()).unwrap();
    let mut nodes = Vec::new();
    flatten_tree_test(&tree, &mut nodes);

    assert_eq!(nodes.len(), 4, "TC-07: all 4 files should be nodes");
    let png_node = nodes.iter().find(|(n, _)| n.ends_with("img.png"));
    assert!(png_node.is_some(), "TC-07: png file should be present");
    assert_eq!(png_node.unwrap().1, "image", "TC-07: png kind should be 'image'");
}

// ── TC-08: orphan node has no edges ──────────────────────────────────────────

/// TC-08: orphan.md has no links and no references → no edges involving it
#[test]
fn graph_orphan_has_no_edges() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "orphan.md", "# Orphan note");
    create_file(vault.path(), "a.md", "No links here");

    let all_files = vec![
        vault.path().join("orphan.md"),
        vault.path().join("a.md"),
    ];

    let links_from_orphan = extract_links(&vault.path().join("orphan.md"), vault.path(), &all_files);
    let links_from_a = extract_links(&vault.path().join("a.md"), vault.path(), &all_files);

    assert!(links_from_orphan.is_empty(), "TC-08: orphan has no outgoing links");
    assert!(links_from_a.is_empty(), "TC-08: no links reference orphan");
}

// ── TC-09: linked nodes have an edge ─────────────────────────────────────────

/// TC-09: a.md → [[B]], b.md → edge exists
#[test]
fn graph_linked_nodes_have_edge() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "a.md", "[[B]]");
    create_file(vault.path(), "B.md", "# B");

    let all_files = vec![
        vault.path().join("a.md"),
        vault.path().join("B.md"),
    ];

    let links = extract_links(&vault.path().join("a.md"), vault.path(), &all_files);
    assert_eq!(links.len(), 1, "TC-09: should have one edge");
    assert_eq!(
        links[0].1,
        vault.path().join("B.md").canonicalize().unwrap(),
        "TC-09: edge target should be B.md"
    );
}

// ── TC-11/TC-12/TC-13: positions persisted and retrieved ─────────────────────

/// TC-11: position is persisted; TC-12: position returned; TC-13: no position → None
#[test]
fn position_saved_and_returned_in_graph() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("config.db");
    let db = NodePositionsDb::open(&db_path).unwrap();

    // TC-13: no position initially
    let positions = db.get_all_positions("/vault").unwrap();
    assert!(positions.is_empty(), "TC-13: should be empty initially");

    // TC-11: set a position
    db.set_position("/vault", "/vault/a.md", 100.0, 200.0).unwrap();

    // TC-12: position returned
    let positions = db.get_all_positions("/vault").unwrap();
    assert_eq!(positions.get("/vault/a.md"), Some(&(100.0, 200.0)), "TC-12: position should be returned");
}

// ── Helper: flatten walk_vault tree → (path_str, kind_str) ───────────────────

fn flatten_tree_test(
    entries: &[crate::fs::tree::VaultEntry],
    out: &mut Vec<(String, String)>,
) {
    for entry in entries {
        match entry.kind {
            crate::fs::tree::EntryKind::File => {
                let kind = entry
                    .file_type
                    .as_ref()
                    .map(|k| match k {
                        crate::fs::tree::FileKind::Md => "md",
                        crate::fs::tree::FileKind::Image => "image",
                        crate::fs::tree::FileKind::Pdf => "pdf",
                        crate::fs::tree::FileKind::Other => "other",
                    })
                    .unwrap_or("other");
                out.push((entry.path.clone(), kind.to_string()));
            }
            crate::fs::tree::EntryKind::Folder => {
                if let Some(children) = &entry.children {
                    flatten_tree_test(children, out);
                }
            }
        }
    }
}
