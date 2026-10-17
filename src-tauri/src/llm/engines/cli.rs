use super::ChatMessage;
use crate::llm::attachment::{self, Attachment, Part};
use crate::llm::connection::Engine;
use crate::llm::env::LlmEnv;
use crate::llm::error::LlmError;
use crate::llm::proc::{self, BinaryResolver};
use serde_json::{json, Value};
use std::path::PathBuf;

pub const CLAUDE_MODELS: [&str; 3] = ["opus", "sonnet", "haiku"];
pub const GEMINI_MODELS: [&str; 3] = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

pub fn bin_name(engine: Engine) -> &'static str {
    match engine {
        Engine::CliClaude => "claude",
        Engine::CliGemini => "gemini",
        _ => "",
    }
}

pub fn fixed_models(engine: Engine) -> Vec<String> {
    let list: &[&str] = match engine {
        Engine::CliClaude => &CLAUDE_MODELS,
        Engine::CliGemini => &GEMINI_MODELS,
        _ => &[],
    };
    list.iter().map(|s| s.to_string()).collect()
}

pub fn detect(engine: Engine, resolver: &dyn BinaryResolver) -> Result<PathBuf, LlmError> {
    resolver.resolve(bin_name(engine)).ok_or(LlmError::CliMissing)
}

/// API-key env vars that would make the CLI bill an API account instead of using
/// the subscription login. They are removed from the child environment.
fn env_scrub(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::CliClaude => &["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
        Engine::CliGemini => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        _ => &[],
    }
}

/// (system prompt, conversation prompt). One user turn -> its bare content.
pub fn split_messages(messages: &[ChatMessage]) -> (String, String) {
    let system = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let turns: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    let prompt = if turns.len() == 1 {
        turns[0].content.clone()
    } else {
        turns.iter().map(|m| format!("{}: {}", m.role, m.content)).collect::<Vec<_>>().join("\n\n")
    };
    (system, prompt)
}

pub fn claude_args(model: &str, system: &str) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if !system.is_empty() {
        a.push("--system-prompt".into());
        a.push(system.into());
    }
    a
}

/// Stream-json variant used only when the turn has attachments: content blocks
/// travel on stdin, the answer is the `"type":"result"` line.
pub fn claude_stream_args(model: &str, system: &str) -> Vec<String> {
    let mut a: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--tools",
        "",
        "--no-session-persistence",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if !system.is_empty() {
        a.push("--system-prompt".into());
        a.push(system.into());
    }
    a
}

/// The attachments of the last conversation turn (the only one sent with bytes).
fn last_attachments(messages: &[ChatMessage]) -> Vec<Attachment> {
    messages.iter().rev().find(|m| m.role != "system").map(|m| m.attachments.clone()).unwrap_or_default()
}

/// One stdin line: a user message whose content is the attachment blocks
/// followed by the conversation prompt.
pub fn claude_stream_input(messages: &[ChatMessage], prompt: &str) -> String {
    let parts = attachment::expand_parts(&last_attachments(messages), prompt, true);
    let blocks: Vec<Value> = parts.iter().filter_map(super::anthropic::part_block).collect();
    let line = json!({ "type": "user", "message": { "role": "user", "content": blocks } });
    format!("{line}\n")
}

fn extension(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    }
}

/// Writes image parts as temp files in `dir` and returns the Gemini prompt:
/// each attachment as a name marker plus `@file` references and inline text.
pub fn gemini_attachment_prompt(dir: &std::path::Path, attachments: &[Attachment], prompt: &str) -> Result<String, LlmError> {
    use base64::Engine as _;
    let mut out = String::new();
    for (i, a) in attachments.iter().enumerate() {
        out.push_str(&format!("[Archivo adjunto: {}]\n", a.name));
        for (j, p) in a.parts_for(false).iter().enumerate() {
            match p {
                Part::Text(t) => out.push_str(&format!("{t}\n")),
                Part::Image { media_type, data_b64 } => {
                    let name = format!("attachment-{}-{}.{}", i + 1, j + 1, extension(media_type));
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(data_b64.as_bytes())
                        .map_err(|e| LlmError::BadResponse(format!("attachment: {e}")))?;
                    std::fs::write(dir.join(&name), bytes).map_err(|e| LlmError::BadResponse(format!("attachment: {e}")))?;
                    out.push_str(&format!("@{name}\n"));
                }
                Part::Document { .. } => {}
            }
        }
        out.push('\n');
    }
    out.push_str(prompt);
    Ok(out)
}

