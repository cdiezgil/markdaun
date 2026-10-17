use super::{anthropic, ChatMessage};
use crate::llm::auth::Credential;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::http::build_client;
use crate::llm::testutil::*;
use std::time::Duration;

fn conn(base: &str) -> Connection {
    Connection {
        id: "c".into(),
        name: "A".into(),
        preset_id: None,
        engine: Engine::AnthropicMessages,
        base_url: Some(base.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::XApiKey,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["claude-sonnet-4-5".into()],
        vision_models: vec![],
    }
}

fn client(c: &Connection) -> reqwest::Client {
    build_client(c, Duration::from_millis(800)).unwrap()
}

fn msgs() -> Vec<ChatMessage> {
    vec![
        ChatMessage::text("system", "be brief"),
        ChatMessage::text("user", "hola"),
    ]
}

#[tokio::test]
async fn chat_sends_headers_system_and_joins_text_blocks() {
    let s = spawn(|_| {
        MockResponse::json(
            200,
            r#"{"content":[{"type":"text","text":"uno "},{"type":"tool_use","id":"x"},{"type":"text","text":"dos"}]}"#,
        )
    });
    let c = conn(&s.url);
    let out = anthropic::chat(&c, &Credential::Secret("sk-ant".into()), &client(&c), "claude-sonnet-4-5", &msgs())
        .await
        .unwrap();
    assert_eq!(out, "uno dos");
    let r = &s.requests()[0];
    assert_eq!(r.path, "/v1/messages");
    assert_eq!(r.header("x-api-key"), Some("sk-ant"));
    assert_eq!(r.header("anthropic-version"), Some("2023-06-01"));
    let body: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(body["model"], "claude-sonnet-4-5");
    assert_eq!(body["system"], "be brief");
    assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    assert_eq!(body["messages"][0]["role"], "user");
    assert!(body["max_tokens"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn azure_foundry_base_path_is_preserved_and_bearer_works() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"ok"}]}"#));
    let mut c = conn(&format!("{}/anthropic", s.url));
    c.auth_header = AuthHeader::Bearer;
    anthropic::chat(&c, &Credential::Secret("entra".into()), &client(&c), "m", &msgs()).await.unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.path, "/anthropic/v1/messages");
    assert_eq!(r.header("authorization"), Some("Bearer entra"));
}

#[tokio::test]
async fn chat_errors_are_typed() {
    let s = spawn(|_| MockResponse::json(401, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::Unauthorized)
    );
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::ModelNotFound)
    );
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[]}"#));
    let c = conn(&s.url);
    assert!(matches!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn list_models_parses_data_ids() {
    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"claude-opus-4-1"},{"id":"claude-haiku-4-5"}]}"#));
    let c = conn(&s.url);
    let ids = anthropic::list_models(&c, &Credential::Secret("k".into()), &client(&c)).await.unwrap();
    assert_eq!(ids, vec!["claude-opus-4-1", "claude-haiku-4-5"]);
    assert_eq!(s.requests()[0].path, "/v1/models");
    assert_eq!(s.requests()[0].header("anthropic-version"), Some("2023-06-01"));
}

#[tokio::test]
async fn list_models_404_means_unlisted() {
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert!(anthropic::list_models(&c, &Credential::None, &client(&c)).await.unwrap().is_empty());
}

fn with_attachments() -> Vec<ChatMessage> {
    use crate::llm::attachment::*;
    let img = Attachment {
        name: "a.png".into(),
        vault_path: "a.png".into(),
        kind: AttachmentKind::Image,
        parts: vec![Part::Image { media_type: "image/png".into(), data_b64: "QUJD".into() }],
        fallback: vec![],
    };
    let pdf = Attachment {
        name: "f.pdf".into(),
        vault_path: "f.pdf".into(),
        kind: AttachmentKind::Pdf,
        parts: vec![Part::Document { media_type: "application/pdf".into(), data_b64: "UERG".into() }],
        fallback: vec![Part::Text("texto".into())],
    };
    vec![
        ChatMessage::text("system", "be brief"),
        ChatMessage { attachments: vec![img, pdf], ..ChatMessage::text("user", "¿qué ves?") },
    ]
}

#[tokio::test]
async fn chat_sends_image_and_native_document_blocks() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"ok"}]}"#));
    let c = conn(&s.url);
    anthropic::chat(&c, &Credential::None, &client(&c), "m", &with_attachments()).await.unwrap();
    let body: serde_json::Value = serde_json::from_str(&s.requests()[0].body).unwrap();
    let content = body["messages"][0]["content"].as_array().unwrap();
    assert_eq!(content[0]["type"], "text");
    assert!(content[0]["text"].as_str().unwrap().contains("a.png"));
    assert_eq!(content[1]["type"], "image");
    assert_eq!(content[1]["source"]["type"], "base64");
    assert_eq!(content[1]["source"]["media_type"], "image/png");
    assert_eq!(content[1]["source"]["data"], "QUJD");
    assert_eq!(content[3]["type"], "document");
    assert_eq!(content[3]["source"]["media_type"], "application/pdf");
    assert_eq!(content[4]["text"], "¿qué ves?");
}

#[tokio::test]
async fn text_only_messages_keep_a_plain_string_content() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"ok"}]}"#));
    let c = conn(&s.url);
    anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await.unwrap();
    let body: serde_json::Value = serde_json::from_str(&s.requests()[0].body).unwrap();
    assert_eq!(body["messages"][0]["content"], "hola");
}
