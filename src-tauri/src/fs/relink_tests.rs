use super::relink::{relink_vault, remap_prefix};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::{tempdir, TempDir};

fn write(root: &Path, rel: &str, content: &str) -> PathBuf {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(&p, content).unwrap();
    p
}

fn read(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).unwrap()
}

/// Renames/moves `old_rel` -> `new_rel` on disk and relinks the vault.
fn mv(vault: &TempDir, old_rel: &str, new_rel: &str) -> Vec<PathBuf> {
    let old = vault.path().join(old_rel);
    let new = vault.path().join(new_rel);
    fs::create_dir_all(new.parent().unwrap()).unwrap();
    fs::rename(&old, &new).unwrap();
    relink_vault(vault.path(), &old, &new).unwrap()
}

// ── Wikilinks ────────────────────────────────────────────────────────────────

#[test]
fn rewrites_plain_wikilink() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "# Old\n");
    write(v.path(), "ref.md", "See [[Old]] now.\n");
    let changed = mv(&v, "Old.md", "New.md");
    assert_eq!(read(v.path(), "ref.md"), "See [[New]] now.\n");
    assert_eq!(changed, vec![v.path().join("ref.md")]);
}

#[test]
fn rewrites_wikilink_keeping_alias() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), "ref.md", "[[Old|el viejo]] y [[Old| otro ]]\n");
    mv(&v, "Old.md", "New.md");
    assert_eq!(read(v.path(), "ref.md"), "[[New|el viejo]] y [[New| otro ]]\n");
}

#[test]
fn wikilink_match_is_case_insensitive_and_keeps_spacing() {
    let v = tempdir().unwrap();
    write(v.path(), "Old Name.md", "");
    write(v.path(), "ref.md", "[[ old name ]]\n");
    mv(&v, "Old Name.md", "Nuevo.md");
    assert_eq!(read(v.path(), "ref.md"), "[[ Nuevo ]]\n");
}

#[test]
fn rewrites_folder_qualified_wikilink_on_rename() {
    let v = tempdir().unwrap();
    write(v.path(), "docs/Old.md", "");
    write(v.path(), "ref.md", "[[docs/Old]] [[docs/Old|x]] [[docs/Old.md]]\n");
    mv(&v, "docs/Old.md", "docs/New.md");
    assert_eq!(read(v.path(), "ref.md"), "[[docs/New]] [[docs/New|x]] [[docs/New.md]]\n");
}

#[test]
fn rewrites_folder_qualified_wikilink_on_move() {
    let v = tempdir().unwrap();
    write(v.path(), "a/Note.md", "");
    write(v.path(), "ref.md", "[[a/Note]] and plain [[Note]]\n");
    let changed = mv(&v, "a/Note.md", "b/Note.md");
    assert_eq!(read(v.path(), "ref.md"), "[[b/Note]] and plain [[Note]]\n");
    assert_eq!(changed.len(), 1);
}

#[test]
fn plain_wikilink_untouched_by_pure_move() {
    let v = tempdir().unwrap();
    write(v.path(), "a/Note.md", "");
    write(v.path(), "ref.md", "[[Note]]\n");
    let changed = mv(&v, "a/Note.md", "b/Note.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), "ref.md"), "[[Note]]\n");
}

#[test]
fn folder_move_rewrites_path_qualified_wikilinks_of_every_note_inside() {
    let v = tempdir().unwrap();
    write(v.path(), "proj/A.md", "");
    write(v.path(), "proj/sub/B.md", "");
    write(v.path(), "ref.md", "[[proj/A]] [[proj/sub/B]] [[A]]\n");
    mv(&v, "proj", "archive/proj");
    assert_eq!(read(v.path(), "ref.md"), "[[archive/proj/A]] [[archive/proj/sub/B]] [[A]]\n");
}

#[test]
fn ambiguous_plain_wikilink_is_left_alone() {
    let v = tempdir().unwrap();
    write(v.path(), "a/Dup.md", "");
    write(v.path(), "b/Dup.md", "");
    write(v.path(), "ref.md", "[[Dup]]\n");
    let changed = mv(&v, "a/Dup.md", "a/Renamed.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), "ref.md"), "[[Dup]]\n");
}

#[test]
fn unrelated_wikilinks_untouched() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), "ref.md", "[[Other]] [[Older]] [[sub/Old2]]\n");
    let changed = mv(&v, "Old.md", "New.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), "ref.md"), "[[Other]] [[Older]] [[sub/Old2]]\n");
}

#[test]
fn self_links_are_rewritten_too() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "me: [[Old]]\n");
    let changed = mv(&v, "Old.md", "New.md");
    assert_eq!(read(v.path(), "New.md"), "me: [[New]]\n");
    assert_eq!(changed, vec![v.path().join("New.md")]);
}

// ── Markdown links ───────────────────────────────────────────────────────────

#[test]
fn rewrites_markdown_link_on_rename() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), "ref.md", "go [here](Old.md) and [again](./Old.md#sec \"t\")\n");
    mv(&v, "Old.md", "New.md");
    assert_eq!(read(v.path(), "ref.md"), "go [here](New.md) and [again](New.md#sec \"t\")\n");
}

#[test]
fn rewrites_url_encoded_markdown_link() {
    let v = tempdir().unwrap();
    write(v.path(), "Old Name.md", "");
    write(v.path(), "ref.md", "[x](Old%20Name.md)\n");
    mv(&v, "Old Name.md", "New Name.md");
    assert_eq!(read(v.path(), "ref.md"), "[x](New%20Name.md)\n");
}

