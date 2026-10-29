/// Google Antigravity / Cloud Code Assist engine.
///
/// API: POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
/// Auth: Bearer token from OAuth (google provider).
/// Request: AntigravityGenerateRequest wrapping a Gemini-format body.
/// Response: Server-Sent Events, each `data:` line is a StreamChunk JSON.
///
/// Sources:
/// - github.com/Rahularya01/pi-antigravity (MIT) — wire format reference
/// - pi-coding-agent examples/extensions/custom-provider-anthropic — OAuth pattern
use super::super::error::LlmError;
use super::ChatMessage;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const ENDPOINT: &str =
    "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
pub const USER_AGENT: &str =
    "antigravity/cli/1.4.0 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";
#[allow(dead_code)]
/// Fallback model when the caller doesn't specify one.
pub const DEFAULT_MODEL: &str = "gemini-2.5-pro";
/// Models known to work with the Antigravity endpoint.
pub const KNOWN_MODELS: &[&str] = &[
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
];

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GeminiTextPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiContent {
    role: &'static str, // "user" | "model"
    parts: Vec<GeminiTextPart>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    max_output_tokens: u32,
    temperature: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequestBody {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
    generation_config: GenerationConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AntigravityRequest {
    project: String,
    model: String,
    request: GeminiRequestBody,
    request_type: &'static str, // "agent"
    user_agent: &'static str,   // "antigravity"
    request_id: String,
}

// ─── Response types (SSE chunks) ──────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct StreamPart {
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct StreamContent {
    parts: Option<Vec<StreamPart>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StreamCandidate {
    content: Option<StreamContent>,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct StreamChunk {
    candidates: Option<Vec<StreamCandidate>>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

// ─── Message conversion ───────────────────────────────────────────────────────

/// Converts MarkDaun's flat ChatMessage list into Gemini's content array,
/// extracting any leading "system" message into a separate `system_instruction`.
fn build_body(messages: &[ChatMessage]) -> GeminiRequestBody {
    let mut contents: Vec<GeminiContent> = Vec::new();
    let mut system_instruction: Option<GeminiContent> = None;

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                // Gemini uses systemInstruction (only one, last one wins)
                system_instruction = Some(GeminiContent {
                    role: "user",
                    parts: vec![GeminiTextPart { text: msg.content.clone() }],
                });
            }
            "assistant" => {
                contents.push(GeminiContent {
                    role: "model",
                    parts: vec![GeminiTextPart { text: msg.content.clone() }],
                });
            }
            _ => {
                // "user" and anything else
                contents.push(GeminiContent {
                    role: "user",
                    parts: vec![GeminiTextPart { text: msg.content.clone() }],
                });
            }
        }
    }

    // Gemini requires the conversation to start with a user turn.
    // If we only have a system instruction and no user turns, add a placeholder.
    if contents.is_empty() {
        contents.push(GeminiContent {
            role: "user",
            parts: vec![GeminiTextPart { text: "Hello".into() }],
        });
    }

    GeminiRequestBody {
        contents,
        system_instruction,
        generation_config: GenerationConfig {
            max_output_tokens: 8192,
            temperature: 1.0,
        },
    }
}

// ─── SSE parser ───────────────────────────────────────────────────────────────

/// Reads the SSE body (already buffered by reqwest) and concatenates all text
/// deltas. Each non-empty line should be `data: <json>` or `data: [DONE]`.
fn parse_sse_body(body: &str) -> Result<String, LlmError> {
    let mut text = String::new();

    for raw_line in body.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line == "data: [DONE]" {
            continue;
        }
        let json_str = line.strip_prefix("data: ").unwrap_or(line);
        let chunk: StreamChunk = match serde_json::from_str(json_str) {
            Ok(c) => c,
            Err(_) => continue, // skip comment lines or malformed chunks
        };

        if let Some(err) = &chunk.error {
            let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown");
            return Err(LlmError::BadResponse(format!("antigravity: {msg}")));
        }

        if let Some(candidates) = chunk.candidates {
            for cand in candidates {
                if let Some(content) = cand.content {
                    if let Some(parts) = content.parts {
                        for part in parts {
                            if let Some(t) = part.text {
                                text.push_str(&t);
                            }
                        }
                    }
                }
            }
        }
    }

    if text.is_empty() {
        return Err(LlmError::BadResponse("antigravity: empty response".into()));
    }
    Ok(text)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// One non-streaming chat turn through the Antigravity API.
/// `token`: OAuth Bearer token for the Google provider.
/// `project_id`: GCP project id (from OAuthTokens stored at login).
pub async fn chat(
    model: &str,
    messages: &[ChatMessage],
    token: &str,
    project_id: &str,
    client: &Client,
) -> Result<String, LlmError> {
    let body = build_body(messages);
    let request = AntigravityRequest {
        project: project_id.to_string(),
        model: model.to_string(),
        request: body,
        request_type: "agent",
        user_agent: "antigravity",
        request_id: Uuid::new_v4().to_string(),
    };

    let resp = client
        .post(ENDPOINT)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&request)
        .send()
        .await
        .map_err(|e| LlmError::BadResponse(format!("antigravity: {e}")))?;

    let status = resp.status();
    if status == 401 || status == 403 {
        return Err(LlmError::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(LlmError::BadResponse(format!("antigravity {status}: {body}")));
    }

    let body_text = resp
        .text()
        .await
        .map_err(|e| LlmError::BadResponse(format!("antigravity read: {e}")))?;

    parse_sse_body(&body_text)
}

/// Lists available models (static — Antigravity has no public /models endpoint).
pub fn list_models() -> Vec<String> {
    KNOWN_MODELS.iter().map(|s| s.to_string()).collect()
}
