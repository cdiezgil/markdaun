//! Which notes still follow their H1 for their file name (`config.db`).
//! Rows hold vault-relative `/` paths; only following notes have a row.

use crate::db::config::DbError;
use crate::fs::relink::remap_prefix;
use rusqlite::Connection;
use std::path::Path;

pub struct H1FollowDb {
    conn: Connection,
}

impl H1FollowDb {
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS h1_follow (
                vault TEXT NOT NULL,
                path  TEXT NOT NULL,
                PRIMARY KEY (vault, path)
            );",
        )?;
        Ok(Self { conn })
    }

    pub fn set_following(&self, vault: &str, rel: &str, following: bool) -> Result<(), DbError> {
        if following {
            self.conn
                .execute("INSERT OR IGNORE INTO h1_follow (vault, path) VALUES (?1, ?2)", rusqlite::params![vault, rel])?;
        } else {
            self.conn
                .execute("DELETE FROM h1_follow WHERE vault = ?1 AND path = ?2", rusqlite::params![vault, rel])?;
        }
        Ok(())
    }

    pub fn is_following(&self, vault: &str, rel: &str) -> Result<bool, DbError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM h1_follow WHERE vault = ?1 AND path = ?2",
            rusqlite::params![vault, rel],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    fn rows(&self, vault: &str) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT path FROM h1_follow WHERE vault = ?1")?;
        let rows = stmt.query_map(rusqlite::params![vault], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// A note or folder moved: carries the follow state to the new paths.
    pub fn rekey(&self, vault: &str, old_rel: &str, new_rel: &str) -> Result<(), DbError> {
        for path in self.rows(vault)? {
            if let Some(next) = remap_prefix(&path, old_rel, new_rel) {
                self.conn.execute(
                    "UPDATE h1_follow SET path = ?3 WHERE vault = ?1 AND path = ?2",
                    rusqlite::params![vault, path, next],
                )?;
            }
        }
        Ok(())
    }

    /// A note or folder was deleted: forgets everything under it.
    pub fn remove(&self, vault: &str, rel: &str) -> Result<(), DbError> {
        for path in self.rows(vault)? {
            if remap_prefix(&path, rel, "").is_some() {
                self.set_following(vault, &path, false)?;
            }
        }
        Ok(())
    }
}
