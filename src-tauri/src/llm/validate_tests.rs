use super::connection::*;
use super::error::LlmError;
use super::proc::FixedResolver;
use super::testutil::*;
use super::validate::*;
use std::sync::{Arc, Mutex};

const MODELS_OK: &str = r#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4o"}]}"#;
const CHAT_OK: &str = r#"{"choices":[{"message":{"content":"ok"}}]}"#;

fn conn(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "T".into(),
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

type Events = Arc<Mutex<Vec<ProgressEvent>>>;

async fn run_with(c: &Connection, secret: Option<&str>, env: &crate::llm::env::LlmEnv) -> (Result<Validated, LlmError>, Vec<(Step, StepStatus)>, Events) {
    let events: Events = Arc::new(Mutex::new(vec![]));
    let sink = events.clone();
    let emit = move |e: ProgressEvent| sink.lock().unwrap().push(e);
    let r = run(c, secret, env, &emit).await;
    let seq = events.lock().unwrap().iter().map(|e| (e.step, e.status)).collect();
    (r, seq, events)
}

fn env() -> crate::llm::env::LlmEnv {
    test_env(FixedResolver::default(), 1500)
}

#[tokio::test]
async fn happy_path_emits_all_steps_in_order() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert_eq!(v.available, vec!["gpt-4.1", "gpt-4o"]);
    assert_eq!(v.verified, vec!["gpt-4.1", "gpt-4o"]);
    use Step::*;
    use StepStatus::*;
    assert_eq!(
        seq,
        vec![
            (Reach, Running), (Reach, Ok),
            (Credential, Running), (Credential, Ok),
            (Models, Running), (Models, Ok),
            (Completion, Running), (Completion, Ok),
        ]
    );
}

#[tokio::test]
async fn unreachable_stops_at_reach() {
    let (r, seq, events) = run_with(&conn(&closed_port_url()), Some("k"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unreachable);
    assert_eq!(seq.last().unwrap(), &(Step::Reach, StepStatus::Failed));
    assert_eq!(seq.len(), 2);
    assert_eq!(events.lock().unwrap().last().unwrap().error, Some(LlmError::Unreachable));
}

#[tokio::test]
async fn missing_api_key_fails_credential_without_network() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let (r, seq, _) = run_with(&conn(&s.url), None, &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
    assert!(s.requests().is_empty());
}

#[tokio::test]
async fn unauthorized_everywhere_fails_credential() {
    let s = spawn(|_| MockResponse::json(401, "{}"));
    let (r, seq, _) = run_with(&conn(&s.url), Some("bad"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
}

#[tokio::test]
async fn models_endpoint_rejecting_key_but_chat_working_still_validates() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(403, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert!(v.available.is_empty());
    assert_eq!(v.verified, vec!["gpt-4.1"]);
    assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Ok));
    // chat was only attempted once (the credential probe is reused)
    assert_eq!(s.requests().iter().filter(|r| r.method == "POST").count(), 1);
}

#[tokio::test]
async fn unlisted_models_are_reported_and_only_the_tested_one_is_verified() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, _, events) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert!(v.available.is_empty());
    assert_eq!(v.verified, vec!["gpt-4.1"]);
    let models_ok = events.lock().unwrap().iter().find(|e| e.step == Step::Models && e.status == StepStatus::Ok).cloned().unwrap();
    assert_eq!(models_ok.detail.as_deref(), Some("unlisted"));
}

#[tokio::test]
async fn unknown_model_fails_at_completion() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(404, "{}") }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::ModelNotFound);
    assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Failed));
}

#[tokio::test]
async fn draft_without_models_is_rejected_up_front() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let mut c = conn(&s.url);
    c.models.clear();
    let (r, seq, _) = run_with(&c, Some("k"), &env()).await;
    assert!(matches!(r.unwrap_err(), LlmError::BadResponse(_)));
    assert!(seq.is_empty());
}

#[tokio::test]
async fn validation_never_touches_the_secret_store() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    });
    let e = env();
    let (r, _, _) = run_with(&conn(&s.url), Some("k"), &e).await;
    r.unwrap();
    assert_eq!(e.secrets.get("llm-connection:").unwrap(), None);
}

