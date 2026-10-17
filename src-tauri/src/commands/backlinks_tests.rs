use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn create_file(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, content).unwrap();
}

// ── Backlinks ─────────────────────────────────────────────────────────────────

use super::backlinks::{compute_backlinks, Backlink};

#[test]
fn backlinks_lists_notes_linking_via_wikilink_sorted_by_name() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "target.md", "# Target");
    create_file(vault.path(), "zeta.md", "see [[target]]");
    create_file(vault.path(), "sub/alpha.md", "also [[target]] here");
    create_file(vault.path(), "other.md", "no links");

    let result = compute_backlinks(vault.path(), &vault.path().join("target.md")).unwrap();
    let names: Vec<&str> = result.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "zeta"]);
    assert!(result[0].path.ends_with("sub/alpha.md"));
}

#[test]
fn backlinks_follows_markdown_links_and_dedups_multiple_mentions() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "target.md", "");
    create_file(vault.path(), "a.md", "[[target]] and [[target]] again");
    create_file(vault.path(), "b.md", "[go](target.md)");

    let result = compute_backlinks(vault.path(), &vault.path().join("target.md")).unwrap();
    assert_eq!(
        result.iter().map(|b| b.name.clone()).collect::<Vec<_>>(),
        vec!["a".to_string(), "b".to_string()]
    );
}

#[test]
fn backlinks_is_empty_without_links_and_ignores_self_links() {
    let vault = tempdir().unwrap();
    create_file(vault.path(), "target.md", "I link to [[target]]");
    create_file(vault.path(), "other.md", "nothing");

    let result: Vec<Backlink> =
        compute_backlinks(vault.path(), &vault.path().join("target.md")).unwrap();
    assert!(result.is_empty());
}

#[test]
fn backlinks_errors_when_target_missing() {
    let vault = tempdir().unwrap();
    assert!(compute_backlinks(vault.path(), &vault.path().join("nope.md")).is_err());
}
