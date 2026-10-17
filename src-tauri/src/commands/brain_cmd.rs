use crate::db::{Conversation, ConversationsDb, Message, VectorsDb};
use crate::llm::connection::Connection;
use crate::llm::engines;
use crate::llm::env::LlmEnv;
use crate::llm::store::LlmStore;
use crate::llm::ChatMessage;
use crate::llm::{chunk_text, embed_text, load_model};
use std::path::{Path, PathBuf};
use tauri::Manager;

// ─── Path helpers ─────────────────────────────────────────────────────────────

pub(crate) fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.db"))
}

fn vectors_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("vectors.db"))
}

fn model_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache = dir.join("fastembed_cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    Ok(cache)
}

// ─── Public DTOs ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct BrainQueryResult {
    pub answer: String,
    pub sources: Vec<String>,
    pub conversation_id: String,
    pub message_id: String,
}

// ─── Inner helpers (testable without AppHandle) ───────────────────────────────

/// Build the RAG prompt: system message with context chunks, user message with the question.
pub fn build_rag_messages(question: &str, results: &[crate::db::vectors::SearchResult]) -> Vec<ChatMessage> {
    let context: String = results
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let name = Path::new(&r.file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&r.file_path);
            format!("[{}] {}: {}", i + 1, name, r.content)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let system = if context.is_empty() {
        "Eres un asistente de conocimiento personal. Responde únicamente en base al contexto proporcionado. Si la respuesta no se puede inferir del contexto, indícalo claramente.".to_string()
    } else {
        format!(
            "Eres un asistente de conocimiento personal. Responde únicamente en base al contexto proporcionado. Si la respuesta no se puede inferir del contexto, indícalo claramente.\n\nContexto:\n{context}"
        )
    };

    vec![
        ChatMessage {
            role: "system".to_string(),
            content: system,
        },
        ChatMessage {
            role: "user".to_string(),
            content: question.to_string(),
        },
    ]
}

/// Core RAG query — takes a pre-computed `query_embedding` for testability.
#[allow(clippy::too_many_arguments)]
pub async fn brain_query_with_embedding(
    db_path: &Path,
    vectors_db_path: &Path,
    question: &str,
    vault_path: &str,
    conversation_id: Option<String>,
    conn: &Connection,
    model: &str,
    secret: Option<&str>,
    env: &LlmEnv,
    query_embedding: &[f32],
) -> Result<BrainQueryResult, String> {
    // 1. Search for similar chunks.
    let vec_db = VectorsDb::open(vectors_db_path).map_err(|e| format!("db_error: {e}"))?;
    let results = vec_db
        .search_similar(vault_path, query_embedding, 5)
        .map_err(|e| format!("db_error: {e}"))?;

    let sources: Vec<String> = results.iter().map(|r| r.file_path.clone()).collect();

    // 2. Build RAG prompt.
    let messages = build_rag_messages(question, &results);

    // 3. Open (or create) conversation.
    let conv_db = ConversationsDb::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let conv_id = match conversation_id {
        Some(id) => id,
        None => {
            let title: String = question.chars().take(50).collect();
            conv_db
                .create_conversation(vault_path, &title)
                .map_err(|e| format!("db_error: {e}"))?
        }
    };

    // 4. Persist user message.
    conv_db
        .add_message(&conv_id, "user", question, None)
        .map_err(|e| format!("db_error: {e}"))?;

    // 5. Call the active connection's engine.
    let answer = engines::chat(conn, model, &messages, secret, env)
        .await
        .map_err(|e| format!("llm_error: {e}"))?;

    // 6. Persist assistant message.
    let message_id = conv_db
        .add_message(&conv_id, "assistant", &answer, Some(&sources))
        .map_err(|e| format!("db_error: {e}"))?;

    Ok(BrainQueryResult { answer, sources, conversation_id: conv_id, message_id })
}

