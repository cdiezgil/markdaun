use crate::commands::vault_index::{index_file, list_vault_notes, relative_note_path, vault_note_listing};
use crate::commands::brain_scope::{resolve_context, validate_scope, ScopeContext};
use crate::db::{Conversation, ConversationsDb, Message, QueryScope, VectorsDb};
use crate::llm::attachment::{build_attachments, stored_references, AttachmentInput};
use crate::llm::connection::Connection;
use crate::llm::error::LlmError;
use crate::llm::engines;
use crate::llm::env::LlmEnv;
use crate::llm::store::LlmStore;
use crate::llm::ChatMessage;
use crate::llm::{embed_text, load_model, EmbedderState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;

// ─── Path helpers ─────────────────────────────────────────────────────────────

pub(crate) fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.db"))
}

pub(crate) fn vectors_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("vectors.db"))
}

pub(crate) fn model_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache = dir.join("fastembed_cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    Ok(cache)
}

type PathFilter = Box<dyn Fn(&str) -> bool>;

// ─── Public DTOs ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct BrainQueryResult {
    pub answer: String,
    pub sources: Vec<String>,
    pub conversation_id: String,
    pub message_id: String,
    /// Set when the answer was produced without notes context
    /// (`notes_context_unavailable: <detail>`).
    pub warning: Option<String>,
}

// ─── Inner helpers (testable without AppHandle) ───────────────────────────────

/// Tells the model how to propose creating or extending a note. The app only
/// writes after the user confirms the proposal card.
pub(crate) const NOTE_BLOCK_INSTRUCTION: &str = "Si el usuario te pide crear o ampliar una nota, responde con uno o más bloques de código con esta forma exacta (el usuario debe confirmar cada bloque; nada se guarda sin su confirmación):\n```markdaun-note path=\"Carpeta/nombre.md\" mode=\"create\"\n# Título\ncontenido en Markdown\n```\n`path` es relativo a la bóveda y debe terminar en .md. `mode` es \"create\" (nota nueva) o \"append\" (añadir al final de una nota existente). Usa estos bloques solo cuando se te pida una nota.\n\nSi el usuario te pide un diagrama dentro de una nota, usa un bloque de código con lenguaje mermaid (```mermaid).";

