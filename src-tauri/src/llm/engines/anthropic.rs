use super::ChatMessage;
use crate::llm::auth::Credential;
use crate::llm::connection::Connection;
use crate::llm::error::LlmError;
use crate::llm::http::{apply_auth, classify_send_error, classify_status};
use reqwest::Client;
use serde_json::{json, Value};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

fn base(conn: &Connection) -> Result<String, LlmError> {
    conn.base_url
        .as_deref()
        .map(|u| u.trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| LlmError::BadResponse("missing base URL".into()))
}

/// `GET /v1/models`. 404/405 -> `Ok(vec![])` (not listed).
pub async fn list_models(conn: &Connection, cred: &Credential, client: &Client) -> Result<Vec<String>, LlmError> {
    let url = format!("{}/v1/models", base(conn)?);
    let resp = apply_auth(client.get(url).header("anthropic-version", ANTHROPIC_VERSION), conn, cred)
        .send()
        .await
        .map_err(|e| classify_send_error(&e))?;
    let status = resp.status().as_u16();
    if status == 404 || status == 405 {
        return Ok(vec![]);
    }
    let text = resp.text().await.map_err(|e| classify_send_error(&e))?;
    if !(200..300).contains(&status) {
        return Err(classify_status(status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| LlmError::BadResponse(format!("models: {e}")))?;
    let data = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| LlmError::BadResponse("models: missing `data`".into()))?;
    Ok(data.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).map(String::from).collect())
}

/// `POST /v1/messages`. System messages are lifted into the `system` field.
pub async fn chat(
    conn: &Connection,
    cred: &Credential,
    client: &Client,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let system: Vec<&str> = messages.iter().filter(|m| m.role == "system").map(|m| m.content.as_str()).collect();
    let turns: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            json!({ "role": role, "content": m.content })
        })
        .collect();
    let mut body = json!({ "model": model, "max_tokens": MAX_TOKENS, "messages": turns });
    if !system.is_empty() {
        body["system"] = Value::String(system.join("\n\n"));
    }
    let url = format!("{}/v1/messages", base(conn)?);
    let resp = apply_auth(client.post(url).header("anthropic-version", ANTHROPIC_VERSION), conn, cred)
        .json(&body)
        .send()
        .await
        .map_err(|e| classify_send_error(&e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| classify_send_error(&e))?;
    if !(200..300).contains(&status) {
        return Err(classify_status(status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| LlmError::BadResponse(format!("messages: {e}")))?;
    let blocks = v
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| LlmError::BadResponse("messages: missing `content`".into()))?;
    let out: String = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect();
    if out.is_empty() {
        return Err(LlmError::BadResponse("messages: no text content".into()));
    }
    Ok(out)
}
