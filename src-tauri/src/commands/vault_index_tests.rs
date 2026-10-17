use super::brain_cmd::IndexProgress;
use super::vault_index::*;
use crate::db::VectorsDb;
use std::cell::RefCell;
use std::path::Path;

/// Deterministic bag-of-words embedder: no model download.
fn fake_embed(text: &str) -> Result<Vec<f32>, String> {
    let mut v = vec![0.0f32; 384];
    for w in text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
        let h = w.bytes().fold(5381usize, |a, b| a.wrapping_mul(33).wrapping_add(b as usize));
        v[h % 384] += 1.0;
    }
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
    Ok(v.iter().map(|x| x / n).collect())
}

struct Env {
    vault: tempfile::TempDir,
    _db_file: tempfile::NamedTempFile,
    db: VectorsDb,
}

fn env() -> Env {
    let f = tempfile::NamedTempFile::new().unwrap();
    Env { vault: tempfile::tempdir().unwrap(), db: VectorsDb::open(f.path()).unwrap(), _db_file: f }
}

impl Env {
    fn path(&self, rel: &str) -> std::path::PathBuf {
        self.vault.path().join(rel)
    }
    fn write(&self, rel: &str, body: &str) {
        let p = self.path(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    fn vkey(&self) -> String {
        self.vault.path().to_string_lossy().to_string()
    }
    fn files(&self) -> Vec<String> {
        let mut f: Vec<String> = self
            .db
            .indexed_files(&self.vkey())
            .unwrap()
            .iter()
            .map(|p| relative_note_path(self.vault.path(), Path::new(p)))
            .collect();
        f.sort();
        f
    }
    fn sync_with(&self, embed: &EmbedFn) -> (SyncReport, Vec<IndexProgress>) {
        let events = RefCell::new(Vec::new());
        let r = sync_vault(&self.db, self.vault.path(), embed, &|p| events.borrow_mut().push(p)).unwrap();
        (r, events.into_inner())
    }
    fn sync(&self) -> (SyncReport, Vec<IndexProgress>) {
        self.sync_with(&fake_embed)
    }
}

fn p(done: usize, total: usize) -> IndexProgress {
    IndexProgress { done, total }
}

#[test]
fn first_sync_indexes_all_notes_with_progress() {
    let e = env();
    e.write("a.md", "alpha");
    e.write("dir/b.md", "beta");
    e.write("image.png", "not a note");
    e.write(".git/c.md", "hidden");
    let (r, events) = e.sync();
    assert_eq!(r.indexed, 2);
    assert_eq!(e.files(), vec!["a.md", "dir/b.md"]);
    assert_eq!(events, vec![p(0, 2), p(1, 2), p(2, 2)]);
}

#[test]
fn second_sync_without_changes_does_nothing() {
    let e = env();
    e.write("a.md", "alpha");
    e.sync();
    let calls = RefCell::new(0);
    let (r, events) = e.sync_with(&|t| {
        *calls.borrow_mut() += 1;
        fake_embed(t)
    });
    assert_eq!(r, SyncReport::default());
    assert!(events.is_empty());
    assert_eq!(*calls.borrow(), 0);
}

#[test]
fn modified_file_is_reindexed_only() {
    let e = env();
    e.write("a.md", "alpha");
    e.write("b.md", "beta");
    e.sync();
    std::thread::sleep(std::time::Duration::from_millis(20));
    e.write("a.md", "alpha changed a lot");
    let (r, events) = e.sync();
    assert_eq!(r.indexed, 1);
    assert_eq!(events, vec![p(0, 1), p(1, 1)]);
    let q = fake_embed("changed").unwrap();
    let hits = e.db.search_similar(&e.vkey(), &q, 1).unwrap();
    assert!(hits[0].content.contains("changed"));
}

#[test]
fn touched_file_with_same_content_is_not_reindexed() {
    let e = env();
    e.write("a.md", "alpha");
    e.sync();
    std::thread::sleep(std::time::Duration::from_millis(20));
    e.write("a.md", "alpha"); // new mtime, same bytes
    let (r, events) = e.sync();
    assert_eq!(r, SyncReport::default());
    assert!(events.is_empty());
}

#[test]
fn deleted_file_chunks_are_removed() {
    let e = env();
    e.write("a.md", "alpha");
    e.write("b.md", "beta");
    e.sync();
    std::fs::remove_file(e.path("a.md")).unwrap();
    let (r, events) = e.sync();
    assert_eq!(r.removed, 1);
    assert_eq!(r.indexed, 0);
    assert!(events.is_empty(), "no embedding work, no progress");
    assert_eq!(e.files(), vec!["b.md"]);
}

#[test]
fn rename_moves_chunks() {
    let e = env();
    e.write("old.md", "contenido");
    e.sync();
    std::fs::rename(e.path("old.md"), e.path("new.md")).unwrap();
    let (r, _) = e.sync();
    assert_eq!((r.indexed, r.removed), (1, 1));
    assert_eq!(e.files(), vec!["new.md"]);
    let hits = e.db.search_similar(&e.vkey(), &fake_embed("contenido").unwrap(), 5).unwrap();
    assert!(hits.iter().all(|h| h.content.contains("new.md")));
}

#[test]
fn per_file_failure_does_not_abort_the_rest() {
    let e = env();
    e.write("bad.md", "explota");
    e.write("good.md", "bien");
    let (r, events) = e.sync_with(&|t| {
        if t.contains("explota") { Err("boom".into()) } else { fake_embed(t) }
    });
    assert_eq!((r.indexed, r.failed), (1, 1));
    assert_eq!(e.files(), vec!["good.md"]);
    assert_eq!(events.last(), Some(&p(2, 2)));
    // The failed file is retried on the next sync.
    let (r2, _) = e.sync();
    assert_eq!(r2.indexed, 1);
    assert_eq!(e.files(), vec!["bad.md", "good.md"]);
}

#[test]
fn chunks_are_prefixed_with_the_relative_path() {
    let e = env();
    e.write("sub/primera nota.md", "Hola mundo");
    e.sync();
    let hits = e.db.search_similar(&e.vkey(), &fake_embed("hola").unwrap(), 1).unwrap();
    assert!(hits[0].content.starts_with("Nota: sub/primera nota.md\n\n"));
    assert!(hits[0].content.contains("Hola mundo"));
}

#[test]
fn index_path_recurses_and_remove_path_drops_subtree() {
    let e = env();
    e.write("dir/a.md", "alpha");
    e.write("dir/sub/b.md", "beta");
    e.write("other.md", "gamma");
    index_path(&e.db, e.vault.path(), &e.path("dir"), &fake_embed);
    assert_eq!(e.files(), vec!["dir/a.md", "dir/sub/b.md"]);
    index_path(&e.db, e.vault.path(), &e.path("other.md"), &fake_embed);
    remove_path(&e.db, e.vault.path(), &e.path("dir"));
    assert_eq!(e.files(), vec!["other.md"]);
}

#[test]
fn list_vault_notes_is_sorted_and_skips_hidden() {
    let e = env();
    e.write("b.md", "");
    e.write("a/z.md", "");
    e.write(".markdaun/x.md", "");
    let rel: Vec<String> = list_vault_notes(e.vault.path())
        .iter()
        .map(|f| relative_note_path(e.vault.path(), f))
        .collect();
    assert_eq!(rel, vec!["a/z.md", "b.md"]);
}

#[test]
fn listing_reports_count_and_sorted_paths() {
    let out = vault_note_listing(&["b.md".into(), "a/x.md".into()]);
    assert!(out.contains("2 notas"));
    assert!(out.find("a/x.md").unwrap() < out.find("b.md").unwrap());
}

#[test]
fn listing_caps_at_300_and_reports_remainder() {
    let paths: Vec<String> = (0..305).map(|i| format!("n{i:03}.md")).collect();
    let out = vault_note_listing(&paths);
    assert!(out.contains("305 notas"));
    assert!(out.contains("n299.md"));
    assert!(!out.contains("n300.md"));
    assert!(out.contains("y 5 más"));
}

#[test]
fn listing_of_empty_vault() {
    let out = vault_note_listing(&[]);
    assert!(out.contains("no tiene notas"));
}

#[test]
fn listing_singular() {
    assert!(vault_note_listing(&["a.md".into()]).contains("1 nota"));
}

#[test]
fn only_one_sync_per_vault_at_a_time() {
    let locks = IndexLocks::default();
    let first = locks.try_acquire("/v").expect("first acquires");
    assert!(locks.try_acquire("/v").is_none(), "second is coalesced");
    assert!(locks.try_acquire("/other").is_some(), "other vaults are independent");
    drop(first);
    assert!(locks.try_acquire("/v").is_some(), "released on drop");
}
