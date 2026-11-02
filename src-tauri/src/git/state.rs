//! Sync state persisted in `config.db` (key/value `config` table).
//!
//! Getters treat any database error as "absent"; setters return the error so
//! the runner can log it (a failing write never stops a sync cycle).

use rusqlite::{params, Connection, OptionalExtension};

const PAUSED_KEY: &str = "sync_paused_reason";
const CONFLICTS_KEY: &str = "sync_conflicts";
const LAST_SUCCESS_KEY: &str = "sync_last_success";

fn get(db: &Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT value FROM config WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn set(db: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map(|_| ())
}

fn remove(db: &Connection, key: &str) -> rusqlite::Result<()> {
    db.execute("DELETE FROM config WHERE key = ?1", params![key])
        .map(|_| ())
}

/// Why sync is paused (e.g. `"deletion"`), if it is.
pub fn paused_reason(db: &Connection) -> Option<String> {
    get(db, PAUSED_KEY)
}

pub fn set_paused_reason(db: &Connection, reason: Option<&str>) -> rusqlite::Result<()> {
    match reason {
        Some(r) => set(db, PAUSED_KEY, r),
        None => remove(db, PAUSED_KEY),
    }
}

/// Conflict-copy paths not yet seen by the user.
pub fn pending_conflicts(db: &Connection) -> Vec<String> {
    get(db, CONFLICTS_KEY)
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Append paths, deduplicated, keeping first-seen order.
pub fn add_conflicts(db: &Connection, paths: &[String]) -> rusqlite::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut all = pending_conflicts(db);
    for p in paths {
        if !all.contains(p) {
            all.push(p.clone());
        }
    }
    let raw = serde_json::to_string(&all)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    set(db, CONFLICTS_KEY, &raw)
}

pub fn clear_conflicts(db: &Connection) -> rusqlite::Result<()> {
    remove(db, CONFLICTS_KEY)
}

/// RFC 3339 timestamp of the last successful sync.
pub fn last_success(db: &Connection) -> Option<String> {
    get(db, LAST_SUCCESS_KEY)
}

pub fn set_last_success(db: &Connection, when: &str) -> rusqlite::Result<()> {
    set(db, LAST_SUCCESS_KEY, when)
}
