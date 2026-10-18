use crate::db::config::DbError;
use crate::fs::relink::remap_prefix;
use rusqlite::Connection;
use std::path::Path;

/// Which part of the vault a conversation answers from. Paths are
/// vault-relative with `/` separators.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QueryScope {
    #[default]
    Vault,
    Notes { paths: Vec<String> },
    Folder { path: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(default)]
    pub scope: QueryScope,
}

fn parse_scope(raw: Option<String>) -> QueryScope {
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    pub sources: Option<Vec<String>>,
    pub created_at: String,
}

pub struct ConversationsDb {
    conn: Connection,
}

impl ConversationsDb {
    /// Open (or create) `config.db` at `db_path` and ensure conversation/message tables exist.
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        let conn = Connection::open(db_path)?;

        // Enable foreign key support.
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
                id         TEXT PRIMARY KEY,
                vault_path TEXT NOT NULL,
                title      TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                    REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
                content         TEXT NOT NULL,
                sources         TEXT,
                created_at      TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv
                ON messages(conversation_id);",
        )?;

        // Migration: conversations created before scopes existed.
        let has_scope = conn
            .prepare("PRAGMA table_info(conversations)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|name| name == "scope");
        if !has_scope {
            conn.execute_batch("ALTER TABLE conversations ADD COLUMN scope TEXT;")?;
        }

        Ok(Self { conn })
    }

    /// Create a new conversation for the given vault. Returns the new UUID.
    pub fn create_conversation(
        &self,
        vault_path: &str,
        title: &str,
    ) -> Result<String, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO conversations (id, vault_path, title, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, vault_path, title, now],
        )?;
        Ok(id)
    }

    /// List all conversations for the given vault, most recent first.
    pub fn list_conversations(
        &self,
        vault_path: &str,
    ) -> Result<Vec<Conversation>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, created_at, scope FROM conversations
             WHERE vault_path = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![vault_path], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                scope: parse_scope(row.get(3)?),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// The scope stored for a conversation (`Vault` when none or unknown).
    pub fn get_scope(&self, id: &str) -> Result<QueryScope, DbError> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT scope FROM conversations WHERE id = ?1", rusqlite::params![id], |r| r.get(0))
            .unwrap_or(None);
        Ok(parse_scope(raw))
    }

    pub fn set_scope(&self, id: &str, scope: &QueryScope) -> Result<(), DbError> {
        let json = serde_json::to_string(scope).unwrap_or_default();
        self.conn.execute("UPDATE conversations SET scope = ?2 WHERE id = ?1", rusqlite::params![id, json])?;
        Ok(())
    }

    /// After `old_rel` (a note or folder, vault-relative) moved to `new_rel`,
    /// points every stored scope that referenced it at the new location.
    /// Returns how many conversations changed.
    pub fn remap_scope_paths(&self, vault_path: &str, old_rel: &str, new_rel: &str) -> Result<usize, DbError> {
        let rows: Vec<(String, Option<String>)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, scope FROM conversations WHERE vault_path = ?1 AND scope IS NOT NULL")?;
            let mapped = stmt.query_map(rusqlite::params![vault_path], |r| Ok((r.get(0)?, r.get(1)?)))?;
            mapped.filter_map(|r| r.ok()).collect()
        };
        let mut changed = 0;
        for (id, raw) in rows {
            let scope = parse_scope(raw);
            let remapped = match &scope {
                QueryScope::Vault => None,
                QueryScope::Notes { paths } => {
                    let new_paths: Vec<String> = paths
                        .iter()
                        .map(|p| remap_prefix(p, old_rel, new_rel).unwrap_or_else(|| p.clone()))
                        .collect();
                    (new_paths != *paths).then_some(QueryScope::Notes { paths: new_paths })
                }
                QueryScope::Folder { path } => {
                    remap_prefix(path, old_rel, new_rel).map(|path| QueryScope::Folder { path })
                }
            };
            if let Some(s) = remapped {
                self.set_scope(&id, &s)?;
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// Delete a conversation and all its messages (CASCADE).
    pub fn delete_conversation(&self, id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    /// Append a message to an existing conversation. Returns the new message UUID.
    pub fn add_message(
        &self,
        conv_id: &str,
        role: &str,
        content: &str,
        sources: Option<&[String]>,
    ) -> Result<String, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let sources_json = sources.map(|s| serde_json::to_string(s).unwrap_or_default());
        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, sources, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, conv_id, role, content, sources_json, now],
        )?;
        Ok(id)
    }

    /// Retrieve all messages for a conversation in insertion order.
    pub fn get_messages(&self, conv_id: &str) -> Result<Vec<Message>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, role, content, sources, created_at FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![conv_id], |row| {
            let sources_json: Option<String> = row.get(3)?;
            let sources: Option<Vec<String>> = sources_json.and_then(|s| {
                serde_json::from_str(&s).ok()
            });
            Ok(Message {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                sources,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_db() -> ConversationsDb {
        // Use in-memory SQLite for tests.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                vault_path TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                scope TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                    REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                content TEXT NOT NULL,
                sources TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);",
        )
        .unwrap();
        ConversationsDb { conn }
    }

    #[test]
    fn remap_scope_paths_updates_notes_and_folder_scopes() {
        let db = make_db();
        let notes = db.create_conversation("/vault", "n").unwrap();
        db.set_scope(&notes, &QueryScope::Notes { paths: vec!["a/Old.md".into(), "keep.md".into()] }).unwrap();
        let folder = db.create_conversation("/vault", "f").unwrap();
        db.set_scope(&folder, &QueryScope::Folder { path: "proj/sub".into() }).unwrap();
        let vault_scope = db.create_conversation("/vault", "v").unwrap();
        let other_vault = db.create_conversation("/otra", "o").unwrap();
        db.set_scope(&other_vault, &QueryScope::Notes { paths: vec!["a/Old.md".into()] }).unwrap();

        assert_eq!(db.remap_scope_paths("/vault", "a/Old.md", "a/New.md").unwrap(), 1);
        assert_eq!(db.remap_scope_paths("/vault", "proj", "arch/proj").unwrap(), 1);
        assert_eq!(db.remap_scope_paths("/vault", "nada", "x").unwrap(), 0);

        assert_eq!(
            db.get_scope(&notes).unwrap(),
            QueryScope::Notes { paths: vec!["a/New.md".into(), "keep.md".into()] }
        );
        assert_eq!(db.get_scope(&folder).unwrap(), QueryScope::Folder { path: "arch/proj/sub".into() });
        assert_eq!(db.get_scope(&vault_scope).unwrap(), QueryScope::Vault);
        assert_eq!(
            db.get_scope(&other_vault).unwrap(),
            QueryScope::Notes { paths: vec!["a/Old.md".into()] },
            "other vaults are untouched"
        );
    }

    /// TC-07: create_conversation returns UUID and list shows it.
    #[test]
    fn create_conversation_persists() {
        let db = make_db();
        let id = db
            .create_conversation("/vault", "titulo de prueba")
            .unwrap();
        assert!(!id.is_empty(), "TC-07: UUID returned");

        let list = db.list_conversations("/vault").unwrap();
        assert_eq!(list.len(), 1, "TC-07: conversation in list");
        assert_eq!(list[0].title, "titulo de prueba");
    }

    /// TC-08: add_message persists and get_messages returns it.
    #[test]
    fn add_message_then_get_messages() {
        let db = make_db();
        let conv_id = db.create_conversation("/vault", "test").unwrap();
        db.add_message(&conv_id, "user", "hola asistente", None)
            .unwrap();

        let messages = db.get_messages(&conv_id).unwrap();
        assert_eq!(messages.len(), 1, "TC-08: one message");
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "hola asistente");
        assert!(messages[0].sources.is_none());
    }

    /// TC-09: sources stored and retrieved correctly.
    #[test]
    fn add_message_with_sources() {
        let db = make_db();
        let conv_id = db.create_conversation("/vault", "test").unwrap();
        let paths = vec!["/vault/nota.md".to_string(), "/vault/otra.md".to_string()];
        db.add_message(&conv_id, "assistant", "respuesta", Some(&paths))
            .unwrap();

        let messages = db.get_messages(&conv_id).unwrap();
        let sources = messages[0].sources.as_ref().unwrap();
        assert_eq!(sources, &paths, "TC-09: sources round-trip");
    }

    /// Extra: delete_conversation cascades to messages.
    #[test]
    fn delete_conversation_cascades() {
        let db = make_db();
        let conv_id = db.create_conversation("/vault", "to delete").unwrap();
        db.add_message(&conv_id, "user", "msg", None).unwrap();
        db.delete_conversation(&conv_id).unwrap();

        let list = db.list_conversations("/vault").unwrap();
        assert!(list.is_empty());
        let msgs = db.get_messages(&conv_id).unwrap();
        assert!(msgs.is_empty(), "Messages should cascade-delete");
    }
}