/// Build the RAG prompt: system message with the vault's note index and the
/// retrieved chunks (each labelled with its note path), user message with the question.
pub fn build_rag_messages(
    question: &str,
    results: &[crate::db::vectors::SearchResult],
    vault_notes: &[String],
) -> Vec<ChatMessage> {
    let context: String = results
        .iter()
        .enumerate()
        .map(|(i, r)| {
            // Chunks indexed by the vault sync already start with "Nota: <path>".
            if r.content.starts_with("Nota: ") {
                format!("[{}] {}", i + 1, r.content)
            } else {
                let name = Path::new(&r.file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&r.file_path);
                format!("[{}] Nota: {}\n\n{}", i + 1, name, r.content)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let base = "Eres un asistente de conocimiento personal. Responde únicamente en base al contexto proporcionado. Si la respuesta no se puede inferir del contexto, indícalo claramente.";
    let listing = vault_note_listing(vault_notes);
    let system = if context.is_empty() {
        format!("{base}\n\n{NOTE_BLOCK_INSTRUCTION}\n\n{listing}")
    } else {
        format!("{base}\n\n{NOTE_BLOCK_INSTRUCTION}\n\n{listing}\n\nContexto:\n{context}")
    };

    vec![
        ChatMessage::text("system", system),
        ChatMessage::text("user", question),
    ]
}

/// Text-only RAG query (see [`brain_query_core`]); used by the tests.
#[cfg(test)]
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
    query_embedding: Result<Vec<f32>, String>,
) -> Result<BrainQueryResult, String> {
    brain_query_core(
        db_path,
        vectors_db_path,
        question,
        vault_path,
        conversation_id,
        conn,
        model,
        secret,
        env,
        query_embedding,
        &[],
        None,
    )
    .await
}

/// Core RAG query — takes the (possibly failed) query embedding for testability.
/// An embedding or vector-search failure degrades to an answer without notes context.
/// Attachments are validated first and sent only with this turn; the stored user
/// message keeps a `📎 name` reference list instead of the bytes.
#[allow(clippy::too_many_arguments)]
pub async fn brain_query_core(
    db_path: &Path,
    vectors_db_path: &Path,
    question: &str,
    vault_path: &str,
    conversation_id: Option<String>,
    conn: &Connection,
    model: &str,
    secret: Option<&str>,
    env: &LlmEnv,
    query_embedding: Result<Vec<f32>, String>,
    attachment_inputs: &[AttachmentInput],
    scope: Option<&QueryScope>,
) -> Result<BrainQueryResult, String> {
    // 0. Validate attachments before anything is persisted or sent.
    let attachments = build_attachments(Path::new(vault_path), attachment_inputs)
        .map_err(|e| format!("attachment_error: {e}"))?;
    if !attachments.is_empty() && !conn.supports_vision(model) {
        return Err("vision_unsupported".to_string());
    }
    let stored_question = if attachments.is_empty() {
        question.to_string()
    } else {
        let names: Vec<String> = attachments.iter().map(|a| a.name.clone()).collect();
        format!("{question}\n\n{}", stored_references(&names))
    };

    // 0b. Resolve the scope: the given one, else the conversation's stored one.
    let conv_db = ConversationsDb::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let vault = Path::new(vault_path);
    let scope = match (scope, conversation_id.as_deref()) {
        (Some(s), _) => validate_scope(vault, s)?,
        (None, Some(id)) => {
            let stored = conv_db.get_scope(id).map_err(|e| format!("db_error: {e}"))?;
            // A stored scope may have gone stale (note deleted): fall back to the vault.
            validate_scope(vault, &stored).unwrap_or_default()
        }
        (None, None) => QueryScope::Vault,
    };
    let context = resolve_context(vault, &scope)?;

    // 1. Context: full text of the scoped notes, or similar chunks (restricted
    //    to the scope when there is one). Failures degrade to "no context".
    let search = |filter: Option<PathFilter>| {
        query_embedding.clone().and_then(|emb| {
            let vec_db = VectorsDb::open(vectors_db_path).map_err(|e| format!("db_error: {e}"))?;
            match filter {
                None => vec_db.search_similar(vault_path, &emb, 5),
                Some(keep) => vec_db.search_similar_where(vault_path, &emb, 5, &*keep),
            }
            .map_err(|e| format!("db_error: {e}"))
        })
    };
    let found = match context {
        ScopeContext::FullText(notes) => Ok(notes),
        ScopeContext::Retrieve => search(None),
        ScopeContext::RetrieveIn(files, prefix) => search(Some(Box::new(move |p: &str| {
            files.iter().any(|f| f == p) || prefix.as_deref().is_some_and(|pre| p.starts_with(pre))
        }))),
    };
    let (results, warning) = match found {
        Ok(r) => (r, None),
        Err(detail) => (Vec::new(), Some(format!("notes_context_unavailable: {detail}"))),
    };

    let sources: Vec<String> = results.iter().map(|r| r.file_path.clone()).collect();

    // 2. Build RAG prompt.
    let vault_notes: Vec<String> = list_vault_notes(Path::new(vault_path))
        .iter()
        .map(|f| relative_note_path(Path::new(vault_path), f))
        .collect();
    let mut messages = build_rag_messages(question, &results, &vault_notes);
    if let Some(last) = messages.last_mut() {
        last.attachments = attachments;
    }

    // 3. Open (or create) conversation and persist its scope.
    let conv_id = match conversation_id {
        Some(id) => id,
        None => {
            let title: String = question.chars().take(50).collect();
            conv_db
                .create_conversation(vault_path, &title)
                .map_err(|e| format!("db_error: {e}"))?
        }
    };
    conv_db.set_scope(&conv_id, &scope).map_err(|e| format!("db_error: {e}"))?;

    // 4. Persist user message.
    conv_db
        .add_message(&conv_id, "user", &stored_question, None)
        .map_err(|e| format!("db_error: {e}"))?;

    // 5. Call the active connection's engine.
    let answer = engines::chat(conn, model, &messages, secret, env).await.map_err(|e| match e {
        LlmError::VisionUnsupported => "vision_unsupported".to_string(),
        other => format!("llm_error: {other}"),
    })?;

    // 6. Persist assistant message.
    let message_id = conv_db
        .add_message(&conv_id, "assistant", &answer, Some(&sources))
        .map_err(|e| format!("db_error: {e}"))?;

    Ok(BrainQueryResult { answer, sources, conversation_id: conv_id, message_id, warning })
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

/// Load (once) the shared embedding model, off the async runtime.
async fn shared_model(
    state: &Arc<EmbedderState>,
    cache_dir: PathBuf,
) -> Result<Arc<fastembed::TextEmbedding>, String> {
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        state
            .get_or_try_init(|| load_model(&cache_dir))
            .map_err(|e| format!("embed_error: {e}"))
    })
    .await
    .map_err(|e| format!("embed_error: {e}"))?
}

/// Embed `text` with the shared model on a blocking thread.
async fn embed_query(
    state: &Arc<EmbedderState>,
    cache_dir: PathBuf,
    text: String,
) -> Result<Vec<f32>, String> {
    let model = shared_model(state, cache_dir).await?;
    tokio::task::spawn_blocking(move || {
        embed_text(&model, &text).map_err(|e| format!("embed_error: {e}"))
    })
    .await
    .map_err(|e| format!("embed_error: {e}"))?
}

/// RAG query: embed question, search vault, call the active LLM connection, persist conversation.
/// If `conversation_id` is None, a new conversation is created.
/// If the notes context cannot be built, the LLM is still called and `warning` is set.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn brain_query(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    embedder: tauri::State<'_, Arc<EmbedderState>>,
    question: String,
    vault_path: String,
    conversation_id: Option<String>,
    attachments: Option<Vec<AttachmentInput>>,
    scope: Option<QueryScope>,
) -> Result<BrainQueryResult, String> {
    let db_path = app_db_path(&app)?;
    let vdb_path = vectors_db_path(&app)?;
    let cache_dir = model_cache_dir(&app)?;

    let (conn, model, secret) = resolve_active(&db_path, &env)?;

    // Embed question locally; failure degrades to an answer without context.
    let query_emb = embed_query(&embedder, cache_dir, question.clone()).await;

    brain_query_core(
        &db_path,
        &vdb_path,
        &question,
        &vault_path,
        conversation_id,
        &conn,
        &model,
        secret.as_deref(),
        &env,
        query_emb,
        attachments.as_deref().unwrap_or(&[]),
        scope.as_ref(),
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

/// Change the scope stored with a conversation.
#[tauri::command]
pub async fn brain_set_conversation_scope(
    app: tauri::AppHandle,
    conversation_id: String,
    vault_path: String,
    scope: QueryScope,
) -> Result<QueryScope, String> {
    let db_path = app_db_path(&app)?;
    let scope = validate_scope(Path::new(&vault_path), &scope)?;
    let db = ConversationsDb::open(&db_path).map_err(|e| format!("db_error: {e}"))?;
    db.set_scope(&conversation_id, &scope).map_err(|e| format!("db_error: {e}"))?;
    Ok(scope)
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

/// Progress of Second Brain (re)indexing, emitted as `brain-index-progress`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct IndexProgress {
    pub done: usize,
    pub total: usize,
}

pub const INDEX_PROGRESS_EVENT: &str = "brain-index-progress";

/// Runs `work` for a single file, reporting 0/1 before and 1/1 after
/// (also when the work fails, so the UI never stays stuck on "indexing").
pub(crate) async fn with_index_progress<E, F, T>(emit: E, work: F) -> T
where
    E: Fn(IndexProgress),
    F: std::future::Future<Output = T>,
{
    emit(IndexProgress { done: 0, total: 1 });
    let out = work.await;
    emit(IndexProgress { done: 1, total: 1 });
    out
}

/// Re-embed one Markdown file, emitting `brain-index-progress`. Shared by
/// `brain_update_embedding` and `chat_write_note`.
pub(crate) async fn reindex_file_with_progress(
    app: &tauri::AppHandle,
    embedder: &Arc<EmbedderState>,
    file_path: &str,
    vault_path: &str,
) -> Result<(), String> {
    use tauri::Emitter;
    if !file_path.ends_with(".md") {
        return Ok(());
    }
    with_index_progress(
        |p| {
            let _ = app.emit(INDEX_PROGRESS_EVENT, p);
        },
        reindex_file(app, embedder, file_path, vault_path),
    )
    .await
}

/// Chunk a Markdown file, embed each chunk, and upsert into vectors.db.
/// Fire-and-forget: embedding/db errors are logged but not propagated.
#[tauri::command]
pub async fn brain_update_embedding(
    app: tauri::AppHandle,
    embedder: tauri::State<'_, Arc<EmbedderState>>,
    file_path: String,
    vault_path: String,
) -> Result<(), String> {
    reindex_file_with_progress(&app, embedder.inner(), &file_path, &vault_path).await
}

async fn reindex_file(
    app: &tauri::AppHandle,
    embedder: &Arc<EmbedderState>,
    file_path: &str,
    vault_path: &str,
) -> Result<(), String> {
    if !file_path.ends_with(".md") {
        return Ok(());
    }

    let vdb_path = vectors_db_path(app)?;
    let cache_dir = model_cache_dir(app)?;

    let model = match shared_model(embedder, cache_dir).await {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[brain_update_embedding] load_model error: {e}");
            return Ok(());
        }
    };

    let (file, vault) = (file_path.to_string(), vault_path.to_string());
    tokio::task::spawn_blocking(move || {
        let vec_db = match VectorsDb::open(&vdb_path) {
            Ok(db) => db,
            Err(e) => {
                eprintln!("[brain_update_embedding] VectorsDb open error: {e}");
                return;
            }
        };
        let embed = |t: &str| embed_text(&model, t).map_err(|e| format!("embed_error: {e}"));
        if let Err(e) = index_file(&vec_db, Path::new(&vault), Path::new(&file), &embed) {
            eprintln!("[brain_update_embedding] index error: {e}");
        }
    })
    .await
    .map_err(|e| format!("embed_error: {e}"))
}
