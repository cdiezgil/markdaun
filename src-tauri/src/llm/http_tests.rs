use super::auth::Credential;
use super::connection::*;
use super::error::LlmError;
use super::http::*;
use super::testutil::*;
use std::time::Duration;

fn conn(url: &str, header: AuthHeader) -> Connection {
    Connection {
        id: "c1".into(),
        name: "T".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::ApiKey,
        auth_header: header,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["m".into()],
        vision_models: vec![],
    }
}

async fn get(c: &Connection, cred: &Credential, url: &str, timeout_ms: u64) -> Result<u16, LlmError> {
    let client = build_client(c, Duration::from_millis(timeout_ms))?;
    let req = apply_auth(client.get(url), c, cred);
    match req.send().await {
        Ok(r) => Ok(r.status().as_u16()),
        Err(e) => Err(classify_send_error(&e)),
    }
}

#[tokio::test]
async fn bearer_header_is_sent() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let c = conn(&s.url, AuthHeader::Bearer);
    get(&c, &Credential::Secret("k1".into()), &format!("{}/x", s.url), 2000).await.unwrap();
    assert_eq!(s.requests()[0].header("authorization"), Some("Bearer k1"));
}

#[tokio::test]
async fn api_key_and_x_api_key_headers() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let c = conn(&s.url, AuthHeader::ApiKey);
    get(&c, &Credential::Secret("k2".into()), &s.url, 2000).await.unwrap();
    let c = conn(&s.url, AuthHeader::XApiKey);
    get(&c, &Credential::Secret("k3".into()), &s.url, 2000).await.unwrap();
    let reqs = s.requests();
    assert_eq!(reqs[0].header("api-key"), Some("k2"));
    assert_eq!(reqs[0].header("authorization"), None);
    assert_eq!(reqs[1].header("x-api-key"), Some("k3"));
}

#[tokio::test]
async fn extra_headers_are_sent_and_no_auth_without_credential() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let mut c = conn(&s.url, AuthHeader::Bearer);
    c.extra_headers = vec![("X-Team".into(), "md".into()), ("X-Env".into(), "prod".into())];
    get(&c, &Credential::None, &s.url, 2000).await.unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.header("x-team"), Some("md"));
    assert_eq!(r.header("x-env"), Some("prod"));
    assert_eq!(r.header("authorization"), None);
}

#[tokio::test]
async fn closed_port_is_unreachable() {
    let url = closed_port_url();
    let c = conn(&url, AuthHeader::Bearer);
    assert_eq!(get(&c, &Credential::None, &url, 2000).await, Err(LlmError::Unreachable));
}

#[tokio::test]
async fn slow_server_times_out() {
    let s = spawn(|_| MockResponse::json(200, "{}").delayed(1500));
    let c = conn(&s.url, AuthHeader::Bearer);
    assert_eq!(get(&c, &Credential::None, &s.url, 200).await, Err(LlmError::Timeout));
}

#[test]
fn status_classification() {
    assert_eq!(classify_status(401, ""), LlmError::Unauthorized);
    assert_eq!(classify_status(403, ""), LlmError::Unauthorized);
    assert_eq!(classify_status(404, ""), LlmError::ModelNotFound);
    assert_eq!(classify_status(408, ""), LlmError::Timeout);
    assert_eq!(classify_status(504, ""), LlmError::Timeout);
    match classify_status(500, "oops") {
        LlmError::BadResponse(m) => assert!(m.contains("500") && m.contains("oops")),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn unreadable_ca_file_is_reported() {
    let mut c = conn("https://x", AuthHeader::Bearer);
    c.ca_cert_path = Some("/definitely/not/here.pem".into());
    assert!(matches!(build_client(&c, Duration::from_secs(1)), Err(LlmError::BadResponse(_))));
}
