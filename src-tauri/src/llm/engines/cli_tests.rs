use super::cli::*;
use super::ChatMessage;
use crate::llm::connection::Engine;
use crate::llm::error::LlmError;

fn m(role: &str, content: &str) -> ChatMessage {
    ChatMessage::text(role, content)
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

fn image_att(name: &str) -> crate::llm::attachment::Attachment {
    use crate::llm::attachment::*;
    Attachment {
        name: name.into(),
        vault_path: name.into(),
        kind: AttachmentKind::Image,
        parts: vec![Part::Image { media_type: "image/png".into(), data_b64: "QUJD".into() }],
        fallback: vec![],
    }
}

fn pdf_att() -> crate::llm::attachment::Attachment {
    use crate::llm::attachment::*;
    Attachment {
        name: "f.pdf".into(),
        vault_path: "f.pdf".into(),
        kind: AttachmentKind::Pdf,
        parts: vec![Part::Document { media_type: "application/pdf".into(), data_b64: "UERG".into() }],
        fallback: vec![
            Part::Text("texto pdf".into()),
            Part::Image { media_type: "image/png".into(), data_b64: "UEFHRQ==".into() },
        ],
    }
}

fn with_atts(text: &str, atts: Vec<crate::llm::attachment::Attachment>) -> Vec<ChatMessage> {
    vec![ChatMessage::text("system", "sys"), ChatMessage { attachments: atts, ..ChatMessage::text("user", text) }]
}

#[test]
fn claude_stream_args_switch_to_stream_json_io() {
    let a = claude_stream_args("sonnet", "");
    let j = a.join(" ");
    assert!(j.contains("-p --input-format stream-json --output-format stream-json --verbose --model sonnet"), "{j}");
    assert!(a.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
    assert!(a.contains(&"--no-session-persistence".to_string()));
}

#[test]
fn parse_claude_stream_takes_the_result_line() {
    let out = "{\"type\":\"system\"}\n{\"type\":\"assistant\",\"message\":{}}\n{\"type\":\"result\",\"is_error\":false,\"result\":\"A -> B\"}\n";
    assert_eq!(parse_claude_stream(out).unwrap(), "A -> B");
    assert!(matches!(parse_claude_stream("{\"type\":\"system\"}\n").unwrap_err(), LlmError::BadResponse(_)));
    assert_eq!(
        parse_claude_stream("{\"type\":\"result\",\"is_error\":true,\"result\":\"Not logged in\"}").unwrap_err(),
        LlmError::CliNotLoggedIn
    );
}

#[test]
fn claude_stream_input_is_one_user_line_with_content_blocks() {
    let line = claude_stream_input(&with_atts("¿qué hay?", vec![image_att("a.png"), pdf_att()]), "¿qué hay?");
    assert!(!line.trim_end().contains('\n'));
    let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(v["type"], "user");
    assert_eq!(v["message"]["role"], "user");
    let c = v["message"]["content"].as_array().unwrap();
    assert_eq!(c[1]["type"], "image");
    assert_eq!(c[1]["source"]["data"], "QUJD");
    assert_eq!(c[3]["type"], "document");
    assert_eq!(c.last().unwrap()["text"], "¿qué hay?");
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

    #[tokio::test]
    async fn claude_with_attachments_uses_stream_json_and_parses_the_result_line() {
        let out_dir = tempfile::tempdir().unwrap();
        let stdin_file = out_dir.path().join("stdin.json");
        let args_file = out_dir.path().join("args.txt");
        let body = format!(
            "cat > {}\necho \"$*\" > {}\necho '{{\"type\":\"system\"}}'\necho '{{\"type\":\"result\",\"is_error\":false,\"result\":\"A -> B\"}}'",
            stdin_file.display(),
            args_file.display()
        );
        let (env, _d) = env_with("claude", &body, 5000);
        let out = chat(Engine::CliClaude, &env, "sonnet", &with_atts("¿qué texto?", vec![image_att("a.png")]))
            .await
            .unwrap();
        assert_eq!(out, "A -> B");
        let args = std::fs::read_to_string(&args_file).unwrap();
        assert!(args.contains("--input-format stream-json"), "{args}");
        assert!(args.contains("--output-format stream-json"), "{args}");
        assert!(args.contains("--verbose"), "{args}");
        assert!(args.contains("--system-prompt sys"), "{args}");
        let sent: serde_json::Value = serde_json::from_str(std::fs::read_to_string(&stdin_file).unwrap().trim()).unwrap();
        assert_eq!(sent["message"]["content"][1]["type"], "image");
        assert_eq!(sent["message"]["content"][2]["text"], "¿qué texto?");
    }

    #[tokio::test]
    async fn claude_without_attachments_keeps_the_plain_json_path() {
        let body = "cat >/dev/null\necho \"$*\" | grep -q stream-json && echo '{\"is_error\":false,\"result\":\"stream\"}' || echo '{\"is_error\":false,\"result\":\"plain\"}'";
        let (env, _d) = env_with("claude", body, 5000);
        assert_eq!(chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap(), "plain");
    }

    #[tokio::test]
    async fn gemini_references_attachments_as_temp_files_in_the_prompt() {
        let body = "printf '{\"response\":\"files=[%s] args=%s\"}' \"$(ls | tr '\\n' ' ')\" \"$*\"";
        let (env, _d) = env_with("gemini", body, 5000);
        let msgs = with_atts("describe", vec![image_att("a b.png"), pdf_att()]);
        let out = chat(Engine::CliGemini, &env, "gemini-2.5-pro", &msgs).await.unwrap();
        assert!(out.contains("--approval-mode plan"), "{out}");
        assert!(out.contains("@attachment-1-1.png"), "{out}");
        assert!(out.contains("@attachment-2-2.png"), "pdf page image: {out}");
        assert!(out.contains("attachment-1-1.png attachment-2-2.png"), "files exist while running: {out}");
        assert!(out.contains("texto pdf"), "{out}");
        assert!(out.contains("describe"), "{out}");
    }
}
