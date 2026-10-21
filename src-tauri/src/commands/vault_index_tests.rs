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
    fn write_bytes(&self, rel: &str, body: &[u8]) {
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

#[test]
fn docx_and_pptx_are_indexed_by_their_extracted_text() {
    use crate::capture::testutil::{simple_docx, simple_pptx};
    let e = env();
    e.write_bytes("Proyecto/Fuentes/informe.docx", &simple_docx(&["El presupuesto asciende a zanahorias."], &[]));
    e.write_bytes("Proyecto/Fuentes/charla.pptx", &simple_pptx(&["Arquitectura hexagonal"]));
    e.write_bytes("Proyecto/Fuentes/roto.docx", b"not a zip");
    e.write("a.md", "alpha");
    let (r, _) = e.sync();
    assert_eq!(r.indexed, 3);
    assert_eq!(r.failed, 1, "a corrupt document is reported, not fatal");
    assert_eq!(e.files(), vec!["Proyecto/Fuentes/charla.pptx", "Proyecto/Fuentes/informe.docx", "a.md"]);
    let q = fake_embed("zanahorias presupuesto").unwrap();
    let hits = e.db.search_similar(&e.vkey(), &q, 1).unwrap();
    assert!(hits[0].content.contains("zanahorias"), "{}", hits[0].content);
    assert!(hits[0].content.starts_with("Nota: Proyecto/Fuentes/informe.docx"));
    // Unchanged files are not re-extracted/embedded.
    let (r, _) = e.sync();
    assert_eq!((r.indexed, r.removed), (0, 0));
}

#[test]
fn index_path_handles_a_single_office_file() {
    use crate::capture::testutil::simple_docx;
    let e = env();
    e.write_bytes("x.docx", &simple_docx(&["contenido singular"], &[]));
    index_path(&e.db, e.vault.path(), &e.path("x.docx"), &fake_embed);
    assert_eq!(e.files(), vec!["x.docx"]);
}

#[test]
fn notes_listing_still_counts_only_markdown() {
    use crate::capture::testutil::simple_docx;
    let e = env();
    e.write_bytes("x.docx", &simple_docx(&["a"], &[]));
    e.write("n.md", "n");
    assert_eq!(list_vault_notes(e.vault.path()).len(), 1);
}

// ─── TC-62: reindex_folder_core ───────────────────────────────────────────────

#[test]
fn tc_62g_reindex_folder_core_only_indexes_files_under_the_given_subfolder() {
    let e = env();
    // 3 notes inside sub/, 1 note outside
    e.write("sub/a.md", "alpha");
    e.write("sub/b.md", "beta");
    e.write("sub/nested/c.md", "gamma");
    e.write("outside.md", "delta");
    // First, index everything so the outer file exists in the DB.
    e.sync();
    // Now force-reindex only sub/
    let events = std::cell::RefCell::new(Vec::new());
    let report = reindex_folder_core(
        &e.db,
        e.vault.path(),
        &e.path("sub"),
        &fake_embed,
        &|p| events.borrow_mut().push(p),
    );
    assert_eq!(report.indexed, 3, "only sub/ files reindexed");
    assert_eq!(report.failed, 0);
    // All 4 files (including outside.md) remain in the DB — core does not delete.
    let mut files = e.files();
    files.sort();
    assert!(files.contains(&"outside.md".to_string()), "outer file untouched");
    assert!(files.contains(&"sub/a.md".to_string()));
    assert!(files.contains(&"sub/b.md".to_string()));
    assert!(files.contains(&"sub/nested/c.md".to_string()));
}

#[test]
fn tc_62h_reindex_folder_core_emits_progress_for_each_file() {
    let e = env();
    e.write("a.md", "uno");
    e.write("b.md", "dos");
    e.write("c.md", "tres");
    let n = 3usize;
    let events = std::cell::RefCell::new(Vec::<IndexProgress>::new());
    let report = reindex_folder_core(
        &e.db,
        e.vault.path(),
        e.vault.path(),
        &fake_embed,
        &|p| events.borrow_mut().push(p),
    );
    assert_eq!(report.indexed, n);
    let emitted = events.into_inner();
    // Expected: {0,n}, {1,n}, {2,n}, {n,n}
    let expected: Vec<IndexProgress> = (0..=n).map(|i| p(i, n)).collect();
    assert_eq!(emitted, expected);
}

#[test]
fn tc_62i_reindex_folder_core_with_vault_root_indexes_all_notes() {
    let e = env();
    e.write("a.md", "uno");
    e.write("dir/b.md", "dos");
    e.write("dir/sub/c.md", "tres");
    e.write(".hidden/h.md", "hidden"); // must be skipped
    let report = reindex_folder_core(
        &e.db,
        e.vault.path(),
        e.vault.path(), // folder == vault root
        &fake_embed,
        &|_| {},
    );
    assert_eq!(report.indexed, 3, "all visible notes indexed when folder is vault root");
    let mut files = e.files();
    files.sort();
    assert_eq!(files, vec!["a.md", "dir/b.md", "dir/sub/c.md"]);
}

// ─── TC-69: embedding model migration ─────────────────────────────────────────

use crate::db::ConfigDb;
use crate::llm::embeddings::EMBED_MODEL_ID;

/// Helper: open (or create) a ConfigDb at `path`.
fn open_cfg(path: &Path) -> ConfigDb {
    ConfigDb::open(path).expect("ConfigDb::open")
}

#[test]
fn tc_69a_check_and_clear_migrates_when_embed_model_key_absent() {
    let db_dir = tempfile::tempdir().unwrap();
    let vdb_dir = tempfile::tempdir().unwrap();
    let cache_dir = tempfile::tempdir().unwrap();

    let db_path = db_dir.path().join("config.db");
    let vdb_path = vdb_dir.path().join("vectors.db");
    let old_dir = cache_dir.path().join(OLD_MODEL_DIR);

    // Preconditions: vectors.db exists with data; old model dir exists; embed_model key absent
    std::fs::write(&vdb_path, b"some data").unwrap();
    std::fs::create_dir_all(&old_dir).unwrap();
    // Touch a file in the old model dir
    std::fs::write(old_dir.join("model.onnx"), b"weights").unwrap();

    // config.db is created on first open; embed_model key is absent by default
    let _ = open_cfg(&db_path);

    let migrated = check_and_clear_embedding_index(&db_path, &vdb_path, cache_dir.path());

    assert!(migrated, "TC-69a: should return true when embed_model key is absent");
    assert!(!vdb_path.exists(), "TC-69a: vectors.db must be deleted after migration");
    assert!(!old_dir.exists(), "TC-69a: old model dir must be deleted after migration");

    let value = open_cfg(&db_path).get("embed_model").unwrap();
    assert_eq!(
        value.as_deref(),
        Some(EMBED_MODEL_ID),
        "TC-69a: embed_model key must be set to EMBED_MODEL_ID"
    );
}

#[test]
fn tc_69b_check_and_clear_migrates_when_embed_model_key_has_old_value() {
    let db_dir = tempfile::tempdir().unwrap();
    let vdb_dir = tempfile::tempdir().unwrap();
    let cache_dir = tempfile::tempdir().unwrap();

    let db_path = db_dir.path().join("config.db");
    let vdb_path = vdb_dir.path().join("vectors.db");
    let old_dir = cache_dir.path().join(OLD_MODEL_DIR);

    // Preconditions: old model value, vectors.db exists
    std::fs::write(&vdb_path, b"old embeddings").unwrap();
    std::fs::create_dir_all(&old_dir).unwrap();

    let cfg = open_cfg(&db_path);
    cfg.set("embed_model", "all-MiniLM-L6-v2").unwrap();
    drop(cfg);

    let migrated = check_and_clear_embedding_index(&db_path, &vdb_path, cache_dir.path());

    assert!(migrated, "TC-69b: should return true when embed_model has an old value");
    assert!(!vdb_path.exists(), "TC-69b: vectors.db must be deleted");
    assert!(!old_dir.exists(), "TC-69b: old model dir must be deleted");

    let value = open_cfg(&db_path).get("embed_model").unwrap();
    assert_eq!(
        value.as_deref(),
        Some(EMBED_MODEL_ID),
        "TC-69b: embed_model must be updated to EMBED_MODEL_ID"
    );
}

#[test]
fn tc_69c_check_and_clear_is_noop_when_model_already_current() {
    let db_dir = tempfile::tempdir().unwrap();
    let vdb_dir = tempfile::tempdir().unwrap();
    let cache_dir = tempfile::tempdir().unwrap();

    let db_path = db_dir.path().join("config.db");
    let vdb_path = vdb_dir.path().join("vectors.db");

    // Precondition: embed_model already set to EMBED_MODEL_ID
    std::fs::write(&vdb_path, b"current embeddings").unwrap();
    let cfg = open_cfg(&db_path);
    cfg.set("embed_model", EMBED_MODEL_ID).unwrap();
    drop(cfg);

    let migrated = check_and_clear_embedding_index(&db_path, &vdb_path, cache_dir.path());

    assert!(!migrated, "TC-69c: should return false when embed_model is already current");
    assert!(
        vdb_path.exists(),
        "TC-69c: vectors.db must NOT be deleted when no migration is needed"
    );
}
