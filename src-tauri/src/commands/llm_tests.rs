use super::llm_cmd::*;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::proc::FixedResolver;
use crate::llm::secrets::connection_account;
use crate::llm::store::LlmStore;
use crate::llm::testutil::*;
use crate::llm::validate::ValidationStore;
use tempfile::NamedTempFile;

const MODELS_OK: &str = r#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4o"}]}"#;
const CHAT_OK: &str = r#"{"choices":[{"message":{"content":"ok"}}]}"#;

fn ok_server() -> MockServer {
    spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    })
}

fn draft(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "Office".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["gpt-4.1".into()],
        vision_models: vec![],
    }
}

fn setup() -> (NamedTempFile, crate::llm::env::LlmEnv, ValidationStore) {
    (NamedTempFile::new().unwrap(), test_env(FixedResolver::default(), 2000), ValidationStore::default())
}

fn silent(_: crate::llm::validate::ProgressEvent) {}

#[tokio::test]
async fn validate_persists_nothing() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let r = validate_inner(&env, &vs, &draft(&s.url), Some("sk".into()), &silent).await.unwrap();
    assert!(!r.token.is_empty());
    assert_eq!(r.available, vec!["gpt-4.1", "gpt-4o"]);
    assert!(LlmStore::open(db.path()).unwrap().list().unwrap().is_empty());
    assert_eq!(env.secrets.get("llm-connection:").unwrap(), None);
}

#[tokio::test]
async fn save_requires_a_valid_matching_token() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    // no token at all
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("sk".into()), "bogus").unwrap_err(), LlmError::NotValidated);

    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    // secret changed after validation
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("other".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    // endpoint changed after validation
    let mut moved = d.clone();
    moved.base_url = Some("https://evil.example".into());
    assert_eq!(save_inner(db.path(), &env, &vs, moved, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    // unverified model selected
    let mut other_model = d.clone();
    other_model.models = vec!["never-tested".into()];
    assert_eq!(save_inner(db.path(), &env, &vs, other_model, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    assert!(LlmStore::open(db.path()).unwrap().list().unwrap().is_empty());
}

#[tokio::test]
async fn save_writes_connection_secret_and_first_active() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    d.models = vec!["gpt-4.1".into(), "gpt-4o".into()];
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    assert_eq!(saved.id.len(), 36);
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap().as_deref(), Some("sk"));
    let active = get_active_inner(db.path()).unwrap().unwrap();
    assert_eq!(active.connection_id, saved.id);
    assert_eq!(active.model, "gpt-4.1");
    // the token is single use
    assert_eq!(
        save_inner(db.path(), &env, &vs, draft(&s.url), Some("sk".into()), &r.token).unwrap_err(),
        LlmError::NotValidated
    );
}

#[tokio::test]
async fn second_connection_does_not_steal_the_active_selection() {
    let s = ok_server();
    let (db, env, vs) = setup();
    for name in ["One", "Two"] {
        let mut d = draft(&s.url);
        d.name = name.into();
        let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
        save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();
    }
    let list = list_inner(db.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(get_active_inner(db.path()).unwrap().unwrap().connection_id, list[0].id);
}

#[tokio::test]
async fn editing_with_a_blank_secret_reuses_the_keyring_value() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk-original".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk-original".into()), &r.token).unwrap();

    let mut edit = saved.clone();
    edit.name = "Renamed".into();
    let r2 = validate_inner(&env, &vs, &edit, None, &silent).await.unwrap();
    // validation used the stored key
    assert_eq!(s.requests().last().unwrap().header("authorization"), Some("Bearer sk-original"));
    let saved2 = save_inner(db.path(), &env, &vs, edit, None, &r2.token).unwrap();
    assert_eq!(saved2.id, saved.id);
    assert_eq!(saved2.name, "Renamed");
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap().as_deref(), Some("sk-original"));
    assert_eq!(list_inner(db.path()).unwrap().len(), 1);
}

#[tokio::test]
async fn switching_auth_away_from_api_key_deletes_the_secret() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    let mut edit = saved.clone();
    edit.auth = AuthSource::None;
    let r2 = validate_inner(&env, &vs, &edit, None, &silent).await.unwrap();
    save_inner(db.path(), &env, &vs, edit, None, &r2.token).unwrap();
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap(), None);
}

#[tokio::test]
async fn api_key_connection_without_any_secret_cannot_be_saved() {
    let (db, env, vs) = setup();
    let token = vs.issue(0, vec!["gpt-4.1".to_string()]);
    assert_eq!(
        save_inner(db.path(), &env, &vs, draft("https://x"), None, &token).unwrap_err(),
        LlmError::Unauthorized
    );
}

#[tokio::test]
async fn verify_model_extends_the_token_so_unlisted_models_can_be_saved() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    d.models = vec!["gpt-4.1".into(), "gpt-4o".into()];
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    assert_eq!(r.verified, vec!["gpt-4.1"]);
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);

    verify_model_inner(&env, &vs, &d, Some("sk".into()), &r.token, "gpt-4o").await.unwrap();
    save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();
}

#[tokio::test]
async fn verify_model_failure_does_not_extend_the_token() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else if r.body.contains("bad-model") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    assert_eq!(
        verify_model_inner(&env, &vs, &d, Some("sk".into()), &r.token, "bad-model").await.unwrap_err(),
        LlmError::ModelNotFound
    );
    d.models = vec!["gpt-4.1".into(), "bad-model".into()];
    assert_eq!(save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
}

#[tokio::test]
async fn delete_removes_row_secret_and_active() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    delete_inner(db.path(), &env, &saved.id).unwrap();
    assert!(list_inner(db.path()).unwrap().is_empty());
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap(), None);
    assert_eq!(get_active_inner(db.path()).unwrap(), None);
}

#[test]
fn set_active_validates_connection_and_model() {
    let (db, _env, _vs) = setup();
    let store = LlmStore::open(db.path()).unwrap();
    let mut c = draft("https://x");
    c.models = vec!["a".into(), "b".into()];
    let saved = store.upsert(c).unwrap();
    assert!(set_active_inner(db.path(), &saved.id, "zzz").is_err());
    let sel = set_active_inner(db.path(), &saved.id, "b").unwrap();
    assert_eq!(sel.model, "b");
}

#[test]
fn detect_cli_reports_installed_state() {
    let env = test_env(FixedResolver::default().with("claude", "/opt/bin/claude"), 1000);
    let found = detect_cli_inner(&env, Engine::CliClaude);
    assert!(found.installed);
    assert_eq!(found.path.as_deref(), Some("/opt/bin/claude"));
    let missing = detect_cli_inner(&env, Engine::CliGemini);
    assert!(!missing.installed && missing.path.is_none());
}
