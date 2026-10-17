use super::connection::*;
use super::env::LlmEnv;
use super::proc::FixedResolver;
use super::secrets::connection_account;
use super::testutil::test_env;

fn conn(id: &str) -> Connection {
    Connection {
        id: id.into(),
        name: "n".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x".into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec![],
    }
}

#[test]
fn secret_for_reads_the_connection_account() {
    let env = test_env(FixedResolver::default(), 1000);
    assert_eq!(env.secret_for(&conn("abc")).unwrap(), None);
    env.secrets.set(&connection_account("abc"), "k").unwrap();
    assert_eq!(env.secret_for(&conn("abc")).unwrap().as_deref(), Some("k"));
    assert_eq!(env.secret_for(&conn("")).unwrap(), None);
}

#[test]
fn production_env_builds() {
    let env = LlmEnv::production();
    assert_eq!(env.timeout.as_secs(), 120);
}
