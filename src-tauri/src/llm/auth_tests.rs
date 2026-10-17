use super::auth::*;
use super::connection::*;
use super::error::LlmError;
use super::proc::{BinaryResolver, FixedResolver};
use super::testutil::*;
use std::sync::Arc;
use std::time::Duration;

fn provider(resolver: FixedResolver, clock: Arc<FakeClock>) -> AzTokenProvider {
    let r: Arc<dyn BinaryResolver> = Arc::new(resolver);
    AzTokenProvider::new(r, clock, Duration::from_secs(5))
}

#[test]
fn fake_clock_advances() {
    let c = FakeClock::new(1_000);
    assert_eq!(Clock::now_unix(&c), 1_000);
    c.advance(60);
    assert_eq!(Clock::now_unix(&c), 1_060);
}

#[cfg(unix)]
mod az {
    use super::*;

    /// Fake `az`: appends its args to a counter file and returns tok-<n> expiring at `exp`.
    fn fake_az(dir: &std::path::Path, exp: i64) -> (FixedResolver, std::path::PathBuf) {
        let counter = dir.join("calls.txt");
        let body = format!(
            "echo \"$@\" >> '{c}'\nn=$(wc -l < '{c}' | tr -d ' ')\nprintf '{{\"accessToken\":\"tok-%s\",\"expires_on\":{exp},\"tokenType\":\"Bearer\"}}' \"$n\"",
            c = counter.display(),
            exp = exp
        );
        let script = write_script(dir, "az", &body);
        (FixedResolver::default().with("az", script), counter)
    }

    fn calls(counter: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(counter).unwrap_or_default().lines().map(String::from).collect()
    }

    #[tokio::test]
    async fn token_is_cached_until_five_minutes_before_expiry() {
        let dir = tempfile::tempdir().unwrap();
        let (resolver, counter) = fake_az(dir.path(), 10_000);
        let clock = Arc::new(FakeClock::new(1_000));
        let p = provider(resolver, clock.clone());

        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(calls(&counter).len(), 1);

        clock.set(9_600); // 400s left: still cached
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(calls(&counter).len(), 1);

        clock.set(9_750); // 250s left (< 300): refresh
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-2");
        assert_eq!(calls(&counter).len(), 2);
    }

    #[tokio::test]
    async fn passes_scope_and_json_output_flags_and_caches_per_scope() {
        let dir = tempfile::tempdir().unwrap();
        let (resolver, counter) = fake_az(dir.path(), 10_000);
        let p = provider(resolver, Arc::new(FakeClock::new(1_000)));
        p.token("https://cognitiveservices.azure.com/.default").await.unwrap();
        p.token("api://other/.default").await.unwrap();
        let c = calls(&counter);
        assert_eq!(c.len(), 2);
        assert_eq!(
            c[0],
            "account get-access-token --scope https://cognitiveservices.azure.com/.default --output json"
        );
        assert!(c[1].contains("api://other/.default"));
    }

    #[tokio::test]
    async fn not_logged_in_maps_to_cli_not_logged_in() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(
            dir.path(),
            "az",
            "echo \"ERROR: Please run 'az login' to setup account.\" >&2\nexit 1",
        );
        let p = provider(FixedResolver::default().with("az", script), Arc::new(FakeClock::new(0)));
        assert_eq!(p.token("s").await.unwrap_err(), LlmError::CliNotLoggedIn);
    }

    #[tokio::test]
    async fn other_az_failures_are_bad_response() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(dir.path(), "az", "echo 'kaboom' >&2\nexit 2");
        let p = provider(FixedResolver::default().with("az", script), Arc::new(FakeClock::new(0)));
        assert!(matches!(p.token("s").await.unwrap_err(), LlmError::BadResponse(m) if m.contains("kaboom")));
    }

    #[tokio::test]
    async fn expires_on_may_be_a_numeric_string() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(
            dir.path(),
            "az",
            "printf '{\"accessToken\":\"t\",\"expires_on\":\"5000\"}'",
        );
        let clock = Arc::new(FakeClock::new(1_000));
        let p = provider(FixedResolver::default().with("az", script), clock);
        assert_eq!(p.token("s").await.unwrap(), "t");
    }
}

#[tokio::test]
async fn missing_az_is_cli_missing() {
    let p = provider(FixedResolver::default(), Arc::new(FakeClock::new(0)));
    assert_eq!(p.token("s").await.unwrap_err(), LlmError::CliMissing);
}

fn conn(auth: AuthSource) -> Connection {
    Connection {
        id: "c".into(),
        name: "n".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x".into()),
        auth,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec![],
        vision_models: vec![],
    }
}

#[tokio::test]
async fn resolve_none_and_api_key() {
    let p = provider(FixedResolver::default(), Arc::new(FakeClock::new(0)));
    assert_eq!(resolve(&conn(AuthSource::None), None, &p).await.unwrap(), Credential::None);
    assert_eq!(
        resolve(&conn(AuthSource::ApiKey), Some("k"), &p).await.unwrap(),
        Credential::Secret("k".into())
    );
    assert_eq!(resolve(&conn(AuthSource::ApiKey), None, &p).await.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(resolve(&conn(AuthSource::ApiKey), Some(""), &p).await.unwrap_err(), LlmError::Unauthorized);
}
