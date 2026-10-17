use super::error::LlmError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    OpenAiCompat,
    AnthropicMessages,
    CliClaude,
    CliGemini,
}

impl Engine {
    pub fn is_cli(self) -> bool {
        matches!(self, Engine::CliClaude | Engine::CliGemini)
    }
}

/// Where the credential comes from. `ApiKey` secrets live in the OS keyring.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthSource {
    None,
    ApiKey,
    AzureCli { scope: String },
}

/// Which HTTP header carries the credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthHeader {
    /// `Authorization: Bearer <secret>`
    Bearer,
    /// `api-key: <secret>`
    ApiKey,
    /// `x-api-key: <secret>`
    XApiKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    /// uuid v4; empty for a not-yet-saved draft.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub preset_id: Option<String>,
    pub engine: Engine,
    #[serde(default)]
    pub base_url: Option<String>,
    pub auth: AuthSource,
    pub auth_header: AuthHeader,
    #[serde(default)]
    pub extra_headers: Vec<(String, String)>,
    #[serde(default)]
    pub ca_cert_path: Option<String>,
    #[serde(default)]
    pub azure_api_version: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    /// Subset of `models` that accept images / PDFs.
    #[serde(default)]
    pub vision_models: Vec<String>,
}

/// Default vision capability by model family (known families see images;
/// unknown or text-only plans do not).
pub fn vision_default(model: &str) -> bool {
    let m = model.to_lowercase();
    if m.contains("kimi") || m.contains("glm") {
        return false;
    }
    ["claude", "opus", "sonnet", "haiku", "gpt-4o", "gpt-4.1", "gpt-4.5", "gpt-5", "gemini", "o3", "o4", "o1"]
        .iter()
        .any(|p| m.starts_with(p) || m.contains(&format!("/{p}")))
}

impl Connection {
    pub fn supports_vision(&self, model: &str) -> bool {
        self.vision_models.iter().any(|m| m == model)
    }

    /// Cheap structural checks before touching the network or the disk.
    pub fn validate_shape(&self) -> Result<(), LlmError> {
        if self.name.trim().is_empty() {
            return Err(LlmError::BadResponse("connection name is empty".into()));
        }
        if !self.engine.is_cli() {
            match self.base_url.as_deref() {
                Some(u) if u.starts_with("https://") || u.starts_with("http://") => {}
                _ => {
                    return Err(LlmError::BadResponse(
                        "base URL must start with http:// or https://".into(),
                    ))
                }
            }
        }
        Ok(())
    }
}