pub fn gemini_args(model: &str, prompt: &str) -> Vec<String> {
    ["-p", prompt, "-m", model, "--approval-mode", "plan", "-o", "json"].iter().map(|s| s.to_string()).collect()
}

pub fn looks_unauthenticated(text: &str) -> bool {
    let s = text.to_lowercase();
    [
        "not logged in",
        "please run /login",
        "/login",
        "invalid api key",
        "authentication_error",
        "oauth token has expired",
        "auth method",
        "gemini_api_key",
        "not authenticated",
        "please login",
        "login required",
        "failed to authenticate",
        "session expired",
    ]
    .iter()
    .any(|m| s.contains(m))
}

fn snippet(s: &str) -> String {
    s.trim().chars().take(300).collect()
}

pub fn parse_claude(stdout: &str) -> Result<String, LlmError> {
    let v: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| LlmError::BadResponse(format!("claude output is not JSON: {e}")))?;
    let obj = match &v {
        Value::Array(items) => items
            .iter()
            .rev()
            .find(|i| i.get("type").and_then(Value::as_str) == Some("result"))
            .cloned()
            .unwrap_or(Value::Null),
        other => other.clone(),
    };
    let result = obj.get("result").and_then(Value::as_str).unwrap_or("");
    if obj.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        return Err(if looks_unauthenticated(result) {
            LlmError::CliNotLoggedIn
        } else {
            LlmError::BadResponse(format!("claude error: {}", snippet(result)))
        });
    }
    if result.is_empty() {
        return Err(LlmError::BadResponse("claude returned no result".into()));
    }
    Ok(result.to_string())
}

/// stream-json output: one JSON object per line; the answer is the last
/// `"type":"result"` line.
pub fn parse_claude_stream(stdout: &str) -> Result<String, LlmError> {
    let line = stdout
        .lines()
        .rev()
        .find(|l| {
            serde_json::from_str::<Value>(l.trim())
                .map(|v| v.get("type").and_then(Value::as_str) == Some("result"))
                .unwrap_or(false)
        })
        .ok_or_else(|| LlmError::BadResponse("claude returned no result line".into()))?;
    parse_claude(line)
}

pub fn parse_gemini(stdout: &str) -> Result<String, LlmError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(LlmError::BadResponse("gemini returned no output".into()));
    }
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
            return Err(if looks_unauthenticated(msg) {
                LlmError::CliNotLoggedIn
            } else {
                LlmError::BadResponse(format!("gemini error: {}", snippet(msg)))
            });
        }
        for key in ["response", "result", "text"] {
            if let Some(s) = v.get(key).and_then(Value::as_str) {
                return Ok(s.to_string());
            }
        }
    }
    Ok(trimmed.to_string())
}

/// One headless turn through the CLI, in an empty temp dir, with no tools.
pub async fn chat(engine: Engine, env: &LlmEnv, model: &str, messages: &[ChatMessage]) -> Result<String, LlmError> {
    let bin = detect(engine, env.resolver.as_ref())?;
    let (system, prompt) = split_messages(messages);
    let dir = tempfile::tempdir().map_err(|e| LlmError::BadResponse(format!("tempdir: {e}")))?;
    let attachments = last_attachments(messages);
    let stream = engine == Engine::CliClaude && !attachments.is_empty();
    let (args, stdin) = match engine {
        Engine::CliClaude if stream => (claude_stream_args(model, &system), Some(claude_stream_input(messages, &prompt))),
        Engine::CliClaude => (claude_args(model, &system), Some(prompt)),
        Engine::CliGemini => {
            let body = gemini_attachment_prompt(dir.path(), &attachments, &prompt)?;
            let full = if system.is_empty() { body } else { format!("{system}\n\n{body}") };
            (gemini_args(model, &full), None)
        }
        _ => return Err(LlmError::BadResponse("not a CLI engine".into())),
    };
    let out = proc::run(&bin, &args, stdin.as_deref(), env_scrub(engine), dir.path(), env.timeout).await?;
    if out.code != Some(0) {
        let combined = format!("{}\n{}", out.stdout, out.stderr);
        if looks_unauthenticated(&combined) {
            return Err(LlmError::CliNotLoggedIn);
        }
        let detail = if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr };
        return Err(LlmError::BadResponse(format!(
            "{} exited with {:?}: {}",
            bin_name(engine),
            out.code,
            snippet(detail)
        )));
    }
    match engine {
        Engine::CliClaude if stream => parse_claude_stream(&out.stdout),
        Engine::CliClaude => parse_claude(&out.stdout),
        _ => parse_gemini(&out.stdout),
    }
}
