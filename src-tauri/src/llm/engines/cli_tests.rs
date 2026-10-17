use super::cli::*;
use super::ChatMessage;
use crate::llm::connection::Engine;
use crate::llm::error::LlmError;

fn m(role: &str, content: &str) -> ChatMessage {
    ChatMessage { role: role.into(), content: content.into() }
}

#[test]
fn fixed_model_lists() {
    assert_eq!(fixed_models(Engine::CliClaude), vec!["opus", "sonnet", "haiku"]);
    assert!(fixed_models(Engine::CliGemini).contains(&"gemini-2.5-pro".to_string()));
    assert!(fixed_models(Engine::OpenAiCompat).is_empty());
}

#[test]
fn split_messages_separates_system_from_turns() {
    let (sys, prompt) = split_messages(&[m("system", "a"), m("system", "b"), m("user", "hola")]);
    assert_eq!(sys, "a\n\nb");
    assert_eq!(prompt, "hola");
    let (_, multi) = split_messages(&[m("user", "q1"), m("assistant", "a1"), m("user", "q2")]);
    assert_eq!(multi, "user: q1\n\nassistant: a1\n\nuser: q2");
}

#[test]
fn claude_args_are_headless_and_toolless() {
    let a = claude_args("opus", "be brief");
    let joined = a.join(" ");
    assert!(joined.contains("-p --output-format json --model opus"));
    assert!(a.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
    assert!(a.contains(&"--no-session-persistence".to_string()));
    assert!(a.windows(2).any(|w| w[0] == "--system-prompt" && w[1] == "be brief"));
    assert!(!a.contains(&"--bare".to_string()));
    assert!(!claude_args("opus", "").contains(&"--system-prompt".to_string()));
}

#[test]
fn gemini_args_use_plan_mode_and_json() {
    let a = gemini_args("gemini-2.5-pro", "hola");
    assert_eq!(
        a,
        vec!["-p", "hola", "-m", "gemini-2.5-pro", "--approval-mode", "plan", "-o", "json"]
    );
}

#[test]
fn parse_claude_variants() {
    assert_eq!(parse_claude(r#"{"type":"result","is_error":false,"result":"hola"}"#).unwrap(), "hola");
    assert_eq!(
        parse_claude(r#"[{"type":"system"},{"type":"result","is_error":false,"result":"arr"}]"#).unwrap(),
        "arr"
    );
    assert_eq!(
        parse_claude(r#"{"is_error":true,"result":"Not logged in · Please run /login"}"#).unwrap_err(),
        LlmError::CliNotLoggedIn
    );
    assert!(matches!(
        parse_claude(r#"{"is_error":true,"result":"rate limited"}"#).unwrap_err(),
        LlmError::BadResponse(_)
    ));
    assert!(matches!(parse_claude("not json").unwrap_err(), LlmError::BadResponse(_)));
    assert!(matches!(parse_claude(r#"{"is_error":false}"#).unwrap_err(), LlmError::BadResponse(_)));
}

#[test]
fn parse_gemini_variants() {
    assert_eq!(parse_gemini(r#"{"response":"hi"}"#).unwrap(), "hi");
    assert_eq!(parse_gemini(r#"{"result":"r"}"#).unwrap(), "r");
    assert_eq!(parse_gemini("plain text\n").unwrap(), "plain text");
    assert_eq!(
        parse_gemini(r#"{"error":{"message":"Please login: no auth method"}}"#).unwrap_err(),
        LlmError::CliNotLoggedIn
    );
    assert!(matches!(parse_gemini("   ").unwrap_err(), LlmError::BadResponse(_)));
}

#[test]
fn unauthenticated_detection() {
    assert!(looks_unauthenticated("Not logged in · Please run /login"));
    assert!(looks_unauthenticated("Error: Please set an Auth method in your settings.json"));
    assert!(looks_unauthenticated(
        "Failed to authenticate: OAuth session expired and could not be refreshed"
    ));
    assert!(!looks_unauthenticated("rate limit exceeded"));
}

#[cfg(unix)]
mod with_scripts {
    use super::*;
    use crate::llm::proc::FixedResolver;
    use crate::llm::testutil::{test_env, write_script};

    fn env_with(name: &str, script_body: &str, timeout_ms: u64) -> (crate::llm::env::LlmEnv, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(dir.path(), name, script_body);
        (test_env(FixedResolver::default().with(name, script), timeout_ms), dir)
    }

    #[tokio::test]
    async fn claude_success() {
        let (env, _d) = env_with("claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"hola mundo\"}'", 5000);
        let out = chat(Engine::CliClaude, &env, "opus", &[m("user", "hi")]).await.unwrap();
        assert_eq!(out, "hola mundo");
    }

    #[tokio::test]
    async fn claude_gets_prompt_on_stdin_scrubbed_env_and_temp_cwd() {
        std::env::set_var("ANTHROPIC_API_KEY", "sk-should-not-leak");
        std::env::set_var("ANTHROPIC_AUTH_TOKEN", "tok-should-not-leak");
        let body = "prompt=$(cat)\nprintf '{\"is_error\":false,\"result\":\"key=[%s] tok=[%s] cwd=%s args=%s prompt=%s\"}' \"$ANTHROPIC_API_KEY\" \"$ANTHROPIC_AUTH_TOKEN\" \"$(pwd)\" \"$*\" \"$prompt\"";
        let (env, _d) = env_with("claude", body, 5000);
        let out = chat(Engine::CliClaude, &env, "opus", &[m("system", "be brief"), m("user", "hola")])
            .await
            .unwrap();
        assert!(out.contains("key=[]"), "{out}");
        assert!(out.contains("tok=[]"), "{out}");
        assert!(!out.contains("should-not-leak"), "{out}");
        assert!(out.contains("--model opus"), "{out}");
        assert!(out.contains("--no-session-persistence"), "{out}");
        assert!(out.contains("--system-prompt be brief"), "{out}");
        assert!(out.contains("prompt=hola"), "{out}");
        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        assert!(!out.contains(&format!("cwd={cwd}")), "must not run in the project dir: {out}");
    }

    #[tokio::test]
    async fn claude_not_logged_in_via_error_json() {
        let (env, _d) = env_with(
            "claude",
            "cat >/dev/null\necho '{\"is_error\":true,\"result\":\"Not logged in · Please run /login\"}'\nexit 1",
            5000,
        );
        assert_eq!(
            chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliNotLoggedIn
        );
    }

    #[tokio::test]
    async fn claude_crash_is_bad_response_with_stderr() {
        let (env, _d) = env_with("claude", "cat >/dev/null\necho boom >&2\nexit 2", 5000);
        match chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err() {
            LlmError::BadResponse(msg) => assert!(msg.contains("boom"), "{msg}"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test]
    async fn claude_timeout() {
        let (env, _d) = env_with("claude", "sleep 5", 200);
        assert_eq!(
            chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err(),
            LlmError::Timeout
        );
    }

    #[tokio::test]
    async fn missing_binary_is_cli_missing() {
        let env = test_env(FixedResolver::default(), 1000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-pro", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliMissing
        );
        assert_eq!(detect(Engine::CliClaude, env.resolver.as_ref()).unwrap_err(), LlmError::CliMissing);
    }

    #[tokio::test]
    async fn gemini_success_scrubs_api_keys_and_uses_plan_mode() {
        std::env::set_var("GEMINI_API_KEY", "g-should-not-leak");
        std::env::set_var("GOOGLE_API_KEY", "google-should-not-leak");
        let body = "printf '{\"response\":\"key=[%s] google=[%s] args=%s\"}' \"$GEMINI_API_KEY\" \"$GOOGLE_API_KEY\" \"$*\"";
        let (env, _d) = env_with("gemini", body, 5000);
        let out = chat(Engine::CliGemini, &env, "gemini-2.5-pro", &[m("system", "sys"), m("user", "hola")])
            .await
            .unwrap();
        assert!(out.contains("key=[]") && out.contains("google=[]"), "{out}");
        assert!(out.contains("--approval-mode plan"), "{out}");
        assert!(out.contains("-m gemini-2.5-pro"), "{out}");
        assert!(out.contains("sys"), "system prompt is folded into the prompt: {out}");
        assert!(out.contains("hola"), "{out}");
    }

    #[tokio::test]
    async fn gemini_plain_text_and_auth_failure() {
        let (env, _d) = env_with("gemini", "echo plain answer", 5000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-flash", &[m("user", "x")]).await.unwrap(),
            "plain answer"
        );
        let (env, _d) = env_with("gemini", "echo 'Please set an Auth method in your settings.json' >&2\nexit 41", 5000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-flash", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliNotLoggedIn
        );
    }
}
