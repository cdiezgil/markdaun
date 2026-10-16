use crate::db::config::DbError;
use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
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
            "SELECT id, title, created_at FROM conversations
             WHERE vault_path = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![vault_path], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
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
                created_at TEXT NOT NULL
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
