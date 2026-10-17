use super::ChatMessage;
use crate::llm::attachment::Part;
use crate::llm::auth::Credential;
use crate::llm::connection::Connection;
use crate::llm::error::LlmError;
use crate::llm::http::{apply_auth, classify_send_error, classify_status};
use reqwest::Client;
use serde_json::{json, Value};

fn base(conn: &Connection) -> Result<String, LlmError> {
    conn.base_url
        .as_deref()
        .map(|u| u.trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| LlmError::BadResponse("missing base URL".into()))
}

fn models_url(conn: &Connection) -> Result<String, LlmError> {
    let b = base(conn)?;
    Ok(match &conn.azure_api_version {
        Some(v) => format!("{b}/openai/models?api-version={v}"),
        None => format!("{b}/models"),
    })
}

fn chat_url(conn: &Connection, model: &str) -> Result<String, LlmError> {
    let b = base(conn)?;
    Ok(match &conn.azure_api_version {
        Some(v) => format!("{b}/openai/deployments/{model}/chat/completions?api-version={v}"),
        None => format!("{b}/chat/completions"),
    })
}

/// `GET /models`. A 404/405 means the endpoint does not list models: `Ok(vec![])`.
pub async fn list_models(conn: &Connection, cred: &Credential, client: &Client) -> Result<Vec<String>, LlmError> {
    let resp = apply_auth(client.get(models_url(conn)?), conn, cred)
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
    Ok(data
        .iter()
        .filter_map(|m| m.get("id").and_then(Value::as_str))
        .map(|id| id.strip_prefix("models/").unwrap_or(id).to_string())
        .collect())
}

/// OpenAI content part. Native documents never reach this engine (PDFs use
/// their page images + text fallback), so they are dropped.
fn part_json(p: &Part) -> Option<Value> {
    match p {
        Part::Text(t) => Some(json!({ "type": "text", "text": t })),
        Part::Image { media_type, data_b64 } => {
            Some(json!({ "type": "image_url", "image_url": { "url": format!("data:{media_type};base64,{data_b64}") } }))
        }
        Part::Document { .. } => None,
    }
}

/// `POST /chat/completions` (non-streaming). Returns `choices[0].message.content`.
pub async fn chat(
    conn: &Connection,
    cred: &Credential,
    client: &Client,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let wire: Vec<Value> = messages
        .iter()
        .map(|m| {
            if m.attachments.is_empty() {
                json!({ "role": m.role, "content": m.content })
            } else {
                let parts: Vec<Value> = m.expand(false).iter().filter_map(part_json).collect();
                json!({ "role": m.role, "content": parts })
            }
        })
        .collect();
    let body = json!({ "model": model, "messages": wire, "stream": false });
    let resp = apply_auth(client.post(chat_url(conn, model)?), conn, cred)
        .json(&body)
        .send()
        .await
        .map_err(|e| classify_send_error(&e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| classify_send_error(&e))?;
    if !(200..300).contains(&status) {
        return Err(classify_status(status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| LlmError::BadResponse(format!("chat: {e}")))?;
    let content = v
        .pointer("/choices/0/message/content")
        .ok_or_else(|| LlmError::BadResponse("chat: missing choices[0].message.content".into()))?;
    match content {
        Value::String(s) => Ok(s.clone()),
        Value::Array(parts) => Ok(parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")),
        _ => Err(LlmError::BadResponse("chat: unsupported content shape".into())),
    }
}
