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

#[test]
fn extracts_url_encoded_md_link() {
    let vault = tempdir().unwrap();
    let a = create_file(vault.path(), "a.md", "[ver](Nota%20dos.md)");
    let b = create_file(vault.path(), "Nota dos.md", "# B");
    let all_files = vec![a.clone(), b.clone()];

    let links = extract_links(&a, vault.path(), &all_files);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].1, b.canonicalize().unwrap());
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

// ── Slice 5: tags and excerpts ───────────────────────────────────────────────

use crate::graph::{extract_excerpt, extract_tags};

#[test]
fn tags_are_extracted_without_hash_and_deduplicated() {
    let tags = extract_tags("Intro #ideas and #Work\n\nlater #ideas again");
    assert_eq!(tags, vec!["ideas".to_string(), "Work".to_string()]);
}

#[test]
fn tags_ignore_headings_urls_and_mid_word_hashes() {
    let tags = extract_tags("# Title\n## Sub\nsee http://x.com/#anchor and a#b and C# code");
    assert!(tags.is_empty(), "got {tags:?}");
}

#[test]
fn tags_ignore_fenced_code() {
    let tags = extract_tags("```\n#notatag\n```\nreal #yes");
    assert_eq!(tags, vec!["yes".to_string()]);
}

#[test]
fn tags_can_start_a_line() {
    assert_eq!(extract_tags("#solo"), vec!["solo".to_string()]);
}

#[test]
fn excerpt_skips_headings_and_blank_lines() {
    let e = extract_excerpt("# Title\n\nFirst line.\nSecond line.\n", 100);
    assert_eq!(e, "First line. Second line.");
}

#[test]
fn excerpt_is_truncated_with_ellipsis() {
    let e = extract_excerpt("abcdefghij klmnop", 10);
    assert_eq!(e, "abcdefghij…");
}

#[test]
fn excerpt_of_empty_note_is_empty() {
    assert_eq!(extract_excerpt("# Only title\n", 100), "");
}
