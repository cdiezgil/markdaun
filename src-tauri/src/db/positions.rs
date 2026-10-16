use crate::db::config::DbError;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

/// Manages the `node_positions` table in `config.db`.
/// Each row stores the canvas (x, y) position of one vault file per vault.
pub struct NodePositionsDb {
    conn: Connection,
}

impl NodePositionsDb {
    /// Open (or create) the database at `db_path` and ensure the table exists.
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS node_positions (
                vault_path  TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                x           REAL NOT NULL,
                y           REAL NOT NULL,
                PRIMARY KEY (vault_path, file_path)
            );",
        )?;
        Ok(Self { conn })
    }

    /// Persist or update the position of a node.
    pub fn set_position(
        &self,
        vault_path: &str,
        file_path: &str,
        x: f64,
        y: f64,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO node_positions (vault_path, file_path, x, y)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![vault_path, file_path, x, y],
        )?;
        Ok(())
    }

    /// Retrieve all saved positions for the given vault.
    /// Returns `HashMap<file_path, (x, y)>`.
    pub fn get_all_positions(
        &self,
        vault_path: &str,
    ) -> Result<HashMap<String, (f64, f64)>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT file_path, x, y FROM node_positions WHERE vault_path = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![vault_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (file_path, x, y) = row?;
            map.insert(file_path, (x, y));
        }
        Ok(map)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> NodePositionsDb {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS node_positions (
                vault_path  TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                x           REAL NOT NULL,
                y           REAL NOT NULL,
                PRIMARY KEY (vault_path, file_path)
            );",
        )
        .unwrap();
        NodePositionsDb { conn }
    }

    /// TC-11: set_position persists and get_all_positions retrieves it
    #[test]
    fn set_and_get_position_tc11() {
        let db = open_in_memory();
        db.set_position("/vault", "/vault/a.md", 100.0, 200.0).unwrap();
        let positions = db.get_all_positions("/vault").unwrap();
        assert_eq!(positions.get("/vault/a.md"), Some(&(100.0, 200.0)));
    }

    /// TC-12: position returned in get_vault_graph (simulated via get_all_positions)
    #[test]
    fn position_returned_tc12() {
        let db = open_in_memory();
        db.set_position("/vault", "/vault/a.md", 50.0, 75.0).unwrap();
        let positions = db.get_all_positions("/vault").unwrap();
        let pos = positions.get("/vault/a.md").copied().unwrap();
        assert!((pos.0 - 50.0).abs() < f64::EPSILON);
        assert!((pos.1 - 75.0).abs() < f64::EPSILON);
    }

    /// TC-13: node without saved position is absent from get_all_positions
    #[test]
    fn no_position_tc13() {
        let db = open_in_memory();
        let positions = db.get_all_positions("/vault").unwrap();
        assert!(positions.is_empty(), "TC-13: no positions should be returned for fresh vault");
    }

    /// INSERT OR REPLACE overwrites existing row
    #[test]
    fn overwrite_position() {
        let db = open_in_memory();
        db.set_position("/vault", "/vault/a.md", 1.0, 2.0).unwrap();
        db.set_position("/vault", "/vault/a.md", 300.0, 400.0).unwrap();
        let positions = db.get_all_positions("/vault").unwrap();
        assert_eq!(positions.get("/vault/a.md"), Some(&(300.0, 400.0)));
    }

    /// Different vaults don't share positions
    #[test]
    fn positions_scoped_to_vault() {
        let db = open_in_memory();
        db.set_position("/vault-a", "/vault-a/note.md", 10.0, 20.0).unwrap();
        let positions_b = db.get_all_positions("/vault-b").unwrap();
        assert!(positions_b.is_empty());
    }
}
