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
        // `embedding` (schema v2) stores the raw f32 blob alongside the vec0 virtual table
        // so that brute-force cosine search can be used for folder-scoped queries without
        // relying on sqlite-vec's KNN (which doesn't support pre-filtering by folder).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chunks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                vault_path  TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content     TEXT NOT NULL,
                embedding   BLOB,
                UNIQUE(vault_path, file_path, chunk_index)
            );",
        )?;
        // Non-destructive migration for databases created before schema v2.
        let _ = conn.execute("ALTER TABLE chunks ADD COLUMN embedding BLOB", []);

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
            // Serialize f32 vector as little-endian blob (sqlite-vec format).
            let emb_blob = Self::to_blob(embedding);
            self.conn.execute(
                "INSERT INTO chunks (vault_path, file_path, chunk_index, content, embedding)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![vault_path, file_path, *idx as i64, content, emb_blob],
            )?;
            let chunk_id = self.conn.last_insert_rowid();

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
    /// Brute-force cosine similarity over all chunks whose `file_path` starts with
    /// `folder_prefix` and whose `embedding` blob is populated (schema v2).
    ///
    /// This is the correct strategy for folder-scoped queries: it avoids the
    /// sqlite-vec limitation where k cannot exceed ~1 000 and where pre-filtering
    /// by folder is not supported at the KNN level.
    ///
    /// Returns `Ok(None)` when no blobs exist yet (vault not re-indexed yet after
    /// the schema-v2 upgrade), so the caller can fall back to the KNN pool path.
    pub fn search_brute_force(
        &self,
        vault_path: &str,
        query_embedding: &[f32],
        k: usize,
        folder_prefix: &str,
    ) -> Result<Option<Vec<SearchResult>>, DbError> {
        let glob = format!("{folder_prefix}%");
        let mut stmt = self.conn.prepare(
            "SELECT file_path, content, embedding
             FROM chunks
             WHERE vault_path = ?1 AND file_path LIKE ?2 AND embedding IS NOT NULL",
        )?;
        let rows: Vec<(String, String, Vec<u8>)> = stmt
            .query_map(rusqlite::params![vault_path, glob], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            // No blobs yet — signal the caller to use the KNN fallback.
            return Ok(None);
        }

        // Cosine similarity = dot product for L2-normalised vectors.
        let mut scored: Vec<(f32, String, String)> = rows
            .into_iter()
            .filter_map(|(fp, content, blob)| {
                let emb = Self::from_blob(&blob)?;
                let score = dot_product(query_embedding, &emb);
                Some((score, fp, content))
            })
            .collect();

        // Sort descending by similarity (highest first).
        scored.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(Some(
            scored
                .into_iter()
                .take(k)
                .map(|(score, file_path, content)| SearchResult {
                    file_path,
                    content,
                    // Distance = 1 - cosine_similarity (normalised vectors).
                    distance: (1.0 - score).max(0.0),
                })
                .collect(),
        ))
    }

    pub fn search_similar_where(
        &self,
        vault_path: &str,
        query_embedding: &[f32],
        k: usize,
        keep: &dyn Fn(&str) -> bool,
        // Optional folder prefix for the brute-force path (schema v2).
        // When `Some`, tries brute-force first; falls back to KNN pool on failure.
        folder_prefix: Option<&str>,
    ) -> Result<Vec<SearchResult>, DbError> {
        // Fast path: brute-force over folder blobs (exact, no k-cap issues).
        if let Some(prefix) = folder_prefix {
            if let Ok(Some(results)) = self.search_brute_force(vault_path, query_embedding, k, prefix) {
                return Ok(results);
            }
        }
        // Fallback: global KNN + post-filter (works even before schema-v2 re-index).
        // Cap the pool to 1 000 to stay within sqlite-vec's practical limits.
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

    fn from_blob(blob: &[u8]) -> Option<Vec<f32>> {
        if blob.len() % 4 != 0 {
            return None;
        }
        Some(
            blob.chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect(),
        )
    }
}

/// Dot product of two equal-length slices.
/// For L2-normalised embeddings this equals cosine similarity.
#[inline]
fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
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

    /// TC-07: embedding blob is stored in chunks.embedding (schema v2).
    #[test]
    fn upsert_stores_embedding_blob() {
        let (db, _tmp) = make_db();
        let emb = fake_embedding(0.3);
        db.upsert_file_chunks("/v", "/v/a.md", &[(0, "text", emb.as_slice())]).unwrap();
        let blob: Option<Vec<u8>> = db
            .conn
            .query_row("SELECT embedding FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert!(blob.is_some(), "TC-07: embedding blob stored in chunks");
        let decoded = VectorsDb::from_blob(blob.as_ref().unwrap()).unwrap();
        assert_eq!(decoded.len(), 384, "TC-07: blob decodes to 384 floats");
    }

    /// TC-08: search_brute_force returns top-k from a folder prefix.
    #[test]
    fn brute_force_returns_top_k_for_folder() {
        let (db, _tmp) = make_db();
        let ea = fake_embedding(0.1); // most similar to query
        let eb = fake_embedding(0.5);
        let ec = fake_embedding(0.9);
        let other = fake_embedding(0.1); // same similarity but DIFFERENT folder
        db.upsert_file_chunks("/v", "/v/folder/a.md", &[(0, "alpha", ea.as_slice())]).unwrap();
        db.upsert_file_chunks("/v", "/v/folder/b.md", &[(0, "beta",  eb.as_slice())]).unwrap();
        db.upsert_file_chunks("/v", "/v/folder/c.md", &[(0, "gamma", ec.as_slice())]).unwrap();
        db.upsert_file_chunks("/v", "/v/other/d.md",  &[(0, "delta", other.as_slice())]).unwrap();

        let query = fake_embedding(0.1);
        let results = db
            .search_brute_force("/v", &query, 2, "/v/folder")
            .unwrap()
            .expect("TC-08: blobs must be present after upsert");

        assert_eq!(results.len(), 2, "TC-08: returns top-2 from the folder");
        // All results must be from /v/folder, not /v/other.
        assert!(
            results.iter().all(|r| r.file_path.starts_with("/v/folder")),
            "TC-08: results scoped to folder"
        );
    }

    /// TC-09: search_similar_where uses brute-force when prefix + blobs are present.
    #[test]
    fn search_similar_where_uses_brute_force_with_prefix() {
        let (db, _tmp) = make_db();
        let ea = fake_embedding(0.1);
        let eb = fake_embedding(0.5);
        db.upsert_file_chunks("/v", "/v/folder/a.md", &[(0, "alpha", ea.as_slice())]).unwrap();
        db.upsert_file_chunks("/v", "/v/folder/b.md", &[(0, "beta",  eb.as_slice())]).unwrap();

        let query = fake_embedding(0.1);
        let results = db
            .search_similar_where(
                "/v",
                &query,
                2,
                &|p: &str| p.starts_with("/v/folder"),
                Some("/v/folder"),
            )
            .unwrap();

        assert_eq!(results.len(), 2, "TC-09: brute-force path returns 2 results");
    }
}
