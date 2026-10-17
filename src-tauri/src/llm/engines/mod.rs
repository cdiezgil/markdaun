use serde::{Deserialize, Serialize};

use super::attachment::{self, Attachment, Part};
use super::auth;
use super::connection::{Connection, Engine};
use super::env::LlmEnv;
use super::error::LlmError;
use super::http;

pub mod anthropic;
pub mod cli;
pub mod openai;

#[cfg(test)]
mod anthropic_tests;
#[cfg(test)]
mod cli_tests;
#[cfg(test)]
mod dispatch_tests;
#[cfg(test)]
mod openai_tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Images / PDFs sent with this turn only (never persisted as bytes).
    #[serde(skip)]
    pub attachments: Vec<Attachment>,
}

impl ChatMessage {
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self { role: role.into(), content: content.into(), attachments: Vec::new() }
    }

    /// Ordered parts: attachments first (each preceded by its name), then the text.
    pub fn expand(&self, native_pdf: bool) -> Vec<Part> {
        attachment::expand_parts(&self.attachments, &self.content, native_pdf)
    }
}

/// Models offered by the connection. CLI engines return their fixed list (after
/// checking the binary exists); API engines hit `/models` (empty = not listed).
pub async fn list_models(conn: &Connection, secret: Option<&str>, env: &LlmEnv) -> Result<Vec<String>, LlmError> {
    match conn.engine {
        Engine::CliClaude | Engine::CliGemini => {
            cli::detect(conn.engine, env.resolver.as_ref())?;
            Ok(cli::fixed_models(conn.engine))
        }
        Engine::OpenAiCompat => {
            let client = http::build_client(conn, env.timeout)?;
            let cred = auth::resolve(conn, secret, &env.az).await?;
            openai::list_models(conn, &cred, &client).await
        }
        Engine::AnthropicMessages => {
            let client = http::build_client(conn, env.timeout)?;
            let cred = auth::resolve(conn, secret, &env.az).await?;
            anthropic::list_models(conn, &cred, &client).await
        }
    }
}

/// One non-streaming chat turn through the connection's engine. Turns with
/// attachments require a vision-capable model.
pub async fn chat(
    conn: &Connection,
    model: &str,
    messages: &[ChatMessage],
    secret: Option<&str>,
    env: &LlmEnv,
) -> Result<String, LlmError> {
    if messages.iter().any(|m| !m.attachments.is_empty()) && !conn.supports_vision(model) {
        return Err(LlmError::VisionUnsupported);
    }
    chat_unchecked(conn, model, messages, secret, env).await
}

/// Like [`chat`] without the vision gate (used to probe vision support itself).
pub async fn chat_unchecked(
    conn: &Connection,
    model: &str,
    messages: &[ChatMessage],
    secret: Option<&str>,
    env: &LlmEnv,
) -> Result<String, LlmError> {
    match conn.engine {
        Engine::CliClaude | Engine::CliGemini => cli::chat(conn.engine, env, model, messages).await,
        Engine::OpenAiCompat => {
            let client = http::build_client(conn, env.timeout)?;
            let cred = auth::resolve(conn, secret, &env.az).await?;
            openai::chat(conn, &cred, &client, model, messages).await
        }
        Engine::AnthropicMessages => {
            let client = http::build_client(conn, env.timeout)?;
            let cred = auth::resolve(conn, secret, &env.az).await?;
            anthropic::chat(conn, &cred, &client, model, messages).await
        }
    }
}
