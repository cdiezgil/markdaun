use super::openai;
use super::ChatMessage;
use crate::llm::auth::Credential;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::http::build_client;
use crate::llm::testutil::*;
use std::time::Duration;

fn conn(base: &str) -> Connection {
    Connection {
        id: "c".into(),
        name: "T".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(base.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["gpt-4.1".into()],
    }
}

fn msgs() -> Vec<ChatMessage> {
    vec![
        ChatMessage { role: "system".into(), content: "be brief".into() },
        ChatMessage { role: "user".into(), content: "hola".into() },
    ]
}

const CHAT_OK: &str = r#"{"choices":[{"message":{"role":"assistant","content":"respuesta"}}]}"#;

fn client(c: &Connection) -> reqwest::Client {
    build_client(c, Duration::from_millis(800)).unwrap()
}

#[tokio::test]
async fn list_models_parses_ids_and_strips_models_prefix() {
    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"gpt-4.1"},{"id":"models/gemini-2.5-pro"}]}"#));
    let c = conn(&format!("{}/v1/", s.url));
    let ids = openai::list_models(&c, &Credential::Secret("k".into()), &client(&c)).await.unwrap();
    assert_eq!(ids, vec!["gpt-4.1", "gemini-2.5-pro"]);
    let r = &s.requests()[0];
    assert_eq!(r.method, "GET");
    assert_eq!(r.path, "/v1/models");
    assert_eq!(r.header("authorization"), Some("Bearer k"));
}

#[tokio::test]
async fn list_models_404_and_405_mean_unlisted() {
    for status in [404u16, 405] {
        let s = spawn(move |_| MockResponse::json(status, "{}"));
        let c = conn(&s.url);
        let ids = openai::list_models(&c, &Credential::None, &client(&c)).await.unwrap();
        assert!(ids.is_empty());
    }
}

#[tokio::test]
async fn list_models_401_is_unauthorized_and_malformed_is_bad_response() {
    let s = spawn(|_| MockResponse::json(401, r#"{"error":"nope"}"#));
    let c = conn(&s.url);
    assert_eq!(
        openai::list_models(&c, &Credential::None, &client(&c)).await,
        Err(LlmError::Unauthorized)
    );
    let s = spawn(|_| MockResponse::json(200, "not json"));
    let c = conn(&s.url);
    assert!(matches!(
        openai::list_models(&c, &Credential::None, &client(&c)).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_posts_expected_body_and_parses_content() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let c = conn(&format!("{}/v1", s.url));
    let out = openai::chat(&c, &Credential::Secret("k".into()), &client(&c), "gpt-4.1", &msgs())
        .await
        .unwrap();
    assert_eq!(out, "respuesta");
    let r = &s.requests()[0];
    assert_eq!(r.method, "POST");
    assert_eq!(r.path, "/v1/chat/completions");
    let body: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(body["model"], "gpt-4.1");
    assert_eq!(body["stream"], false);
    assert_eq!(body["messages"][1]["content"], "hola");
}

#[tokio::test]
async fn chat_maps_404_to_model_not_found_and_5xx_to_bad_response() {
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::ModelNotFound)
    );
    let s = spawn(|_| MockResponse::json(500, "boom"));
    let c = conn(&s.url);
    assert!(matches!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_without_choices_is_bad_response() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[]}"#));
    let c = conn(&s.url);
    assert!(matches!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_accepts_content_parts_array() {
    let s = spawn(|_| {
        MockResponse::json(200, r#"{"choices":[{"message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}]}"#)
    });
    let c = conn(&s.url);
    assert_eq!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await.unwrap(),
        "ab"
    );
}

#[tokio::test]
async fn azure_variant_uses_deployment_path_and_api_version() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let mut c = conn(&s.url);
    c.azure_api_version = Some("2024-10-21".into());
    c.auth_header = AuthHeader::ApiKey;
    openai::chat(&c, &Credential::Secret("az-key".into()), &client(&c), "my-gpt", &msgs())
        .await
        .unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.path, "/openai/deployments/my-gpt/chat/completions?api-version=2024-10-21");
    assert_eq!(r.header("api-key"), Some("az-key"));

    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"gpt-4.1"}]}"#));
    let mut c = conn(&s.url);
    c.azure_api_version = Some("2024-10-21".into());
    openai::list_models(&c, &Credential::None, &client(&c)).await.unwrap();
    assert_eq!(s.requests()[0].path, "/openai/models?api-version=2024-10-21");
}

#[tokio::test]
async fn custom_extra_header_reaches_the_server() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let mut c = conn(&s.url);
    c.extra_headers = vec![("X-Proxy-Team".into(), "md".into())];
    openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await.unwrap();
    assert_eq!(s.requests()[0].header("x-proxy-team"), Some("md"));
}

#[tokio::test]
async fn chat_timeout_is_typed() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK).delayed(1500));
    let c = conn(&s.url);
    let fast = build_client(&c, Duration::from_millis(150)).unwrap();
    assert_eq!(
        openai::chat(&c, &Credential::None, &fast, "m", &msgs()).await,
        Err(LlmError::Timeout)
    );
}
