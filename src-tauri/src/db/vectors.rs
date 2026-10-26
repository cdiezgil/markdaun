use crate::db::config::DbError;
use rusqlite::{ffi::sqlite3_auto_extension, Connection};
use std::path::Path;

pub struct VectorsDb {
    conn: Connection,
}

/// Register the sqlite-vec extension globally (once per process).
/// Must be called before opening any connection that needs vec0 tables.
fn ensure_sqlite_vec_loaded() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *const i8,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> i32,
        >(sqlite_vec::sqlite3_vec_init as *const ())));
    });
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub content: String,
    pub distance: f32,
}

/// Cheap change detector for an indexed file (mtime + size, confirmed by a content hash).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    pub mtime_ns: i64,
    pub size: i64,
    pub hash: String,
}

impl VectorsDb {
    /// Open (or create) `vectors.db` at `db_path`, load the sqlite-vec extension,
    /// and ensure the `chunks` and `chunk_embeddings` tables exist.
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        // Register the sqlite-vec extension before opening the connection.
        ensure_sqlite_vec_loaded();
        let conn = Connection::open(db_path)?;

        // Regular table: metadata for each chunk.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chunks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                vault_path  TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content     TEXT NOT NULL,
                UNIQUE(vault_path, file_path, chunk_index)
            );",
        )?;

        // Per-file change detector for incremental vault sync. `IF NOT EXISTS`
        // is the migration for databases created before this table existed.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS file_index (
                vault_path TEXT NOT NULL,
                file_path  TEXT NOT NULL,
                mtime_ns   INTEGER NOT NULL,
                size       INTEGER NOT NULL,
                hash       TEXT NOT NULL,
                PRIMARY KEY (vault_path, file_path)
            );",
        )?;

        // Virtual table: float32 embeddings, dim 384.
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
                chunk_id  INTEGER PRIMARY KEY,
                embedding FLOAT[384]
            );",
        )?;

        Ok(Self { conn })
    }

    /// Replace all chunks for `(vault_path, file_path)` with new ones.
    /// `chunks`: list of `(chunk_index, content, embedding)`.
    /// Operation is atomic (wrapped in a transaction).
    pub fn upsert_file_chunks(
        &self,
        vault_path: &str,
        file_path: &str,
        chunks: &[(usize, &str, &[f32])],
    ) -> Result<(), DbError> {
        // Collect IDs of existing chunks for this file so we can delete their embeddings.
        let mut stmt = self.conn.prepare(
            "SELECT id FROM chunks WHERE vault_path = ?1 AND file_path = ?2",
        )?;
        let old_ids: Vec<i64> = stmt
            .query_map(rusqlite::params![vault_path, file_path], |row| {
                row.get::<_, i64>(0)
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Delete old embeddings first (virtual table FK not enforced automatically).
        for id in &old_ids {
            self.conn.execute(
                "DELETE FROM chunk_embeddings WHERE chunk_id = ?1",
                rusqlite::params![id],
            )?;
        }

        // Delete old chunk metadata.
        self.conn.execute(
            "DELETE FROM chunks WHERE vault_path = ?1 AND file_path = ?2",
            rusqlite::params![vault_path, file_path],
        )?;

        // Insert new chunks + embeddings.
        for (idx, content, embedding) in chunks {
            self.conn.execute(
                "INSERT INTO chunks (vault_path, file_path, chunk_index, content)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![vault_path, file_path, *idx as i64, content],
            )?;
            let chunk_id = self.conn.last_insert_rowid();

            // Serialize f32 vector as little-endian blob (sqlite-vec format).
            let emb_blob = Self::to_blob(embedding);
            self.conn.execute(
                "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?1, ?2)",
                rusqlite::params![chunk_id, emb_blob],
            )?;
        }

        Ok(())
    }

    /// Return the top-`k` most similar chunks to `query_embedding` within the given vault.
    ///
    /// Uses two separate queries to avoid any query-planner interaction between
    /// the sqlite-vec virtual table (KNN) and the regular `chunks` table (metadata):
    ///
    /// 1. KNN-only query on `chunk_embeddings` — pure vec0 scan, no JOINs.
    /// 2. Metadata lookup in `chunks` using the returned IDs.
    ///
    /// This is the safest pattern for sqlite-vec 0.1.x, which can silently return
    /// 0 rows when MATCH is mixed with cross-table WHERE conditions in one query.
    pub fn search_similar(
        &self,
        vault_path: &str,
        query_embedding: &[f32],
        k: usize,
    ) -> Result<Vec<SearchResult>, DbError> {
        let emb_blob = Self::to_blob(query_embedding);

        // Step 1 — pure KNN: get (chunk_id, distance) pairs from sqlite-vec.
        // No JOIN, no cross-table filter — sqlite-vec drives this entirely.
        let knn: Vec<(i64, f64)> = {
            let mut stmt = self.conn.prepare(
                "SELECT chunk_id, distance
                 FROM chunk_embeddings
                 WHERE embedding MATCH ?1 AND k = ?2",
            )?;
            let rows: Result<Vec<_>, _> = stmt
                .query_map(rusqlite::params![emb_blob, k as i64], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
                })?
                .collect();
            rows?
        };

        if knn.is_empty() {
            return Ok(Vec::new());
        }

        // Step 2 — metadata lookup: fetch file_path and content for each ID.
        // Build a parameterized IN clause for the IDs we got from KNN.
        let placeholders: String = knn
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, file_path, content FROM chunks
             WHERE vault_path = ?1 AND id IN ({placeholders})"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(knn.len() + 1);
        params.push(Box::new(vault_path.to_string()));
        for (id, _) in &knn {
            params.push(Box::new(*id));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let meta: std::collections::HashMap<i64, (String, String)> = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, fp, content)| (id, (fp, content)))
            .collect();

        // Step 3 — merge: keep KNN order, skip IDs not found (wrong vault).
        let results: Vec<SearchResult> = knn
            .into_iter()
            .filter_map(|(id, dist)| {
                meta.get(&id).map(|(fp, content)| SearchResult {
                    file_path: fp.clone(),
                    content: content.clone(),
                    distance: dist as f32,
                })
            })
            .collect();

        Ok(results)
    }

    /// Top-`k` most similar chunks whose file path satisfies `keep`. The KNN
    /// runs over every chunk of the vault first (sqlite-vec limits before any
    /// other filter), so a restricted scope never comes back empty by accident.
    pub fn search_similar_where(
        &self,
        vault_path: &str,
        query_embedding: &[f32],
        k: usize,
        keep: &dyn Fn(&str) -> bool,
    ) -> Result<Vec<SearchResult>, DbError> {
        // Ask KNN for a pool large enough to cover the folder after filtering,
        // but capped at 1000 to stay within sqlite-vec's practical limits.
        // The pool is 20× the requested k (min 200, max 1000).
        let pool = (k.saturating_mul(20)).clamp(200, 1000);
        let all = self.search_similar(vault_path, query_embedding, pool)?;
        Ok(all.into_iter().filter(|r| keep(&r.file_path)).take(k).collect())
    }

    /// Stored fingerprints of every indexed file in the vault, keyed by file path.
    pub fn fingerprints(&self, vault_path: &str) -> Result<std::collections::HashMap<String, Fingerprint>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT file_path, mtime_ns, size, hash FROM file_index WHERE vault_path = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![vault_path], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Fingerprint { mtime_ns: r.get(1)?, size: r.get(2)?, hash: r.get(3)? },
            ))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn set_fingerprint(&self, vault_path: &str, file_path: &str, fp: &Fingerprint) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO file_index (vault_path, file_path, mtime_ns, size, hash)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(vault_path, file_path)
             DO UPDATE SET mtime_ns = ?3, size = ?4, hash = ?5",
            rusqlite::params![vault_path, file_path, fp.mtime_ns, fp.size, fp.hash],
        )?;
        Ok(())
    }

    /// Every file known to the index (has chunks or a fingerprint).
    pub fn indexed_files(&self, vault_path: &str) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT file_path FROM chunks WHERE vault_path = ?1
             UNION SELECT file_path FROM file_index WHERE vault_path = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![vault_path], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Drop chunks, embeddings and fingerprint of one file.
    pub fn delete_file(&self, vault_path: &str, file_path: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM chunk_embeddings WHERE chunk_id IN
               (SELECT id FROM chunks WHERE vault_path = ?1 AND file_path = ?2)",
            rusqlite::params![vault_path, file_path],
        )?;
        self.conn.execute(
            "DELETE FROM chunks WHERE vault_path = ?1 AND file_path = ?2",
            rusqlite::params![vault_path, file_path],
        )?;
        self.conn.execute(
            "DELETE FROM file_index WHERE vault_path = ?1 AND file_path = ?2",
            rusqlite::params![vault_path, file_path],
        )?;
        Ok(())
    }

    /// Drop every indexed file located under directory `dir_path`.
    pub fn delete_tree(&self, vault_path: &str, dir_path: &str) -> Result<(), DbError> {
        let prefix = format!("{}{}", dir_path.trim_end_matches(std::path::MAIN_SEPARATOR), std::path::MAIN_SEPARATOR);
        for f in self.indexed_files(vault_path)? {
            if f.starts_with(&prefix) {
                self.delete_file(vault_path, &f)?;
            }
        }
        Ok(())
    }

    /// Serialize a `f32` slice into a little-endian byte blob for sqlite-vec.
    fn to_blob(embedding: &[f32]) -> Vec<u8> {
        embedding.iter().flat_map(|&f| f.to_le_bytes()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn fp(h: &str) -> Fingerprint {
        Fingerprint { mtime_ns: 1, size: 2, hash: h.into() }
    }

    #[test]
    fn fingerprint_roundtrip_and_overwrite() {
        let (db, _tmp) = make_db();
        db.set_fingerprint("/v", "/v/a.md", &fp("h1")).unwrap();
        db.set_fingerprint("/v", "/v/a.md", &fp("h2")).unwrap();
        db.set_fingerprint("/other", "/other/a.md", &fp("x")).unwrap();
        let m = db.fingerprints("/v").unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m["/v/a.md"], fp("h2"));
    }

    #[test]
    fn indexed_files_unions_chunks_and_fingerprints() {
        let (db, _tmp) = make_db();
        let e = fake_embedding(0.1);
        db.upsert_file_chunks("/v", "/v/a.md", &[(0, "a", e.as_slice())]).unwrap();
        db.set_fingerprint("/v", "/v/b.md", &fp("h")).unwrap();
        let mut files = db.indexed_files("/v").unwrap();
        files.sort();
        assert_eq!(files, vec!["/v/a.md", "/v/b.md"]);
    }

    #[test]
    fn delete_file_removes_chunks_embeddings_and_fingerprint() {
        let (db, _tmp) = make_db();
        let e = fake_embedding(0.1);
        db.upsert_file_chunks("/v", "/v/a.md", &[(0, "a", e.as_slice())]).unwrap();
        db.set_fingerprint("/v", "/v/a.md", &fp("h")).unwrap();
        db.delete_file("/v", "/v/a.md").unwrap();
        assert!(db.indexed_files("/v").unwrap().is_empty());
        assert!(db.search_similar("/v", &e, 5).unwrap().is_empty());
    }

    #[test]
    fn delete_tree_removes_only_descendants() {
        let (db, _tmp) = make_db();
        let e = fake_embedding(0.1);
        for f in ["/v/dir/a.md", "/v/dir/sub/b.md", "/v/dir2/c.md"] {
            db.upsert_file_chunks("/v", f, &[(0, "x", e.as_slice())]).unwrap();
        }
        db.delete_tree("/v", "/v/dir").unwrap();
        assert_eq!(db.indexed_files("/v").unwrap(), vec!["/v/dir2/c.md"]);
    }

    fn make_db() -> (VectorsDb, NamedTempFile) {
        let tmp = NamedTempFile::new().unwrap();
        let db = VectorsDb::open(tmp.path()).unwrap();
        (db, tmp) // keep tmp alive so the file isn't deleted
    }

    fn fake_embedding(seed: f32) -> Vec<f32> {
        let mut v = vec![seed; 384];
        // Slightly randomize to avoid all-identical vectors.
        for (i, x) in v.iter_mut().enumerate() {
            *x += i as f32 * 0.0001;
        }
        // Normalize.
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter().map(|x| x / norm).collect()
    }

    /// TC-04: upsert_file_chunks stores chunks.
    #[test]
    fn upsert_file_chunks_stores_data() {
        let (db, _tmp) = make_db();
        let emb = fake_embedding(0.1);
        let chunks = vec![(0usize, "chunk zero", emb.as_slice())];
        db.upsert_file_chunks("/vault", "/vault/note.md", &chunks)
            .unwrap();

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "TC-04: one chunk stored");
    }

    /// TC-05: search_similar returns top-k results.
    #[test]
    fn search_similar_returns_top_k() {
        let (db, _tmp) = make_db();
        let e1 = fake_embedding(0.1);
        let e2 = fake_embedding(0.5);
        let e3 = fake_embedding(0.9);
        db.upsert_file_chunks(
            "/vault",
            "/vault/a.md",
            &[(0, "alpha content", e1.as_slice())],
        )
        .unwrap();
        db.upsert_file_chunks(
            "/vault",
            "/vault/b.md",
            &[(0, "beta content", e2.as_slice())],
        )
        .unwrap();
        db.upsert_file_chunks(
            "/vault",
            "/vault/c.md",
            &[(0, "gamma content", e3.as_slice())],
        )
        .unwrap();

        let query = fake_embedding(0.1);
        let results = db.search_similar("/vault", &query, 2).unwrap();
        assert_eq!(results.len(), 2, "TC-05: top-2 returned");
    }

    /// TC-05b: search works when chunk IDs start at a large value (simulates
    /// a real vault that has been re-indexed after deletions, giving IDs like
    /// 11233+ instead of 1, 2, 3 -- this is the production scenario).
    #[test]
    fn search_similar_works_with_large_chunk_ids() {
        let (db, _tmp) = make_db();

        // Advance the autoincrement counter so new chunks get high IDs.
        db.conn
            .execute_batch("INSERT INTO sqlite_sequence(name, seq) VALUES ('chunks', 11232);")
            .unwrap();

        let e1 = fake_embedding(0.1); // ID will be 11233
        let e2 = fake_embedding(0.5); // ID will be 11234
        let e3 = fake_embedding(0.9); // ID will be 11235
        db.upsert_file_chunks("/vault", "/vault/a.md", &[(0, "alpha", e1.as_slice())]).unwrap();
        db.upsert_file_chunks("/vault", "/vault/b.md", &[(0, "beta",  e2.as_slice())]).unwrap();
        db.upsert_file_chunks("/vault", "/vault/c.md", &[(0, "gamma", e3.as_slice())]).unwrap();

        // Verify the IDs are as expected.
        let min_id: i64 = db.conn.query_row("SELECT MIN(id) FROM chunks", [], |r| r.get(0)).unwrap();
        assert_eq!(min_id, 11233, "chunk IDs must start at 11233 (production-like)");

        let query = fake_embedding(0.1);
        let results = db.search_similar("/vault", &query, 2).unwrap();
        assert_eq!(results.len(), 2, "TC-05b: search must return 2 results even with large IDs");
    }

    /// TC-06b: upsert replaces old chunks.
    #[test]
    fn upsert_replaces_old_chunks() {
        let (db, _tmp) = make_db();
        let e1 = fake_embedding(0.1);
        let e2 = fake_embedding(0.5);
        db.upsert_file_chunks("/vault", "/vault/note.md", &[(0, "old content", e1.as_slice())])
            .unwrap();
        // Upsert again with new content.
        db.upsert_file_chunks(
            "/vault",
            "/vault/note.md",
            &[(0, "new content", e2.as_slice())],
        )
        .unwrap();

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "TC-06b: old chunks replaced");

        let content: String = db
            .conn
            .query_row("SELECT content FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(content, "new content", "TC-06b: content is updated");
    }
}
