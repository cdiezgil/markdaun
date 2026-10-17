use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Typed LLM failures. Serialized as `{ "kind": ..., "detail": ... }` so the
/// frontend can map each `kind` to a message and a concrete action.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail")]
pub enum LlmError {
    #[error("endpoint unreachable")]
    Unreachable,
    #[error("credentials rejected")]
    Unauthorized,
    #[error("TLS certificate not trusted")]
    TlsUntrusted,
    #[error("model not found")]
    ModelNotFound,
    #[error("CLI not installed")]
    CliMissing,
    #[error("CLI not logged in")]
    CliNotLoggedIn,
    #[error("timed out")]
    Timeout,
    #[error("bad response: {0}")]
    BadResponse(String),
    /// Save was attempted without a matching validation token.
    #[error("connection not validated")]
    NotValidated,
    #[error("storage error: {0}")]
    Storage(String),
}

impl LlmError {
    pub fn storage<E: std::fmt::Display>(e: E) -> Self {
        LlmError::Storage(e.to_string())
    }
}
