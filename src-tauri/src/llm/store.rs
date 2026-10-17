use super::connection::*;
use super::error::LlmError;
use super::secrets::{connection_account, SecretStore, LEGACY_ACCOUNT};
use crate::db::ConfigDb;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

const KEY_ACTIVE_CONN: &str = "llm_active_connection";
const KEY_ACTIVE_MODEL: &str = "llm_active_model";
const KEY_MIGRATED: &str = "llm_migrated";
const KEY_VISION_MIGRATED: &str = "llm_vision_migrated";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSelection {
    pub connection_id: String,
    pub model: String,
}

/// Connections (one JSON row each) and the active selection, in `config.db`.
/// Never touches secrets except during legacy migration.
pub struct LlmStore {
    db: ConfigDb,
}

impl LlmStore {
    pub fn open(path: &Path) -> Result<Self, LlmError> {
        let db = ConfigDb::open(path).map_err(LlmError::storage)?;
        db.connection()
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS llm_connections (
                    id       TEXT PRIMARY KEY NOT NULL,
                    position INTEGER NOT NULL,
                    json     TEXT NOT NULL
                );",
            )
            .map_err(LlmError::storage)?;
        Ok(Self { db })
    }

    pub fn list(&self) -> Result<Vec<Connection>, LlmError> {
        let mut stmt = self
            .db
            .connection()
            .prepare("SELECT json FROM llm_connections ORDER BY position ASC")
            .map_err(LlmError::storage)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(LlmError::storage)?;
        let mut out = Vec::new();
        for row in rows {
            let json = row.map_err(LlmError::storage)?;
            out.push(serde_json::from_str(&json).map_err(LlmError::storage)?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Option<Connection>, LlmError> {
        let json: Option<String> = self
            .db
            .connection()
            .query_row("SELECT json FROM llm_connections WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(LlmError::storage)?;
        match json {
            Some(j) => Ok(Some(serde_json::from_str(&j).map_err(LlmError::storage)?)),
            None => Ok(None),
        }
    }

    /// Insert or update. An empty `id` gets a fresh uuid v4.
    pub fn upsert(&self, mut conn: Connection) -> Result<Connection, LlmError> {
        if conn.id.is_empty() {
            conn.id = uuid::Uuid::new_v4().to_string();
        }
        let json = serde_json::to_string(&conn).map_err(LlmError::storage)?;
        let next_pos: i64 = self
            .db
            .connection()
            .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM llm_connections", [], |r| r.get(0))
            .map_err(LlmError::storage)?;
        self.db
            .connection()
            .execute(
                "INSERT INTO llm_connections (id, position, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json",
                params![conn.id, next_pos, json],
            )
            .map_err(LlmError::storage)?;
        self.repair_active(&conn)?;
        Ok(conn)
    }

    /// Removes the row and clears the active selection if it pointed here.
    /// Keyring cleanup is the caller's job.
    pub fn delete(&self, id: &str) -> Result<(), LlmError> {
        self.db
            .connection()
            .execute("DELETE FROM llm_connections WHERE id = ?1", params![id])
            .map_err(LlmError::storage)?;
        if let Some(active) = self.get_active()? {
            if active.connection_id == id {
                self.clear_active()?;
            }
        }
        Ok(())
    }

    pub fn set_active(&self, connection_id: &str, model: &str) -> Result<ActiveSelection, LlmError> {
        let conn = self
            .get(connection_id)?
            .ok_or_else(|| LlmError::BadResponse("unknown connection".into()))?;
        if !conn.models.iter().any(|m| m == model) {
            return Err(LlmError::ModelNotFound);
        }
        self.db.set(KEY_ACTIVE_CONN, connection_id).map_err(LlmError::storage)?;
        self.db.set(KEY_ACTIVE_MODEL, model).map_err(LlmError::storage)?;
        Ok(ActiveSelection { connection_id: connection_id.into(), model: model.into() })
    }

    pub fn get_active(&self) -> Result<Option<ActiveSelection>, LlmError> {
        let id = self.db.get(KEY_ACTIVE_CONN).map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let model = self.db.get(KEY_ACTIVE_MODEL).map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        match (id, model) {
            (Some(connection_id), Some(model)) if self.get(&connection_id)?.is_some() => {
                Ok(Some(ActiveSelection { connection_id, model }))
            }
            _ => Ok(None),
        }
    }

    fn clear_active(&self) -> Result<(), LlmError> {
        self.db.set(KEY_ACTIVE_CONN, "").map_err(LlmError::storage)?;
        self.db.set(KEY_ACTIVE_MODEL, "").map_err(LlmError::storage)
    }

    /// If the active model was removed from `conn`, fall back to its first model.
    fn repair_active(&self, conn: &Connection) -> Result<(), LlmError> {
        if let Some(active) = self.get_active()? {
            if active.connection_id == conn.id && !conn.models.contains(&active.model) {
                match conn.models.first() {
                    Some(m) => {
                        self.db.set(KEY_ACTIVE_MODEL, m).map_err(LlmError::storage)?;
                    }
                    None => self.clear_active()?,
                }
            }
        }
        Ok(())
    }

    /// One-shot: fills `vision_models` of existing connections with the
    /// per-family defaults. Returns true when it ran.
    pub fn migrate_vision(&self) -> Result<bool, LlmError> {
        if self.db.get(KEY_VISION_MIGRATED).map_err(LlmError::storage)?.is_some() {
            return Ok(false);
        }
        for mut c in self.list()? {
            if c.vision_models.is_empty() {
                c.vision_models = c.models.iter().filter(|m| vision_default(m)).cloned().collect();
                self.upsert(c)?;
            }
        }
        self.db.set(KEY_VISION_MIGRATED, "1").map_err(LlmError::storage)?;
        Ok(true)
    }

    /// One-shot migration of the pre-connections config
    /// (`llm_endpoint_url` / `llm_model` / keyring `llm-api-key`).
    /// Returns true when a connection was created.
    pub fn migrate_legacy(&self, secrets: &dyn SecretStore) -> Result<bool, LlmError> {
        if self.db.get(KEY_MIGRATED).map_err(LlmError::storage)?.is_some() {
            return Ok(false);
        }
        let url = self.db.get("llm_endpoint_url").map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let model = self.db.get("llm_model").map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let (Some(url), Some(model)) = (url, model) else {
            self.db.set(KEY_MIGRATED, "1").map_err(LlmError::storage)?;
            return Ok(false);
        };
        let key = secrets.get(LEGACY_ACCOUNT)?;
        let saved = self.upsert(Connection {
            id: String::new(),
            name: "Migrated".into(),
            preset_id: None,
            engine: Engine::OpenAiCompat,
            base_url: Some(legacy_base_url(&url)),
            auth: if key.is_some() { AuthSource::ApiKey } else { AuthSource::None },
            auth_header: AuthHeader::Bearer,
            extra_headers: vec![],
            ca_cert_path: None,
            azure_api_version: None,
            models: vec![model.clone()],
            vision_models: vec![],
        })?;
        if let Some(k) = &key {
            secrets.set(&connection_account(&saved.id), k)?;
        }
        self.set_active(&saved.id, &model)?;
        secrets.delete(LEGACY_ACCOUNT)?;
        self.db.set("llm_endpoint_url", "").map_err(LlmError::storage)?;
        self.db.set("llm_model", "").map_err(LlmError::storage)?;
        self.db.set(KEY_MIGRATED, "1").map_err(LlmError::storage)?;
        Ok(true)
    }
}

/// The legacy setting stored the full chat URL; connections store the base.
fn legacy_base_url(url: &str) -> String {
    let u = url.trim_end_matches('/');
    u.strip_suffix("/chat/completions").unwrap_or(u).trim_end_matches('/').to_string()
}
