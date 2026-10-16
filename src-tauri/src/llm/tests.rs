use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

// ── Mock HTTP server helper ───────────────────────────────────────────────────

/// Starts a single-request mock HTTP server on a random port.
/// Returns (url, join_handle_that_yields_raw_request_bytes).
fn start_mock_llm_server(response_json: &'static str) -> (String, thread::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");

    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        // Read the full HTTP request into a buffer.
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        buf.truncate(n);

        // Write HTTP response.
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            response_json.len(),
            response_json
        );
        let _ = stream.write_all(response.as_bytes());
        buf
    });

    (url, handle)
}

/// Minimal mock JSON for the OpenAI chat completions format.
const MOCK_RESPONSE: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"respuesta mock"}}]}"#;

// ── TC-03b: chunk_text splits on paragraphs ───────────────────────────────────

/// TC-03b: chunk_text divides content by paragraphs and respects chunk_size.
#[test]
fn chunk_text_splits_on_paragraphs() {
    let para_a = "a".repeat(800);
    let para_b = "b".repeat(800);
    let content = format!("{para_a}\n\n{para_b}");

    let chunks = embeddings::chunk_text(&content, 1500, 200);
    // Each chunk must be within a reasonable bound.
    assert!(!chunks.is_empty(), "Must produce at least one chunk");
    for chunk in &chunks {
        assert!(
            chunk.chars().count() <= 1700,
            "Chunk too large: {} chars",
            chunk.len()
        );
    }
    // Both paragraphs must be present somewhere.
    let all = chunks.join(" ");
    assert!(all.contains('a'), "Should contain para_a content");
    assert!(all.contains('b'), "Should contain para_b content");
}

// ── TC-01/02: model loading (ignored in CI, require download) ────────────────

/// TC-01: embed_text returns a vector of 384 dimensions.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_returns_384_dims() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let emb = embeddings::embed_text(&model, "hello world").unwrap();
    assert_eq!(emb.len(), 384, "AllMiniLML6V2 produces 384-dim vectors");
}

/// TC-02: embed_text is deterministic for the same input.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_is_deterministic() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let a = embeddings::embed_text(&model, "mismo texto").unwrap();
    let b = embeddings::embed_text(&model, "mismo texto").unwrap();
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(b.iter()) {
        assert!(
            (x - y).abs() < 1e-6,
            "Embeddings should be deterministic, got diff at some dim"
        );
    }
}

// ── TC-10: chat_completion sends correct body ─────────────────────────────────

/// TC-10: POST body contains model, messages, and stream:false.
#[tokio::test]
async fn chat_completion_sends_correct_body() {
    let (url, handle) = start_mock_llm_server(MOCK_RESPONSE);

    let config = client::LlmConfig {
        endpoint_url: url,
        api_key: None,
        model: "gpt-4o-mini".to_string(),
    };
    let messages = vec![client::ChatMessage {
        role: "user".to_string(),
        content: "hola mundo".to_string(),
    }];

    let result = client::chat_completion(&config, messages).await.unwrap();
    assert_eq!(result, "respuesta mock");

    let raw = handle.join().unwrap();
    let req_str = String::from_utf8_lossy(&raw);
    assert!(
        req_str.contains("gpt-4o-mini"),
        "Body must contain model name"
    );
    assert!(
        req_str.contains("\"stream\":false"),
        "Body must contain stream:false"
    );
    assert!(
        req_str.contains("hola mundo"),
        "Body must contain message content"
    );
}

// ── TC-11: chat_completion includes auth header when api_key is Some ──────────

/// TC-11: Authorization header is present when api_key is Some.
#[tokio::test]
async fn chat_completion_includes_auth_header() {
    let (url, handle) = start_mock_llm_server(MOCK_RESPONSE);

    let config = client::LlmConfig {
        endpoint_url: url,
        api_key: Some("sk-test-key-123".to_string()),
        model: "gpt-4o".to_string(),
    };
    let messages = vec![client::ChatMessage {
        role: "user".to_string(),
        content: "test".to_string(),
    }];

    client::chat_completion(&config, messages).await.unwrap();

    let raw = handle.join().unwrap();
    let req_str = String::from_utf8_lossy(&raw);
    assert!(
        req_str.to_lowercase().contains("authorization: bearer sk-test-key-123"),
        "Request must include Authorization header. Got:\n{req_str}"
    );
}

// ── TC-12: chat_completion omits auth header when api_key is None ─────────────

/// TC-12: No Authorization header when api_key is None.
#[tokio::test]
async fn chat_completion_omits_auth_header_when_none() {
    let (url, handle) = start_mock_llm_server(MOCK_RESPONSE);

    let config = client::LlmConfig {
        endpoint_url: url,
        api_key: None,
        model: "llama3".to_string(),
    };
    let messages = vec![client::ChatMessage {
        role: "user".to_string(),
        content: "test".to_string(),
    }];

    client::chat_completion(&config, messages).await.unwrap();

    let raw = handle.join().unwrap();
    let req_str = String::from_utf8_lossy(&raw);
    assert!(
        !req_str.to_ascii_lowercase().contains("authorization"),
        "Request must NOT include Authorization header when api_key is None"
    );
}
