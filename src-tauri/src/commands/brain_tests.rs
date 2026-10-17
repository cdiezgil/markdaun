use super::brain_cmd::{brain_query_with_embedding, build_rag_messages, resolve_active};
use crate::db::{ConversationsDb, VectorsDb};
use crate::llm::connection::*;
use crate::llm::proc::FixedResolver;
use crate::llm::secrets::connection_account;
use crate::llm::store::LlmStore;
use crate::llm::testutil::{spawn, test_env, MockResponse, MockServer};
use tempfile::NamedTempFile;

// ── Mock LLM ──────────────────────────────────────────────────────────────────

const MOCK_LLM_RESPONSE: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"respuesta de prueba"}}]}"#;

fn mock_llm() -> MockServer {
    spawn(|_| MockResponse::json(200, MOCK_LLM_RESPONSE))
}

fn conn_for(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "Test".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::None,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["test-model".into()],
    }
}

fn fake_embedding() -> Vec<f32> {
    let v = vec![0.1_f32; 384];
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter().map(|x| x / norm).collect()
}

fn make_config_db() -> NamedTempFile {
    NamedTempFile::new().unwrap()
}

fn make_vectors_db() -> (VectorsDb, NamedTempFile) {
    let f = NamedTempFile::new().unwrap();
    let db = VectorsDb::open(f.path()).unwrap();
    (db, f)
}

// ── TC-13: prompt includes chunk content ──────────────────────────────────────

#[tokio::test]
async fn brain_query_builds_prompt_with_context() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db
        .upsert_file_chunks("/vault", "/vault/nota.md", &[(0, "contenido importante de la nota", emb.as_slice())])
        .unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "¿qué dice la nota?",
        "/vault",
        None,
        &conn_for(&server.url),
        "test-model",
        None,
        &env,
        Ok(emb.clone()),
    )
    .await
    .unwrap();

    assert_eq!(result.answer, "respuesta de prueba", "TC-13: answer extracted");
    let body = &server.requests()[0].body;
    assert!(body.contains("contenido importante de la nota"), "TC-13: prompt must include chunk content. Body:\n{body}");
    assert!(body.contains("test-model"), "TC-13: request carries the chosen model");
}

// ── TC-14: creates a new conversation ─────────────────────────────────────────

#[tokio::test]
async fn brain_query_creates_conversation_when_none() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db.upsert_file_chunks("/vault", "/vault/a.md", &[(0, "algo", emb.as_slice())]).unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "primera pregunta",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(emb.clone()),
    )
    .await
    .unwrap();

    assert!(!result.conversation_id.is_empty(), "TC-14: conversation_id assigned");
    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let list = conv_db.list_conversations("/vault").unwrap();
    assert_eq!(list.len(), 1, "TC-14: one conversation created");
    assert_eq!(list[0].id, result.conversation_id);
}

// ── TC-15: continues an existing conversation ─────────────────────────────────

#[tokio::test]
async fn brain_query_continues_existing_conversation() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db.upsert_file_chunks("/vault", "/vault/b.md", &[(0, "texto", emb.as_slice())]).unwrap();

    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let existing_id = conv_db.create_conversation("/vault", "charla anterior").unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "segunda pregunta",
        "/vault",
        Some(existing_id.clone()),
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(emb.clone()),
    )
    .await
    .unwrap();

    assert_eq!(result.conversation_id, existing_id, "TC-15: same conversation_id returned");
    let messages = conv_db.get_messages(&existing_id).unwrap();
    assert_eq!(messages.len(), 2, "TC-15: user + assistant messages added");
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");
}

// ── TC-16: LLM failure is surfaced as llm_error ───────────────────────────────

#[tokio::test]
async fn brain_query_reports_llm_errors() {
    let cfg_file = make_config_db();
    let (_vec_db, vec_file) = make_vectors_db();
    let server = spawn(|_| MockResponse::json(401, "{}"));
    let env = test_env(FixedResolver::default(), 3000);
    let err = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "q",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(fake_embedding()),
    )
    .await
    .unwrap_err();
    assert!(err.starts_with("llm_error:"), "got {err}");
}

// ── TC-17: active connection resolution ───────────────────────────────────────