#[test]
fn rewrites_angle_bracket_markdown_link() {
    let v = tempdir().unwrap();
    write(v.path(), "Old Name.md", "");
    write(v.path(), "ref.md", "[x](<Old Name.md>)\n");
    mv(&v, "Old Name.md", "New Name.md");
    assert_eq!(read(v.path(), "ref.md"), "[x](<New Name.md>)\n");
}

#[test]
fn markdown_links_are_relative_to_the_referencing_file() {
    let v = tempdir().unwrap();
    write(v.path(), "a/Old.md", "");
    write(v.path(), "a/near.md", "[x](Old.md)\n");
    write(v.path(), "b/far.md", "[x](../a/Old.md)\n");
    write(v.path(), "root.md", "[x](a/Old.md)\n");
    mv(&v, "a/Old.md", "c/deep/New.md");
    assert_eq!(read(v.path(), "a/near.md"), "[x](../c/deep/New.md)\n");
    assert_eq!(read(v.path(), "b/far.md"), "[x](../c/deep/New.md)\n");
    assert_eq!(read(v.path(), "root.md"), "[x](c/deep/New.md)\n");
}

#[test]
fn external_and_anchor_links_untouched() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    let body = "[a](https://x.com/Old.md) [b](#Old) [c](mailto:a@b.c)\n";
    write(v.path(), "ref.md", body);
    let changed = mv(&v, "Old.md", "New.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), "ref.md"), body);
}

#[test]
fn moved_notes_keep_their_relative_links_working() {
    let v = tempdir().unwrap();
    write(v.path(), "inbox/Draft.md", "[to](../Target.md) and ![i](pic.png) and [s](Sibling.md)\n");
    write(v.path(), "inbox/pic.png", "x");
    write(v.path(), "inbox/Sibling.md", "");
    write(v.path(), "Target.md", "");
    mv(&v, "inbox/Draft.md", "deep/er/Draft.md");
    assert_eq!(
        read(v.path(), "deep/er/Draft.md"),
        "[to](../../Target.md) and ![i](../../inbox/pic.png) and [s](../../inbox/Sibling.md)\n"
    );
}

#[test]
fn folder_move_keeps_internal_relative_links_untouched() {
    let v = tempdir().unwrap();
    write(v.path(), "p/A.md", "[b](B.md) [out](../Out.md)\n");
    write(v.path(), "p/B.md", "");
    write(v.path(), "Out.md", "[in](p/A.md)\n");
    mv(&v, "p", "q/p");
    // internal link unchanged (same relative layout), outgoing link re-based
    assert_eq!(read(v.path(), "q/p/A.md"), "[b](B.md) [out](../../Out.md)\n");
    assert_eq!(read(v.path(), "Out.md"), "[in](q/p/A.md)\n");
}

// ── Code ─────────────────────────────────────────────────────────────────────

#[test]
fn links_inside_code_are_not_rewritten() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    let body = "inline `[[Old]]` and `[x](Old.md)`\n\n```\n[[Old]]\n[x](Old.md)\n```\n\n    [[Old]]\n\nreal [[Old]]\n";
    write(v.path(), "ref.md", body);
    mv(&v, "Old.md", "New.md");
    let expected = body.replace("real [[Old]]", "real [[New]]");
    assert_eq!(read(v.path(), "ref.md"), expected);
}

// ── Scope of rewriting ───────────────────────────────────────────────────────

#[test]
fn only_changed_files_are_rewritten() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), "hit.md", "[[Old]]\n");
    let miss = write(v.path(), "miss.md", "nothing\n");
    let before = fs::metadata(&miss).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let changed = mv(&v, "Old.md", "New.md");
    assert_eq!(changed, vec![v.path().join("hit.md")]);
    assert_eq!(fs::metadata(&miss).unwrap().modified().unwrap(), before);
}

#[test]
fn non_markdown_files_are_never_rewritten() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), "data.txt", "[[Old]] [x](Old.md)\n");
    let changed = mv(&v, "Old.md", "New.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), "data.txt"), "[[Old]] [x](Old.md)\n");
}

#[test]
fn hidden_directories_are_skipped() {
    let v = tempdir().unwrap();
    write(v.path(), "Old.md", "");
    write(v.path(), ".markdaun/n.md", "[[Old]]\n");
    let changed = mv(&v, "Old.md", "New.md");
    assert!(changed.is_empty());
    assert_eq!(read(v.path(), ".markdaun/n.md"), "[[Old]]\n");
}

#[test]
fn moving_a_non_note_file_rewrites_markdown_links_to_it() {
    let v = tempdir().unwrap();
    write(v.path(), "pic.png", "x");
    write(v.path(), "ref.md", "![p](pic.png) [[pic]]\n");
    mv(&v, "pic.png", "img/pic.png");
    assert_eq!(read(v.path(), "ref.md"), "![p](img/pic.png) [[pic]]\n");
}

// ── remap_prefix ─────────────────────────────────────────────────────────────

#[test]
fn remap_prefix_handles_exact_nested_and_unrelated_paths() {
    assert_eq!(remap_prefix("a/Old.md", "a/Old.md", "a/New.md"), Some("a/New.md".to_string()));
    assert_eq!(remap_prefix("proj/x/N.md", "proj", "arch/proj"), Some("arch/proj/x/N.md".to_string()));
    assert_eq!(remap_prefix("project/N.md", "proj", "arch/proj"), None);
    assert_eq!(remap_prefix("other.md", "proj", "q"), None);
}
