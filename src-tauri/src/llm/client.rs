use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub endpoint_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("api: {0}")]
    Api(String),
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    content: String,
}

/// POST to `config.endpoint_url`. Includes `Authorization: Bearer {api_key}` only if
/// `config.api_key` is `Some`. Body: `{model, messages, stream:false}`.
/// Parses `choices[0].message.content` from the JSON response.
/// Errors: HTTP errors → `LlmError::Http`; API status ≥ 400 → `LlmError::Api`.
pub async fn chat_completion(
    config: &LlmConfig,
    messages: Vec<ChatMessage>,
) -> Result<String, LlmError> {
    let client = Client::new();
    let body = ChatRequest {
        model: &config.model,
        messages: &messages,
        stream: false,
    };

    let mut request = client.post(&config.endpoint_url).json(&body);

    if let Some(key) = &config.api_key {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let response = request.send().await?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(LlmError::Api(format!("status {status}: {body}")));
    }

    let chat_resp: ChatResponse = response.json().await?;
    let content = chat_resp
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default();

    Ok(content)
}