#[test]
fn resolve_active_requires_configuration_then_returns_conn_model_secret() {
    let cfg_file = make_config_db();
    let env = test_env(FixedResolver::default(), 1000);
    assert_eq!(resolve_active(cfg_file.path(), &env).unwrap_err(), "not_configured");

    let store = LlmStore::open(cfg_file.path()).unwrap();
    let mut c = conn_for("https://x");
    c.auth = AuthSource::ApiKey;
    c.models = vec!["a".into(), "b".into()];
    let saved = store.upsert(c).unwrap();
    env.secrets.set(&connection_account(&saved.id), "sk").unwrap();
    store.set_active(&saved.id, "b").unwrap();

    let (conn, model, secret) = resolve_active(cfg_file.path(), &env).unwrap();
    assert_eq!(conn.id, saved.id);
    assert_eq!(model, "b");
    assert_eq!(secret.as_deref(), Some("sk"));
}

// ── Extra: build_rag_messages includes chunk filenames ────────────────────────

#[test]
fn build_rag_messages_includes_context() {
    use crate::db::vectors::SearchResult;
    let results = vec![
        SearchResult { file_path: "/vault/nota-a.md".to_string(), content: "contenido de A".to_string(), distance: 0.1 },
        SearchResult { file_path: "/vault/nota-b.md".to_string(), content: "contenido de B".to_string(), distance: 0.2 },
    ];
    let messages = build_rag_messages("¿qué hay en las notas?", &results);
    assert_eq!(messages.len(), 2, "system + user");
    assert_eq!(messages[0].role, "system");
    let system = &messages[0].content;
    assert!(system.contains("nota-a.md"), "system includes file name A");
    assert!(system.contains("contenido de A"), "system includes content A");
    assert!(system.contains("nota-b.md"), "system includes file name B");
    assert_eq!(messages[1].role, "user");
    assert!(messages[1].content.contains("¿qué hay en las notas?"));
}

// ── Degradation: notes context is optional, the LLM answer is not ─────────────

#[tokio::test]
async fn brain_query_answers_without_context_when_embedding_fails() {
    let cfg_file = make_config_db();
    let (_vec_db, vec_file) = make_vectors_db();
    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "¿hola?",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Err("embed_error: model missing".to_string()),
    )
    .await
    .unwrap();

    assert_eq!(result.answer, "respuesta de prueba");
    assert!(result.sources.is_empty());
    let warning = result.warning.expect("a warning must explain the missing context");
    assert!(warning.starts_with("notes_context_unavailable:"), "got {warning}");
    assert!(warning.contains("model missing"), "got {warning}");
    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    assert_eq!(conv_db.get_messages(&result.conversation_id).unwrap().len(), 2);
}

#[tokio::test]
async fn brain_query_has_no_warning_when_context_is_available() {
    let cfg_file = make_config_db();
    let (_vec_db, vec_file) = make_vectors_db();
    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "q",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(fake_embedding()),
    )
    .await
    .unwrap();
    assert!(result.warning.is_none());
}

#[tokio::test]
async fn brain_query_degrades_when_vector_search_fails() {
    let cfg_file = make_config_db();
    let dir = tempfile::tempdir().unwrap();
    // A directory is not a valid SQLite file: opening the vector store fails.
    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        dir.path(),
        "q",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(fake_embedding()),
    )
    .await
    .unwrap();
    assert_eq!(result.answer, "respuesta de prueba");
    assert!(result.warning.unwrap().starts_with("notes_context_unavailable:"));
}

#[tokio::test]
async fn brain_query_keeps_user_message_when_llm_fails() {
    let cfg_file = make_config_db();
    let (_vec_db, vec_file) = make_vectors_db();
    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let conv_id = conv_db.create_conversation("/vault", "t").unwrap();
    let server = spawn(|_| MockResponse::json(500, "{}"));
    let env = test_env(FixedResolver::default(), 3000);
    let err = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "pregunta perdida",
        "/vault",
        Some(conv_id.clone()),
        &conn_for(&server.url),
        "m",
        None,
        &env,
        Ok(fake_embedding()),
    )
    .await
    .unwrap_err();
    assert!(err.starts_with("llm_error:"), "got {err}");
    let messages = conv_db.get_messages(&conv_id).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].content, "pregunta perdida");
}
