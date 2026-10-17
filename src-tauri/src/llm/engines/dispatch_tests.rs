use super::{chat, list_models, ChatMessage};
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::proc::FixedResolver;
use crate::llm::testutil::*;

fn conn(engine: Engine, url: &str, auth: AuthSource, header: AuthHeader) -> Connection {
    Connection {
        id: "c".into(),
        name: "n".into(),
        preset_id: None,
        engine,
        base_url: Some(url.into()),
        auth,
        auth_header: header,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["m".into()],
        vision_models: vec![],
    }
}

fn user(text: &str) -> Vec<ChatMessage> {
    vec![ChatMessage::text("user", text)]
}

#[tokio::test]
async fn openai_engine_with_api_key() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") {
            MockResponse::json(200, r#"{"data":[{"id":"a"}]}"#)
        } else {
            MockResponse::json(200, r#"{"choices":[{"message":{"content":"yo"}}]}"#)
        }
    });
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::OpenAiCompat, &s.url, AuthSource::ApiKey, AuthHeader::Bearer);
    assert_eq!(list_models(&c, Some("k"), &env).await.unwrap(), vec!["a"]);
    assert_eq!(chat(&c, "m", &user("hi"), Some("k"), &env).await.unwrap(), "yo");
    assert_eq!(s.requests()[1].header("authorization"), Some("Bearer k"));
}

#[tokio::test]
async fn missing_api_key_fails_before_any_network_call() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::OpenAiCompat, &s.url, AuthSource::ApiKey, AuthHeader::Bearer);
    assert_eq!(list_models(&c, None, &env).await.unwrap_err(), LlmError::Unauthorized);
    assert!(s.requests().is_empty());
}

#[tokio::test]
async fn anthropic_engine_dispatches_to_messages() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"claude says hi"}]}"#));
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::AnthropicMessages, &s.url, AuthSource::ApiKey, AuthHeader::XApiKey);
    assert_eq!(chat(&c, "m", &user("hi"), Some("k"), &env).await.unwrap(), "claude says hi");
    assert_eq!(s.requests()[0].path, "/v1/messages");
}

#[cfg(unix)]
#[tokio::test]
async fn azure_cli_auth_puts_the_az_token_in_the_bearer_header() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[{"message":{"content":"ok"}}]}"#));
    let dir = tempfile::tempdir().unwrap();
    let az = write_script(dir.path(), "az", "printf '{\"accessToken\":\"entra-token\",\"expires_on\":99999}'");
    let env = test_env(FixedResolver::default().with("az", az), 5000);
    let c = conn(
        Engine::OpenAiCompat,
        &s.url,
        AuthSource::AzureCli { scope: "https://cognitiveservices.azure.com/.default".into() },
        AuthHeader::Bearer,
    );
    assert_eq!(chat(&c, "m", &user("hi"), None, &env).await.unwrap(), "ok");
    assert_eq!(s.requests()[0].header("authorization"), Some("Bearer entra-token"));
}

#[tokio::test]
async fn azure_cli_auth_without_az_is_cli_missing() {
    let env = test_env(FixedResolver::default(), 1000);
    let c = conn(
        Engine::OpenAiCompat,
        "http://127.0.0.1:1",
        AuthSource::AzureCli { scope: "https://cognitiveservices.azure.com/.default".into() },
        AuthHeader::Bearer,
    );
    assert_eq!(chat(&c, "m", &user("hi"), None, &env).await.unwrap_err(), LlmError::CliMissing);
}

#[cfg(unix)]
#[tokio::test]
async fn cli_engine_lists_fixed_models_and_chats() {
    let dir = tempfile::tempdir().unwrap();
    let claude = write_script(dir.path(), "claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"cli says hi\"}'");
    let env = test_env(FixedResolver::default().with("claude", claude), 5000);
    let mut c = conn(Engine::CliClaude, "", AuthSource::None, AuthHeader::Bearer);
    c.base_url = None;
    assert_eq!(list_models(&c, None, &env).await.unwrap(), vec!["opus", "sonnet", "haiku"]);
    assert_eq!(chat(&c, "opus", &user("hi"), None, &env).await.unwrap(), "cli says hi");
}

#[tokio::test]
async fn cli_engine_without_binary_is_cli_missing() {
    let env = test_env(FixedResolver::default(), 1000);
    let mut c = conn(Engine::CliGemini, "", AuthSource::None, AuthHeader::Bearer);
    c.base_url = None;
    assert_eq!(list_models(&c, None, &env).await.unwrap_err(), LlmError::CliMissing);
}

fn image_message() -> Vec<ChatMessage> {
    use crate::llm::attachment::*;
    let a = Attachment {
        name: "a.png".into(),
        vault_path: "a.png".into(),
        kind: AttachmentKind::Image,
        parts: vec![Part::Image { media_type: "image/png".into(), data_b64: "QUJD".into() }],
        fallback: vec![],
    };
    vec![ChatMessage { attachments: vec![a], ..ChatMessage::text("user", "mira") }]
}

#[tokio::test]
async fn attachments_with_a_non_vision_model_are_rejected_before_any_call() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[{"message":{"content":"yo"}}]}"#));
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::OpenAiCompat, &s.url, AuthSource::None, AuthHeader::Bearer);
    assert_eq!(
        chat(&c, "m", &image_message(), None, &env).await.unwrap_err(),
        LlmError::VisionUnsupported
    );
    assert!(s.requests().is_empty());
}

#[tokio::test]
async fn attachments_with_a_vision_model_go_through() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[{"message":{"content":"yo"}}]}"#));
    let env = test_env(FixedResolver::default(), 2000);
    let mut c = conn(Engine::OpenAiCompat, &s.url, AuthSource::None, AuthHeader::Bearer);
    c.vision_models = vec!["m".into()];
    assert_eq!(chat(&c, "m", &image_message(), None, &env).await.unwrap(), "yo");
    assert!(s.requests()[0].body.contains("data:image/png;base64,QUJD"));
}
