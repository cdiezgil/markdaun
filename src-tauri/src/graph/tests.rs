use crate::graph::extract_links;
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

/// Helper: create a file inside a tempdir and return its PathBuf.
fn create_file(dir: &std::path::Path, rel: &str, content: &str) -> PathBuf {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, content).unwrap();
    path
}

// ── TC-01: [[Wikilink]] resolved ──────────────────────────────────────────────

#[test]
fn extracts_wikilink() {
    let vault = tempdir().unwrap();
    let a = create_file(vault.path(), "a.md", "# A\n\n[[NoteB]]");
    let b = create_file(vault.path(), "NoteB.md", "# B");
    let all_files = vec![a.clone(), b.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert_eq!(links.len(), 1, "TC-01: should extract one link");
    assert_eq!(links[0].1, b.canonicalize().unwrap(), "TC-01: target should be NoteB.md");
}

// ── TC-02: Case-insensitive wikilink matching ─────────────────────────────────

#[test]
fn wikilink_case_insensitive() {
    let vault = tempdir().unwrap();
    let a = create_file(vault.path(), "a.md", "[[noteb]]");
    let b = create_file(vault.path(), "NoteB.md", "");
    let all_files = vec![a.clone(), b.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert_eq!(links.len(), 1, "TC-02: case-insensitive match should produce one link");
    assert_eq!(links[0].1, b.canonicalize().unwrap());
}

// ── TC-03: Unresolved wikilink ignored ───────────────────────────────────────

#[test]
fn unresolved_wikilink_ignored() {
    let vault = tempdir().unwrap();
    let a = create_file(vault.path(), "a.md", "[[Ghost]]");
    let all_files = vec![a.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert!(links.is_empty(), "TC-03: unresolved wikilink should produce no links");
}

// ── TC-04: Relative Markdown link resolved ────────────────────────────────────

#[test]
fn extracts_md_link() {
    let vault = tempdir().unwrap();
    let sub = vault.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let a = create_file(vault.path(), "a.md", "[ver](./sub/c.md)");
    let c = create_file(vault.path(), "sub/c.md", "# C");
    let all_files = vec![a.clone(), c.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert_eq!(links.len(), 1, "TC-04: should extract one Markdown link");
    assert_eq!(links[0].1, c.canonicalize().unwrap(), "TC-04: target should be sub/c.md");
}

// ── TC-05: External URL ignored ───────────────────────────────────────────────

#[test]
fn external_url_ignored() {
    let vault = tempdir().unwrap();
    let a = create_file(vault.path(), "a.md", "[ver](https://example.com)");
    let all_files = vec![a.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert!(links.is_empty(), "TC-05: external URL should produce no links");
}

// ── TC-06: Non-.md file returns empty ────────────────────────────────────────

#[test]
fn non_md_file_returns_empty() {
    let vault = tempdir().unwrap();
    let img = create_file(vault.path(), "img.png", "PNG data");
    let all_files = vec![img.clone()];

    let links = extract_links(&img, vault.path(), &all_files);
    assert!(links.is_empty(), "TC-06: non-.md file should return empty vec");
}