/// Active connection + model + its keyring secret, or `"not_configured"`.
pub fn resolve_active(db_path: &Path, env: &LlmEnv) -> Result<(Connection, String, Option<String>), String> {
    let store = LlmStore::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let active = store
        .get_active()
        .map_err(|e| format!("db_error: {e}"))?
        .ok_or_else(|| "not_configured".to_string())?;
    let conn = store
        .get(&active.connection_id)
        .map_err(|e| format!("db_error: {e}"))?
        .ok_or_else(|| "not_configured".to_string())?;
    let secret = env.secret_for(&conn).map_err(|e| format!("keyring_error: {e}"))?;
    Ok((conn, active.model, secret))
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

/// RAG query: embed question, search vault, call the active LLM connection, persist conversation.
/// If `conversation_id` is None, a new conversation is created.
#[tauri::command]
pub async fn brain_query(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    question: String,
    vault_path: String,
    conversation_id: Option<String>,
) -> Result<BrainQueryResult, String> {
    let db_path = app_db_path(&app)?;
    let vdb_path = vectors_db_path(&app)?;
    let cache_dir = model_cache_dir(&app)?;

    let (conn, model, secret) = resolve_active(&db_path, &env)?;

    // Embed question locally.
    let model_handle = load_model(&cache_dir).map_err(|e| format!("embed_error: {e}"))?;
    let query_emb = embed_text(&model_handle, &question).map_err(|e| format!("embed_error: {e}"))?;

    brain_query_with_embedding(
        &db_path,
        &vdb_path,
        &question,
        &vault_path,
        conversation_id,
        &conn,
        &model,
        secret.as_deref(),
        &env,
        &query_emb,
    )
    .await
}

/// List all conversations for the given vault (most recent first).
#[tauri::command]
pub async fn brain_get_conversations(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<Vec<Conversation>, String> {
    let db_path = app_db_path(&app)?;
    let db = ConversationsDb::open(&db_path).map_err(|e| format!("db_error: {e}"))?;
    db.list_conversations(&vault_path)
        .map_err(|e| format!("db_error: {e}"))
}

/// Get all messages in a conversation (oldest first).
#[tauri::command]
pub async fn brain_get_messages(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let db_path = app_db_path(&app)?;
    let db = ConversationsDb::open(&db_path).map_err(|e| format!("db_error: {e}"))?;
    db.get_messages(&conversation_id)
        .map_err(|e| format!("db_error: {e}"))
}

/// Delete a conversation and cascade-delete its messages.
#[tauri::command]
pub async fn brain_delete_conversation(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    let db_path = app_db_path(&app)?;
    let db = ConversationsDb::open(&db_path).map_err(|e| format!("db_error: {e}"))?;
    db.delete_conversation(&conversation_id)
        .map_err(|e| format!("db_error: {e}"))
}

/// Chunk a Markdown file, embed each chunk, and upsert into vectors.db.
/// Fire-and-forget: errors are logged but not propagated.
#[tauri::command]
pub async fn brain_update_embedding(
    app: tauri::AppHandle,
    file_path: String,
    vault_path: String,
) -> Result<(), String> {
    if !file_path.ends_with(".md") {
        return Ok(());
    }

    let vdb_path = vectors_db_path(&app)?;
    let cache_dir = model_cache_dir(&app)?;

    // Read file content — errors silently discarded (fire-and-forget).
    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[brain_update_embedding] read error {file_path}: {e}");
            return Ok(());
        }
    };

    let model = match load_model(&cache_dir) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[brain_update_embedding] load_model error: {e}");
            return Ok(());
        }
    };

    let chunks = chunk_text(&content, 1500, 200);
    let mut embedded: Vec<(usize, String, Vec<f32>)> = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        match embed_text(&model, chunk) {
            Ok(emb) => embedded.push((i, chunk.clone(), emb)),
            Err(e) => eprintln!("[brain_update_embedding] embed error chunk {i}: {e}"),
        }
    }

    let chunk_refs: Vec<(usize, &str, &[f32])> = embedded
        .iter()
        .map(|(i, s, e)| (*i, s.as_str(), e.as_slice()))
        .collect();

    let vec_db = match VectorsDb::open(&vdb_path) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("[brain_update_embedding] VectorsDb open error: {e}");
            return Ok(());
        }
    };

    if let Err(e) = vec_db.upsert_file_chunks(&vault_path, &file_path, &chunk_refs) {
        eprintln!("[brain_update_embedding] upsert error: {e}");
    }

    Ok(())
}
