use super::brain_cmd::{brain_query_with_embedding, build_rag_messages, configure_inner, get_config_inner};
use crate::db::{ConversationsDb, VectorsDb};
use crate::llm::client::LlmConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use tempfile::NamedTempFile;

// ── Mock HTTP server ──────────────────────────────────────────────────────────

const MOCK_LLM_RESPONSE: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"respuesta de prueba"}}]}"#;

fn start_mock_llm(response: &'static str) -> (String, thread::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        buf.truncate(n);
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            response.len(),
            response
        );
        let _ = stream.write_all(resp.as_bytes());
        buf
    });
    (url, handle)
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

// ── TC-13: brain_query_with_embedding builds prompt with context ───────────────

/// TC-13: prompt sent to LLM includes chunk content from vectors.db.
#[tokio::test]
async fn brain_query_builds_prompt_with_context() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();

    let emb = fake_embedding();
    vec_db
        .upsert_file_chunks(
            "/vault",
            "/vault/nota.md",
            &[(0, "contenido importante de la nota", emb.as_slice())],
        )
        .unwrap();

    let (url, llm_handle) = start_mock_llm(MOCK_LLM_RESPONSE);
    let llm_config = LlmConfig {
        endpoint_url: url,
        api_key: None,
        model: "test-model".to_string(),
    };

    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "¿qué dice la nota?",
        "/vault",
        None,
        &llm_config,
        &emb,
    )
    .await
    .unwrap();

    let raw = llm_handle.join().unwrap();
    let req_str = String::from_utf8_lossy(&raw);

    assert_eq!(result.answer, "respuesta de prueba", "TC-13: answer extracted");
    assert!(
        req_str.contains("contenido importante de la nota"),
        "TC-13: prompt must include chunk content. Request:\n{req_str}"
    );
}

// ── TC-14: creates new conversation when conversation_id is None ───────────────

/// TC-14: brain_query_with_embedding creates a new conversation.
#[tokio::test]
async fn brain_query_creates_conversation_when_none() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db
        .upsert_file_chunks("/vault", "/vault/a.md", &[(0, "algo", emb.as_slice())])
        .unwrap();

    let (url, _handle) = start_mock_llm(MOCK_LLM_RESPONSE);
    let llm_config = LlmConfig {
        endpoint_url: url,
        api_key: None,
        model: "m".to_string(),
    };

    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "primera pregunta",
        "/vault",
        None, // ← no conversation yet
        &llm_config,
        &emb,
    )
    .await
    .unwrap();

    assert!(!result.conversation_id.is_empty(), "TC-14: conversation_id assigned");

    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let list = conv_db.list_conversations("/vault").unwrap();
    assert_eq!(list.len(), 1, "TC-14: one conversation created");
    assert_eq!(list[0].id, result.conversation_id);
}

// ── TC-15: continues existing conversation ────────────────────────────────────

/// TC-15: brain_query_with_embedding appends to an existing conversation.
#[tokio::test]
async fn brain_query_continues_existing_conversation() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db
        .upsert_file_chunks("/vault", "/vault/b.md", &[(0, "texto", emb.as_slice())])
        .unwrap();

    // Pre-create a conversation.
    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let existing_id = conv_db
        .create_conversation("/vault", "charla anterior")
        .unwrap();

    let (url, _handle) = start_mock_llm(MOCK_LLM_RESPONSE);
    let llm_config = LlmConfig {
        endpoint_url: url,
        api_key: None,
        model: "m".to_string(),
    };

    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "segunda pregunta",
        "/vault",
        Some(existing_id.clone()), // ← continue
        &llm_config,
        &emb,
    )
    .await
    .unwrap();

    assert_eq!(
        result.conversation_id, existing_id,
        "TC-15: same conversation_id returned"
    );

    let messages = conv_db.get_messages(&existing_id).unwrap();
    assert_eq!(messages.len(), 2, "TC-15: user + assistant messages added");
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");
}

// ── TC-16: API key in keyring, NOT in DB ─────────────────────────────────────

/// TC-16: configure_inner only stores endpoint_url + model, NEVER the API key.
#[test]
fn brain_configure_stores_key_in_keyring() {
    let cfg_file = make_config_db();

    // configure_inner does NOT receive or store the API key.
    configure_inner(
        cfg_file.path(),
        "https://api.openai.com/v1/chat/completions",
        "gpt-4o-mini",
    )
    .unwrap();

    // Verify DB has endpoint + model but NOT the api_key.
    let db = crate::db::ConfigDb::open(cfg_file.path()).unwrap();
    assert!(
        db.get("llm_endpoint_url").unwrap().is_some(),
        "TC-16: endpoint_url stored in DB"
    );
    assert!(
        db.get("llm_model").unwrap().is_some(),
        "TC-16: model stored in DB"
    );
    assert_eq!(
        db.get("llm_api_key").unwrap(),
        None,
        "TC-16: API key must NOT be in DB"
    );
}

// ── TC-17: brain_get_config does not return API key ───────────────────────────

/// TC-17: get_config_inner returns endpoint_url + model, never the API key.
#[test]
fn brain_get_config_does_not_return_api_key() {
    let cfg_file = make_config_db();
    configure_inner(
        cfg_file.path(),
        "https://api.example.com/v1/chat/completions",
        "mistral-7b",
    )
    .unwrap();

    let config = get_config_inner(cfg_file.path()).unwrap();
    assert!(
        config.endpoint_url.is_some(),
        "TC-17: endpoint_url present"
    );
    assert!(config.model.is_some(), "TC-17: model present");
    // BrainConfig has no `api_key` field — verified by type system.
    // Serialize and check no "api_key" key leaks.
    let json = serde_json::to_string(&config).unwrap();
    assert!(
        !json.contains("api_key"),
        "TC-17: api_key must not appear in serialized config"
    );
}

// ── Extra: build_rag_messages includes chunk filenames ────────────────────────

#[test]
fn build_rag_messages_includes_context() {
    use crate::db::vectors::SearchResult;
    let results = vec![
        SearchResult {
            file_path: "/vault/nota-a.md".to_string(),
            content: "contenido de A".to_string(),
            distance: 0.1,
        },
        SearchResult {
            file_path: "/vault/nota-b.md".to_string(),
            content: "contenido de B".to_string(),
            distance: 0.2,
        },
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