#[cfg(unix)]
mod cli {
    use super::*;

    fn cli_conn() -> Connection {
        Connection {
            id: String::new(),
            name: "Home".into(),
            preset_id: None,
            engine: Engine::CliClaude,
            base_url: None,
            auth: AuthSource::None,
            auth_header: AuthHeader::Bearer,
            extra_headers: vec![],
            ca_cert_path: None,
            azure_api_version: None,
            models: vec!["sonnet".into()],
            vision_models: vec![],
        }
    }

    #[tokio::test]
    async fn cli_happy_path_reports_installed_logged_in_and_fixed_models() {
        let dir = tempfile::tempdir().unwrap();
        let claude = write_script(dir.path(), "claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"ok\"}'");
        let e = test_env(FixedResolver::default().with("claude", claude), 5000);
        let (r, seq, _) = run_with(&cli_conn(), None, &e).await;
        let v = r.unwrap();
        assert_eq!(v.available, vec!["opus", "sonnet", "haiku"]);
        assert_eq!(v.verified, vec!["opus", "sonnet", "haiku"]);
        assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Ok));
    }

    #[tokio::test]
    async fn cli_missing_fails_at_reach() {
        let (r, seq, _) = run_with(&cli_conn(), None, &env()).await;
        assert_eq!(r.unwrap_err(), LlmError::CliMissing);
        assert_eq!(seq.last().unwrap(), &(Step::Reach, StepStatus::Failed));
    }

    #[tokio::test]
    async fn cli_not_logged_in_fails_at_credential() {
        let dir = tempfile::tempdir().unwrap();
        let claude = write_script(
            dir.path(),
            "claude",
            "cat >/dev/null\necho '{\"is_error\":true,\"result\":\"Not logged in · Please run /login\"}'\nexit 1",
        );
        let e = test_env(FixedResolver::default().with("claude", claude), 5000);
        let (r, seq, _) = run_with(&cli_conn(), None, &e).await;
        assert_eq!(r.unwrap_err(), LlmError::CliNotLoggedIn);
        assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
    }
}

// ── tokens ────────────────────────────────────────────────────────────────────

#[test]
fn fingerprint_ignores_name_models_and_id_but_not_endpoint_or_secret() {
    let a = conn("https://a");
    let mut renamed = a.clone();
    renamed.name = "Other".into();
    renamed.models = vec!["x".into(), "y".into()];
    renamed.id = "abc".into();
    assert_eq!(fingerprint(&a, Some("k")), fingerprint(&renamed, Some("k")));

    let mut moved = a.clone();
    moved.base_url = Some("https://b".into());
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&moved, Some("k")));
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&a, Some("k2")));
    let mut headered = a.clone();
    headered.extra_headers = vec![("X".into(), "1".into())];
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&headered, Some("k")));
}

#[test]
fn token_must_match_fingerprint_and_cover_all_models_and_is_single_use() {
    let store = ValidationStore::default();
    let token = store.issue(42, vec!["a".to_string(), "b".to_string()]);

    assert_eq!(store.consume("nope", 42, &["a".to_string()]), Err(LlmError::NotValidated));
    assert_eq!(store.consume(&token, 43, &["a".to_string()]), Err(LlmError::NotValidated));
    assert_eq!(store.consume(&token, 42, &["a".to_string(), "zzz".to_string()]), Err(LlmError::NotValidated));
    // failed attempts do not burn the token
    assert_eq!(store.consume(&token, 42, &["a".to_string(), "b".to_string()]), Ok(()));
    assert_eq!(store.consume(&token, 42, &["a".to_string()]), Err(LlmError::NotValidated));
}

#[test]
fn add_verified_extends_the_token() {
    let store = ValidationStore::default();
    let token = store.issue(7, vec!["a".to_string()]);
    assert_eq!(store.add_verified(&token, 8, "b"), Err(LlmError::NotValidated));
    store.add_verified(&token, 7, "b").unwrap();
    assert_eq!(store.consume(&token, 7, &["a".to_string(), "b".to_string()]), Ok(()));
}
