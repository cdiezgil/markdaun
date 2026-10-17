use super::auth::Credential;
use super::connection::*;
use super::engines::openai;
use super::error::LlmError;
use super::http::build_client;
use super::testutil::*;
use std::time::Duration;

fn conn(url: &str, ca: Option<String>) -> Connection {
    Connection {
        id: "t".into(),
        name: "TLS".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::None,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: ca,
        azure_api_version: None,
        models: vec!["m".into()],
        vision_models: vec![],
    }
}

const MODELS: &str = r#"{"data":[{"id":"gpt-4.1"}]}"#;

#[tokio::test]
async fn self_signed_server_fails_with_tls_untrusted_without_ca() {
    let (server, _pem) = spawn_tls(|_| MockResponse::json(200, MODELS));
    let c = conn(&server.url, None);
    let client = build_client(&c, Duration::from_secs(3)).unwrap();
    assert_eq!(
        openai::list_models(&c, &Credential::None, &client).await,
        Err(LlmError::TlsUntrusted)
    );
}

#[tokio::test]
async fn self_signed_server_succeeds_with_ca_cert_path() {
    let (server, pem) = spawn_tls(|_| MockResponse::json(200, MODELS));
    let dir = tempfile::tempdir().unwrap();
    let ca = dir.path().join("ca.pem");
    std::fs::write(&ca, pem).unwrap();
    let c = conn(&server.url, Some(ca.to_string_lossy().to_string()));
    let client = build_client(&c, Duration::from_secs(3)).unwrap();
    let ids = openai::list_models(&c, &Credential::None, &client).await.unwrap();
    assert_eq!(ids, vec!["gpt-4.1"]);
}
