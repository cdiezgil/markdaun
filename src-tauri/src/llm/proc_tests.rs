use super::error::LlmError;
use super::proc::*;
use std::path::Path;
use std::time::Duration;

fn sh() -> &'static Path {
    Path::new("/bin/sh")
}

fn args(script: &str) -> Vec<String> {
    vec!["-c".to_string(), script.to_string()]
}

#[cfg(unix)]
#[tokio::test]
async fn passes_stdin_and_captures_stdout() {
    let tmp = std::env::temp_dir();
    let out = run(sh(), &args("cat"), Some("hello"), &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(out.code, Some(0));
    assert_eq!(out.stdout, "hello");
}

#[cfg(unix)]
#[tokio::test]
async fn reports_exit_code_and_stderr() {
    let tmp = std::env::temp_dir();
    let out = run(sh(), &args("echo oops >&2; exit 3"), None, &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(out.code, Some(3));
    assert!(out.stderr.contains("oops"));
}

#[cfg(unix)]
#[tokio::test]
async fn removes_listed_env_vars_from_the_child() {
    std::env::set_var("MD_TEST_SECRET", "abc");
    let tmp = std::env::temp_dir();
    let kept = run(sh(), &args("echo \"[$MD_TEST_SECRET]\""), None, &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(kept.stdout.trim(), "[abc]");
    let scrubbed =
        run(sh(), &args("echo \"[$MD_TEST_SECRET]\""), None, &["MD_TEST_SECRET"], &tmp, Duration::from_secs(5))
            .await
            .unwrap();
    assert_eq!(scrubbed.stdout.trim(), "[]");
}

#[cfg(unix)]
#[tokio::test]
async fn kills_and_reports_timeout() {
    let tmp = std::env::temp_dir();
    let r = run(sh(), &args("sleep 5"), None, &[], &tmp, Duration::from_millis(200)).await;
    assert_eq!(r.unwrap_err(), LlmError::Timeout);
}

#[tokio::test]
async fn missing_binary_is_cli_missing() {
    let tmp = std::env::temp_dir();
    let r = run(Path::new("/no/such/binary-xyz"), &[], None, &[], &tmp, Duration::from_secs(1)).await;
    assert_eq!(r.unwrap_err(), LlmError::CliMissing);
}

#[test]
fn fixed_resolver_resolves_registered_names_only() {
    let r = FixedResolver::default().with("claude", "/opt/claude");
    assert_eq!(r.resolve("claude"), Some("/opt/claude".into()));
    assert_eq!(r.resolve("gemini"), None);
}

#[test]
fn login_shell_resolver_rejects_unsafe_names() {
    let r = LoginShellResolver::default();
    assert_eq!(r.resolve("a;rm -rf /"), None);
    assert_eq!(r.resolve(""), None);
    assert_eq!(r.resolve("$(whoami)"), None);
}

#[cfg(unix)]
#[test]
fn login_shell_resolver_finds_sh_and_caches() {
    let r = LoginShellResolver::default();
    let p = r.resolve("sh").expect("sh must exist");
    assert!(p.is_absolute() && p.exists());
    assert_eq!(r.resolve("sh"), Some(p));
    assert_eq!(r.resolve("definitely-not-a-real-binary-xyz"), None);
}
