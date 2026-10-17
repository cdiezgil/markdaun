use serde::{Deserialize, Serialize};

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

/// One non-streaming chat turn through the connection's engine.
pub async fn chat(
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
