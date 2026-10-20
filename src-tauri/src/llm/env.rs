use super::auth::{AzTokenProvider, Clock, SystemClock};
use super::connection::Connection;
use super::error::LlmError;
use super::proc::{BinaryResolver, LoginShellResolver};
use super::secrets::{connection_account, KeyringStore, SecretStore};
use std::sync::Arc;
use std::time::Duration;

/// Everything with side effects that engines need, injected so tests can fake it.
/// Registered as Tauri managed state.
pub struct LlmEnv {
    pub resolver: Arc<dyn BinaryResolver>,
    pub az: Arc<AzTokenProvider>,
    pub secrets: Arc<dyn SecretStore>,
    pub timeout: Duration,
}

impl LlmEnv {
    pub fn new(
        resolver: Arc<dyn BinaryResolver>,
        clock: Arc<dyn Clock>,
        secrets: Arc<dyn SecretStore>,
        timeout: Duration,
    ) -> Self {
        let az = Arc::new(AzTokenProvider::new(resolver.clone(), clock, timeout));
        Self { resolver, az, secrets, timeout }
    }

    pub fn production() -> Self {
        Self::new(
            Arc::new(LoginShellResolver::default()),
            Arc::new(SystemClock),
            Arc::new(KeyringStore),
            Duration::from_secs(300),
        )
    }

    /// The stored API key of a saved connection (None for drafts or no entry).
    pub fn secret_for(&self, conn: &Connection) -> Result<Option<String>, LlmError> {
        if conn.id.is_empty() {
            return Ok(None);
        }
        self.secrets.get(&connection_account(&conn.id))
    }
}
