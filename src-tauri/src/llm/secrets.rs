use super::error::LlmError;
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

pub const KEYRING_SERVICE: &str = "markdaun";
/// Keyring account used by the pre-connections single-endpoint config.
pub const LEGACY_ACCOUNT: &str = "llm-api-key";

pub fn connection_account(id: &str) -> String {
    format!("llm-connection:{id}")
}

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, LlmError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), LlmError>;
    /// Deleting a missing entry succeeds.
    fn delete(&self, account: &str) -> Result<(), LlmError>;
}

/// OS keyring (Keychain / Credential Manager / Secret Service).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, LlmError> {
        keyring::Entry::new(KEYRING_SERVICE, account).map_err(LlmError::storage)
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, LlmError> {
        match Self::entry(account)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(LlmError::storage(e)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), LlmError> {
        Self::entry(account)?.set_password(secret).map_err(LlmError::storage)
    }

    fn delete(&self, account: &str) -> Result<(), LlmError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(LlmError::storage(e)),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, LlmError> {
        Ok(self.inner.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), LlmError> {
        self.inner.lock().unwrap().insert(account.to_string(), secret.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), LlmError> {
        self.inner.lock().unwrap().remove(account);
        Ok(())
    }
}
