use super::connection::*;
use super::error::LlmError;

fn sample() -> Connection {
    Connection {
        id: "abc".into(),
        name: "Office".into(),
        preset_id: Some("azure-openai".into()),
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x.openai.azure.com".into()),
        auth: AuthSource::AzureCli { scope: DEFAULT_AZURE_SCOPE.into() },
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![("X-Team".into(), "md".into())],
        ca_cert_path: None,
        azure_api_version: Some("2024-10-21".into()),
        models: vec!["gpt-4.1".into()],
    }
}

#[test]
fn serializes_camel_case_with_tagged_auth() {
    let v = serde_json::to_value(sample()).unwrap();
    assert_eq!(v["engine"], "openAiCompat");
    assert_eq!(v["authHeader"], "bearer");
    assert_eq!(v["baseUrl"], "https://x.openai.azure.com");
    assert_eq!(v["auth"]["type"], "azureCli");
    assert_eq!(v["auth"]["scope"], DEFAULT_AZURE_SCOPE);
    assert_eq!(v["extraHeaders"][0][0], "X-Team");
    assert_eq!(v["azureApiVersion"], "2024-10-21");
}

#[test]
fn roundtrips() {
    let c = sample();
    let back: Connection = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
    assert_eq!(back, c);
}

#[test]
fn deserializes_minimal_draft_with_defaults() {
    let json = r#"{"id":"","name":"Home","engine":"cliClaude","auth":{"type":"none"},"authHeader":"bearer"}"#;
    let c: Connection = serde_json::from_str(json).unwrap();
    assert!(c.extra_headers.is_empty());
    assert!(c.models.is_empty());
    assert_eq!(c.base_url, None);
    assert!(c.engine.is_cli());
}

#[test]
fn validate_shape_accepts_valid_api_and_cli() {
    assert!(sample().validate_shape().is_ok());
    let mut cli = sample();
    cli.engine = Engine::CliGemini;
    cli.base_url = None;
    assert!(cli.validate_shape().is_ok());
}

#[test]
fn validate_shape_rejects_bad_drafts() {
    let mut c = sample();
    c.name = "  ".into();
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));

    let mut c = sample();
    c.base_url = None;
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));

    let mut c = sample();
    c.base_url = Some("ftp://x".into());
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));
}
