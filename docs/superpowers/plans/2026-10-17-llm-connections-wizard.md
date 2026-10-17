# LLM Connections & Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `LlmConfigPanel` with a multi-connection LLM setup (API-key engines, Azure CLI auth, `claude`/`gemini` CLI bridges), a validate-before-save wizard, and a bottom-right model switcher.

**Architecture:** All logic and secrets live in Rust (`src-tauri/src/llm/`): typed `Connection`s stored in `config.db`, secrets only in the OS keyring, per-connection HTTP engines (OpenAI-compatible incl. Azure variant, Anthropic Messages) and CLI engines, a validation pipeline that persists nothing and issues a one-shot `validationToken` required by save. The React side is a thin `llmStore` + wizard + switcher; `brain_query` dispatches to the active connection.

**Tech Stack:** Tauri 2, Rust (`reqwest` + rustls, `tokio::process`, `rusqlite`, `keyring`), React 18 + TS strict + Zustand + Vitest/RTL, `lucide-react`, design tokens from `design/`.

**Spec:** `docs/superpowers/specs/2026-10-17-llm-connections-wizard-design.md`

---

## Conventions (read before starting)

- **Rust tests** live next to the module they test. Existing precedent for multiple test files: `commands/*_tests.rs`. This plan uses `llm/<module>_tests.rs` (declared `#[cfg(test)] mod <module>_tests;` in `llm/mod.rs`) and `llm/engines/<engine>_tests.rs`.
- `src-tauri/src/main.rs` has `#![deny(warnings)]` and the crate is a binary, so **unused code is a build error**. Task 1 adds `#![allow(dead_code)]` at the top of `llm/mod.rs`; Task 17 removes it once everything is wired.
- **Run Rust tests** with `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test <filter>`. First build is slow (fastembed/ort).
- **Known pre-existing flaky tests** (do NOT fix here, ignore if they fail): `git::tests::pull_fast_forward`, `git::tests::pull_reset_hard_on_divergence`.
- **Frontend**: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run <path>`; type-check `npx tsc --noEmit`. Invoke payload keys MUST be camelCase (guard: `src/lib/invokeArgs.test.ts`). `@tauri-apps/api/core` is globally mocked in `src/test/setup.ts`.
- **Design**: only tokens from `design/tokens.css` (`var(--daun)`, `var(--space-4)`, `var(--radius-md)`, `var(--font-sans)`, `var(--shadow-pop)` ...). Lucide icons, `strokeWidth={1.5}`. One primary button per view. UI copy is Spanish (matches the existing app); code and comments are English.
- **No test may require real `az`, `claude` or `gemini`.** CLI behaviour is tested with fake `sh` scripts (`#[cfg(unix)]` tests) injected through a `BinaryResolver`.
- **Commits**: conventional commits, imperative, English, no `Co-Authored-By` lines.
- Phases 4-7 change the Tauri command surface and the frontend together; keep them on one branch and land them together. Every task still leaves its own test suite green.

## File structure

**Rust (`src-tauri/src/`)**

| File | Responsibility |
|---|---|
| `llm/error.rs` | `LlmError` enum, serialized as `{kind, detail}` |
| `llm/connection.rs` | `Connection`, `Engine`, `AuthSource`, `AuthHeader`, shape validation |
| `llm/secrets.rs` | `SecretStore` trait, `KeyringStore`, `MemorySecretStore`, account naming |
| `llm/store.rs` | `LlmStore`: connection CRUD in `config.db`, active selection, legacy migration |
| `llm/auth.rs` | `Credential`, `Clock`, `AzTokenProvider` (cache), `resolve()` |
| `llm/proc.rs` | `BinaryResolver` (login shell / `where`), async `run()` with timeout + env scrubbing |
| `llm/env.rs` | `LlmEnv` (resolver, az provider, secrets, timeout) injected everywhere; Tauri managed state |
| `llm/http.rs` | per-connection `reqwest` client (rustls, extra root CA), auth header, error classification |
| `llm/engines/mod.rs` | `ChatMessage`, `list_models()` / `chat()` dispatch by `Engine` |
| `llm/engines/openai.rs` | `GET /models`, `POST /chat/completions` (+ Azure variant) |
| `llm/engines/anthropic.rs` | `GET /v1/models`, `POST /v1/messages` |
| `llm/engines/cli.rs` | `claude -p` / `gemini -p` bridge, detection, fixed model lists |
| `llm/validate.rs` | step pipeline, progress events, `ValidationStore` tokens |
| `llm/testutil.rs` | `#[cfg(test)]` mock HTTP/TLS server, fake clock, fake-script writer, `test_env()` |
| `commands/llm_cmd.rs` | Tauri commands + testable `*_inner` functions |
| `commands/llm_tests.rs` | tests for the above |

Deviation from the spec layout: the spec's `trait ChatEngine` becomes plain enum dispatch in `engines/mod.rs` (async fns in traits are not object-safe; no `async_trait` dependency needed). `secrets.rs` and `env.rs` are extra small files so `auth.rs`/`store.rs` stay focused.

**Frontend (`src/`)**

| File | Responsibility |
|---|---|
| `lib/llm/types.ts` | TS mirrors of Rust types |
| `lib/llm/errors.ts` | `LlmError.kind` -> human message + action |
| `lib/llm/presets.ts` | preset catalog + `draftFromPreset()` |
| `lib/openExternal.ts` | open https links in the system browser |
| `lib/tauri.ts` | typed wrappers for `llm_*` commands |
| `store/llmStore.ts` | connections, active selection, wizard open/edit state |
| `components/LlmWizard/*` | `LlmWizard`, `ChooseRoute`, `ChooseProvider`, `Credentials`, `Validation`, `ModelsAndName`, `styles.ts` |
| `components/ModelSwitcher/ModelSwitcher.tsx` | bottom-right pill + popover |
| `components/Settings/AiConnections.tsx` | Settings list (edit / duplicate / delete) |

---

# PHASE 1 - Domain types, store, migration

### Task 1: Dependencies, error enum, module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/llm/mod.rs`
- Create: `src-tauri/src/llm/error.rs`, `src-tauri/src/llm/error_tests.rs`

- [x] **Step 1: Write the failing test** - create `src-tauri/src/llm/error_tests.rs`:

```rust
use super::error::LlmError;

#[test]
fn unit_variants_serialize_with_kind_only() {
    let v = serde_json::to_value(LlmError::Unreachable).unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "Unreachable" }));
}

#[test]
fn bad_response_serializes_kind_and_detail() {
    let v = serde_json::to_value(LlmError::BadResponse("boom".into())).unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "BadResponse", "detail": "boom" }));
}

#[test]
fn roundtrips_through_json() {
    let e = LlmError::Storage("disk".into());
    let back: LlmError = serde_json::from_str(&serde_json::to_string(&e).unwrap()).unwrap();
    assert_eq!(back, e);
}

#[test]
fn display_is_human_readable() {
    assert_eq!(LlmError::Timeout.to_string(), "timed out");
    assert_eq!(LlmError::BadResponse("x".into()).to_string(), "bad response: x");
}
```

- [x] **Step 2: Wire the module and run to see it fail** - replace `src-tauri/src/llm/mod.rs` with:

```rust
#![allow(dead_code)] // removed in Task 17 once everything is wired

pub mod client;
pub mod embeddings;
pub mod error;

pub use client::{chat_completion, ChatMessage, LlmConfig};
pub use embeddings::{chunk_text, embed_text, load_model};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod error_tests;
```

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::error_tests`
Expected: FAIL to compile (`file not found for module error` / unresolved import).

- [x] **Step 3: Implement** - edit `src-tauri/Cargo.toml`. Replace the `reqwest` line and add dependencies; move `tempfile` into `[dependencies]` and add the TLS test crates to `[dev-dependencies]`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls-native-roots"] }
tokio = { version = "1", features = ["process", "time", "rt", "io-util", "macros"] }
tempfile = "3"
```

```toml
[dev-dependencies]
tokio = { version = "1", features = ["full"] }
rcgen = { version = "0.13", default-features = false, features = ["ring", "pem"] }
rustls = { version = "0.23", default-features = false, features = ["ring", "std"] }
```

(Remove the old `tempfile = "3"` line from `[dev-dependencies]`.) Rationale: rustls gives deterministic custom-root-CA behaviour on macOS and Windows and lets tests spin up a self-signed TLS server; `native-roots` keeps OS-installed corporate CAs trusted.

Create `src-tauri/src/llm/error.rs`:

```rust
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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::error_tests`
Expected: PASS (4 tests). Also run `cargo tree -i aws-lc-rs` (expect "did not match any packages" - if it is present, see the risk note in Task 9).

- [x] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/llm
git commit -m "feat(llm): add typed LlmError and switch reqwest to rustls"
```

### Task 2: Connection types

**Files:**
- Create: `src-tauri/src/llm/connection.rs`, `src-tauri/src/llm/connection_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/connection_tests.rs`:

```rust
use super::connection::*;
use super::error::LlmError;

fn sample() -> Connection {
    Connection {
        id: "abc".into(),
        name: "Office".into(),
        preset_id: Some("azure-openai".into()),
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x.openai.azure.com".into()),
        auth: AuthSource::AzureCli { scope: DEFAULT_AZURE_SCOPE.into() },
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![("X-Team".into(), "md".into())],
        ca_cert_path: None,
        azure_api_version: Some("2024-10-21".into()),
        models: vec!["gpt-4.1".into()],
    }
}

#[test]
fn serializes_camel_case_with_tagged_auth() {
    let v = serde_json::to_value(sample()).unwrap();
    assert_eq!(v["engine"], "openAiCompat");
    assert_eq!(v["authHeader"], "bearer");
    assert_eq!(v["baseUrl"], "https://x.openai.azure.com");
    assert_eq!(v["auth"]["type"], "azureCli");
    assert_eq!(v["auth"]["scope"], DEFAULT_AZURE_SCOPE);
    assert_eq!(v["extraHeaders"][0][0], "X-Team");
    assert_eq!(v["azureApiVersion"], "2024-10-21");
}

#[test]
fn roundtrips() {
    let c = sample();
    let back: Connection = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
    assert_eq!(back, c);
}

#[test]
fn deserializes_minimal_draft_with_defaults() {
    let json = r#"{"id":"","name":"Home","engine":"cliClaude","auth":{"type":"none"},"authHeader":"bearer"}"#;
    let c: Connection = serde_json::from_str(json).unwrap();
    assert!(c.extra_headers.is_empty());
    assert!(c.models.is_empty());
    assert_eq!(c.base_url, None);
    assert!(c.engine.is_cli());
}

#[test]
fn validate_shape_accepts_valid_api_and_cli() {
    assert!(sample().validate_shape().is_ok());
    let mut cli = sample();
    cli.engine = Engine::CliGemini;
    cli.base_url = None;
    assert!(cli.validate_shape().is_ok());
}

#[test]
fn validate_shape_rejects_bad_drafts() {
    let mut c = sample();
    c.name = "  ".into();
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));

    let mut c = sample();
    c.base_url = None;
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));

    let mut c = sample();
    c.base_url = Some("ftp://x".into());
    assert!(matches!(c.validate_shape(), Err(LlmError::BadResponse(_))));
}
```

- [x] **Step 2: Run to verify it fails** - add to `llm/mod.rs` after `pub mod client;` the line `pub mod connection;` and after `mod error_tests;` the line `#[cfg(test)] mod connection_tests;` (on its own line pair, same style as the others).

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::connection_tests`
Expected: FAIL to compile (`connection.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/connection.rs`:

```rust
use super::error::LlmError;
use serde::{Deserialize, Serialize};

pub const DEFAULT_AZURE_SCOPE: &str = "https://cognitiveservices.azure.com/.default";

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
}

impl Connection {
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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::connection_tests`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add Connection domain types"
```

### Task 3: Secret store abstraction

**Files:**
- Create: `src-tauri/src/llm/secrets.rs`, `src-tauri/src/llm/secrets_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/secrets_tests.rs`:

```rust
use super::secrets::*;

#[test]
fn account_name_uses_connection_prefix() {
    assert_eq!(connection_account("abc"), "llm-connection:abc");
}

#[test]
fn memory_store_set_get_delete() {
    let s = MemorySecretStore::default();
    assert_eq!(s.get("a").unwrap(), None);
    s.set("a", "k1").unwrap();
    assert_eq!(s.get("a").unwrap(), Some("k1".to_string()));
    s.set("a", "k2").unwrap();
    assert_eq!(s.get("a").unwrap(), Some("k2".to_string()));
    s.delete("a").unwrap();
    assert_eq!(s.get("a").unwrap(), None);
    // deleting a missing entry is not an error
    s.delete("a").unwrap();
}
```

- [x] **Step 2: Run to verify it fails** - add `pub mod secrets;` and `#[cfg(test)] mod secrets_tests;` to `llm/mod.rs`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::secrets_tests`
Expected: FAIL to compile (`secrets.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/secrets.rs`:

```rust
use super::error::LlmError;
use std::collections::HashMap;
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
#[derive(Default)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::secrets_tests`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add SecretStore with keyring and in-memory backends"
```

### Task 4: LlmStore (CRUD, active selection, migration)

**Files:**
- Modify: `src-tauri/src/db/config.rs` (add `connection()` accessor)
- Create: `src-tauri/src/llm/store.rs`, `src-tauri/src/llm/store_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/store_tests.rs`:

```rust
use super::connection::*;
use super::error::LlmError;
use super::secrets::{connection_account, MemorySecretStore, SecretStore, LEGACY_ACCOUNT};
use super::store::*;
use crate::db::ConfigDb;
use tempfile::NamedTempFile;

fn conn(name: &str, models: &[&str]) -> Connection {
    Connection {
        id: String::new(),
        name: name.into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://api.example.com/v1".into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: models.iter().map(|m| m.to_string()).collect(),
    }
}

fn open() -> (LlmStore, NamedTempFile) {
    let f = NamedTempFile::new().unwrap();
    (LlmStore::open(f.path()).unwrap(), f)
}

#[test]
fn upsert_assigns_uuid_and_lists_in_insertion_order() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1"])).unwrap();
    let b = s.upsert(conn("B", &["m2"])).unwrap();
    assert_eq!(a.id.len(), 36);
    let names: Vec<_> = s.list().unwrap().into_iter().map(|c| c.name).collect();
    assert_eq!(names, vec!["A", "B"]);
    assert_eq!(s.get(&b.id).unwrap().unwrap().name, "B");
    assert_eq!(s.get("missing").unwrap(), None);
}

#[test]
fn upsert_existing_id_updates_in_place() {
    let (s, _f) = open();
    let mut a = s.upsert(conn("A", &["m1"])).unwrap();
    a.name = "A2".into();
    s.upsert(a.clone()).unwrap();
    let all = s.list().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "A2");
}

#[test]
fn set_active_requires_known_connection_and_model() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1", "m2"])).unwrap();
    assert!(matches!(s.set_active("nope", "m1"), Err(LlmError::BadResponse(_))));
    assert_eq!(s.set_active(&a.id, "zzz"), Err(LlmError::ModelNotFound));
    let sel = s.set_active(&a.id, "m2").unwrap();
    assert_eq!(sel.connection_id, a.id);
    assert_eq!(s.get_active().unwrap(), Some(sel));
}

#[test]
fn delete_clears_active_when_it_pointed_there() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1"])).unwrap();
    let b = s.upsert(conn("B", &["m1"])).unwrap();
    s.set_active(&a.id, "m1").unwrap();
    s.delete(&b.id).unwrap();
    assert!(s.get_active().unwrap().is_some());
    s.delete(&a.id).unwrap();
    assert_eq!(s.get_active().unwrap(), None);
    assert_eq!(s.list().unwrap().len(), 0);
}

#[test]
fn upsert_repairs_active_model_removed_from_connection() {
    let (s, _f) = open();
    let mut a = s.upsert(conn("A", &["m1", "m2"])).unwrap();
    s.set_active(&a.id, "m2").unwrap();
    a.models = vec!["m1".into()];
    s.upsert(a.clone()).unwrap();
    assert_eq!(s.get_active().unwrap().unwrap().model, "m1");
}

#[test]
fn migration_converts_legacy_config_and_cleans_up() {
    let f = NamedTempFile::new().unwrap();
    {
        let db = ConfigDb::open(f.path()).unwrap();
        db.set("llm_endpoint_url", "https://api.openai.com/v1/chat/completions").unwrap();
        db.set("llm_model", "gpt-4o-mini").unwrap();
    }
    let secrets = MemorySecretStore::default();
    secrets.set(LEGACY_ACCOUNT, "sk-legacy").unwrap();

    let s = LlmStore::open(f.path()).unwrap();
    assert!(s.migrate_legacy(&secrets).unwrap());

    let all = s.list().unwrap();
    assert_eq!(all.len(), 1);
    let c = &all[0];
    assert_eq!(c.name, "Migrated");
    assert_eq!(c.engine, Engine::OpenAiCompat);
    assert_eq!(c.base_url.as_deref(), Some("https://api.openai.com/v1"));
    assert_eq!(c.auth, AuthSource::ApiKey);
    assert_eq!(c.models, vec!["gpt-4o-mini"]);
    assert_eq!(s.get_active().unwrap().unwrap().connection_id, c.id);
    assert_eq!(secrets.get(&connection_account(&c.id)).unwrap().as_deref(), Some("sk-legacy"));
    assert_eq!(secrets.get(LEGACY_ACCOUNT).unwrap(), None);

    // idempotent
    assert!(!s.migrate_legacy(&secrets).unwrap());
    assert_eq!(s.list().unwrap().len(), 1);
}

#[test]
fn migration_without_legacy_config_is_a_noop() {
    let (s, _f) = open();
    assert!(!s.migrate_legacy(&MemorySecretStore::default()).unwrap());
    assert!(s.list().unwrap().is_empty());
}

#[test]
fn migration_without_key_uses_auth_none() {
    let f = NamedTempFile::new().unwrap();
    {
        let db = ConfigDb::open(f.path()).unwrap();
        db.set("llm_endpoint_url", "http://localhost:11434/v1/chat/completions/").unwrap();
        db.set("llm_model", "llama3").unwrap();
    }
    let s = LlmStore::open(f.path()).unwrap();
    assert!(s.migrate_legacy(&MemorySecretStore::default()).unwrap());
    let c = &s.list().unwrap()[0];
    assert_eq!(c.auth, AuthSource::None);
    assert_eq!(c.base_url.as_deref(), Some("http://localhost:11434/v1"));
}
```

- [x] **Step 2: Run to verify it fails** - add `pub mod store;` and `#[cfg(test)] mod store_tests;` to `llm/mod.rs`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::store_tests`
Expected: FAIL to compile (`store.rs` missing).

- [x] **Step 3: Implement**

Edit `src-tauri/src/db/config.rs`: add inside `impl ConfigDb` (after `set`):

```rust
    /// Raw connection, for modules that own extra tables in `config.db`.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }
```

Create `src-tauri/src/llm/store.rs`:

```rust
use super::connection::*;
use super::error::LlmError;
use super::secrets::{connection_account, SecretStore, LEGACY_ACCOUNT};
use crate::db::ConfigDb;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

const KEY_ACTIVE_CONN: &str = "llm_active_connection";
const KEY_ACTIVE_MODEL: &str = "llm_active_model";
const KEY_MIGRATED: &str = "llm_migrated";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSelection {
    pub connection_id: String,
    pub model: String,
}

/// Connections (one JSON row each) and the active selection, in `config.db`.
/// Never touches secrets except during legacy migration.
pub struct LlmStore {
    db: ConfigDb,
}

impl LlmStore {
    pub fn open(path: &Path) -> Result<Self, LlmError> {
        let db = ConfigDb::open(path).map_err(LlmError::storage)?;
        db.connection()
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS llm_connections (
                    id       TEXT PRIMARY KEY NOT NULL,
                    position INTEGER NOT NULL,
                    json     TEXT NOT NULL
                );",
            )
            .map_err(LlmError::storage)?;
        Ok(Self { db })
    }

    pub fn list(&self) -> Result<Vec<Connection>, LlmError> {
        let mut stmt = self
            .db
            .connection()
            .prepare("SELECT json FROM llm_connections ORDER BY position ASC")
            .map_err(LlmError::storage)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(LlmError::storage)?;
        let mut out = Vec::new();
        for row in rows {
            let json = row.map_err(LlmError::storage)?;
            out.push(serde_json::from_str(&json).map_err(LlmError::storage)?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Option<Connection>, LlmError> {
        let json: Option<String> = self
            .db
            .connection()
            .query_row("SELECT json FROM llm_connections WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(LlmError::storage)?;
        match json {
            Some(j) => Ok(Some(serde_json::from_str(&j).map_err(LlmError::storage)?)),
            None => Ok(None),
        }
    }

    /// Insert or update. An empty `id` gets a fresh uuid v4.
    pub fn upsert(&self, mut conn: Connection) -> Result<Connection, LlmError> {
        if conn.id.is_empty() {
            conn.id = uuid::Uuid::new_v4().to_string();
        }
        let json = serde_json::to_string(&conn).map_err(LlmError::storage)?;
        let next_pos: i64 = self
            .db
            .connection()
            .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM llm_connections", [], |r| r.get(0))
            .map_err(LlmError::storage)?;
        self.db
            .connection()
            .execute(
                "INSERT INTO llm_connections (id, position, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json",
                params![conn.id, next_pos, json],
            )
            .map_err(LlmError::storage)?;
        self.repair_active(&conn)?;
        Ok(conn)
    }

    /// Removes the row and clears the active selection if it pointed here.
    /// Keyring cleanup is the caller's job.
    pub fn delete(&self, id: &str) -> Result<(), LlmError> {
        self.db
            .connection()
            .execute("DELETE FROM llm_connections WHERE id = ?1", params![id])
            .map_err(LlmError::storage)?;
        if let Some(active) = self.get_active()? {
            if active.connection_id == id {
                self.clear_active()?;
            }
        }
        Ok(())
    }

    pub fn set_active(&self, connection_id: &str, model: &str) -> Result<ActiveSelection, LlmError> {
        let conn = self
            .get(connection_id)?
            .ok_or_else(|| LlmError::BadResponse("unknown connection".into()))?;
        if !conn.models.iter().any(|m| m == model) {
            return Err(LlmError::ModelNotFound);
        }
        self.db.set(KEY_ACTIVE_CONN, connection_id).map_err(LlmError::storage)?;
        self.db.set(KEY_ACTIVE_MODEL, model).map_err(LlmError::storage)?;
        Ok(ActiveSelection { connection_id: connection_id.into(), model: model.into() })
    }

    pub fn get_active(&self) -> Result<Option<ActiveSelection>, LlmError> {
        let id = self.db.get(KEY_ACTIVE_CONN).map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let model = self.db.get(KEY_ACTIVE_MODEL).map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        match (id, model) {
            (Some(connection_id), Some(model)) if self.get(&connection_id)?.is_some() => {
                Ok(Some(ActiveSelection { connection_id, model }))
            }
            _ => Ok(None),
        }
    }

    fn clear_active(&self) -> Result<(), LlmError> {
        self.db.set(KEY_ACTIVE_CONN, "").map_err(LlmError::storage)?;
        self.db.set(KEY_ACTIVE_MODEL, "").map_err(LlmError::storage)
    }

    /// If the active model was removed from `conn`, fall back to its first model.
    fn repair_active(&self, conn: &Connection) -> Result<(), LlmError> {
        if let Some(active) = self.get_active()? {
            if active.connection_id == conn.id && !conn.models.contains(&active.model) {
                match conn.models.first() {
                    Some(m) => {
                        self.db.set(KEY_ACTIVE_MODEL, m).map_err(LlmError::storage)?;
                    }
                    None => self.clear_active()?,
                }
            }
        }
        Ok(())
    }

    /// One-shot migration of the pre-connections config
    /// (`llm_endpoint_url` / `llm_model` / keyring `llm-api-key`).
    /// Returns true when a connection was created.
    pub fn migrate_legacy(&self, secrets: &dyn SecretStore) -> Result<bool, LlmError> {
        if self.db.get(KEY_MIGRATED).map_err(LlmError::storage)?.is_some() {
            return Ok(false);
        }
        let url = self.db.get("llm_endpoint_url").map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let model = self.db.get("llm_model").map_err(LlmError::storage)?.filter(|s| !s.is_empty());
        let (Some(url), Some(model)) = (url, model) else {
            self.db.set(KEY_MIGRATED, "1").map_err(LlmError::storage)?;
            return Ok(false);
        };
        let key = secrets.get(LEGACY_ACCOUNT)?;
        let saved = self.upsert(Connection {
            id: String::new(),
            name: "Migrated".into(),
            preset_id: None,
            engine: Engine::OpenAiCompat,
            base_url: Some(legacy_base_url(&url)),
            auth: if key.is_some() { AuthSource::ApiKey } else { AuthSource::None },
            auth_header: AuthHeader::Bearer,
            extra_headers: vec![],
            ca_cert_path: None,
            azure_api_version: None,
            models: vec![model.clone()],
        })?;
        if let Some(k) = &key {
            secrets.set(&connection_account(&saved.id), k)?;
        }
        self.set_active(&saved.id, &model)?;
        secrets.delete(LEGACY_ACCOUNT)?;
        self.db.set("llm_endpoint_url", "").map_err(LlmError::storage)?;
        self.db.set("llm_model", "").map_err(LlmError::storage)?;
        self.db.set(KEY_MIGRATED, "1").map_err(LlmError::storage)?;
        Ok(true)
    }
}

/// The legacy setting stored the full chat URL; connections store the base.
fn legacy_base_url(url: &str) -> String {
    let u = url.trim_end_matches('/');
    u.strip_suffix("/chat/completions").unwrap_or(u).trim_end_matches('/').to_string()
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::store_tests db::`
Expected: PASS (8 store tests + existing db tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(llm): add connection store with active selection and legacy migration"
```

---

# PHASE 2 - HTTP engines, HTTP client, error classification

### Task 5: Test utilities (mock HTTP + TLS server, fake clock, fake scripts)

**Files:**
- Create: `src-tauri/src/llm/testutil.rs`, `src-tauri/src/llm/testutil_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/testutil_tests.rs`:

```rust
use super::testutil::*;

#[tokio::test]
async fn mock_server_records_requests_and_replies() {
    let server = spawn(|req| {
        if req.path == "/hello" {
            MockResponse::json(200, r#"{"ok":true}"#)
        } else {
            MockResponse::json(404, "{}")
        }
    });
    let client = reqwest::Client::new();
    let ok = client
        .post(format!("{}/hello", server.url))
        .header("X-Test", "1")
        .body("payload")
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status().as_u16(), 200);
    let missing = client.get(format!("{}/nope", server.url)).send().await.unwrap();
    assert_eq!(missing.status().as_u16(), 404);

    let reqs = server.requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0].method, "POST");
    assert_eq!(reqs[0].path, "/hello");
    assert_eq!(reqs[0].body, "payload");
    assert_eq!(reqs[0].header("x-test"), Some("1"));
}
```

(The `FakeClock` helper and its test are added in Task 11 because it implements the `Clock` trait defined there.)

- [x] **Step 2: Run to verify it fails** - add to `llm/mod.rs`: `#[cfg(test)] pub mod testutil;` and `#[cfg(test)] mod testutil_tests;`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::testutil_tests`
Expected: FAIL to compile (`testutil.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/testutil.rs`:

```rust
//! Test-only helpers: scriptable HTTP/TLS mock server and fake executables.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    /// Path including the query string.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub struct MockResponse {
    pub status: u16,
    pub body: String,
    pub delay_ms: u64,
}

impl MockResponse {
    pub fn json(status: u16, body: &str) -> Self {
        Self { status, body: body.to_string(), delay_ms: 0 }
    }
    pub fn delayed(mut self, ms: u64) -> Self {
        self.delay_ms = ms;
        self
    }
}

pub struct MockServer {
    pub url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl MockServer {
    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

type Handler = Arc<dyn Fn(&Recorded) -> MockResponse + Send + Sync>;
type Log = Arc<Mutex<Vec<Recorded>>>;

fn read_request<S: Read>(stream: &mut S) -> Option<Recorded> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    while buf.len() < header_end + len {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let end = (header_end + len).min(buf.len());
    let body = String::from_utf8_lossy(&buf[header_end..end]).to_string();
    Some(Recorded { method, path, headers, body })
}

fn serve<S: Read + Write>(mut stream: S, handler: &Handler, log: &Log) {
    let Some(req) = read_request(&mut stream) else { return };
    log.lock().unwrap().push(req.clone());
    let resp = handler(&req);
    if resp.delay_ms > 0 {
        thread::sleep(Duration::from_millis(resp.delay_ms));
    }
    let out = format!(
        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        resp.status,
        resp.body.len(),
        resp.body
    );
    let _ = stream.write_all(out.as_bytes());
    let _ = stream.flush();
}

/// Plain-HTTP server on a random port; one thread per connection, never stops
/// (fine for tests). The handler decides every response.
pub fn spawn<F>(handler: F) -> MockServer
where
    F: Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let handler: Handler = Arc::new(handler);
    let log2 = log.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (h, l) = (handler.clone(), log2.clone());
            thread::spawn(move || serve(stream, &h, &l));
        }
    });
    MockServer { url: format!("http://127.0.0.1:{port}"), requests: log }
}

/// HTTPS server with a fresh self-signed certificate for `127.0.0.1`.
/// Returns the server and the certificate in PEM (use as `ca_cert_path` content).
pub fn spawn_tls<F>(handler: F) -> (MockServer, String)
where
    F: Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
{
    let ck = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()]).unwrap();
    let pem = ck.cert.pem();
    let cert_der = ck.cert.der().clone();
    let key_der = rustls::pki_types::PrivateKeyDer::try_from(ck.key_pair.serialize_der()).unwrap();
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .unwrap();
    let config = Arc::new(config);

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let handler: Handler = Arc::new(handler);
    let log2 = log.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (h, l, cfg) = (handler.clone(), log2.clone(), config.clone());
            thread::spawn(move || {
                let Ok(conn) = rustls::ServerConnection::new(cfg) else { return };
                serve(rustls::StreamOwned::new(conn, stream), &h, &l);
            });
        }
    });
    (MockServer { url: format!("https://127.0.0.1:{port}"), requests: log }, pem)
}

/// A TCP port nobody listens on (bind, read the port, drop the listener).
pub fn closed_port_url() -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    format!("http://127.0.0.1:{port}")
}

/// Writes an executable `sh` script into `dir` and returns its path (unix only).
#[cfg(unix)]
pub fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    {
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(format!("#!/bin/sh\n{body}\n").as_bytes()).unwrap();
        f.sync_all().unwrap();
    }
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::testutil_tests`
Expected: PASS (1 test). If `rcgen`/`rustls` API names differ for the installed versions, fix `spawn_tls` here (run `cargo doc -p rcgen --no-deps` or read the compiler error); nothing else depends on its internals.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "test(llm): add mock HTTP/TLS server and fake script helpers"
```

### Task 6: Credential type, HTTP client builder, auth header, error classification

**Files:**
- Create: `src-tauri/src/llm/auth.rs` (only `Credential` for now), `src-tauri/src/llm/http.rs`, `src-tauri/src/llm/http_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/http_tests.rs`:

```rust
use super::auth::Credential;
use super::connection::*;
use super::error::LlmError;
use super::http::*;
use super::testutil::*;
use std::time::Duration;

fn conn(url: &str, header: AuthHeader) -> Connection {
    Connection {
        id: "c1".into(),
        name: "T".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::ApiKey,
        auth_header: header,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["m".into()],
    }
}

async fn get(c: &Connection, cred: &Credential, url: &str, timeout_ms: u64) -> Result<u16, LlmError> {
    let client = build_client(c, Duration::from_millis(timeout_ms))?;
    let req = apply_auth(client.get(url), c, cred);
    match req.send().await {
        Ok(r) => Ok(r.status().as_u16()),
        Err(e) => Err(classify_send_error(&e)),
    }
}

#[tokio::test]
async fn bearer_header_is_sent() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let c = conn(&s.url, AuthHeader::Bearer);
    get(&c, &Credential::Secret("k1".into()), &format!("{}/x", s.url), 2000).await.unwrap();
    assert_eq!(s.requests()[0].header("authorization"), Some("Bearer k1"));
}

#[tokio::test]
async fn api_key_and_x_api_key_headers() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let c = conn(&s.url, AuthHeader::ApiKey);
    get(&c, &Credential::Secret("k2".into()), &s.url, 2000).await.unwrap();
    let c = conn(&s.url, AuthHeader::XApiKey);
    get(&c, &Credential::Secret("k3".into()), &s.url, 2000).await.unwrap();
    let reqs = s.requests();
    assert_eq!(reqs[0].header("api-key"), Some("k2"));
    assert_eq!(reqs[0].header("authorization"), None);
    assert_eq!(reqs[1].header("x-api-key"), Some("k3"));
}

#[tokio::test]
async fn extra_headers_are_sent_and_no_auth_without_credential() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let mut c = conn(&s.url, AuthHeader::Bearer);
    c.extra_headers = vec![("X-Team".into(), "md".into()), ("X-Env".into(), "prod".into())];
    get(&c, &Credential::None, &s.url, 2000).await.unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.header("x-team"), Some("md"));
    assert_eq!(r.header("x-env"), Some("prod"));
    assert_eq!(r.header("authorization"), None);
}

#[tokio::test]
async fn closed_port_is_unreachable() {
    let url = closed_port_url();
    let c = conn(&url, AuthHeader::Bearer);
    assert_eq!(get(&c, &Credential::None, &url, 2000).await, Err(LlmError::Unreachable));
}

#[tokio::test]
async fn slow_server_times_out() {
    let s = spawn(|_| MockResponse::json(200, "{}").delayed(1500));
    let c = conn(&s.url, AuthHeader::Bearer);
    assert_eq!(get(&c, &Credential::None, &s.url, 200).await, Err(LlmError::Timeout));
}

#[test]
fn status_classification() {
    assert_eq!(classify_status(401, ""), LlmError::Unauthorized);
    assert_eq!(classify_status(403, ""), LlmError::Unauthorized);
    assert_eq!(classify_status(404, ""), LlmError::ModelNotFound);
    assert_eq!(classify_status(408, ""), LlmError::Timeout);
    assert_eq!(classify_status(504, ""), LlmError::Timeout);
    match classify_status(500, "oops") {
        LlmError::BadResponse(m) => assert!(m.contains("500") && m.contains("oops")),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn unreadable_ca_file_is_reported() {
    let mut c = conn("https://x", AuthHeader::Bearer);
    c.ca_cert_path = Some("/definitely/not/here.pem".into());
    assert!(matches!(build_client(&c, Duration::from_secs(1)), Err(LlmError::BadResponse(_))));
}
```

- [x] **Step 2: Run to verify it fails** - add to `llm/mod.rs`: `pub mod auth;`, `pub mod http;`, `#[cfg(test)] mod http_tests;`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::http_tests`
Expected: FAIL to compile (`auth.rs`/`http.rs` missing).

- [x] **Step 3: Implement**

`src-tauri/src/llm/auth.rs` (extended in Task 11):

```rust
/// What goes into the auth header (or nothing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    None,
    Secret(String),
}
```

`src-tauri/src/llm/http.rs`:

```rust
use super::auth::Credential;
use super::connection::{AuthHeader, Connection};
use super::error::LlmError;
use reqwest::{Certificate, Client, RequestBuilder};
use std::time::Duration;

/// Per-connection client: rustls, request timeout, optional extra root CA (PEM).
pub fn build_client(conn: &Connection, timeout: Duration) -> Result<Client, LlmError> {
    let mut builder = Client::builder().use_rustls_tls().timeout(timeout);
    if let Some(path) = &conn.ca_cert_path {
        let pem = std::fs::read(path)
            .map_err(|e| LlmError::BadResponse(format!("cannot read CA file {path}: {e}")))?;
        let cert = Certificate::from_pem(&pem)
            .map_err(|e| LlmError::BadResponse(format!("invalid CA certificate: {e}")))?;
        builder = builder.add_root_certificate(cert);
    }
    builder.build().map_err(|e| LlmError::BadResponse(e.to_string()))
}

/// Adds the credential header chosen by `conn.auth_header`, then `extra_headers`.
pub fn apply_auth(mut req: RequestBuilder, conn: &Connection, cred: &Credential) -> RequestBuilder {
    if let Credential::Secret(secret) = cred {
        req = match conn.auth_header {
            AuthHeader::Bearer => req.header("Authorization", format!("Bearer {secret}")),
            AuthHeader::ApiKey => req.header("api-key", secret.as_str()),
            AuthHeader::XApiKey => req.header("x-api-key", secret.as_str()),
        };
    }
    for (name, value) in &conn.extra_headers {
        req = req.header(name.as_str(), value.as_str());
    }
    req
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut cur = e.source();
    while let Some(s) = cur {
        parts.push(s.to_string());
        cur = s.source();
    }
    parts.join(" | ")
}

/// Transport-level failure -> typed error.
pub fn classify_send_error(e: &reqwest::Error) -> LlmError {
    if e.is_timeout() {
        return LlmError::Timeout;
    }
    let chain = error_chain(e).to_lowercase();
    if chain.contains("certificate") || chain.contains("unknownissuer") || chain.contains("invalid peer") {
        return LlmError::TlsUntrusted;
    }
    if e.is_decode() || e.is_body() {
        return LlmError::BadResponse(e.to_string());
    }
    LlmError::Unreachable
}

/// Non-2xx HTTP status -> typed error.
pub fn classify_status(status: u16, body: &str) -> LlmError {
    match status {
        401 | 403 => LlmError::Unauthorized,
        404 => LlmError::ModelNotFound,
        408 | 504 => LlmError::Timeout,
        _ => {
            let snippet: String = body.chars().take(300).collect();
            LlmError::BadResponse(format!("status {status}: {snippet}"))
        }
    }
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::http_tests`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add per-connection HTTP client with auth headers and error classification"
```

### Task 7: ChatMessage + OpenAI-compatible engine (incl. Azure variant)

**Files:**
- Create: `src-tauri/src/llm/engines/mod.rs`, `src-tauri/src/llm/engines/openai.rs`, `src-tauri/src/llm/engines/openai_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/engines/openai_tests.rs`:

```rust
use super::openai;
use super::ChatMessage;
use crate::llm::auth::Credential;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::http::build_client;
use crate::llm::testutil::*;
use std::time::Duration;

fn conn(base: &str) -> Connection {
    Connection {
        id: "c".into(),
        name: "T".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(base.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["gpt-4.1".into()],
    }
}

fn msgs() -> Vec<ChatMessage> {
    vec![
        ChatMessage { role: "system".into(), content: "be brief".into() },
        ChatMessage { role: "user".into(), content: "hola".into() },
    ]
}

const CHAT_OK: &str = r#"{"choices":[{"message":{"role":"assistant","content":"respuesta"}}]}"#;

fn client(c: &Connection) -> reqwest::Client {
    build_client(c, Duration::from_millis(800)).unwrap()
}

#[tokio::test]
async fn list_models_parses_ids_and_strips_models_prefix() {
    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"gpt-4.1"},{"id":"models/gemini-2.5-pro"}]}"#));
    let c = conn(&format!("{}/v1/", s.url));
    let ids = openai::list_models(&c, &Credential::Secret("k".into()), &client(&c)).await.unwrap();
    assert_eq!(ids, vec!["gpt-4.1", "gemini-2.5-pro"]);
    let r = &s.requests()[0];
    assert_eq!(r.method, "GET");
    assert_eq!(r.path, "/v1/models");
    assert_eq!(r.header("authorization"), Some("Bearer k"));
}

#[tokio::test]
async fn list_models_404_and_405_mean_unlisted() {
    for status in [404u16, 405] {
        let s = spawn(move |_| MockResponse::json(status, "{}"));
        let c = conn(&s.url);
        let ids = openai::list_models(&c, &Credential::None, &client(&c)).await.unwrap();
        assert!(ids.is_empty());
    }
}

#[tokio::test]
async fn list_models_401_is_unauthorized_and_malformed_is_bad_response() {
    let s = spawn(|_| MockResponse::json(401, r#"{"error":"nope"}"#));
    let c = conn(&s.url);
    assert_eq!(
        openai::list_models(&c, &Credential::None, &client(&c)).await,
        Err(LlmError::Unauthorized)
    );
    let s = spawn(|_| MockResponse::json(200, "not json"));
    let c = conn(&s.url);
    assert!(matches!(
        openai::list_models(&c, &Credential::None, &client(&c)).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_posts_expected_body_and_parses_content() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let c = conn(&format!("{}/v1", s.url));
    let out = openai::chat(&c, &Credential::Secret("k".into()), &client(&c), "gpt-4.1", &msgs())
        .await
        .unwrap();
    assert_eq!(out, "respuesta");
    let r = &s.requests()[0];
    assert_eq!(r.method, "POST");
    assert_eq!(r.path, "/v1/chat/completions");
    let body: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(body["model"], "gpt-4.1");
    assert_eq!(body["stream"], false);
    assert_eq!(body["messages"][1]["content"], "hola");
}

#[tokio::test]
async fn chat_maps_404_to_model_not_found_and_5xx_to_bad_response() {
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::ModelNotFound)
    );
    let s = spawn(|_| MockResponse::json(500, "boom"));
    let c = conn(&s.url);
    assert!(matches!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_without_choices_is_bad_response() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[]}"#));
    let c = conn(&s.url);
    assert!(matches!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn chat_accepts_content_parts_array() {
    let s = spawn(|_| {
        MockResponse::json(200, r#"{"choices":[{"message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}]}"#)
    });
    let c = conn(&s.url);
    assert_eq!(
        openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await.unwrap(),
        "ab"
    );
}

#[tokio::test]
async fn azure_variant_uses_deployment_path_and_api_version() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let mut c = conn(&s.url);
    c.azure_api_version = Some("2024-10-21".into());
    c.auth_header = AuthHeader::ApiKey;
    openai::chat(&c, &Credential::Secret("az-key".into()), &client(&c), "my-gpt", &msgs())
        .await
        .unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.path, "/openai/deployments/my-gpt/chat/completions?api-version=2024-10-21");
    assert_eq!(r.header("api-key"), Some("az-key"));

    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"gpt-4.1"}]}"#));
    let mut c = conn(&s.url);
    c.azure_api_version = Some("2024-10-21".into());
    openai::list_models(&c, &Credential::None, &client(&c)).await.unwrap();
    assert_eq!(s.requests()[0].path, "/openai/models?api-version=2024-10-21");
}

#[tokio::test]
async fn custom_extra_header_reaches_the_server() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK));
    let mut c = conn(&s.url);
    c.extra_headers = vec![("X-Proxy-Team".into(), "md".into())];
    openai::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await.unwrap();
    assert_eq!(s.requests()[0].header("x-proxy-team"), Some("md"));
}

#[tokio::test]
async fn chat_timeout_is_typed() {
    let s = spawn(|_| MockResponse::json(200, CHAT_OK).delayed(1500));
    let c = conn(&s.url);
    let fast = build_client(&c, Duration::from_millis(150)).unwrap();
    assert_eq!(
        openai::chat(&c, &Credential::None, &fast, "m", &msgs()).await,
        Err(LlmError::Timeout)
    );
}
```

- [x] **Step 2: Run to verify it fails** - add to `llm/mod.rs`: `pub mod engines;`. Create `llm/engines/mod.rs` with only the test declarations plus ChatMessage (below) - but first create it minimal so the failure is the missing `openai`:

Create `src-tauri/src/llm/engines/mod.rs`:

```rust
use serde::{Deserialize, Serialize};

pub mod openai;

#[cfg(test)]
mod openai_tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}
```

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::openai_tests`
Expected: FAIL to compile (`openai.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/engines/openai.rs`:

```rust
use super::ChatMessage;
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

/// `POST /chat/completions` (non-streaming). Returns `choices[0].message.content`.
pub async fn chat(
    conn: &Connection,
    cred: &Credential,
    client: &Client,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let body = json!({ "model": model, "messages": messages, "stream": false });
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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::openai_tests`
Expected: PASS (10 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add OpenAI-compatible engine with Azure variant"
```

### Task 8: Anthropic Messages engine

**Files:**
- Create: `src-tauri/src/llm/engines/anthropic.rs`, `src-tauri/src/llm/engines/anthropic_tests.rs`
- Modify: `src-tauri/src/llm/engines/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/engines/anthropic_tests.rs`:

```rust
use super::{anthropic, ChatMessage};
use crate::llm::auth::Credential;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::http::build_client;
use crate::llm::testutil::*;
use std::time::Duration;

fn conn(base: &str) -> Connection {
    Connection {
        id: "c".into(),
        name: "A".into(),
        preset_id: None,
        engine: Engine::AnthropicMessages,
        base_url: Some(base.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::XApiKey,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["claude-sonnet-4-5".into()],
    }
}

fn client(c: &Connection) -> reqwest::Client {
    build_client(c, Duration::from_millis(800)).unwrap()
}

fn msgs() -> Vec<ChatMessage> {
    vec![
        ChatMessage { role: "system".into(), content: "be brief".into() },
        ChatMessage { role: "user".into(), content: "hola".into() },
    ]
}

#[tokio::test]
async fn chat_sends_headers_system_and_joins_text_blocks() {
    let s = spawn(|_| {
        MockResponse::json(
            200,
            r#"{"content":[{"type":"text","text":"uno "},{"type":"tool_use","id":"x"},{"type":"text","text":"dos"}]}"#,
        )
    });
    let c = conn(&s.url);
    let out = anthropic::chat(&c, &Credential::Secret("sk-ant".into()), &client(&c), "claude-sonnet-4-5", &msgs())
        .await
        .unwrap();
    assert_eq!(out, "uno dos");
    let r = &s.requests()[0];
    assert_eq!(r.path, "/v1/messages");
    assert_eq!(r.header("x-api-key"), Some("sk-ant"));
    assert_eq!(r.header("anthropic-version"), Some("2023-06-01"));
    let body: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(body["model"], "claude-sonnet-4-5");
    assert_eq!(body["system"], "be brief");
    assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    assert_eq!(body["messages"][0]["role"], "user");
    assert!(body["max_tokens"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn azure_foundry_base_path_is_preserved_and_bearer_works() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"ok"}]}"#));
    let mut c = conn(&format!("{}/anthropic", s.url));
    c.auth_header = AuthHeader::Bearer;
    anthropic::chat(&c, &Credential::Secret("entra".into()), &client(&c), "m", &msgs()).await.unwrap();
    let r = &s.requests()[0];
    assert_eq!(r.path, "/anthropic/v1/messages");
    assert_eq!(r.header("authorization"), Some("Bearer entra"));
}

#[tokio::test]
async fn chat_errors_are_typed() {
    let s = spawn(|_| MockResponse::json(401, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::Unauthorized)
    );
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert_eq!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::ModelNotFound)
    );
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[]}"#));
    let c = conn(&s.url);
    assert!(matches!(
        anthropic::chat(&c, &Credential::None, &client(&c), "m", &msgs()).await,
        Err(LlmError::BadResponse(_))
    ));
}

#[tokio::test]
async fn list_models_parses_data_ids() {
    let s = spawn(|_| MockResponse::json(200, r#"{"data":[{"id":"claude-opus-4-1"},{"id":"claude-haiku-4-5"}]}"#));
    let c = conn(&s.url);
    let ids = anthropic::list_models(&c, &Credential::Secret("k".into()), &client(&c)).await.unwrap();
    assert_eq!(ids, vec!["claude-opus-4-1", "claude-haiku-4-5"]);
    assert_eq!(s.requests()[0].path, "/v1/models");
    assert_eq!(s.requests()[0].header("anthropic-version"), Some("2023-06-01"));
}

#[tokio::test]
async fn list_models_404_means_unlisted() {
    let s = spawn(|_| MockResponse::json(404, "{}"));
    let c = conn(&s.url);
    assert!(anthropic::list_models(&c, &Credential::None, &client(&c)).await.unwrap().is_empty());
}
```

- [x] **Step 2: Run to verify it fails** - in `engines/mod.rs` add `pub mod anthropic;` after `pub mod openai;` and `#[cfg(test)] mod anthropic_tests;` after the openai one.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::anthropic_tests`
Expected: FAIL to compile (`anthropic.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/engines/anthropic.rs`:

```rust
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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::anthropic_tests`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add Anthropic Messages engine"
```

### Task 9: TLS behaviour (self-signed server, custom root CA)

**Files:**
- Create: `src-tauri/src/llm/tls_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/tls_tests.rs`:

```rust
use super::auth::Credential;
use super::connection::*;
use super::engines::openai;
use super::error::LlmError;
use super::http::build_client;
use super::testutil::*;
use std::time::Duration;

fn conn(url: &str, ca: Option<String>) -> Connection {
    Connection {
        id: "t".into(),
        name: "TLS".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::None,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: ca,
        azure_api_version: None,
        models: vec!["m".into()],
    }
}

const MODELS: &str = r#"{"data":[{"id":"gpt-4.1"}]}"#;

#[tokio::test]
async fn self_signed_server_fails_with_tls_untrusted_without_ca() {
    let (server, _pem) = spawn_tls(|_| MockResponse::json(200, MODELS));
    let c = conn(&server.url, None);
    let client = build_client(&c, Duration::from_secs(3)).unwrap();
    assert_eq!(
        openai::list_models(&c, &Credential::None, &client).await,
        Err(LlmError::TlsUntrusted)
    );
}

#[tokio::test]
async fn self_signed_server_succeeds_with_ca_cert_path() {
    let (server, pem) = spawn_tls(|_| MockResponse::json(200, MODELS));
    let dir = tempfile::tempdir().unwrap();
    let ca = dir.path().join("ca.pem");
    std::fs::write(&ca, pem).unwrap();
    let c = conn(&server.url, Some(ca.to_string_lossy().to_string()));
    let client = build_client(&c, Duration::from_secs(3)).unwrap();
    let ids = openai::list_models(&c, &Credential::None, &client).await.unwrap();
    assert_eq!(ids, vec!["gpt-4.1"]);
}
```

- [x] **Step 2: Run to verify it fails** - add `#[cfg(test)] mod tls_tests;` to `llm/mod.rs`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::tls_tests`
Expected: with the infrastructure from Tasks 5-7 these should actually **pass immediately** (this task adds coverage, not production code). If `self_signed_server_fails...` returns `Unreachable` instead of `TlsUntrusted`, the classifier needs the fix in Step 3. If any test panics with "Could not automatically determine the process-level CryptoProvider", see the risk note below.

- [x] **Step 3: Fix only if Step 2 failed** - In `http.rs::classify_send_error`, print the chain once (`eprintln!("{}", error_chain(e))`) to see the actual rustls message, and add the missing substring to the `contains` checks (typical: `"invalid peer certificate"`, `"unknownissuer"`, `"certificate verify failed"`). Remove the `eprintln!` afterwards.

Risk note: if two rustls crypto providers end up enabled (`cargo tree -i aws-lc-rs` prints something), either remove the feature that pulls it in or install the ring provider explicitly once at startup: `let _ = rustls::crypto::ring::default_provider().install_default();` (add `rustls = { version = "0.23", default-features = false, features = ["ring", "std"] }` to `[dependencies]` in that case and call it at the top of `main()` and in the TLS tests).

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::tls_tests`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "test(llm): cover self-signed TLS failure and custom root CA success"
```

---

# PHASE 3 - Auth (Azure CLI token cache) and CLI engines

### Task 10: Process runner and binary resolver

**Files:**
- Create: `src-tauri/src/llm/proc.rs`, `src-tauri/src/llm/proc_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/proc_tests.rs`:

```rust
use super::error::LlmError;
use super::proc::*;
use std::path::Path;
use std::time::Duration;

fn sh() -> &'static Path {
    Path::new("/bin/sh")
}

fn args(script: &str) -> Vec<String> {
    vec!["-c".to_string(), script.to_string()]
}

#[cfg(unix)]
#[tokio::test]
async fn passes_stdin_and_captures_stdout() {
    let tmp = std::env::temp_dir();
    let out = run(sh(), &args("cat"), Some("hello"), &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(out.code, Some(0));
    assert_eq!(out.stdout, "hello");
}

#[cfg(unix)]
#[tokio::test]
async fn reports_exit_code_and_stderr() {
    let tmp = std::env::temp_dir();
    let out = run(sh(), &args("echo oops >&2; exit 3"), None, &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(out.code, Some(3));
    assert!(out.stderr.contains("oops"));
}

#[cfg(unix)]
#[tokio::test]
async fn removes_listed_env_vars_from_the_child() {
    std::env::set_var("MD_TEST_SECRET", "abc");
    let tmp = std::env::temp_dir();
    let kept = run(sh(), &args("echo \"[$MD_TEST_SECRET]\""), None, &[], &tmp, Duration::from_secs(5)).await.unwrap();
    assert_eq!(kept.stdout.trim(), "[abc]");
    let scrubbed =
        run(sh(), &args("echo \"[$MD_TEST_SECRET]\""), None, &["MD_TEST_SECRET"], &tmp, Duration::from_secs(5))
            .await
            .unwrap();
    assert_eq!(scrubbed.stdout.trim(), "[]");
}

#[cfg(unix)]
#[tokio::test]
async fn kills_and_reports_timeout() {
    let tmp = std::env::temp_dir();
    let r = run(sh(), &args("sleep 5"), None, &[], &tmp, Duration::from_millis(200)).await;
    assert_eq!(r.unwrap_err(), LlmError::Timeout);
}

#[tokio::test]
async fn missing_binary_is_cli_missing() {
    let tmp = std::env::temp_dir();
    let r = run(Path::new("/no/such/binary-xyz"), &[], None, &[], &tmp, Duration::from_secs(1)).await;
    assert_eq!(r.unwrap_err(), LlmError::CliMissing);
}

#[test]
fn fixed_resolver_resolves_registered_names_only() {
    let r = FixedResolver::default().with("claude", "/opt/claude");
    assert_eq!(r.resolve("claude"), Some("/opt/claude".into()));
    assert_eq!(r.resolve("gemini"), None);
}

#[test]
fn login_shell_resolver_rejects_unsafe_names() {
    let r = LoginShellResolver::default();
    assert_eq!(r.resolve("a;rm -rf /"), None);
    assert_eq!(r.resolve(""), None);
    assert_eq!(r.resolve("$(whoami)"), None);
}

#[cfg(unix)]
#[test]
fn login_shell_resolver_finds_sh_and_caches() {
    let r = LoginShellResolver::default();
    let p = r.resolve("sh").expect("sh must exist");
    assert!(p.is_absolute() && p.exists());
    assert_eq!(r.resolve("sh"), Some(p));
    assert_eq!(r.resolve("definitely-not-a-real-binary-xyz"), None);
}
```

- [x] **Step 2: Run to verify it fails** - add `pub mod proc;` and `#[cfg(test)] mod proc_tests;` to `llm/mod.rs`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::proc_tests`
Expected: FAIL to compile (`proc.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/proc.rs`:

```rust
use super::error::LlmError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// Finds an executable by name. Injectable so tests can point at fake scripts.
pub trait BinaryResolver: Send + Sync {
    fn resolve(&self, name: &str) -> Option<PathBuf>;
}

/// Test resolver: a fixed name -> path table.
#[derive(Default)]
pub struct FixedResolver(pub HashMap<String, PathBuf>);

impl FixedResolver {
    pub fn with(mut self, name: &str, path: impl Into<PathBuf>) -> Self {
        self.0.insert(name.to_string(), path.into());
        self
    }
}

impl BinaryResolver for FixedResolver {
    fn resolve(&self, name: &str) -> Option<PathBuf> {
        self.0.get(name).cloned()
    }
}

/// Dock-launched macOS apps do not inherit the user's PATH, so ask a login
/// shell (`zsh -lc 'command -v X'`; `where X` on Windows). Successes are cached.
#[derive(Default)]
pub struct LoginShellResolver {
    cache: Mutex<HashMap<String, PathBuf>>,
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

impl BinaryResolver for LoginShellResolver {
    fn resolve(&self, name: &str) -> Option<PathBuf> {
        if !safe_name(name) {
            return None;
        }
        if let Some(p) = self.cache.lock().unwrap().get(name) {
            return Some(p.clone());
        }
        let out = if cfg!(windows) {
            std::process::Command::new("where").arg(name).output().ok()?
        } else {
            std::process::Command::new("zsh").args(["-lc", &format!("command -v {name}")]).output().ok()?
        };
        if !out.status.success() {
            return None;
        }
        // Login shells may print rc-file noise first; the last absolute existing path wins.
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let found = stdout
            .lines()
            .rev()
            .map(str::trim)
            .map(PathBuf::from)
            .find(|p| p.is_absolute() && p.is_file())?;
        self.cache.lock().unwrap().insert(name.to_string(), found.clone());
        Some(found)
    }
}

#[derive(Debug, Clone)]
pub struct CmdOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `bin` non-interactively: optional stdin, scrubbed env vars, fixed cwd,
/// hard timeout (the child is killed when the future is dropped).
pub async fn run(
    bin: &Path,
    args: &[String],
    stdin: Option<&str>,
    env_remove: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<CmdOutput, LlmError> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in env_remove {
        cmd.env_remove(key);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            LlmError::CliMissing
        } else {
            LlmError::BadResponse(format!("cannot start {}: {e}", bin.display()))
        }
    })?;
    if let Some(mut si) = child.stdin.take() {
        let data = stdin.unwrap_or("").to_string();
        // Write in a task so a child that never reads cannot deadlock us; dropping closes stdin.
        tokio::spawn(async move {
            let _ = si.write_all(data.as_bytes()).await;
        });
    }
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Err(_) => Err(LlmError::Timeout),
        Ok(Err(e)) => Err(LlmError::BadResponse(format!("process error: {e}"))),
        Ok(Ok(o)) => Ok(CmdOutput {
            code: o.status.code(),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        }),
    }
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::proc_tests`
Expected: PASS (8 tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add process runner and login-shell binary resolver"
```

### Task 11: Azure CLI token cache, credential resolution, LlmEnv

**Files:**
- Modify: `src-tauri/src/llm/auth.rs` (replace), `src-tauri/src/llm/testutil.rs` (append)
- Create: `src-tauri/src/llm/env.rs`, `src-tauri/src/llm/auth_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/auth_tests.rs`:

```rust
use super::auth::*;
use super::connection::*;
use super::error::LlmError;
use super::proc::{BinaryResolver, FixedResolver};
use super::testutil::*;
use std::sync::Arc;
use std::time::Duration;

fn provider(resolver: FixedResolver, clock: Arc<FakeClock>) -> AzTokenProvider {
    let r: Arc<dyn BinaryResolver> = Arc::new(resolver);
    AzTokenProvider::new(r, clock, Duration::from_secs(5))
}

#[test]
fn fake_clock_advances() {
    let c = FakeClock::new(1_000);
    assert_eq!(Clock::now_unix(&c), 1_000);
    c.advance(60);
    assert_eq!(Clock::now_unix(&c), 1_060);
}

#[cfg(unix)]
mod az {
    use super::*;

    /// Fake `az`: appends its args to a counter file and returns tok-<n> expiring at `exp`.
    fn fake_az(dir: &std::path::Path, exp: i64) -> (FixedResolver, std::path::PathBuf) {
        let counter = dir.join("calls.txt");
        let body = format!(
            "echo \"$@\" >> '{c}'\nn=$(wc -l < '{c}' | tr -d ' ')\nprintf '{{\"accessToken\":\"tok-%s\",\"expires_on\":{exp},\"tokenType\":\"Bearer\"}}' \"$n\"",
            c = counter.display(),
            exp = exp
        );
        let script = write_script(dir, "az", &body);
        (FixedResolver::default().with("az", script), counter)
    }

    fn calls(counter: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(counter).unwrap_or_default().lines().map(String::from).collect()
    }

    #[tokio::test]
    async fn token_is_cached_until_five_minutes_before_expiry() {
        let dir = tempfile::tempdir().unwrap();
        let (resolver, counter) = fake_az(dir.path(), 10_000);
        let clock = Arc::new(FakeClock::new(1_000));
        let p = provider(resolver, clock.clone());

        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(calls(&counter).len(), 1);

        clock.set(9_600); // 400s left: still cached
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-1");
        assert_eq!(calls(&counter).len(), 1);

        clock.set(9_750); // 250s left (< 300): refresh
        assert_eq!(p.token("scope-a").await.unwrap(), "tok-2");
        assert_eq!(calls(&counter).len(), 2);
    }

    #[tokio::test]
    async fn passes_scope_and_json_output_flags_and_caches_per_scope() {
        let dir = tempfile::tempdir().unwrap();
        let (resolver, counter) = fake_az(dir.path(), 10_000);
        let p = provider(resolver, Arc::new(FakeClock::new(1_000)));
        p.token("https://cognitiveservices.azure.com/.default").await.unwrap();
        p.token("api://other/.default").await.unwrap();
        let c = calls(&counter);
        assert_eq!(c.len(), 2);
        assert_eq!(
            c[0],
            "account get-access-token --scope https://cognitiveservices.azure.com/.default --output json"
        );
        assert!(c[1].contains("api://other/.default"));
    }

    #[tokio::test]
    async fn not_logged_in_maps_to_cli_not_logged_in() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(
            dir.path(),
            "az",
            "echo \"ERROR: Please run 'az login' to setup account.\" >&2\nexit 1",
        );
        let p = provider(FixedResolver::default().with("az", script), Arc::new(FakeClock::new(0)));
        assert_eq!(p.token("s").await.unwrap_err(), LlmError::CliNotLoggedIn);
    }

    #[tokio::test]
    async fn other_az_failures_are_bad_response() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(dir.path(), "az", "echo 'kaboom' >&2\nexit 2");
        let p = provider(FixedResolver::default().with("az", script), Arc::new(FakeClock::new(0)));
        assert!(matches!(p.token("s").await.unwrap_err(), LlmError::BadResponse(m) if m.contains("kaboom")));
    }

    #[tokio::test]
    async fn expires_on_may_be_a_numeric_string() {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(
            dir.path(),
            "az",
            "printf '{\"accessToken\":\"t\",\"expires_on\":\"5000\"}'",
        );
        let clock = Arc::new(FakeClock::new(1_000));
        let p = provider(FixedResolver::default().with("az", script), clock);
        assert_eq!(p.token("s").await.unwrap(), "t");
    }
}

#[tokio::test]
async fn missing_az_is_cli_missing() {
    let p = provider(FixedResolver::default(), Arc::new(FakeClock::new(0)));
    assert_eq!(p.token("s").await.unwrap_err(), LlmError::CliMissing);
}

fn conn(auth: AuthSource) -> Connection {
    Connection {
        id: "c".into(),
        name: "n".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x".into()),
        auth,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec![],
    }
}

#[tokio::test]
async fn resolve_none_and_api_key() {
    let p = provider(FixedResolver::default(), Arc::new(FakeClock::new(0)));
    assert_eq!(resolve(&conn(AuthSource::None), None, &p).await.unwrap(), Credential::None);
    assert_eq!(
        resolve(&conn(AuthSource::ApiKey), Some("k"), &p).await.unwrap(),
        Credential::Secret("k".into())
    );
    assert_eq!(resolve(&conn(AuthSource::ApiKey), None, &p).await.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(resolve(&conn(AuthSource::ApiKey), Some(""), &p).await.unwrap_err(), LlmError::Unauthorized);
}
```

Also create `src-tauri/src/llm/env_tests.rs`:

```rust
use super::connection::*;
use super::env::LlmEnv;
use super::proc::FixedResolver;
use super::secrets::connection_account;
use super::testutil::test_env;

fn conn(id: &str) -> Connection {
    Connection {
        id: id.into(),
        name: "n".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://x".into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec![],
    }
}

#[test]
fn secret_for_reads_the_connection_account() {
    let env = test_env(FixedResolver::default(), 1000);
    assert_eq!(env.secret_for(&conn("abc")).unwrap(), None);
    env.secrets.set(&connection_account("abc"), "k").unwrap();
    assert_eq!(env.secret_for(&conn("abc")).unwrap().as_deref(), Some("k"));
    assert_eq!(env.secret_for(&conn("")).unwrap(), None);
}

#[test]
fn production_env_builds() {
    let env = LlmEnv::production();
    assert_eq!(env.timeout.as_secs(), 120);
}
```

- [x] **Step 2: Run to verify it fails** - in `llm/mod.rs` add `pub mod env;` and `#[cfg(test)] mod auth_tests;`, `#[cfg(test)] mod env_tests;`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::auth_tests llm::env_tests`
Expected: FAIL to compile (`AzTokenProvider`, `FakeClock`, `env` missing).

- [x] **Step 3: Implement**

Replace `src-tauri/src/llm/auth.rs`:

```rust
use super::connection::{AuthSource, Connection};
use super::error::LlmError;
use super::proc::{self, BinaryResolver};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// What goes into the auth header (or nothing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    None,
    Secret(String),
}

pub trait Clock: Send + Sync {
    fn now_unix(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> i64 {
        chrono::Utc::now().timestamp()
    }
}

/// Tokens are refreshed when fewer than this many seconds remain.
pub const REFRESH_MARGIN_SECS: i64 = 300;

/// Obtains Entra ID tokens through `az account get-access-token`, cached per scope.
pub struct AzTokenProvider {
    resolver: Arc<dyn BinaryResolver>,
    clock: Arc<dyn Clock>,
    timeout: Duration,
    cache: Mutex<HashMap<String, (String, i64)>>,
}

fn looks_not_logged_in(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    ["az login", "not logged in", "aadsts", "interactive authentication is needed", "refresh token has expired"]
        .iter()
        .any(|m| s.contains(m))
}

fn parse_local_datetime(s: &str) -> Option<i64> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f").ok()?;
    chrono::Local.from_local_datetime(&naive).single().map(|d| d.timestamp())
}

/// Returns (token, expiry as unix seconds). Accepts `expires_on` (number or
/// numeric string) and falls back to the local-time `expiresOn` string.
fn parse_token(stdout: &str, now: i64) -> Result<(String, i64), LlmError> {
    let v: Value =
        serde_json::from_str(stdout.trim()).map_err(|e| LlmError::BadResponse(format!("az output: {e}")))?;
    let token = v
        .get("accessToken")
        .or_else(|| v.get("access_token"))
        .and_then(Value::as_str)
        .ok_or_else(|| LlmError::BadResponse("az output: missing accessToken".into()))?
        .to_string();
    let exp = v
        .get("expires_on")
        .and_then(|e| e.as_i64().or_else(|| e.as_str().and_then(|s| s.parse().ok())))
        .or_else(|| v.get("expiresOn").and_then(Value::as_str).and_then(parse_local_datetime))
        .unwrap_or(now + REFRESH_MARGIN_SECS);
    Ok((token, exp))
}

impl AzTokenProvider {
    pub fn new(resolver: Arc<dyn BinaryResolver>, clock: Arc<dyn Clock>, timeout: Duration) -> Self {
        Self { resolver, clock, timeout, cache: Mutex::new(HashMap::new()) }
    }

    pub async fn token(&self, scope: &str) -> Result<String, LlmError> {
        let now = self.clock.now_unix();
        {
            let cache = self.cache.lock().unwrap();
            if let Some((tok, exp)) = cache.get(scope) {
                if exp - now > REFRESH_MARGIN_SECS {
                    return Ok(tok.clone());
                }
            }
        }
        let bin = self.resolver.resolve("az").ok_or(LlmError::CliMissing)?;
        let args: Vec<String> = ["account", "get-access-token", "--scope", scope, "--output", "json"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let out = proc::run(&bin, &args, None, &[], &std::env::temp_dir(), self.timeout).await?;
        if out.code != Some(0) {
            if looks_not_logged_in(&out.stderr) {
                return Err(LlmError::CliNotLoggedIn);
            }
            let snippet: String = out.stderr.trim().chars().take(300).collect();
            return Err(LlmError::BadResponse(format!("az failed: {snippet}")));
        }
        let (tok, exp) = parse_token(&out.stdout, now)?;
        self.cache.lock().unwrap().insert(scope.to_string(), (tok.clone(), exp));
        Ok(tok)
    }
}

/// Turns the connection's `AuthSource` into a concrete credential.
/// `secret` is the keyring value (or the freshly typed one during validation).
pub async fn resolve(conn: &Connection, secret: Option<&str>, az: &AzTokenProvider) -> Result<Credential, LlmError> {
    match &conn.auth {
        AuthSource::None => Ok(Credential::None),
        AuthSource::ApiKey => match secret.filter(|s| !s.is_empty()) {
            Some(s) => Ok(Credential::Secret(s.to_string())),
            None => Err(LlmError::Unauthorized),
        },
        AuthSource::AzureCli { scope } => Ok(Credential::Secret(az.token(scope).await?)),
    }
}
```

`src-tauri/src/llm/env.rs`:

```rust
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
            Duration::from_secs(120),
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
```

Append to `src-tauri/src/llm/testutil.rs`:

```rust
use super::auth::Clock;
use super::env::LlmEnv;
use super::proc::FixedResolver;
use super::secrets::MemorySecretStore;
use std::sync::atomic::{AtomicI64, Ordering};

/// Controllable clock for token-cache tests.
pub struct FakeClock(AtomicI64);

impl FakeClock {
    pub fn new(now: i64) -> Self {
        Self(AtomicI64::new(now))
    }
    pub fn set(&self, now: i64) {
        self.0.store(now, Ordering::SeqCst);
    }
    pub fn advance(&self, secs: i64) {
        self.0.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// LlmEnv with in-memory secrets, a fake clock and the given fake binaries.
pub fn test_env(resolver: FixedResolver, timeout_ms: u64) -> LlmEnv {
    LlmEnv::new(
        Arc::new(resolver),
        Arc::new(FakeClock::new(1_000)),
        Arc::new(MemorySecretStore::default()),
        Duration::from_millis(timeout_ms),
    )
}
```

(`Arc`, `Duration` are already imported at the top of `testutil.rs`.)

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::auth_tests llm::env_tests llm::http_tests`
Expected: PASS (auth: 8 on unix incl. clock; env: 2; http still green). Note: tests that write+exec fake scripts could very rarely hit `Text file busy` under parallel `fork`; if seen, re-run (do not add sleeps).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add Azure CLI token cache, credential resolution and LlmEnv"
```

### Task 12: CLI engines (`claude -p`, `gemini -p`)

**Files:**
- Create: `src-tauri/src/llm/engines/cli.rs`, `src-tauri/src/llm/engines/cli_tests.rs`
- Modify: `src-tauri/src/llm/engines/mod.rs`

**Verified against the installed CLIs (`claude --help`, `gemini --help`):**
- Claude Code 2.1.212: `-p/--print`, `--output-format json` ("single result"), `--model`, `--tools ""` (disables all tools), `--no-session-persistence`, `--system-prompt`. **Do not use `--bare`** (it ignores OAuth/subscription login). Prompt goes on stdin. JSON fields parsed tolerantly: `result`, `is_error`.
- Gemini CLI 0.57.0: `-p/--prompt`, `-m/--model`, `--approval-mode plan` ("read-only mode"), `-o/--output-format json`. The exact JSON shape of `-o json` is **not verified** (no real prompt is run in this plan); the parser accepts `response`, `result` or `text`, and falls back to raw stdout.

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/engines/cli_tests.rs`:

```rust
use super::cli::*;
use super::ChatMessage;
use crate::llm::connection::Engine;
use crate::llm::error::LlmError;

fn m(role: &str, content: &str) -> ChatMessage {
    ChatMessage { role: role.into(), content: content.into() }
}

#[test]
fn fixed_model_lists() {
    assert_eq!(fixed_models(Engine::CliClaude), vec!["opus", "sonnet", "haiku"]);
    assert!(fixed_models(Engine::CliGemini).contains(&"gemini-2.5-pro".to_string()));
    assert!(fixed_models(Engine::OpenAiCompat).is_empty());
}

#[test]
fn split_messages_separates_system_from_turns() {
    let (sys, prompt) = split_messages(&[m("system", "a"), m("system", "b"), m("user", "hola")]);
    assert_eq!(sys, "a\n\nb");
    assert_eq!(prompt, "hola");
    let (_, multi) = split_messages(&[m("user", "q1"), m("assistant", "a1"), m("user", "q2")]);
    assert_eq!(multi, "user: q1\n\nassistant: a1\n\nuser: q2");
}

#[test]
fn claude_args_are_headless_and_toolless() {
    let a = claude_args("opus", "be brief");
    let joined = a.join(" ");
    assert!(joined.contains("-p --output-format json --model opus"));
    assert!(a.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
    assert!(a.contains(&"--no-session-persistence".to_string()));
    assert!(a.windows(2).any(|w| w[0] == "--system-prompt" && w[1] == "be brief"));
    assert!(!a.contains(&"--bare".to_string()));
    assert!(!claude_args("opus", "").contains(&"--system-prompt".to_string()));
}

#[test]
fn gemini_args_use_plan_mode_and_json() {
    let a = gemini_args("gemini-2.5-pro", "hola");
    assert_eq!(
        a,
        vec!["-p", "hola", "-m", "gemini-2.5-pro", "--approval-mode", "plan", "-o", "json"]
    );
}

#[test]
fn parse_claude_variants() {
    assert_eq!(parse_claude(r#"{"type":"result","is_error":false,"result":"hola"}"#).unwrap(), "hola");
    assert_eq!(
        parse_claude(r#"[{"type":"system"},{"type":"result","is_error":false,"result":"arr"}]"#).unwrap(),
        "arr"
    );
    assert_eq!(
        parse_claude(r#"{"is_error":true,"result":"Not logged in · Please run /login"}"#).unwrap_err(),
        LlmError::CliNotLoggedIn
    );
    assert!(matches!(
        parse_claude(r#"{"is_error":true,"result":"rate limited"}"#).unwrap_err(),
        LlmError::BadResponse(_)
    ));
    assert!(matches!(parse_claude("not json").unwrap_err(), LlmError::BadResponse(_)));
    assert!(matches!(parse_claude(r#"{"is_error":false}"#).unwrap_err(), LlmError::BadResponse(_)));
}

#[test]
fn parse_gemini_variants() {
    assert_eq!(parse_gemini(r#"{"response":"hi"}"#).unwrap(), "hi");
    assert_eq!(parse_gemini(r#"{"result":"r"}"#).unwrap(), "r");
    assert_eq!(parse_gemini("plain text\n").unwrap(), "plain text");
    assert_eq!(
        parse_gemini(r#"{"error":{"message":"Please login: no auth method"}}"#).unwrap_err(),
        LlmError::CliNotLoggedIn
    );
    assert!(matches!(parse_gemini("   ").unwrap_err(), LlmError::BadResponse(_)));
}

#[test]
fn unauthenticated_detection() {
    assert!(looks_unauthenticated("Not logged in · Please run /login"));
    assert!(looks_unauthenticated("Error: Please set an Auth method in your settings.json"));
    assert!(!looks_unauthenticated("rate limit exceeded"));
}

#[cfg(unix)]
mod with_scripts {
    use super::*;
    use crate::llm::proc::FixedResolver;
    use crate::llm::testutil::{test_env, write_script};

    fn env_with(name: &str, script_body: &str, timeout_ms: u64) -> (crate::llm::env::LlmEnv, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let script = write_script(dir.path(), name, script_body);
        (test_env(FixedResolver::default().with(name, script), timeout_ms), dir)
    }

    #[tokio::test]
    async fn claude_success() {
        let (env, _d) = env_with("claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"hola mundo\"}'", 5000);
        let out = chat(Engine::CliClaude, &env, "opus", &[m("user", "hi")]).await.unwrap();
        assert_eq!(out, "hola mundo");
    }

    #[tokio::test]
    async fn claude_gets_prompt_on_stdin_scrubbed_env_and_temp_cwd() {
        std::env::set_var("ANTHROPIC_API_KEY", "sk-should-not-leak");
        std::env::set_var("ANTHROPIC_AUTH_TOKEN", "tok-should-not-leak");
        let body = "prompt=$(cat)\nprintf '{\"is_error\":false,\"result\":\"key=[%s] tok=[%s] cwd=%s args=%s prompt=%s\"}' \"$ANTHROPIC_API_KEY\" \"$ANTHROPIC_AUTH_TOKEN\" \"$(pwd)\" \"$*\" \"$prompt\"";
        let (env, _d) = env_with("claude", body, 5000);
        let out = chat(Engine::CliClaude, &env, "opus", &[m("system", "be brief"), m("user", "hola")])
            .await
            .unwrap();
        assert!(out.contains("key=[]"), "{out}");
        assert!(out.contains("tok=[]"), "{out}");
        assert!(!out.contains("should-not-leak"), "{out}");
        assert!(out.contains("--model opus"), "{out}");
        assert!(out.contains("--no-session-persistence"), "{out}");
        assert!(out.contains("--system-prompt be brief"), "{out}");
        assert!(out.contains("prompt=hola"), "{out}");
        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        assert!(!out.contains(&format!("cwd={cwd}")), "must not run in the project dir: {out}");
    }

    #[tokio::test]
    async fn claude_not_logged_in_via_error_json() {
        let (env, _d) = env_with(
            "claude",
            "cat >/dev/null\necho '{\"is_error\":true,\"result\":\"Not logged in · Please run /login\"}'\nexit 1",
            5000,
        );
        assert_eq!(
            chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliNotLoggedIn
        );
    }

    #[tokio::test]
    async fn claude_crash_is_bad_response_with_stderr() {
        let (env, _d) = env_with("claude", "cat >/dev/null\necho boom >&2\nexit 2", 5000);
        match chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err() {
            LlmError::BadResponse(msg) => assert!(msg.contains("boom"), "{msg}"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test]
    async fn claude_timeout() {
        let (env, _d) = env_with("claude", "sleep 5", 200);
        assert_eq!(
            chat(Engine::CliClaude, &env, "opus", &[m("user", "x")]).await.unwrap_err(),
            LlmError::Timeout
        );
    }

    #[tokio::test]
    async fn missing_binary_is_cli_missing() {
        let env = test_env(FixedResolver::default(), 1000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-pro", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliMissing
        );
        assert_eq!(detect(Engine::CliClaude, env.resolver.as_ref()).unwrap_err(), LlmError::CliMissing);
    }

    #[tokio::test]
    async fn gemini_success_scrubs_api_keys_and_uses_plan_mode() {
        std::env::set_var("GEMINI_API_KEY", "g-should-not-leak");
        std::env::set_var("GOOGLE_API_KEY", "google-should-not-leak");
        let body = "printf '{\"response\":\"key=[%s] google=[%s] args=%s\"}' \"$GEMINI_API_KEY\" \"$GOOGLE_API_KEY\" \"$*\"";
        let (env, _d) = env_with("gemini", body, 5000);
        let out = chat(Engine::CliGemini, &env, "gemini-2.5-pro", &[m("system", "sys"), m("user", "hola")])
            .await
            .unwrap();
        assert!(out.contains("key=[]") && out.contains("google=[]"), "{out}");
        assert!(out.contains("--approval-mode plan"), "{out}");
        assert!(out.contains("-m gemini-2.5-pro"), "{out}");
        assert!(out.contains("sys"), "system prompt is folded into the prompt: {out}");
        assert!(out.contains("hola"), "{out}");
    }

    #[tokio::test]
    async fn gemini_plain_text_and_auth_failure() {
        let (env, _d) = env_with("gemini", "echo plain answer", 5000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-flash", &[m("user", "x")]).await.unwrap(),
            "plain answer"
        );
        let (env, _d) = env_with("gemini", "echo 'Please set an Auth method in your settings.json' >&2\nexit 41", 5000);
        assert_eq!(
            chat(Engine::CliGemini, &env, "gemini-2.5-flash", &[m("user", "x")]).await.unwrap_err(),
            LlmError::CliNotLoggedIn
        );
    }
}
```

- [x] **Step 2: Run to verify it fails** - in `engines/mod.rs` add `pub mod cli;` and `#[cfg(test)] mod cli_tests;`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::cli_tests`
Expected: FAIL to compile (`cli.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/engines/cli.rs`:

```rust
use super::ChatMessage;
use crate::llm::connection::Engine;
use crate::llm::env::LlmEnv;
use crate::llm::error::LlmError;
use crate::llm::proc::{self, BinaryResolver};
use serde_json::Value;
use std::path::PathBuf;

pub const CLAUDE_MODELS: [&str; 3] = ["opus", "sonnet", "haiku"];
pub const GEMINI_MODELS: [&str; 3] = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

pub fn bin_name(engine: Engine) -> &'static str {
    match engine {
        Engine::CliClaude => "claude",
        Engine::CliGemini => "gemini",
        _ => "",
    }
}

pub fn fixed_models(engine: Engine) -> Vec<String> {
    let list: &[&str] = match engine {
        Engine::CliClaude => &CLAUDE_MODELS,
        Engine::CliGemini => &GEMINI_MODELS,
        _ => &[],
    };
    list.iter().map(|s| s.to_string()).collect()
}

pub fn detect(engine: Engine, resolver: &dyn BinaryResolver) -> Result<PathBuf, LlmError> {
    resolver.resolve(bin_name(engine)).ok_or(LlmError::CliMissing)
}

/// API-key env vars that would make the CLI bill an API account instead of using
/// the subscription login. They are removed from the child environment.
fn env_scrub(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::CliClaude => &["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
        Engine::CliGemini => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        _ => &[],
    }
}

/// (system prompt, conversation prompt). One user turn -> its bare content.
pub fn split_messages(messages: &[ChatMessage]) -> (String, String) {
    let system = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let turns: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    let prompt = if turns.len() == 1 {
        turns[0].content.clone()
    } else {
        turns.iter().map(|m| format!("{}: {}", m.role, m.content)).collect::<Vec<_>>().join("\n\n")
    };
    (system, prompt)
}

pub fn claude_args(model: &str, system: &str) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if !system.is_empty() {
        a.push("--system-prompt".into());
        a.push(system.into());
    }
    a
}

pub fn gemini_args(model: &str, prompt: &str) -> Vec<String> {
    ["-p", prompt, "-m", model, "--approval-mode", "plan", "-o", "json"].iter().map(|s| s.to_string()).collect()
}

pub fn looks_unauthenticated(text: &str) -> bool {
    let s = text.to_lowercase();
    [
        "not logged in",
        "please run /login",
        "/login",
        "invalid api key",
        "authentication_error",
        "oauth token has expired",
        "auth method",
        "gemini_api_key",
        "not authenticated",
        "please login",
        "login required",
    ]
    .iter()
    .any(|m| s.contains(m))
}

fn snippet(s: &str) -> String {
    s.trim().chars().take(300).collect()
}

pub fn parse_claude(stdout: &str) -> Result<String, LlmError> {
    let v: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| LlmError::BadResponse(format!("claude output is not JSON: {e}")))?;
    let obj = match &v {
        Value::Array(items) => items
            .iter()
            .rev()
            .find(|i| i.get("type").and_then(Value::as_str) == Some("result"))
            .cloned()
            .unwrap_or(Value::Null),
        other => other.clone(),
    };
    let result = obj.get("result").and_then(Value::as_str).unwrap_or("");
    if obj.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        return Err(if looks_unauthenticated(result) {
            LlmError::CliNotLoggedIn
        } else {
            LlmError::BadResponse(format!("claude error: {}", snippet(result)))
        });
    }
    if result.is_empty() {
        return Err(LlmError::BadResponse("claude returned no result".into()));
    }
    Ok(result.to_string())
}

pub fn parse_gemini(stdout: &str) -> Result<String, LlmError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(LlmError::BadResponse("gemini returned no output".into()));
    }
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
            return Err(if looks_unauthenticated(msg) {
                LlmError::CliNotLoggedIn
            } else {
                LlmError::BadResponse(format!("gemini error: {}", snippet(msg)))
            });
        }
        for key in ["response", "result", "text"] {
            if let Some(s) = v.get(key).and_then(Value::as_str) {
                return Ok(s.to_string());
            }
        }
    }
    Ok(trimmed.to_string())
}

/// One headless turn through the CLI, in an empty temp dir, with no tools.
pub async fn chat(engine: Engine, env: &LlmEnv, model: &str, messages: &[ChatMessage]) -> Result<String, LlmError> {
    let bin = detect(engine, env.resolver.as_ref())?;
    let (system, prompt) = split_messages(messages);
    let (args, stdin) = match engine {
        Engine::CliClaude => (claude_args(model, &system), Some(prompt)),
        Engine::CliGemini => {
            let full = if system.is_empty() { prompt } else { format!("{system}\n\n{prompt}") };
            (gemini_args(model, &full), None)
        }
        _ => return Err(LlmError::BadResponse("not a CLI engine".into())),
    };
    let dir = tempfile::tempdir().map_err(|e| LlmError::BadResponse(format!("tempdir: {e}")))?;
    let out = proc::run(&bin, &args, stdin.as_deref(), env_scrub(engine), dir.path(), env.timeout).await?;
    if out.code != Some(0) {
        let combined = format!("{}\n{}", out.stdout, out.stderr);
        if looks_unauthenticated(&combined) {
            return Err(LlmError::CliNotLoggedIn);
        }
        let detail = if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr };
        return Err(LlmError::BadResponse(format!(
            "{} exited with {:?}: {}",
            bin_name(engine),
            out.code,
            snippet(detail)
        )));
    }
    match engine {
        Engine::CliClaude => parse_claude(&out.stdout),
        _ => parse_gemini(&out.stdout),
    }
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::cli_tests`
Expected: PASS (7 pure tests + 8 script tests on unix).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add claude and gemini CLI engines with scrubbed env"
```

### Task 13: Engine dispatch

**Files:**
- Modify: `src-tauri/src/llm/engines/mod.rs` (replace)
- Create: `src-tauri/src/llm/engines/dispatch_tests.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/engines/dispatch_tests.rs`:

```rust
use super::{chat, list_models, ChatMessage};
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::proc::FixedResolver;
use crate::llm::testutil::*;

fn conn(engine: Engine, url: &str, auth: AuthSource, header: AuthHeader) -> Connection {
    Connection {
        id: "c".into(),
        name: "n".into(),
        preset_id: None,
        engine,
        base_url: Some(url.into()),
        auth,
        auth_header: header,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["m".into()],
    }
}

fn user(text: &str) -> Vec<ChatMessage> {
    vec![ChatMessage { role: "user".into(), content: text.into() }]
}

#[tokio::test]
async fn openai_engine_with_api_key() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") {
            MockResponse::json(200, r#"{"data":[{"id":"a"}]}"#)
        } else {
            MockResponse::json(200, r#"{"choices":[{"message":{"content":"yo"}}]}"#)
        }
    });
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::OpenAiCompat, &s.url, AuthSource::ApiKey, AuthHeader::Bearer);
    assert_eq!(list_models(&c, Some("k"), &env).await.unwrap(), vec!["a"]);
    assert_eq!(chat(&c, "m", &user("hi"), Some("k"), &env).await.unwrap(), "yo");
    assert_eq!(s.requests()[1].header("authorization"), Some("Bearer k"));
}

#[tokio::test]
async fn missing_api_key_fails_before_any_network_call() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::OpenAiCompat, &s.url, AuthSource::ApiKey, AuthHeader::Bearer);
    assert_eq!(list_models(&c, None, &env).await.unwrap_err(), LlmError::Unauthorized);
    assert!(s.requests().is_empty());
}

#[tokio::test]
async fn anthropic_engine_dispatches_to_messages() {
    let s = spawn(|_| MockResponse::json(200, r#"{"content":[{"type":"text","text":"claude says hi"}]}"#));
    let env = test_env(FixedResolver::default(), 2000);
    let c = conn(Engine::AnthropicMessages, &s.url, AuthSource::ApiKey, AuthHeader::XApiKey);
    assert_eq!(chat(&c, "m", &user("hi"), Some("k"), &env).await.unwrap(), "claude says hi");
    assert_eq!(s.requests()[0].path, "/v1/messages");
}

#[cfg(unix)]
#[tokio::test]
async fn azure_cli_auth_puts_the_az_token_in_the_bearer_header() {
    let s = spawn(|_| MockResponse::json(200, r#"{"choices":[{"message":{"content":"ok"}}]}"#));
    let dir = tempfile::tempdir().unwrap();
    let az = write_script(dir.path(), "az", "printf '{\"accessToken\":\"entra-token\",\"expires_on\":99999}'");
    let env = test_env(FixedResolver::default().with("az", az), 5000);
    let c = conn(
        Engine::OpenAiCompat,
        &s.url,
        AuthSource::AzureCli { scope: DEFAULT_AZURE_SCOPE.into() },
        AuthHeader::Bearer,
    );
    assert_eq!(chat(&c, "m", &user("hi"), None, &env).await.unwrap(), "ok");
    assert_eq!(s.requests()[0].header("authorization"), Some("Bearer entra-token"));
}

#[tokio::test]
async fn azure_cli_auth_without_az_is_cli_missing() {
    let env = test_env(FixedResolver::default(), 1000);
    let c = conn(
        Engine::OpenAiCompat,
        "http://127.0.0.1:1",
        AuthSource::AzureCli { scope: DEFAULT_AZURE_SCOPE.into() },
        AuthHeader::Bearer,
    );
    assert_eq!(chat(&c, "m", &user("hi"), None, &env).await.unwrap_err(), LlmError::CliMissing);
}

#[cfg(unix)]
#[tokio::test]
async fn cli_engine_lists_fixed_models_and_chats() {
    let dir = tempfile::tempdir().unwrap();
    let claude = write_script(dir.path(), "claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"cli says hi\"}'");
    let env = test_env(FixedResolver::default().with("claude", claude), 5000);
    let mut c = conn(Engine::CliClaude, "", AuthSource::None, AuthHeader::Bearer);
    c.base_url = None;
    assert_eq!(list_models(&c, None, &env).await.unwrap(), vec!["opus", "sonnet", "haiku"]);
    assert_eq!(chat(&c, "opus", &user("hi"), None, &env).await.unwrap(), "cli says hi");
}

#[tokio::test]
async fn cli_engine_without_binary_is_cli_missing() {
    let env = test_env(FixedResolver::default(), 1000);
    let mut c = conn(Engine::CliGemini, "", AuthSource::None, AuthHeader::Bearer);
    c.base_url = None;
    assert_eq!(list_models(&c, None, &env).await.unwrap_err(), LlmError::CliMissing);
}
```

- [x] **Step 2: Run to verify it fails** - replace `src-tauri/src/llm/engines/mod.rs` with the module declarations only (dispatch comes in Step 3):

```rust
use serde::{Deserialize, Serialize};

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
```

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines::dispatch_tests`
Expected: FAIL to compile (`chat` / `list_models` not found in `engines`).

- [x] **Step 3: Implement** - append to `src-tauri/src/llm/engines/mod.rs` (and add the new imports at the top of the file):

```rust
use super::auth;
use super::connection::{Connection, Engine};
use super::env::LlmEnv;
use super::error::LlmError;
use super::http;

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
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::engines`
Expected: PASS (all engine tests incl. 7 dispatch tests).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): dispatch chat and model listing by engine"
```

---

# PHASE 4 - Validation pipeline, Tauri commands, brain_query on the active connection

### Task 14: Validation pipeline and validation tokens

**Files:**
- Create: `src-tauri/src/llm/validate.rs`, `src-tauri/src/llm/validate_tests.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing test** - `src-tauri/src/llm/validate_tests.rs`:

```rust
use super::connection::*;
use super::error::LlmError;
use super::proc::FixedResolver;
use super::testutil::*;
use super::validate::*;
use std::sync::{Arc, Mutex};

const MODELS_OK: &str = r#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4o"}]}"#;
const CHAT_OK: &str = r#"{"choices":[{"message":{"content":"ok"}}]}"#;

fn conn(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "T".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["gpt-4.1".into()],
    }
}

type Events = Arc<Mutex<Vec<ProgressEvent>>>;

async fn run_with(c: &Connection, secret: Option<&str>, env: &crate::llm::env::LlmEnv) -> (Result<Validated, LlmError>, Vec<(Step, StepStatus)>, Events) {
    let events: Events = Arc::new(Mutex::new(vec![]));
    let sink = events.clone();
    let emit = move |e: ProgressEvent| sink.lock().unwrap().push(e);
    let r = run(c, secret, env, &emit).await;
    let seq = events.lock().unwrap().iter().map(|e| (e.step, e.status)).collect();
    (r, seq, events)
}

fn env() -> crate::llm::env::LlmEnv {
    test_env(FixedResolver::default(), 1500)
}

#[tokio::test]
async fn happy_path_emits_all_steps_in_order() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert_eq!(v.available, vec!["gpt-4.1", "gpt-4o"]);
    assert_eq!(v.verified, vec!["gpt-4.1", "gpt-4o"]);
    use Step::*;
    use StepStatus::*;
    assert_eq!(
        seq,
        vec![
            (Reach, Running), (Reach, Ok),
            (Credential, Running), (Credential, Ok),
            (Models, Running), (Models, Ok),
            (Completion, Running), (Completion, Ok),
        ]
    );
}

#[tokio::test]
async fn unreachable_stops_at_reach() {
    let (r, seq, events) = run_with(&conn(&closed_port_url()), Some("k"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unreachable);
    assert_eq!(seq.last().unwrap(), &(Step::Reach, StepStatus::Failed));
    assert_eq!(seq.len(), 2);
    assert_eq!(events.lock().unwrap().last().unwrap().error, Some(LlmError::Unreachable));
}

#[tokio::test]
async fn missing_api_key_fails_credential_without_network() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let (r, seq, _) = run_with(&conn(&s.url), None, &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
    assert!(s.requests().is_empty());
}

#[tokio::test]
async fn unauthorized_everywhere_fails_credential() {
    let s = spawn(|_| MockResponse::json(401, "{}"));
    let (r, seq, _) = run_with(&conn(&s.url), Some("bad"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::Unauthorized);
    assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
}

#[tokio::test]
async fn models_endpoint_rejecting_key_but_chat_working_still_validates() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(403, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert!(v.available.is_empty());
    assert_eq!(v.verified, vec!["gpt-4.1"]);
    assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Ok));
    // chat was only attempted once (the credential probe is reused)
    assert_eq!(s.requests().iter().filter(|r| r.method == "POST").count(), 1);
}

#[tokio::test]
async fn unlisted_models_are_reported_and_only_the_tested_one_is_verified() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (r, _, events) = run_with(&conn(&s.url), Some("k"), &env()).await;
    let v = r.unwrap();
    assert!(v.available.is_empty());
    assert_eq!(v.verified, vec!["gpt-4.1"]);
    let models_ok = events.lock().unwrap().iter().find(|e| e.step == Step::Models && e.status == StepStatus::Ok).cloned().unwrap();
    assert_eq!(models_ok.detail.as_deref(), Some("unlisted"));
}

#[tokio::test]
async fn unknown_model_fails_at_completion() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(404, "{}") }
    });
    let (r, seq, _) = run_with(&conn(&s.url), Some("k"), &env()).await;
    assert_eq!(r.unwrap_err(), LlmError::ModelNotFound);
    assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Failed));
}

#[tokio::test]
async fn draft_without_models_is_rejected_up_front() {
    let s = spawn(|_| MockResponse::json(200, "{}"));
    let mut c = conn(&s.url);
    c.models.clear();
    let (r, seq, _) = run_with(&c, Some("k"), &env()).await;
    assert!(matches!(r.unwrap_err(), LlmError::BadResponse(_)));
    assert!(seq.is_empty());
}

#[tokio::test]
async fn validation_never_touches_the_secret_store() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    });
    let e = env();
    let (r, _, _) = run_with(&conn(&s.url), Some("k"), &e).await;
    r.unwrap();
    assert_eq!(e.secrets.get("llm-connection:").unwrap(), None);
}

#[cfg(unix)]
mod cli {
    use super::*;

    fn cli_conn() -> Connection {
        Connection {
            id: String::new(),
            name: "Home".into(),
            preset_id: None,
            engine: Engine::CliClaude,
            base_url: None,
            auth: AuthSource::None,
            auth_header: AuthHeader::Bearer,
            extra_headers: vec![],
            ca_cert_path: None,
            azure_api_version: None,
            models: vec!["sonnet".into()],
        }
    }

    #[tokio::test]
    async fn cli_happy_path_reports_installed_logged_in_and_fixed_models() {
        let dir = tempfile::tempdir().unwrap();
        let claude = write_script(dir.path(), "claude", "cat >/dev/null\necho '{\"is_error\":false,\"result\":\"ok\"}'");
        let e = test_env(FixedResolver::default().with("claude", claude), 5000);
        let (r, seq, _) = run_with(&cli_conn(), None, &e).await;
        let v = r.unwrap();
        assert_eq!(v.available, vec!["opus", "sonnet", "haiku"]);
        assert_eq!(v.verified, vec!["opus", "sonnet", "haiku"]);
        assert_eq!(seq.last().unwrap(), &(Step::Completion, StepStatus::Ok));
    }

    #[tokio::test]
    async fn cli_missing_fails_at_reach() {
        let (r, seq, _) = run_with(&cli_conn(), None, &env()).await;
        assert_eq!(r.unwrap_err(), LlmError::CliMissing);
        assert_eq!(seq.last().unwrap(), &(Step::Reach, StepStatus::Failed));
    }

    #[tokio::test]
    async fn cli_not_logged_in_fails_at_credential() {
        let dir = tempfile::tempdir().unwrap();
        let claude = write_script(
            dir.path(),
            "claude",
            "cat >/dev/null\necho '{\"is_error\":true,\"result\":\"Not logged in · Please run /login\"}'\nexit 1",
        );
        let e = test_env(FixedResolver::default().with("claude", claude), 5000);
        let (r, seq, _) = run_with(&cli_conn(), None, &e).await;
        assert_eq!(r.unwrap_err(), LlmError::CliNotLoggedIn);
        assert_eq!(seq.last().unwrap(), &(Step::Credential, StepStatus::Failed));
    }
}

// ── tokens ────────────────────────────────────────────────────────────────────

#[test]
fn fingerprint_ignores_name_models_and_id_but_not_endpoint_or_secret() {
    let a = conn("https://a");
    let mut renamed = a.clone();
    renamed.name = "Other".into();
    renamed.models = vec!["x".into(), "y".into()];
    renamed.id = "abc".into();
    assert_eq!(fingerprint(&a, Some("k")), fingerprint(&renamed, Some("k")));

    let mut moved = a.clone();
    moved.base_url = Some("https://b".into());
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&moved, Some("k")));
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&a, Some("k2")));
    let mut headered = a.clone();
    headered.extra_headers = vec![("X".into(), "1".into())];
    assert_ne!(fingerprint(&a, Some("k")), fingerprint(&headered, Some("k")));
}

#[test]
fn token_must_match_fingerprint_and_cover_all_models_and_is_single_use() {
    let store = ValidationStore::default();
    let token = store.issue(42, vec!["a".to_string(), "b".to_string()]);

    assert_eq!(store.consume("nope", 42, &["a".to_string()]), Err(LlmError::NotValidated));
    assert_eq!(store.consume(&token, 43, &["a".to_string()]), Err(LlmError::NotValidated));
    assert_eq!(store.consume(&token, 42, &["a".to_string(), "zzz".to_string()]), Err(LlmError::NotValidated));
    // failed attempts do not burn the token
    assert_eq!(store.consume(&token, 42, &["a".to_string(), "b".to_string()]), Ok(()));
    assert_eq!(store.consume(&token, 42, &["a".to_string()]), Err(LlmError::NotValidated));
}

#[test]
fn add_verified_extends_the_token() {
    let store = ValidationStore::default();
    let token = store.issue(7, vec!["a".to_string()]);
    assert_eq!(store.add_verified(&token, 8, "b"), Err(LlmError::NotValidated));
    store.add_verified(&token, 7, "b").unwrap();
    assert_eq!(store.consume(&token, 7, &["a".to_string(), "b".to_string()]), Ok(()));
}
```

- [x] **Step 2: Run to verify it fails** - add `pub mod validate;` and `#[cfg(test)] mod validate_tests;` to `llm/mod.rs`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::validate_tests`
Expected: FAIL to compile (`validate.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/llm/validate.rs`:

```rust
use super::connection::{AuthSource, Connection};
use super::engines::{self, ChatMessage};
use super::env::LlmEnv;
use super::error::LlmError;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

pub const TEST_PROMPT: &str = "Reply with the single word: ok";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Reach,
    Credential,
    Models,
    Completion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Running,
    Ok,
    Failed,
}

/// Payload of the `llm-validate-progress` event.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub step: Step,
    pub status: StepStatus,
    pub detail: Option<String>,
    pub error: Option<LlmError>,
}

pub type Emit<'a> = &'a (dyn Fn(ProgressEvent) + Send + Sync);

#[derive(Debug, Clone, PartialEq)]
pub struct Validated {
    /// Models listed by the endpoint (or the CLI's fixed list). Empty = unlisted.
    pub available: Vec<String>,
    /// Models that may be saved: listed ones plus every test-completed one.
    pub verified: Vec<String>,
}

fn step(emit: Emit<'_>, step: Step, status: StepStatus, detail: Option<String>, error: Option<LlmError>) {
    emit(ProgressEvent { step, status, detail, error });
}

fn fail(emit: Emit<'_>, s: Step, e: LlmError) -> LlmError {
    step(emit, s, StepStatus::Failed, None, Some(e.clone()));
    e
}

/// One real round trip with the given model. Never persists anything.
pub async fn test_completion(conn: &Connection, model: &str, secret: Option<&str>, env: &LlmEnv) -> Result<(), LlmError> {
    let msgs = [ChatMessage { role: "user".into(), content: TEST_PROMPT.into() }];
    let answer = engines::chat(conn, model, &msgs, secret, env).await?;
    if answer.trim().is_empty() {
        return Err(LlmError::BadResponse("empty completion".into()));
    }
    Ok(())
}

/// reach -> credential -> models -> completion. Stops at the first failure.
/// `conn.models[0]` is the model used for the test completion.
pub async fn run(conn: &Connection, secret: Option<&str>, env: &LlmEnv, emit: Emit<'_>) -> Result<Validated, LlmError> {
    conn.validate_shape()?;
    let test_model = conn
        .models
        .first()
        .cloned()
        .ok_or_else(|| LlmError::BadResponse("choose a model to test".into()))?;
    if matches!(conn.auth, AuthSource::ApiKey) && secret.map_or(true, str::is_empty) {
        return Err(fail(emit, Step::Credential, LlmError::Unauthorized));
    }

    // 1. Reach: list models (or detect the CLI binary).
    step(emit, Step::Reach, StepStatus::Running, None, None);
    let listed = engines::list_models(conn, secret, env).await;
    if let Err(e) = &listed {
        if matches!(e, LlmError::Unreachable | LlmError::TlsUntrusted | LlmError::Timeout | LlmError::CliMissing) {
            return Err(fail(emit, Step::Reach, e.clone()));
        }
    }
    step(emit, Step::Reach, StepStatus::Ok, None, None);

    // 2. Credential. Some providers reject /models for plan keys but accept chat,
    //    so an Unauthorized listing is re-checked with a real completion.
    //    CLIs are "logged in" only if a completion works.
    step(emit, Step::Credential, StepStatus::Running, None, None);
    if let Err(LlmError::CliNotLoggedIn) = &listed {
        return Err(fail(emit, Step::Credential, LlmError::CliNotLoggedIn));
    }
    let mut completed = false;
    if conn.engine.is_cli() || matches!(&listed, Err(LlmError::Unauthorized)) {
        if let Err(e) = test_completion(conn, &test_model, secret, env).await {
            return Err(fail(emit, Step::Credential, e));
        }
        completed = true;
    }
    step(emit, Step::Credential, StepStatus::Ok, None, None);

    // 3. Models (any other listing failure is treated as "unlisted").
    step(emit, Step::Models, StepStatus::Running, None, None);
    let available = listed.unwrap_or_default();
    let detail = if available.is_empty() { "unlisted".to_string() } else { format!("{} models", available.len()) };
    step(emit, Step::Models, StepStatus::Ok, Some(detail), None);

    // 4. Test completion.
    step(emit, Step::Completion, StepStatus::Running, None, None);
    if !completed {
        if let Err(e) = test_completion(conn, &test_model, secret, env).await {
            return Err(fail(emit, Step::Completion, e));
        }
    }
    step(emit, Step::Completion, StepStatus::Ok, None, None);

    let mut verified = available.clone();
    if !verified.contains(&test_model) {
        verified.push(test_model);
    }
    Ok(Validated { available, verified })
}

// ── validation tokens ─────────────────────────────────────────────────────────

/// Hash of everything that affects connectivity (not name / models / id) plus the
/// effective secret. In-process integrity check, not a security primitive.
pub fn fingerprint(conn: &Connection, secret: Option<&str>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&(
        conn.engine,
        &conn.base_url,
        &conn.auth,
        conn.auth_header,
        &conn.extra_headers,
        &conn.ca_cert_path,
        &conn.azure_api_version,
    ))
    .unwrap_or_default()
    .hash(&mut h);
    secret.unwrap_or("").hash(&mut h);
    h.finish()
}

struct Entry {
    fingerprint: u64,
    verified: HashSet<String>,
}

/// Tokens issued by a successful validation; required (and consumed) by save.
#[derive(Default)]
pub struct ValidationStore {
    inner: Mutex<HashMap<String, Entry>>,
}

impl ValidationStore {
    pub fn issue(&self, fingerprint: u64, verified: impl IntoIterator<Item = String>) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.inner
            .lock()
            .unwrap()
            .insert(token.clone(), Entry { fingerprint, verified: verified.into_iter().collect() });
        token
    }

    pub fn add_verified(&self, token: &str, fingerprint: u64, model: &str) -> Result<(), LlmError> {
        let mut map = self.inner.lock().unwrap();
        match map.get_mut(token) {
            Some(e) if e.fingerprint == fingerprint => {
                e.verified.insert(model.to_string());
                Ok(())
            }
            _ => Err(LlmError::NotValidated),
        }
    }

    /// Succeeds (and burns the token) only if the fingerprint matches and every
    /// model in `models` is verified. A failed attempt keeps the token.
    pub fn consume(&self, token: &str, fingerprint: u64, models: &[String]) -> Result<(), LlmError> {
        let mut map = self.inner.lock().unwrap();
        let ok = match map.get(token) {
            Some(e) => e.fingerprint == fingerprint && models.iter().all(|m| e.verified.contains(m)),
            None => false,
        };
        if !ok {
            return Err(LlmError::NotValidated);
        }
        map.remove(token);
        Ok(())
    }
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test llm::validate_tests`
Expected: PASS (13 tests on unix: 9 pipeline + 3 cli + 3 token/fingerprint... counts may vary by platform; all green).

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/llm
git commit -m "feat(llm): add validation pipeline with progress events and one-shot tokens"
```

### Task 15: Tauri LLM commands (testable `*_inner` + wrappers)

**Files:**
- Create: `src-tauri/src/commands/llm_cmd.rs`, `src-tauri/src/commands/llm_tests.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/brain_cmd.rs` (make `app_db_path` `pub(crate)`)

- [x] **Step 1: Write the failing test** - `src-tauri/src/commands/llm_tests.rs`:

```rust
use super::llm_cmd::*;
use crate::llm::connection::*;
use crate::llm::error::LlmError;
use crate::llm::proc::FixedResolver;
use crate::llm::secrets::connection_account;
use crate::llm::store::LlmStore;
use crate::llm::testutil::*;
use crate::llm::validate::ValidationStore;
use tempfile::NamedTempFile;

const MODELS_OK: &str = r#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4o"}]}"#;
const CHAT_OK: &str = r#"{"choices":[{"message":{"content":"ok"}}]}"#;

fn ok_server() -> MockServer {
    spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(200, MODELS_OK) } else { MockResponse::json(200, CHAT_OK) }
    })
}

fn draft(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "Office".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["gpt-4.1".into()],
    }
}

fn setup() -> (NamedTempFile, crate::llm::env::LlmEnv, ValidationStore) {
    (NamedTempFile::new().unwrap(), test_env(FixedResolver::default(), 2000), ValidationStore::default())
}

fn silent(_: crate::llm::validate::ProgressEvent) {}

#[tokio::test]
async fn validate_persists_nothing() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let r = validate_inner(&env, &vs, &draft(&s.url), Some("sk".into()), &silent).await.unwrap();
    assert!(!r.token.is_empty());
    assert_eq!(r.available, vec!["gpt-4.1", "gpt-4o"]);
    assert!(LlmStore::open(db.path()).unwrap().list().unwrap().is_empty());
    assert_eq!(env.secrets.get("llm-connection:").unwrap(), None);
}

#[tokio::test]
async fn save_requires_a_valid_matching_token() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    // no token at all
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("sk".into()), "bogus").unwrap_err(), LlmError::NotValidated);

    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    // secret changed after validation
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("other".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    // endpoint changed after validation
    let mut moved = d.clone();
    moved.base_url = Some("https://evil.example".into());
    assert_eq!(save_inner(db.path(), &env, &vs, moved, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    // unverified model selected
    let mut other_model = d.clone();
    other_model.models = vec!["never-tested".into()];
    assert_eq!(save_inner(db.path(), &env, &vs, other_model, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
    assert!(LlmStore::open(db.path()).unwrap().list().unwrap().is_empty());
}

#[tokio::test]
async fn save_writes_connection_secret_and_first_active() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    d.models = vec!["gpt-4.1".into(), "gpt-4o".into()];
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    assert_eq!(saved.id.len(), 36);
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap().as_deref(), Some("sk"));
    let active = get_active_inner(db.path()).unwrap().unwrap();
    assert_eq!(active.connection_id, saved.id);
    assert_eq!(active.model, "gpt-4.1");
    // the token is single use
    assert_eq!(
        save_inner(db.path(), &env, &vs, draft(&s.url), Some("sk".into()), &r.token).unwrap_err(),
        LlmError::NotValidated
    );
}

#[tokio::test]
async fn second_connection_does_not_steal_the_active_selection() {
    let s = ok_server();
    let (db, env, vs) = setup();
    for name in ["One", "Two"] {
        let mut d = draft(&s.url);
        d.name = name.into();
        let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
        save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();
    }
    let list = list_inner(db.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(get_active_inner(db.path()).unwrap().unwrap().connection_id, list[0].id);
}

#[tokio::test]
async fn editing_with_a_blank_secret_reuses_the_keyring_value() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk-original".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk-original".into()), &r.token).unwrap();

    let mut edit = saved.clone();
    edit.name = "Renamed".into();
    let r2 = validate_inner(&env, &vs, &edit, None, &silent).await.unwrap();
    // validation used the stored key
    assert_eq!(s.requests().last().unwrap().header("authorization"), Some("Bearer sk-original"));
    let saved2 = save_inner(db.path(), &env, &vs, edit, None, &r2.token).unwrap();
    assert_eq!(saved2.id, saved.id);
    assert_eq!(saved2.name, "Renamed");
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap().as_deref(), Some("sk-original"));
    assert_eq!(list_inner(db.path()).unwrap().len(), 1);
}

#[tokio::test]
async fn switching_auth_away_from_api_key_deletes_the_secret() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    let mut edit = saved.clone();
    edit.auth = AuthSource::None;
    let r2 = validate_inner(&env, &vs, &edit, None, &silent).await.unwrap();
    save_inner(db.path(), &env, &vs, edit, None, &r2.token).unwrap();
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap(), None);
}

#[tokio::test]
async fn api_key_connection_without_any_secret_cannot_be_saved() {
    let (db, env, vs) = setup();
    let token = vs.issue(0, vec!["gpt-4.1".to_string()]);
    assert_eq!(
        save_inner(db.path(), &env, &vs, draft("https://x"), None, &token).unwrap_err(),
        LlmError::Unauthorized
    );
}

#[tokio::test]
async fn verify_model_extends_the_token_so_unlisted_models_can_be_saved() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    d.models = vec!["gpt-4.1".into(), "gpt-4o".into()];
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    assert_eq!(r.verified, vec!["gpt-4.1"]);
    assert_eq!(save_inner(db.path(), &env, &vs, d.clone(), Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);

    verify_model_inner(&env, &vs, &d, Some("sk".into()), &r.token, "gpt-4o").await.unwrap();
    save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();
}

#[tokio::test]
async fn verify_model_failure_does_not_extend_the_token() {
    let s = spawn(|r| {
        if r.path.ends_with("/models") { MockResponse::json(404, "{}") } else if r.body.contains("bad-model") { MockResponse::json(404, "{}") } else { MockResponse::json(200, CHAT_OK) }
    });
    let (db, env, vs) = setup();
    let mut d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    assert_eq!(
        verify_model_inner(&env, &vs, &d, Some("sk".into()), &r.token, "bad-model").await.unwrap_err(),
        LlmError::ModelNotFound
    );
    d.models = vec!["gpt-4.1".into(), "bad-model".into()];
    assert_eq!(save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap_err(), LlmError::NotValidated);
}

#[tokio::test]
async fn delete_removes_row_secret_and_active() {
    let s = ok_server();
    let (db, env, vs) = setup();
    let d = draft(&s.url);
    let r = validate_inner(&env, &vs, &d, Some("sk".into()), &silent).await.unwrap();
    let saved = save_inner(db.path(), &env, &vs, d, Some("sk".into()), &r.token).unwrap();

    delete_inner(db.path(), &env, &saved.id).unwrap();
    assert!(list_inner(db.path()).unwrap().is_empty());
    assert_eq!(env.secrets.get(&connection_account(&saved.id)).unwrap(), None);
    assert_eq!(get_active_inner(db.path()).unwrap(), None);
}

#[test]
fn set_active_validates_connection_and_model() {
    let (db, _env, _vs) = setup();
    let store = LlmStore::open(db.path()).unwrap();
    let mut c = draft("https://x");
    c.models = vec!["a".into(), "b".into()];
    let saved = store.upsert(c).unwrap();
    assert!(set_active_inner(db.path(), &saved.id, "zzz").is_err());
    let sel = set_active_inner(db.path(), &saved.id, "b").unwrap();
    assert_eq!(sel.model, "b");
}

#[test]
fn detect_cli_reports_installed_state() {
    let env = test_env(FixedResolver::default().with("claude", "/opt/bin/claude"), 1000);
    let found = detect_cli_inner(&env, Engine::CliClaude);
    assert!(found.installed);
    assert_eq!(found.path.as_deref(), Some("/opt/bin/claude"));
    let missing = detect_cli_inner(&env, Engine::CliGemini);
    assert!(!missing.installed && missing.path.is_none());
}
```

- [x] **Step 2: Run to verify it fails** - edit `src-tauri/src/commands/mod.rs`: add

```rust
pub mod llm_cmd;
pub use llm_cmd::*;
#[cfg(test)]
mod llm_tests;
```

In `brain_cmd.rs` change `fn app_db_path` to `pub(crate) fn app_db_path`.

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test commands::llm_tests`
Expected: FAIL to compile (`llm_cmd.rs` missing).

- [x] **Step 3: Implement** - `src-tauri/src/commands/llm_cmd.rs`:

```rust
use crate::commands::brain_cmd::app_db_path;
use crate::llm::connection::{AuthSource, Connection, Engine};
use crate::llm::engines::cli;
use crate::llm::env::LlmEnv;
use crate::llm::error::LlmError;
use crate::llm::secrets::{connection_account, KeyringStore};
use crate::llm::store::{ActiveSelection, LlmStore};
use crate::llm::validate::{self, fingerprint, Emit, ProgressEvent, ValidationStore};
use serde::Serialize;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResult {
    pub token: String,
    pub available: Vec<String>,
    pub verified: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDetection {
    pub installed: bool,
    pub path: Option<String>,
}

/// A freshly typed secret wins; otherwise an existing API-key connection falls
/// back to its keyring entry (editing without re-typing the key).
fn effective_secret(env: &LlmEnv, draft: &Connection, typed: Option<String>) -> Result<Option<String>, LlmError> {
    if let Some(s) = typed.filter(|s| !s.is_empty()) {
        return Ok(Some(s));
    }
    if matches!(draft.auth, AuthSource::ApiKey) && !draft.id.is_empty() {
        return env.secret_for(draft);
    }
    Ok(None)
}

pub async fn validate_inner(
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: &Connection,
    typed_secret: Option<String>,
    emit: Emit<'_>,
) -> Result<ValidateResult, LlmError> {
    let secret = effective_secret(env, draft, typed_secret)?;
    let validated = validate::run(draft, secret.as_deref(), env, emit).await?;
    let token = vs.issue(fingerprint(draft, secret.as_deref()), validated.verified.clone());
    Ok(ValidateResult { token, available: validated.available, verified: validated.verified })
}

/// Test-completes one extra model and adds it to the token's verified set.
pub async fn verify_model_inner(
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: &Connection,
    typed_secret: Option<String>,
    token: &str,
    model: &str,
) -> Result<(), LlmError> {
    let secret = effective_secret(env, draft, typed_secret)?;
    validate::test_completion(draft, model, secret.as_deref(), env).await?;
    vs.add_verified(token, fingerprint(draft, secret.as_deref()), model)
}

pub fn save_inner(
    db_path: &Path,
    env: &LlmEnv,
    vs: &ValidationStore,
    draft: Connection,
    typed_secret: Option<String>,
    token: &str,
) -> Result<Connection, LlmError> {
    draft.validate_shape()?;
    if draft.models.is_empty() {
        return Err(LlmError::BadResponse("select at least one model".into()));
    }
    let secret = effective_secret(env, &draft, typed_secret.clone())?;
    if matches!(draft.auth, AuthSource::ApiKey) && secret.is_none() {
        return Err(LlmError::Unauthorized);
    }
    vs.consume(token, fingerprint(&draft, secret.as_deref()), &draft.models)?;

    let store = LlmStore::open(db_path)?;
    let saved = store.upsert(draft)?;
    let account = connection_account(&saved.id);
    match (&saved.auth, typed_secret.filter(|s| !s.is_empty())) {
        (AuthSource::ApiKey, Some(s)) => env.secrets.set(&account, &s)?,
        (AuthSource::ApiKey, None) => {}
        _ => env.secrets.delete(&account)?,
    }
    if store.get_active()?.is_none() {
        store.set_active(&saved.id, &saved.models[0])?;
    }
    Ok(saved)
}

pub fn list_inner(db_path: &Path) -> Result<Vec<Connection>, LlmError> {
    LlmStore::open(db_path)?.list()
}

pub fn delete_inner(db_path: &Path, env: &LlmEnv, id: &str) -> Result<(), LlmError> {
    LlmStore::open(db_path)?.delete(id)?;
    env.secrets.delete(&connection_account(id))
}

pub fn set_active_inner(db_path: &Path, connection_id: &str, model: &str) -> Result<ActiveSelection, LlmError> {
    LlmStore::open(db_path)?.set_active(connection_id, model)
}

pub fn get_active_inner(db_path: &Path) -> Result<Option<ActiveSelection>, LlmError> {
    LlmStore::open(db_path)?.get_active()
}

pub fn detect_cli_inner(env: &LlmEnv, engine: Engine) -> CliDetection {
    match cli::detect(engine, env.resolver.as_ref()) {
        Ok(p) => CliDetection { installed: true, path: Some(p.to_string_lossy().to_string()) },
        Err(_) => CliDetection { installed: false, path: None },
    }
}

/// Best-effort legacy migration at startup; failures are logged, never fatal.
pub fn run_startup_migration(app: &tauri::AppHandle) {
    let result = app_db_path(app)
        .map_err(LlmError::Storage)
        .and_then(|p| LlmStore::open(&p))
        .and_then(|s| s.migrate_legacy(&KeyringStore));
    if let Err(e) = result {
        eprintln!("[llm] legacy migration skipped: {e}");
    }
}

// ── Tauri commands (thin wrappers) ────────────────────────────────────────────

#[tauri::command]
pub async fn llm_validate(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
) -> Result<ValidateResult, LlmError> {
    let emit = move |ev: ProgressEvent| {
        let _ = app.emit("llm-validate-progress", ev);
    };
    validate_inner(&env, &vs, &draft, secret, &emit).await
}

#[tauri::command]
pub async fn llm_verify_model(
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
    token: String,
    model: String,
) -> Result<(), LlmError> {
    verify_model_inner(&env, &vs, &draft, secret, &token, &model).await
}

#[tauri::command]
pub async fn llm_save_connection(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    vs: tauri::State<'_, ValidationStore>,
    draft: Connection,
    secret: Option<String>,
    validation_token: String,
) -> Result<Connection, LlmError> {
    let db_path = app_db_path(&app).map_err(LlmError::Storage)?;
    save_inner(&db_path, &env, &vs, draft, secret, &validation_token)
}

#[tauri::command]
pub async fn llm_list_connections(app: tauri::AppHandle) -> Result<Vec<Connection>, LlmError> {
    list_inner(&app_db_path(&app).map_err(LlmError::Storage)?)
}

#[tauri::command]
pub async fn llm_delete_connection(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    id: String,
) -> Result<(), LlmError> {
    delete_inner(&app_db_path(&app).map_err(LlmError::Storage)?, &env, &id)
}

#[tauri::command]
pub async fn llm_set_active(
    app: tauri::AppHandle,
    connection_id: String,
    model: String,
) -> Result<ActiveSelection, LlmError> {
    set_active_inner(&app_db_path(&app).map_err(LlmError::Storage)?, &connection_id, &model)
}

#[tauri::command]
pub async fn llm_get_active(app: tauri::AppHandle) -> Result<Option<ActiveSelection>, LlmError> {
    get_active_inner(&app_db_path(&app).map_err(LlmError::Storage)?)
}

#[tauri::command]
pub async fn llm_detect_cli(env: tauri::State<'_, LlmEnv>, engine: Engine) -> Result<CliDetection, LlmError> {
    Ok(detect_cli_inner(&env, engine))
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test commands::llm_tests`
Expected: PASS (12 tests). (The Tauri wrappers are compiled but only exercised in Task 17's build.)

- [x] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(llm): add validate/save/list/delete/active/detect commands with token-gated save"
```

### Task 16: `brain_query` on the active connection; remove the legacy single-endpoint API

**Files:**
- Modify: `src-tauri/src/commands/brain_cmd.rs`
- Replace: `src-tauri/src/commands/brain_tests.rs`
- Replace: `src-tauri/src/llm/tests.rs`
- Delete: `src-tauri/src/llm/client.rs`
- Modify: `src-tauri/src/llm/mod.rs`

- [x] **Step 1: Write the failing tests** - replace `src-tauri/src/commands/brain_tests.rs` entirely with:

```rust
use super::brain_cmd::{brain_query_with_embedding, build_rag_messages, resolve_active};
use crate::db::{ConversationsDb, VectorsDb};
use crate::llm::connection::*;
use crate::llm::proc::FixedResolver;
use crate::llm::secrets::connection_account;
use crate::llm::store::LlmStore;
use crate::llm::testutil::{spawn, test_env, MockResponse, MockServer};
use tempfile::NamedTempFile;

// ── Mock LLM ──────────────────────────────────────────────────────────────────

const MOCK_LLM_RESPONSE: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"respuesta de prueba"}}]}"#;

fn mock_llm() -> MockServer {
    spawn(|_| MockResponse::json(200, MOCK_LLM_RESPONSE))
}

fn conn_for(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "Test".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::None,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["test-model".into()],
    }
}

fn fake_embedding() -> Vec<f32> {
    let v = vec![0.1_f32; 384];
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter().map(|x| x / norm).collect()
}

fn make_config_db() -> NamedTempFile {
    NamedTempFile::new().unwrap()
}

fn make_vectors_db() -> (VectorsDb, NamedTempFile) {
    let f = NamedTempFile::new().unwrap();
    let db = VectorsDb::open(f.path()).unwrap();
    (db, f)
}

// ── TC-13: prompt includes chunk content ──────────────────────────────────────

#[tokio::test]
async fn brain_query_builds_prompt_with_context() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db
        .upsert_file_chunks("/vault", "/vault/nota.md", &[(0, "contenido importante de la nota", emb.as_slice())])
        .unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "¿qué dice la nota?",
        "/vault",
        None,
        &conn_for(&server.url),
        "test-model",
        None,
        &env,
        &emb,
    )
    .await
    .unwrap();

    assert_eq!(result.answer, "respuesta de prueba", "TC-13: answer extracted");
    let body = &server.requests()[0].body;
    assert!(body.contains("contenido importante de la nota"), "TC-13: prompt must include chunk content. Body:\n{body}");
    assert!(body.contains("test-model"), "TC-13: request carries the chosen model");
}

// ── TC-14: creates a new conversation ─────────────────────────────────────────

#[tokio::test]
async fn brain_query_creates_conversation_when_none() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db.upsert_file_chunks("/vault", "/vault/a.md", &[(0, "algo", emb.as_slice())]).unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "primera pregunta",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        &emb,
    )
    .await
    .unwrap();

    assert!(!result.conversation_id.is_empty(), "TC-14: conversation_id assigned");
    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let list = conv_db.list_conversations("/vault").unwrap();
    assert_eq!(list.len(), 1, "TC-14: one conversation created");
    assert_eq!(list[0].id, result.conversation_id);
}

// ── TC-15: continues an existing conversation ─────────────────────────────────

#[tokio::test]
async fn brain_query_continues_existing_conversation() {
    let cfg_file = make_config_db();
    let (vec_db, vec_file) = make_vectors_db();
    let emb = fake_embedding();
    vec_db.upsert_file_chunks("/vault", "/vault/b.md", &[(0, "texto", emb.as_slice())]).unwrap();

    let conv_db = ConversationsDb::open(cfg_file.path()).unwrap();
    let existing_id = conv_db.create_conversation("/vault", "charla anterior").unwrap();

    let server = mock_llm();
    let env = test_env(FixedResolver::default(), 3000);
    let result = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "segunda pregunta",
        "/vault",
        Some(existing_id.clone()),
        &conn_for(&server.url),
        "m",
        None,
        &env,
        &emb,
    )
    .await
    .unwrap();

    assert_eq!(result.conversation_id, existing_id, "TC-15: same conversation_id returned");
    let messages = conv_db.get_messages(&existing_id).unwrap();
    assert_eq!(messages.len(), 2, "TC-15: user + assistant messages added");
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");
}

// ── TC-16: LLM failure is surfaced as llm_error ───────────────────────────────

#[tokio::test]
async fn brain_query_reports_llm_errors() {
    let cfg_file = make_config_db();
    let (_vec_db, vec_file) = make_vectors_db();
    let server = spawn(|_| MockResponse::json(401, "{}"));
    let env = test_env(FixedResolver::default(), 3000);
    let err = brain_query_with_embedding(
        cfg_file.path(),
        vec_file.path(),
        "q",
        "/vault",
        None,
        &conn_for(&server.url),
        "m",
        None,
        &env,
        &fake_embedding(),
    )
    .await
    .unwrap_err();
    assert!(err.starts_with("llm_error:"), "got {err}");
}

// ── TC-17: active connection resolution ───────────────────────────────────────

#[test]
fn resolve_active_requires_configuration_then_returns_conn_model_secret() {
    let cfg_file = make_config_db();
    let env = test_env(FixedResolver::default(), 1000);
    assert_eq!(resolve_active(cfg_file.path(), &env).unwrap_err(), "not_configured");

    let store = LlmStore::open(cfg_file.path()).unwrap();
    let mut c = conn_for("https://x");
    c.auth = AuthSource::ApiKey;
    c.models = vec!["a".into(), "b".into()];
    let saved = store.upsert(c).unwrap();
    env.secrets.set(&connection_account(&saved.id), "sk").unwrap();
    store.set_active(&saved.id, "b").unwrap();

    let (conn, model, secret) = resolve_active(cfg_file.path(), &env).unwrap();
    assert_eq!(conn.id, saved.id);
    assert_eq!(model, "b");
    assert_eq!(secret.as_deref(), Some("sk"));
}

// ── Extra: build_rag_messages includes chunk filenames ────────────────────────

#[test]
fn build_rag_messages_includes_context() {
    use crate::db::vectors::SearchResult;
    let results = vec![
        SearchResult { file_path: "/vault/nota-a.md".to_string(), content: "contenido de A".to_string(), distance: 0.1 },
        SearchResult { file_path: "/vault/nota-b.md".to_string(), content: "contenido de B".to_string(), distance: 0.2 },
    ];
    let messages = build_rag_messages("¿qué hay en las notas?", &results);
    assert_eq!(messages.len(), 2, "system + user");
    assert_eq!(messages[0].role, "system");
    let system = &messages[0].content;
    assert!(system.contains("nota-a.md"), "system includes file name A");
    assert!(system.contains("contenido de A"), "system includes content A");
    assert!(system.contains("nota-b.md"), "system includes file name B");
    assert_eq!(messages[1].role, "user");
    assert!(messages[1].content.contains("¿qué hay en las notas?"));
}
```

Also replace `src-tauri/src/llm/tests.rs` (drop the old `chat_completion` tests and the mock-server helper that went with them):

```rust
use super::*;

// ── TC-03b: chunk_text splits on paragraphs ───────────────────────────────────

/// TC-03b: chunk_text divides content by paragraphs and respects chunk_size.
#[test]
fn chunk_text_splits_on_paragraphs() {
    let para_a = "a".repeat(800);
    let para_b = "b".repeat(800);
    let content = format!("{para_a}\n\n{para_b}");

    let chunks = embeddings::chunk_text(&content, 1500, 200);
    assert!(!chunks.is_empty(), "Must produce at least one chunk");
    for chunk in &chunks {
        assert!(chunk.chars().count() <= 1700, "Chunk too large: {} chars", chunk.len());
    }
    let all = chunks.join(" ");
    assert!(all.contains('a'), "Should contain para_a content");
    assert!(all.contains('b'), "Should contain para_b content");
}

// ── TC-01/02: model loading (ignored in CI, require download) ────────────────

/// TC-01: embed_text returns a vector of 384 dimensions.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_returns_384_dims() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let emb = embeddings::embed_text(&model, "hello world").unwrap();
    assert_eq!(emb.len(), 384, "AllMiniLML6V2 produces 384-dim vectors");
}

/// TC-02: embed_text is deterministic for the same input.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_is_deterministic() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let a = embeddings::embed_text(&model, "mismo texto").unwrap();
    let b = embeddings::embed_text(&model, "mismo texto").unwrap();
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(b.iter()) {
        assert!((x - y).abs() < 1e-6, "Embeddings should be deterministic, got diff at some dim");
    }
}
```

- [x] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test commands::brain_tests`
Expected: FAIL to compile (`resolve_active` missing; `brain_query_with_embedding` has the old signature).

- [x] **Step 3: Implement**

3a. Delete `src-tauri/src/llm/client.rs` (`git rm src-tauri/src/llm/client.rs`).

3b. Replace `src-tauri/src/llm/mod.rs` with:

```rust
#![allow(dead_code)] // removed in Task 17 once everything is wired

pub mod auth;
pub mod connection;
pub mod embeddings;
pub mod engines;
pub mod env;
pub mod error;
pub mod http;
pub mod proc;
pub mod secrets;
pub mod store;
pub mod validate;

#[cfg(test)]
pub mod testutil;

pub use embeddings::{chunk_text, embed_text, load_model};
pub use engines::ChatMessage;

#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod connection_tests;
#[cfg(test)]
mod env_tests;
#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod proc_tests;
#[cfg(test)]
mod secrets_tests;
#[cfg(test)]
mod store_tests;
#[cfg(test)]
mod testutil_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tls_tests;
#[cfg(test)]
mod validate_tests;
```

3c. Edit `src-tauri/src/commands/brain_cmd.rs`:

- Replace the import block at the top (everything above `// ─── Path helpers`) with:

```rust
use crate::db::{Conversation, ConversationsDb, Message, VectorsDb};
use crate::llm::connection::Connection;
use crate::llm::engines;
use crate::llm::env::LlmEnv;
use crate::llm::store::LlmStore;
use crate::llm::ChatMessage;
use crate::llm::{chunk_text, embed_text, load_model};
use std::path::{Path, PathBuf};
use tauri::Manager;
```

- Delete: the `BrainConfig` struct, `configure_inner`, `get_config_inner`, `validate_url`, `brain_configure`, `brain_get_config`.
- Replace `brain_query_with_embedding` with:

```rust
/// Core RAG query — takes a pre-computed `query_embedding` for testability.
#[allow(clippy::too_many_arguments)]
pub async fn brain_query_with_embedding(
    db_path: &Path,
    vectors_db_path: &Path,
    question: &str,
    vault_path: &str,
    conversation_id: Option<String>,
    conn: &Connection,
    model: &str,
    secret: Option<&str>,
    env: &LlmEnv,
    query_embedding: &[f32],
) -> Result<BrainQueryResult, String> {
    // 1. Search for similar chunks.
    let vec_db = VectorsDb::open(vectors_db_path).map_err(|e| format!("db_error: {e}"))?;
    let results = vec_db
        .search_similar(vault_path, query_embedding, 5)
        .map_err(|e| format!("db_error: {e}"))?;

    let sources: Vec<String> = results.iter().map(|r| r.file_path.clone()).collect();

    // 2. Build RAG prompt.
    let messages = build_rag_messages(question, &results);

    // 3. Open (or create) conversation.
    let conv_db = ConversationsDb::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let conv_id = match conversation_id {
        Some(id) => id,
        None => {
            let title: String = question.chars().take(50).collect();
            conv_db
                .create_conversation(vault_path, &title)
                .map_err(|e| format!("db_error: {e}"))?
        }
    };

    // 4. Persist user message.
    conv_db
        .add_message(&conv_id, "user", question, None)
        .map_err(|e| format!("db_error: {e}"))?;

    // 5. Call the active connection's engine.
    let answer = engines::chat(conn, model, &messages, secret, env)
        .await
        .map_err(|e| format!("llm_error: {e}"))?;

    // 6. Persist assistant message.
    let message_id = conv_db
        .add_message(&conv_id, "assistant", &answer, Some(&sources))
        .map_err(|e| format!("db_error: {e}"))?;

    Ok(BrainQueryResult { answer, sources, conversation_id: conv_id, message_id })
}

/// Active connection + model + its keyring secret, or `"not_configured"`.
pub fn resolve_active(db_path: &Path, env: &LlmEnv) -> Result<(Connection, String, Option<String>), String> {
    let store = LlmStore::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let active = store
        .get_active()
        .map_err(|e| format!("db_error: {e}"))?
        .ok_or_else(|| "not_configured".to_string())?;
    let conn = store
        .get(&active.connection_id)
        .map_err(|e| format!("db_error: {e}"))?
        .ok_or_else(|| "not_configured".to_string())?;
    let secret = env.secret_for(&conn).map_err(|e| format!("keyring_error: {e}"))?;
    Ok((conn, active.model, secret))
}
```

- Replace the `brain_query` command (and its doc comment) with:

```rust
/// RAG query: embed question, search vault, call the active LLM connection, persist conversation.
/// If `conversation_id` is None, a new conversation is created.
#[tauri::command]
pub async fn brain_query(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    question: String,
    vault_path: String,
    conversation_id: Option<String>,
) -> Result<BrainQueryResult, String> {
    let db_path = app_db_path(&app)?;
    let vdb_path = vectors_db_path(&app)?;
    let cache_dir = model_cache_dir(&app)?;

    let (conn, model, secret) = resolve_active(&db_path, &env)?;

    // Embed question locally.
    let model_handle = load_model(&cache_dir).map_err(|e| format!("embed_error: {e}"))?;
    let query_emb = embed_text(&model_handle, &question).map_err(|e| format!("embed_error: {e}"))?;

    brain_query_with_embedding(
        &db_path,
        &vdb_path,
        &question,
        &vault_path,
        conversation_id,
        &conn,
        &model,
        secret.as_deref(),
        &env,
        &query_emb,
    )
    .await
}
```

(Remove the `KEYRING_SERVICE` / `KEYRING_USER_LLM` consts and keep `build_rag_messages`, `BrainQueryResult`, path helpers and the remaining commands unchanged.)

3d. `src-tauri/src/main.rs`: remove `commands::brain_configure,` and `commands::brain_get_config,` from `generate_handler!` for now (full registration is Task 17; the app won't be launched between these tasks).

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test commands::brain_tests llm::`
Expected: PASS. (Known flaky `git::tests::pull_*` are outside this filter.)

- [x] **Step 5: Commit**

```bash
git add -A src-tauri/src
git commit -m "refactor(brain): dispatch brain_query to the active connection and drop single-endpoint config"
```

### Task 17: Register commands and state, run migration at startup, drop `allow(dead_code)`

**Files:**
- Modify: `src-tauri/src/main.rs`, `src-tauri/src/llm/mod.rs`, `src-tauri/src/llm/proc.rs`, `src-tauri/src/llm/secrets.rs`

- [x] **Step 1: Write the failing check** - the "test" here is the compiler. Replace `src-tauri/src/main.rs` with:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(warnings)]

mod commands;
mod db;
mod fs;
mod graph;
mod git;
mod llm;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(llm::env::LlmEnv::production())
        .manage(llm::validate::ValidationStore::default())
        .setup(|app| {
            commands::run_startup_migration(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault_dialog,
            commands::get_active_vault,
            commands::set_active_vault,
            commands::list_vault_tree,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::delete_entry,
            commands::import_files,
            commands::read_note,
            commands::write_note,
            commands::pick_image_file,
            commands::get_vault_graph,
            commands::save_node_position,
            commands::github_configure,
            commands::github_get_config,
            commands::github_disconnect,
            commands::github_push,
            commands::github_pull,
            commands::github_status,
            commands::brain_query,
            commands::brain_get_conversations,
            commands::brain_get_messages,
            commands::brain_delete_conversation,
            commands::brain_update_embedding,
            commands::llm_validate,
            commands::llm_verify_model,
            commands::llm_save_connection,
            commands::llm_list_connections,
            commands::llm_delete_connection,
            commands::llm_set_active,
            commands::llm_get_active,
            commands::llm_detect_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Remove the first line of `src-tauri/src/llm/mod.rs` (`#![allow(dead_code)] ...`).

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo build`
Expected: FAIL with `dead_code` errors (`deny(warnings)`), typically for test-only helpers `FixedResolver` and `MemorySecretStore` and possibly small unused items.

- [x] **Step 2: Fix** - make test-only helpers test-only: in `llm/proc.rs` put `#[cfg(test)]` on the `FixedResolver` struct, its `impl`, and its `impl BinaryResolver` (three attributes). In `llm/secrets.rs` put `#[cfg(test)]` on `MemorySecretStore`, its `#[derive(Default)]` struct and `impl SecretStore for MemorySecretStore` (keep the `HashMap`/`Mutex` imports under `#[cfg(test)]` too: `#[cfg(test)] use std::collections::HashMap; #[cfg(test)] use std::sync::Mutex;`). For any other `dead_code` error the compiler reports, delete the unused item (and its tests) rather than allowing it; do not re-add `allow(dead_code)`.

- [x] **Step 3: Run build and the whole Rust suite**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo build && ORT_STRATEGY=download cargo test`
Expected: build succeeds with zero warnings; all tests pass except the pre-existing flaky `git::tests::pull_fast_forward` / `git::tests::pull_reset_hard_on_divergence` (ignore if they fail).

- [x] **Step 4: Commit**

```bash
git add -A src-tauri
git commit -m "feat(llm): register LLM commands and state, run legacy migration at startup"
```

---

# PHASE 5 - Frontend data layer (presets, wrappers, llmStore)

### Task 18: External links, event mock, opener plugin

The wizard needs "Open page to create the key" (system browser) and progress events. Neither `tauri-plugin-opener` nor an `event` mock exists yet.

**Files:**
- Modify: `package.json`/`package-lock.json` (npm), `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/capabilities/default.json`, `src/test/setup.ts`
- Create: `src/lib/openExternal.ts`, `src/lib/openExternal.test.ts`

- [x] **Step 1: Write the failing test** - `src/lib/openExternal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { openExternal } from './openExternal';

const mockOpen = vi.mocked(openUrl);

beforeEach(() => vi.clearAllMocks());

describe('openExternal', () => {
  it('opens https URLs in the system browser', async () => {
    await openExternal('https://console.anthropic.com/settings/keys');
    expect(mockOpen).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');
  });

  it('refuses anything that is not https', async () => {
    await openExternal('http://example.com');
    await openExternal('javascript:alert(1)');
    await openExternal('file:///etc/passwd');
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/openExternal.test.ts`
Expected: FAIL (cannot resolve `./openExternal` / `@tauri-apps/plugin-opener`).

- [x] **Step 3: Implement**

1. `cd /Users/carlosdiez/Projects/markdaun && npm view @tauri-apps/plugin-opener version && npm install @tauri-apps/plugin-opener` (expected: a 2.x version, installed).
2. `src-tauri/Cargo.toml` `[dependencies]`: add `tauri-plugin-opener = "2"`.
3. `src-tauri/src/main.rs`: add `.plugin(tauri_plugin_opener::init())` right after `.plugin(tauri_plugin_fs::init())`.
4. `src-tauri/capabilities/default.json`: add `"opener:default"` to `permissions` (default scope allows http/https/mailto/tel only). After `cargo build`, confirm the permission exists: `grep -c '"opener:default"' src-tauri/gen/schemas/desktop-schema.json` should print `1` or more; if it is `0`, check the plugin docs (context7: `@tauri-apps/plugin-opener`) for the correct permission identifier.
5. `src/test/setup.ts`: append

```ts
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));
```

6. `src/lib/openExternal.ts`:

```ts
import { openUrl } from '@tauri-apps/plugin-opener';

/** Open an https link in the system browser. Anything else is ignored. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) return;
  await openUrl(url);
}
```

- [x] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/openExternal.test.ts && cd src-tauri && ORT_STRATEGY=download cargo build`
Expected: vitest PASS (2 tests); cargo build succeeds with no warnings.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/capabilities/default.json src/test/setup.ts src/lib/openExternal.ts src/lib/openExternal.test.ts
git commit -m "feat(ui): add opener plugin for external links and event mock for tests"
```

### Task 19: TS types and error-to-message mapping

**Files:**
- Create: `src/lib/llm/types.ts`, `src/lib/llm/errors.ts`, `src/lib/llm/errors.test.ts`

- [ ] **Step 1: Write the failing test** - `src/lib/llm/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asLlmError, describeLlmError } from './errors';
import type { LlmErrorKind } from './types';

const ALL_KINDS: LlmErrorKind[] = [
  'Unreachable',
  'Unauthorized',
  'TlsUntrusted',
  'ModelNotFound',
  'CliMissing',
  'CliNotLoggedIn',
  'Timeout',
  'BadResponse',
  'NotValidated',
  'Storage',
];

describe('describeLlmError', () => {
  it('gives every kind a non-empty message and action', () => {
    for (const kind of ALL_KINDS) {
      const v = describeLlmError({ kind, detail: 'x' });
      expect(v.message.length).toBeGreaterThan(5);
      expect(v.action.length).toBeGreaterThan(5);
    }
  });

  it('TlsUntrusted points at the Advanced root certificate', () => {
    const v = describeLlmError({ kind: 'TlsUntrusted' });
    expect(v.action).toMatch(/certificado ra[ií]z/i);
    expect(v.action).toMatch(/Avanzado/);
  });

  it('is engine-aware for missing CLIs and logins', () => {
    expect(describeLlmError({ kind: 'CliMissing' }, 'cliClaude').message).toMatch(/Claude Code/);
    expect(describeLlmError({ kind: 'CliMissing' }, 'cliGemini').message).toMatch(/Gemini CLI/);
    expect(describeLlmError({ kind: 'CliMissing' }, 'openAiCompat').message).toMatch(/Azure CLI/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'cliClaude').action).toMatch(/claude/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'cliGemini').action).toMatch(/gemini/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'openAiCompat').action).toMatch(/az login/);
  });

  it('includes the detail of a bad response', () => {
    expect(describeLlmError({ kind: 'BadResponse', detail: 'status 500: boom' }).message).toMatch(/status 500: boom/);
  });
});

describe('asLlmError', () => {
  it('passes typed errors through', () => {
    expect(asLlmError({ kind: 'Timeout' })).toEqual({ kind: 'Timeout' });
  });
  it('wraps anything else as BadResponse', () => {
    expect(asLlmError('boom')).toEqual({ kind: 'BadResponse', detail: 'boom' });
    expect(asLlmError(new Error('x'))).toEqual({ kind: 'BadResponse', detail: 'Error: x' });
    expect(asLlmError(null)).toEqual({ kind: 'BadResponse', detail: 'null' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/llm/errors.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/llm/types.ts`:

```ts
// TypeScript mirrors of the Rust types in src-tauri/src/llm (serde camelCase).

export type Engine = 'openAiCompat' | 'anthropicMessages' | 'cliClaude' | 'cliGemini';

export type AuthSource =
  | { type: 'none' }
  | { type: 'apiKey' }
  | { type: 'azureCli'; scope: string };

export type AuthHeader = 'bearer' | 'apiKey' | 'xApiKey';

export interface Connection {
  /** Empty string for an unsaved draft. */
  id: string;
  name: string;
  presetId: string | null;
  engine: Engine;
  baseUrl: string | null;
  auth: AuthSource;
  authHeader: AuthHeader;
  extraHeaders: [string, string][];
  caCertPath: string | null;
  azureApiVersion: string | null;
  models: string[];
}

export const DEFAULT_AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';

export function isCliEngine(engine: Engine): boolean {
  return engine === 'cliClaude' || engine === 'cliGemini';
}

export type LlmErrorKind =
  | 'Unreachable'
  | 'Unauthorized'
  | 'TlsUntrusted'
  | 'ModelNotFound'
  | 'CliMissing'
  | 'CliNotLoggedIn'
  | 'Timeout'
  | 'BadResponse'
  | 'NotValidated'
  | 'Storage';

export interface LlmError {
  kind: LlmErrorKind;
  detail?: string;
}

export type StepId = 'reach' | 'credential' | 'models' | 'completion';
export type StepStatus = 'running' | 'ok' | 'failed';

/** Payload of the `llm-validate-progress` event. */
export interface ProgressEvent {
  step: StepId;
  status: StepStatus;
  detail?: string | null;
  error?: LlmError | null;
}

export interface ValidateResult {
  token: string;
  /** Models listed by the endpoint (empty = unlisted). */
  available: string[];
  /** Models that may be saved without further checks. */
  verified: string[];
}

export interface ActiveSelection {
  connectionId: string;
  model: string;
}

export interface CliDetection {
  installed: boolean;
  path: string | null;
}
```

`src/lib/llm/errors.ts`:

```ts
import type { Engine, LlmError, LlmErrorKind } from './types';

export interface ErrorView {
  message: string;
  action: string;
}

const KINDS: LlmErrorKind[] = [
  'Unreachable',
  'Unauthorized',
  'TlsUntrusted',
  'ModelNotFound',
  'CliMissing',
  'CliNotLoggedIn',
  'Timeout',
  'BadResponse',
  'NotValidated',
  'Storage',
];

/** Normalize whatever `invoke` rejected with into a typed LlmError. */
export function asLlmError(e: unknown): LlmError {
  if (e && typeof e === 'object' && 'kind' in e && KINDS.includes((e as LlmError).kind)) {
    return e as LlmError;
  }
  return { kind: 'BadResponse', detail: String(e) };
}

export function describeLlmError(err: LlmError, engine?: Engine): ErrorView {
  switch (err.kind) {
    case 'Unreachable':
      return {
        message: 'No se pudo conectar con el endpoint.',
        action: 'Comprueba la URL y tu conexión a internet o VPN.',
      };
    case 'Unauthorized':
      return {
        message: 'El endpoint rechazó las credenciales.',
        action: 'Revisa la clave o el token e inténtalo de nuevo.',
      };
    case 'TlsUntrusted':
      return {
        message: 'No se confía en el certificado TLS del endpoint.',
        action:
          'Tu empresa puede estar interceptando TLS. Añade su certificado raíz en Avanzado.',
      };
    case 'ModelNotFound':
      return {
        message: 'El modelo no existe en este endpoint.',
        action: 'Elige otro modelo o revisa la URL.',
      };
    case 'CliMissing':
      if (engine === 'cliClaude') {
        return {
          message: 'Claude Code no está instalado.',
          action: 'Instálalo, ejecuta `claude` para iniciar sesión y pulsa Comprobar de nuevo.',
        };
      }
      if (engine === 'cliGemini') {
        return {
          message: 'Gemini CLI no está instalado.',
          action: 'Instálalo, ejecuta `gemini` para iniciar sesión y pulsa Comprobar de nuevo.',
        };
      }
      return {
        message: 'Azure CLI (`az`) no está instalado.',
        action: 'Instala Azure CLI, ejecuta `az login` y vuelve a intentarlo.',
      };
    case 'CliNotLoggedIn':
      if (engine === 'cliClaude') {
        return { message: 'Claude Code no tiene sesión iniciada.', action: 'Ejecuta `claude` e inicia sesión.' };
      }
      if (engine === 'cliGemini') {
        return { message: 'Gemini CLI no tiene sesión iniciada.', action: 'Ejecuta `gemini` e inicia sesión.' };
      }
      return { message: 'Azure CLI no tiene sesión iniciada.', action: 'Ejecuta `az login`.' };
    case 'Timeout':
      return {
        message: 'La petición tardó demasiado.',
        action: 'Inténtalo de nuevo; si persiste, revisa la red.',
      };
    case 'BadResponse':
      return {
        message: `Respuesta inesperada${err.detail ? `: ${err.detail}` : '.'}`,
        action: 'Comprueba que la URL apunta a una API compatible.',
      };
    case 'NotValidated':
      return {
        message: 'La conexión no está validada.',
        action: 'Vuelve a ejecutar la validación.',
      };
    case 'Storage':
      return {
        message: 'No se pudo guardar la configuración.',
        action: err.detail ?? 'Inténtalo de nuevo.',
      };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/llm/errors.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm
git commit -m "feat(ui): add LLM TS types and error-to-message mapping"
```

### Task 20: Preset catalog

**Files:**
- Create: `src/lib/llm/presets.ts`, `src/lib/llm/presets.test.ts`

- [ ] **Step 1: Write the failing test** - `src/lib/llm/presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PRESETS, draftFromPreset, presetsForRoute } from './presets';
import { isCliEngine } from './types';

describe('PRESETS', () => {
  it('has unique ids and the 11 spec presets', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'claude-code',
      'gemini-cli',
      'anthropic-api',
      'gemini-api',
      'kimi-coding',
      'kimi-api',
      'zai-coding',
      'zai-api',
      'azure-openai',
      'azure-anthropic',
      'proxy',
    ]);
  });

  it('every preset declares engine, auth, auth header, help text and a route', () => {
    for (const p of PRESETS) {
      expect(p.engine, p.id).toBeTruthy();
      expect(p.auth, p.id).toBeTruthy();
      expect(p.authHeader, p.id).toBeTruthy();
      expect(p.help.length, p.id).toBeGreaterThan(10);
      expect(['subscription', 'apiKey', 'company']).toContain(p.route);
    }
  });

  it('CLI presets have no URL; HTTP presets have a valid URL (placeholders allowed)', () => {
    for (const p of PRESETS) {
      if (isCliEngine(p.engine)) {
        expect(p.baseUrl, p.id).toBeNull();
        expect(p.suggestedModels.length, p.id).toBeGreaterThan(0);
        continue;
      }
      if (p.id === 'proxy') {
        expect(p.baseUrl).toBe('');
        continue;
      }
      expect(p.baseUrl, p.id).toBeTruthy();
      const url = new URL((p.baseUrl as string).replace('<resource>', 'myresource'));
      expect(url.protocol, p.id).toBe('https:');
    }
  });

  it('API-key presets link to a page where the key is created', () => {
    for (const p of PRESETS.filter((x) => x.route === 'apiKey')) {
      expect(p.keyUrl, p.id).toMatch(/^https:\/\//);
      expect(p.auth.type).toBe('apiKey');
    }
  });

  it('wires the engine-specific auth the spec requires', () => {
    const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
    expect(byId['anthropic-api'].engine).toBe('anthropicMessages');
    expect(byId['anthropic-api'].authHeader).toBe('xApiKey');
    expect(byId['azure-openai'].auth.type).toBe('azureCli');
    expect(byId['azure-openai'].azureApiVersion).toBeTruthy();
    expect(byId['azure-anthropic'].engine).toBe('anthropicMessages');
    expect(byId['claude-code'].engine).toBe('cliClaude');
    expect(byId['gemini-cli'].engine).toBe('cliGemini');
  });
});

describe('presetsForRoute / draftFromPreset', () => {
  it('groups presets by route', () => {
    expect(presetsForRoute('subscription').map((p) => p.id)).toEqual(['claude-code', 'gemini-cli']);
    expect(presetsForRoute('company').map((p) => p.id)).toEqual(['azure-openai', 'azure-anthropic', 'proxy']);
    expect(presetsForRoute('apiKey')).toHaveLength(6);
  });

  it('builds an unsaved draft from a preset', () => {
    const p = PRESETS.find((x) => x.id === 'anthropic-api')!;
    const d = draftFromPreset(p);
    expect(d.id).toBe('');
    expect(d.presetId).toBe('anthropic-api');
    expect(d.name).toBe(p.name);
    expect(d.baseUrl).toBe('https://api.anthropic.com');
    expect(d.models).toEqual([p.suggestedModels[0]]);
    expect(d.extraHeaders).toEqual([]);
    expect(d.caCertPath).toBeNull();
  });

  it('the proxy draft starts with no models', () => {
    const d = draftFromPreset(PRESETS.find((x) => x.id === 'proxy')!);
    expect(d.models).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/llm/presets.test.ts`
Expected: FAIL (`./presets` not found).

- [ ] **Step 3: Implement** - `src/lib/llm/presets.ts`:

```ts
import {
  DEFAULT_AZURE_SCOPE,
  type AuthHeader,
  type AuthSource,
  type Connection,
  type Engine,
} from './types';

export type Route = 'subscription' | 'apiKey' | 'company';
export type PresetIcon = 'terminal' | 'key' | 'cloud' | 'building';

export interface Preset {
  id: string;
  name: string;
  route: Route;
  icon: PresetIcon;
  engine: Engine;
  /** null for CLI engines; '' when the user must supply it (proxy). */
  baseUrl: string | null;
  auth: AuthSource;
  authHeader: AuthHeader;
  azureApiVersion: string | null;
  /** Page where the user creates the key. */
  keyUrl: string | null;
  /** Fallback when the endpoint does not list models; first one is tested by default. */
  suggestedModels: string[];
  help: string;
  /** CLI presets: command that starts the interactive login. */
  cliLogin?: string;
}

// Endpoint URLs and model names are re-verified against provider docs in the
// "Verify preset endpoints" step of this task; keep this table the single source.
export const PRESETS: Preset[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    route: 'subscription',
    icon: 'terminal',
    engine: 'cliClaude',
    baseUrl: null,
    auth: { type: 'none' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['opus', 'sonnet', 'haiku'],
    help: 'Usa tu suscripción de Claude a través de la CLI oficial. No se guarda ninguna clave.',
    cliLogin: 'claude',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    route: 'subscription',
    icon: 'terminal',
    engine: 'cliGemini',
    baseUrl: null,
    auth: { type: 'none' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    help: 'Usa tu cuenta de Google a través de la CLI oficial de Gemini. No se guarda ninguna clave.',
    cliLogin: 'gemini',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    route: 'apiKey',
    icon: 'key',
    engine: 'anthropicMessages',
    baseUrl: 'https://api.anthropic.com',
    auth: { type: 'apiKey' },
    authHeader: 'xApiKey',
    azureApiVersion: null,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    suggestedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    help: 'Clave de la consola de Anthropic (facturación por uso).',
  },
  {
    id: 'gemini-api',
    name: 'Gemini API',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://aistudio.google.com/apikey',
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    help: 'Clave de Google AI Studio, vía el endpoint compatible con OpenAI.',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding Plan',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.kimi.com/coding/v1',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://www.kimi.com/coding',
    suggestedModels: ['kimi-for-coding'],
    help: 'Clave del plan Kimi Coding (cuota de suscripción).',
  },
  {
    id: 'kimi-api',
    name: 'Kimi (pago por uso)',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.moonshot.ai/v1',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    suggestedModels: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
    help: 'Clave de la plataforma Moonshot (facturación por uso).',
  },
  {
    id: 'zai-coding',
    name: 'z.ai Coding Plan',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    suggestedModels: ['glm-4.6', 'glm-4.5-air'],
    help: 'Clave del plan GLM Coding de z.ai.',
  },
  {
    id: 'zai-api',
    name: 'z.ai (pago por uso)',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    suggestedModels: ['glm-4.6', 'glm-4.5-air'],
    help: 'Clave de z.ai con facturación por uso.',
  },
  {
    id: 'azure-openai',
    name: 'Azure Foundry — OpenAI',
    route: 'company',
    icon: 'cloud',
    engine: 'openAiCompat',
    baseUrl: 'https://<resource>.openai.azure.com',
    auth: { type: 'azureCli', scope: DEFAULT_AZURE_SCOPE },
    authHeader: 'bearer',
    azureApiVersion: '2024-10-21',
    keyUrl: null,
    suggestedModels: ['gpt-4.1'],
    help: 'Sustituye <resource> por el nombre de tu recurso. El modelo es el nombre de tu despliegue. Inicia sesión con `az login` o usa una clave.',
  },
  {
    id: 'azure-anthropic',
    name: 'Azure Foundry — Anthropic',
    route: 'company',
    icon: 'cloud',
    engine: 'anthropicMessages',
    baseUrl: 'https://<resource>.services.ai.azure.com/anthropic',
    auth: { type: 'azureCli', scope: DEFAULT_AZURE_SCOPE },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['claude-sonnet-4-5'],
    help: 'Modelos Claude alojados en Azure Foundry. Sustituye <resource> por tu recurso. Inicia sesión con `az login` o usa una clave.',
  },
  {
    id: 'proxy',
    name: 'LiteLLM / proxy compatible con OpenAI',
    route: 'company',
    icon: 'building',
    engine: 'openAiCompat',
    baseUrl: '',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: [],
    help: 'Cualquier endpoint compatible con OpenAI. En Avanzado puedes cambiar la cabecera de autenticación, añadir cabeceras y un certificado raíz propio.',
  },
];

export function presetsForRoute(route: Route): Preset[] {
  return PRESETS.filter((p) => p.route === route);
}

/** Unsaved connection draft (id = '') pre-filled from a preset. */
export function draftFromPreset(p: Preset): Connection {
  return {
    id: '',
    name: p.name,
    presetId: p.id,
    engine: p.engine,
    baseUrl: p.baseUrl,
    auth: p.auth,
    authHeader: p.authHeader,
    extraHeaders: [],
    caCertPath: null,
    azureApiVersion: p.azureApiVersion,
    models: p.suggestedModels.slice(0, 1),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/llm/presets.test.ts && npx tsc --noEmit`
Expected: PASS (8 tests); tsc clean.

- [ ] **Step 5: Verify preset endpoints against provider docs** (research step; edit `presets.ts` only if a value is wrong, and keep `presets.test.ts` green)

Use context7 (`mcp__context7__resolve-library-id` + `query-docs`) or the vendors' docs to confirm, per preset, (a) base URL, (b) the auth header, (c) that the suggested model ids exist, (d) the page that creates the key:

| Preset | What to confirm |
|---|---|
| anthropic-api | `https://api.anthropic.com/v1/messages` + `x-api-key` + `anthropic-version`; current model ids; keys page |
| gemini-api | OpenAI-compat base `https://generativelanguage.googleapis.com/v1beta/openai/`; `GET /models` returns ids with `models/` prefix (the engine strips it); AI Studio key page |
| kimi-coding | `https://api.kimi.com/coding/v1`; **key page URL is a guess** (`https://www.kimi.com/coding`) - confirm; model id (`kimi-for-coding`?); whether `/models` is served |
| kimi-api | `https://api.moonshot.ai/v1`; console key page; model ids |
| zai-coding / zai-api | `https://api.z.ai/api/coding/paas/v4` and `https://api.z.ai/api/paas/v4`; key page; model ids (`glm-4.6`, `glm-4.5-air`) |
| azure-openai | `https://<resource>.openai.azure.com`, `/openai/deployments/<deployment>/chat/completions?api-version=...` with Entra `Authorization: Bearer` (scope `https://cognitiveservices.azure.com/.default`); a currently supported `api-version`; note whether the newer `/openai/v1/` route is preferred |
| azure-anthropic | `https://<resource>.services.ai.azure.com/anthropic/v1/messages` and whether Entra bearer tokens (not just `x-api-key`) are accepted there |
| gemini-cli | confirm the `-o json` response field name and the model ids accepted by `-m` (do not run a billable prompt; read the Gemini CLI docs) |

If a discrepancy is found, update the table in `presets.ts` (and, for Azure/Gemini path changes, `engines/openai.rs` + its tests), then re-run `npx vitest run src/lib/llm` and the Rust engine tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm
git commit -m "feat(ui): add LLM provider preset catalog"
```

### Task 21: Typed `llm_*` wrappers in `tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/lib/tauri.llm.test.ts`

- [ ] **Step 1: Write the failing test** - `src/lib/tauri.llm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  llmDeleteConnection,
  llmDetectCli,
  llmGetActive,
  llmListConnections,
  llmSaveConnection,
  llmSetActive,
  llmValidate,
  llmVerifyModel,
  onLlmValidateProgress,
} from './tauri';
import type { Connection } from './llm/types';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const draft: Connection = {
  id: '',
  name: 'Office',
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x/v1',
  auth: { type: 'apiKey' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models: ['m'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined as never);
});

describe('llm command wrappers send camelCase payloads', () => {
  it('llmValidate', async () => {
    await llmValidate(draft, 'sk');
    expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: 'sk' });
  });

  it('llmVerifyModel', async () => {
    await llmVerifyModel(draft, null, 'tok', 'gpt-4o');
    expect(mockInvoke).toHaveBeenCalledWith('llm_verify_model', {
      draft,
      secret: null,
      token: 'tok',
      model: 'gpt-4o',
    });
  });

  it('llmSaveConnection maps the token to validationToken', async () => {
    await llmSaveConnection(draft, 'sk', 'tok');
    expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', {
      draft,
      secret: 'sk',
      validationToken: 'tok',
    });
  });

  it('list / delete / active / detect', async () => {
    await llmListConnections();
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
    await llmDeleteConnection('abc');
    expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'abc' });
    await llmSetActive('abc', 'm');
    expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'abc', model: 'm' });
    await llmGetActive();
    expect(mockInvoke).toHaveBeenCalledWith('llm_get_active');
    await llmDetectCli('cliClaude');
    expect(mockInvoke).toHaveBeenCalledWith('llm_detect_cli', { engine: 'cliClaude' });
  });
});

describe('onLlmValidateProgress', () => {
  it('subscribes to llm-validate-progress and forwards the payload', async () => {
    const unlisten = vi.fn();
    mockListen.mockImplementationOnce(async (_name, cb) => {
      (cb as (e: { payload: unknown }) => void)({ payload: { step: 'reach', status: 'ok' } });
      return unlisten;
    });
    const seen: unknown[] = [];
    const off = await onLlmValidateProgress((e) => seen.push(e));
    expect(mockListen).toHaveBeenCalledWith('llm-validate-progress', expect.any(Function));
    expect(seen).toEqual([{ step: 'reach', status: 'ok' }]);
    expect(off).toBe(unlisten);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/tauri.llm.test.ts`
Expected: FAIL (`llmValidate` etc. are not exported).

- [ ] **Step 3: Implement** - in `src/lib/tauri.ts`, add imports at the top (below the existing imports):

```ts
import { listen } from '@tauri-apps/api/event';
import type {
  ActiveSelection,
  CliDetection,
  Connection,
  Engine,
  ProgressEvent,
  ValidateResult,
} from './llm/types';
```

and append at the end of the file:

```ts
// ── LLM connections ────────────────────────────────────────────────────────────
// Payload keys must be camelCase (guarded by invokeArgs.test.ts).

/** Validate an unsaved connection end-to-end. Persists nothing. */
export async function llmValidate(draft: Connection, secret: string | null): Promise<ValidateResult> {
  return invoke<ValidateResult>('llm_validate', { draft, secret });
}

/** Test-complete one more model and add it to the validation token. */
export async function llmVerifyModel(
  draft: Connection,
  secret: string | null,
  token: string,
  model: string,
): Promise<void> {
  return invoke<void>('llm_verify_model', { draft, secret, token, model });
}

/** Persist a validated connection (and its secret, in the OS keyring). */
export async function llmSaveConnection(
  draft: Connection,
  secret: string | null,
  validationToken: string,
): Promise<Connection> {
  return invoke<Connection>('llm_save_connection', { draft, secret, validationToken });
}

export async function llmListConnections(): Promise<Connection[]> {
  return invoke<Connection[]>('llm_list_connections');
}

export async function llmDeleteConnection(id: string): Promise<void> {
  return invoke<void>('llm_delete_connection', { id });
}

export async function llmSetActive(connectionId: string, model: string): Promise<ActiveSelection> {
  return invoke<ActiveSelection>('llm_set_active', { connectionId, model });
}

export async function llmGetActive(): Promise<ActiveSelection | null> {
  return invoke<ActiveSelection | null>('llm_get_active');
}

/** Is the claude / gemini CLI installed? (Login is checked by validation.) */
export async function llmDetectCli(engine: Engine): Promise<CliDetection> {
  return invoke<CliDetection>('llm_detect_cli', { engine });
}

/** Subscribe to validation progress events. Returns the unlisten function. */
export async function onLlmValidateProgress(cb: (e: ProgressEvent) => void): Promise<() => void> {
  return listen<ProgressEvent>('llm-validate-progress', (event) => cb(event.payload));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/tauri.llm.test.ts src/lib/invokeArgs.test.ts && npx tsc --noEmit`
Expected: PASS (both files); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/tauri.llm.test.ts
git commit -m "feat(ui): add typed wrappers for llm_* commands"
```

### Task 22: `llmStore`

**Files:**
- Create: `src/store/llmStore.ts`, `src/store/llmStore.test.ts`

- [ ] **Step 1: Write the failing test** - `src/store/llmStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useLlmStore } from './llmStore';
import type { Connection } from '../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string): Connection => ({
  id,
  name: `C${id}`,
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'none' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models: ['m1', 'm2'],
});

beforeEach(() => {
  vi.clearAllMocks();
  useLlmStore.setState({
    connections: [],
    active: null,
    loaded: false,
    error: null,
    wizardOpen: false,
    editing: null,
  });
});

describe('load', () => {
  it('fills connections and active selection', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'llm_list_connections') return [conn('a')];
      if (cmd === 'llm_get_active') return { connectionId: 'a', model: 'm1' };
      return undefined;
    });
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.connections).toHaveLength(1);
    expect(s.active).toEqual({ connectionId: 'a', model: 'm1' });
  });

  it('tolerates empty responses', async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.connections).toEqual([]);
    expect(s.active).toBeNull();
  });

  it('records a human error when loading fails', async () => {
    mockInvoke.mockRejectedValue({ kind: 'Storage', detail: 'disk' });
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.error).toMatch(/guardar/i);
  });
});

describe('setActive', () => {
  it('persists through llm_set_active and updates state', async () => {
    mockInvoke.mockResolvedValueOnce({ connectionId: 'a', model: 'm2' });
    await useLlmStore.getState().setActive('a', 'm2');
    expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'a', model: 'm2' });
    expect(useLlmStore.getState().active).toEqual({ connectionId: 'a', model: 'm2' });
  });

  it('keeps the previous selection and reports the error on failure', async () => {
    useLlmStore.setState({ active: { connectionId: 'a', model: 'm1' } });
    mockInvoke.mockRejectedValueOnce({ kind: 'ModelNotFound' });
    await useLlmStore.getState().setActive('a', 'zzz');
    expect(useLlmStore.getState().active).toEqual({ connectionId: 'a', model: 'm1' });
    expect(useLlmStore.getState().error).toMatch(/modelo/i);
  });
});

describe('deleteConnection', () => {
  it('deletes then reloads', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'llm_list_connections') return [];
      return undefined;
    });
    await useLlmStore.getState().deleteConnection('a');
    expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'a' });
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
  });
});

describe('wizard state', () => {
  it('opens for a new connection, for editing, and closes', () => {
    useLlmStore.getState().openWizard();
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();

    useLlmStore.getState().openWizard(conn('a'));
    expect(useLlmStore.getState().editing?.id).toBe('a');

    useLlmStore.getState().closeWizard();
    expect(useLlmStore.getState().wizardOpen).toBe(false);
    expect(useLlmStore.getState().editing).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/store/llmStore.test.ts`
Expected: FAIL (`./llmStore` not found).

- [ ] **Step 3: Implement** - `src/store/llmStore.ts`:

```ts
import { create } from 'zustand';
import {
  llmDeleteConnection,
  llmGetActive,
  llmListConnections,
  llmSetActive,
} from '../lib/tauri';
import { asLlmError, describeLlmError } from '../lib/llm/errors';
import type { ActiveSelection, Connection } from '../lib/llm/types';

export interface LlmState {
  connections: Connection[];
  active: ActiveSelection | null;
  /** True after the first load attempt (avoids flashing the empty state). */
  loaded: boolean;
  error: string | null;
  wizardOpen: boolean;
  /** Connection being edited / duplicated (id '' for a duplicate); null = new. */
  editing: Connection | null;

  load(): Promise<void>;
  setActive(connectionId: string, model: string): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  openWizard(editing?: Connection | null): void;
  closeWizard(): void;
}

const fail = (e: unknown): string => describeLlmError(asLlmError(e)).message;

export const useLlmStore = create<LlmState>((set, get) => ({
  connections: [],
  active: null,
  loaded: false,
  error: null,
  wizardOpen: false,
  editing: null,

  async load() {
    try {
      const [connections, active] = await Promise.all([llmListConnections(), llmGetActive()]);
      set({ connections: connections ?? [], active: active ?? null, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: fail(e) });
    }
  },

  async setActive(connectionId, model) {
    try {
      const active = await llmSetActive(connectionId, model);
      set({ active, error: null });
    } catch (e) {
      set({ error: fail(e) });
    }
  },

  async deleteConnection(id) {
    try {
      await llmDeleteConnection(id);
      await get().load();
    } catch (e) {
      set({ error: fail(e) });
    }
  },

  openWizard(editing = null) {
    set({ wizardOpen: true, editing });
  },

  closeWizard() {
    set({ wizardOpen: false, editing: null });
  },
}));
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/store/llmStore.test.ts && npx tsc --noEmit`
Expected: PASS (7 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/llmStore.ts src/store/llmStore.test.ts
git commit -m "feat(ui): add llmStore for connections, active selection and wizard state"
```

### Task 23: Second Brain on `llmStore`; remove `LlmConfigPanel` and the legacy wrappers

**Files:**
- Modify: `src/store/brainStore.ts`, `src/store/brainStore.test.ts`, `src/lib/tauri.ts`, `src/views/SecondBrainView.tsx`, `src/views/SecondBrainView.test.tsx`, `src/components/SecondBrain/ChatPanel.test.tsx`, `src/components/SecondBrain/ConversationList.test.tsx`
- Create: `src/components/SecondBrain/SetupPrompt.tsx`, `src/components/SecondBrain/SetupPrompt.test.tsx`
- Delete: `src/components/SecondBrain/LlmConfigPanel.tsx`, `src/components/SecondBrain/LlmConfigPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/components/SecondBrain/SetupPrompt.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SetupPrompt } from './SetupPrompt';
import { useLlmStore } from '../../store/llmStore';

beforeEach(() => {
  useLlmStore.setState({ wizardOpen: false, editing: null });
});

describe('SetupPrompt', () => {
  it('explains the three routes and opens the wizard', () => {
    render(<SetupPrompt />);
    expect(screen.getByTestId('setup-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('setup-prompt-btn'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();
  });
});
```

Replace `src/views/SecondBrainView.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../store/brainStore';
import { useLlmStore } from '../store/llmStore';
import { useVaultStore } from '../store/vaultStore';
import { SecondBrainView } from './SecondBrainView';
import React from 'react';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined as never);

  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    filterQuery: '',
    isLoading: false,
    error: null,
  });
  useLlmStore.setState({ connections: [], active: null, loaded: true, error: null });
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null });
});

function renderView() {
  return render(
    <MemoryRouter>
      <SecondBrainView />
    </MemoryRouter>,
  );
}

describe('SecondBrainView', () => {
  it('TC-25b: shows the setup prompt when there is no active connection', () => {
    renderView();
    expect(screen.getByTestId('second-brain-view')).toBeInTheDocument();
    expect(screen.getByTestId('setup-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('TC-27b: renders ConversationList + ChatPanel when a connection is active', () => {
    useLlmStore.setState({ active: { connectionId: 'a', model: 'm' } });
    renderView();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-prompt')).not.toBeInTheDocument();
  });

  it('renders neither before the first load completes', () => {
    useLlmStore.setState({ loaded: false });
    renderView();
    expect(screen.queryByTestId('setup-prompt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/SecondBrain/SetupPrompt.test.tsx src/views/SecondBrainView.test.tsx`
Expected: FAIL (`SetupPrompt` not found; view still uses `LlmConfigPanel`).

- [ ] **Step 3: Implement**

3a. `src/components/SecondBrain/SetupPrompt.tsx`:

```tsx
import React from 'react';
import { Sparkles } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';

/** Shown in Second Brain until an AI connection is configured. */
export function SetupPrompt(): JSX.Element {
  const openWizard = useLlmStore((s) => s.openWizard);
  return (
    <div
      data-testid="setup-prompt"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        height: '100%',
        width: '100%',
        padding: 'var(--space-6)',
        fontFamily: 'var(--font-sans)',
        textAlign: 'center',
      }}
    >
      <Sparkles size={20} strokeWidth={1.5} color="var(--daun)" />
      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Conecta una IA</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0, maxWidth: 'var(--measure)' }}>
        Usa tu suscripción, una API key o el endpoint de tu empresa para conversar con tus notas.
      </p>
      <button
        data-testid="setup-prompt-btn"
        onClick={() => openWizard()}
        style={{
          background: 'var(--daun)',
          color: 'var(--on-daun)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Configurar IA
      </button>
    </div>
  );
}
```

3b. `src/views/SecondBrainView.tsx`:

```tsx
import React, { useEffect } from 'react';
import { useVaultStore } from '../store/vaultStore';
import { useBrainStore } from '../store/brainStore';
import { useLlmStore } from '../store/llmStore';
import { SetupPrompt } from '../components/SecondBrain/SetupPrompt';
import { ConversationList } from '../components/SecondBrain/ConversationList';
import { ChatPanel } from '../components/SecondBrain/ChatPanel';

export function SecondBrainView(): JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const active = useLlmStore((s) => s.active);
  const loaded = useLlmStore((s) => s.loaded);
  const loadLlm = useLlmStore((s) => s.load);
  const loadConversations = useBrainStore((s) => s.loadConversations);

  useEffect(() => {
    void loadLlm();
    if (vaultPath) {
      void loadConversations(vaultPath);
    }
  }, [vaultPath, loadLlm, loadConversations]);

  return (
    <div
      data-testid="second-brain-view"
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--bg)',
      }}
    >
      {!loaded ? null : !active ? (
        <SetupPrompt />
      ) : (
        <>
          {/* Left: conversation history sidebar */}
          <div
            style={{
              width: 240,
              background: 'var(--surface-sunken)',
              borderRight: '1px solid var(--line)',
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ConversationList vaultPath={vaultPath ?? ''} />
          </div>

          {/* Right: chat area */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPanel vaultPath={vaultPath ?? ''} />
          </div>
        </>
      )}
    </div>
  );
}
```

3c. `src/store/brainStore.ts`: remove the imports `brainConfigure`, `brainGetConfig`, `type BrainConfig`; remove `export type { BrainConfig };`; remove from `BrainState` the fields/methods `isConfigured`, `config`, `loadConfig`, `configure`; remove the same keys and the two method bodies (`loadConfig`, `configure`) from the store implementation (initial state keeps `conversations`, `currentConversationId`, `messages`, `filterQuery`, `isLoading`, `error`).

3d. `src/lib/tauri.ts`: delete the `BrainConfig` interface, `brainConfigure` and `brainGetConfig` (and their doc comments).

3e. Tests cleanup:
- `git rm src/components/SecondBrain/LlmConfigPanel.tsx src/components/SecondBrain/LlmConfigPanel.test.tsx`
- In `src/components/SecondBrain/ChatPanel.test.tsx`, `src/components/SecondBrain/ConversationList.test.tsx` and `src/store/brainStore.test.ts` delete the setState lines `isConfigured: ...,` and `config: { endpoint_url: ... },`:

```bash
cd /Users/carlosdiez/Projects/markdaun
sed -i '' -E '/^[[:space:]]*(isConfigured:|config: \{ endpoint_url)/d' src/components/SecondBrain/ChatPanel.test.tsx src/components/SecondBrain/ConversationList.test.tsx src/store/brainStore.test.ts
```

- In `src/store/brainStore.test.ts` also delete the unused `DEFAULT_CONFIG` constant (line starting `const DEFAULT_CONFIG`) and the whole `TC-18` block:

```bash
python3 -I - <<'EOF'
import re
p = 'src/store/brainStore.test.ts'
s = open(p).read()
s = re.sub(r"const DEFAULT_CONFIG = .*?\n", "", s)
s = re.sub(r"// ── TC-18.*?(?=// ── TC-19)", "", s, flags=re.S)
open(p, 'w').write(s)
EOF
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx tsc --noEmit && npx vitest run src/components/SecondBrain src/views/SecondBrainView.test.tsx src/store src/lib`
Expected: tsc clean; all listed suites PASS (the deleted TC-18 / LlmConfigPanel tests are gone; the invoke-args guard stays green).

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(brain): drive Second Brain setup from llmStore and remove LlmConfigPanel"
```

---

# PHASE 6 - Wizard components

### Task 24: Wizard styles, `ChooseRoute`, `ChooseProvider`

**Files:**
- Create: `src/components/LlmWizard/styles.ts`, `src/components/LlmWizard/ChooseRoute.tsx`, `src/components/LlmWizard/ChooseRoute.test.tsx`, `src/components/LlmWizard/ChooseProvider.tsx`, `src/components/LlmWizard/ChooseProvider.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/components/LlmWizard/ChooseRoute.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChooseRoute } from './ChooseRoute';

describe('ChooseRoute', () => {
  it('shows the three routes and reports the chosen one', () => {
    const onSelect = vi.fn();
    render(<ChooseRoute onSelect={onSelect} />);
    expect(screen.getByText('Usar mi suscripción')).toBeInTheDocument();
    expect(screen.getByText('Tengo una API key')).toBeInTheDocument();
    expect(screen.getByText('Endpoint o proxy de mi empresa')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('route-subscription'));
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(screen.getByTestId('route-company'));
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['subscription', 'apiKey', 'company']);
  });
});
```

`src/components/LlmWizard/ChooseProvider.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChooseProvider } from './ChooseProvider';
import { PRESETS } from '../../lib/llm/presets';

describe('ChooseProvider', () => {
  it('lists only the presets of the route and reports the chosen one', () => {
    const onSelect = vi.fn();
    render(<ChooseProvider route="subscription" onSelect={onSelect} onBack={() => {}} />);
    expect(screen.getByTestId('preset-claude-code')).toBeInTheDocument();
    expect(screen.getByTestId('preset-gemini-cli')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-anthropic-api')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('preset-claude-code'));
    expect(onSelect).toHaveBeenCalledWith(PRESETS.find((p) => p.id === 'claude-code'));
  });

  it('shows each preset help text', () => {
    render(<ChooseProvider route="company" onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getByTestId('preset-proxy')).toHaveTextContent(/compatible con OpenAI/i);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4);
  });

  it('has a back button', () => {
    const onBack = vi.fn();
    render(<ChooseProvider route="apiKey" onSelect={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard`
Expected: FAIL (components not found).

- [ ] **Step 3: Implement**

`src/components/LlmWizard/styles.ts`:

```ts
import type { CSSProperties } from 'react';

// Shared styles for the wizard. Tokens only (design/tokens.css).

export const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
};

export const modal: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-pop)',
  width: 'min(720px, 92vw)',
  maxHeight: '88vh',
  overflow: 'auto',
  padding: 'var(--space-6)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--ink)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};

export const title: CSSProperties = { fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--ink)' };
export const muted: CSSProperties = { fontSize: 13, color: 'var(--ink-muted)', margin: 0 };
export const errorText: CSSProperties = { fontSize: 13, color: 'var(--danger)', margin: 0 };

export const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 'var(--space-3)',
};

export const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  alignItems: 'flex-start',
  textAlign: 'left',
  background: 'var(--surface)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--ink)',
  cursor: 'pointer',
};

export const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };
export const label: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--ink)' };

export const input: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: 'var(--ink)',
  boxSizing: 'border-box',
  width: '100%',
};

const buttonBase: CSSProperties = {
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

export const primaryButton: CSSProperties = {
  ...buttonBase,
  background: 'var(--daun)',
  color: 'var(--on-daun)',
  border: 'none',
};

export const secondaryButton: CSSProperties = {
  ...buttonBase,
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
};

export const ghostButton: CSSProperties = {
  ...buttonBase,
  background: 'transparent',
  color: 'var(--ink-muted)',
  border: 'none',
};

export const footer: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
};

export function disabled(style: CSSProperties, isDisabled: boolean): CSSProperties {
  return isDisabled ? { ...style, opacity: 0.5, cursor: 'not-allowed' } : style;
}
```

`src/components/LlmWizard/ChooseRoute.tsx`:

```tsx
import React from 'react';
import { Building2, KeyRound, Terminal } from 'lucide-react';
import type { Route } from '../../lib/llm/presets';
import { card, cardGrid, muted, title } from './styles';

interface Props {
  onSelect: (route: Route) => void;
}

const ROUTES: { id: Route; title: string; text: string; Icon: typeof Terminal }[] = [
  {
    id: 'subscription',
    title: 'Usar mi suscripción',
    text: 'Claude Code o Gemini CLI con tu cuenta. Sin claves.',
    Icon: Terminal,
  },
  {
    id: 'apiKey',
    title: 'Tengo una API key',
    text: 'Anthropic, Gemini, Kimi o z.ai con tu propia clave.',
    Icon: KeyRound,
  },
  {
    id: 'company',
    title: 'Endpoint o proxy de mi empresa',
    text: 'Azure Foundry, LiteLLM u otro endpoint compatible con OpenAI.',
    Icon: Building2,
  },
];

export function ChooseRoute({ onSelect }: Props): JSX.Element {
  return (
    <div data-testid="step-route" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>¿Cómo quieres conectarte?</h2>
      <div style={cardGrid}>
        {ROUTES.map(({ id, title: t, text, Icon }) => (
          <button key={id} data-testid={`route-${id}`} style={card} onClick={() => onSelect(id)}>
            <Icon size={20} strokeWidth={1.5} color="var(--daun)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t}</span>
            <span style={muted}>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

`src/components/LlmWizard/ChooseProvider.tsx`:

```tsx
import React from 'react';
import { Building2, Cloud, KeyRound, Terminal } from 'lucide-react';
import { presetsForRoute, type Preset, type PresetIcon, type Route } from '../../lib/llm/presets';
import { card, cardGrid, footer, ghostButton, muted, title } from './styles';

interface Props {
  route: Route;
  onSelect: (preset: Preset) => void;
  onBack: () => void;
}

const ICONS: Record<PresetIcon, typeof Terminal> = {
  terminal: Terminal,
  key: KeyRound,
  cloud: Cloud,
  building: Building2,
};

export function ChooseProvider({ route, onSelect, onBack }: Props): JSX.Element {
  return (
    <div data-testid="step-provider" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Elige el proveedor</h2>
      <div style={cardGrid}>
        {presetsForRoute(route).map((p) => {
          const Icon = ICONS[p.icon];
          return (
            <button key={p.id} data-testid={`preset-${p.id}`} style={card} onClick={() => onSelect(p)}>
              <Icon size={20} strokeWidth={1.5} color="var(--daun)" />
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
              <span style={muted}>{p.help}</span>
            </button>
          );
        })}
      </div>
      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard && npx tsc --noEmit`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/LlmWizard
git commit -m "feat(ui): add wizard route and provider steps"
```

### Task 25: `Credentials` step

**Files:**
- Create: `src/components/LlmWizard/Credentials.tsx`, `src/components/LlmWizard/Credentials.test.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/LlmWizard/Credentials.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import React, { useState } from 'react';
import { Credentials } from './Credentials';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);
const mockOpenUrl = vi.mocked(openUrl);
const mockDialog = vi.mocked(openDialog);

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

/** Stateful harness: Credentials is controlled by its parent. */
function Harness({ presetId, initial, onNext }: { presetId: string; initial?: Connection; onNext?: () => void }) {
  const p = preset(presetId);
  const [draft, setDraft] = useState<Connection>(initial ?? draftFromPreset(p));
  const [secret, setSecret] = useState('');
  return (
    <Credentials
      preset={p}
      draft={draft}
      secret={secret}
      onChange={setDraft}
      onSecret={setSecret}
      onBack={() => {}}
      onNext={onNext ?? (() => {})}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Credentials — CLI', () => {
  it('detects the CLI and enables Continue only when installed', async () => {
    mockInvoke.mockResolvedValue({ installed: false, path: null } as never);
    render(<Harness presetId="claude-code" />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_detect_cli', { engine: 'cliClaude' }));
    expect(await screen.findByTestId('cli-status')).toHaveTextContent(/no encontrado/i);
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    expect(screen.getByTestId('cli-instructions')).toHaveTextContent('claude');

    mockInvoke.mockResolvedValue({ installed: true, path: '/opt/homebrew/bin/claude' } as never);
    fireEvent.click(screen.getByTestId('cli-check-again'));
    expect(await screen.findByText(/instalado/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
  });

  it('has no key or URL inputs', async () => {
    mockInvoke.mockResolvedValue({ installed: true, path: '/x' } as never);
    render(<Harness presetId="gemini-cli" />);
    await screen.findByTestId('cli-status');
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('base-url-input')).not.toBeInTheDocument();
  });
});

describe('Credentials — API key', () => {
  it('requires a key before continuing and opens the key page', () => {
    const onNext = vi.fn();
    render(<Harness presetId="anthropic-api" onNext={onNext} />);
    expect(screen.getByTestId('base-url-input')).toHaveValue('https://api.anthropic.com');
    expect(screen.getByTestId('test-model-input')).toHaveValue('claude-sonnet-4-5');
    expect(screen.getByTestId('credentials-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('open-key-page'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');

    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'sk-ant-123' } });
    expect(screen.getByTestId('secret-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('credentials-next'));
    expect(onNext).toHaveBeenCalled();
  });

  it('blocks Continue on an invalid URL or empty model', () => {
    render(<Harness presetId="kimi-api" />);
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'k' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'not a url' } });
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'https://api.moonshot.ai/v1' } });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: '  ' } });
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
  });

  it('when editing a saved connection the key may stay blank', () => {
    const saved: Connection = { ...draftFromPreset(preset('anthropic-api')), id: 'abc' };
    render(<Harness presetId="anthropic-api" initial={saved} />);
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    expect(screen.getByTestId('secret-input')).toHaveAttribute('placeholder', expect.stringMatching(/dejar/i));
  });
});

describe('Credentials — company', () => {
  it('Azure placeholders block Continue until replaced; az login hides the key field', () => {
    render(<Harness presetId="azure-openai" />);
    expect(screen.getByTestId('auth-select')).toHaveValue('az');
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('credentials-next')).toBeDisabled(); // https://<resource>...
    fireEvent.change(screen.getByTestId('base-url-input'), {
      target: { value: 'https://acme.openai.azure.com' },
    });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: 'my-gpt41' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    expect(screen.getByTestId('azure-api-version-input')).toHaveValue('2024-10-21');
  });

  it('token auth shows the key field; none hides it', () => {
    render(<Harness presetId="proxy" />);
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'https://llm.corp.local/v1' } });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: 'gpt-4.1' } });
    expect(screen.getByTestId('auth-select')).toHaveValue('token');
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'tok' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.change(screen.getByTestId('auth-select'), { target: { value: 'none' } });
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
  });

  it('Advanced: auth header, extra headers and root CA', async () => {
    mockDialog.mockResolvedValueOnce('/Users/me/corp-ca.pem' as never);
    const seen: Connection[] = [];
    function Spy() {
      const [draft, setDraft] = useState<Connection>(draftFromPreset(preset('proxy')));
      seen.push(draft);
      return (
        <Credentials
          preset={preset('proxy')}
          draft={draft}
          secret=""
          onChange={setDraft}
          onSecret={() => {}}
          onBack={() => {}}
          onNext={() => {}}
        />
      );
    }
    render(<Spy />);
    fireEvent.change(screen.getByTestId('auth-header-select'), { target: { value: 'xApiKey' } });
    fireEvent.change(screen.getByTestId('extra-headers-input'), {
      target: { value: 'X-Team: md\nX-Env: prod\nnot-a-header' },
    });
    fireEvent.click(screen.getByTestId('pick-ca'));
    await waitFor(() => expect(screen.getByTestId('ca-path')).toHaveValue('/Users/me/corp-ca.pem'));

    const last = seen[seen.length - 1];
    expect(last.authHeader).toBe('xApiKey');
    expect(last.extraHeaders).toEqual([
      ['X-Team', 'md'],
      ['X-Env', 'prod'],
    ]);
    expect(last.caCertPath).toBe('/Users/me/corp-ca.pem');

    fireEvent.click(screen.getByTestId('clear-ca'));
    expect(screen.getByTestId('ca-path')).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/Credentials.test.tsx`
Expected: FAIL (`./Credentials` not found).

- [ ] **Step 3: Implement** - `src/components/LlmWizard/Credentials.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { llmDetectCli } from '../../lib/tauri';
import { openExternal } from '../../lib/openExternal';
import {
  DEFAULT_AZURE_SCOPE,
  isCliEngine,
  type AuthHeader,
  type CliDetection,
  type Connection,
} from '../../lib/llm/types';
import type { Preset } from '../../lib/llm/presets';
import {
  disabled,
  errorText,
  field,
  footer,
  ghostButton,
  input,
  label,
  muted,
  primaryButton,
  secondaryButton,
  title,
} from './styles';

interface Props {
  preset: Preset | null;
  draft: Connection;
  secret: string;
  onChange: (draft: Connection) => void;
  onSecret: (secret: string) => void;
  onBack: () => void;
  onNext: () => void;
}

type AuthChoice = 'token' | 'az' | 'none';

function authChoice(d: Connection): AuthChoice {
  if (d.auth.type === 'azureCli') return 'az';
  if (d.auth.type === 'none') return 'none';
  return 'token';
}

function parseHeaders(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (name && value) out.push([name, value]);
  }
  return out;
}

function formatHeaders(h: [string, string][]): string {
  return h.map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function Credentials({ preset, draft, secret, onChange, onSecret, onBack, onNext }: Props): JSX.Element {
  const isCli = isCliEngine(draft.engine);
  const isEditing = draft.id !== '';
  const [cli, setCli] = useState<CliDetection | null>(null);
  const [headersText, setHeadersText] = useState(formatHeaders(draft.extraHeaders));

  const check = useCallback(() => {
    llmDetectCli(draft.engine)
      .then((d) => setCli(d ?? { installed: false, path: null }))
      .catch(() => setCli({ installed: false, path: null }));
  }, [draft.engine]);

  useEffect(() => {
    if (isCli) check();
  }, [isCli, check]);

  const patch = (p: Partial<Connection>) => onChange({ ...draft, ...p });
  const choice = authChoice(draft);
  const showSecret = !isCli && choice === 'token';
  const model = draft.models[0] ?? '';

  const urlOk = /^https?:\/\/[^\s<>]+$/.test(draft.baseUrl ?? '');
  const modelOk = model.trim() !== '';
  const secretOk = !showSecret || secret.trim() !== '' || isEditing;
  const canContinue = isCli ? Boolean(cli?.installed) && modelOk : urlOk && modelOk && secretOk;

  const setAuth = (c: AuthChoice) => {
    if (c === 'az') patch({ auth: { type: 'azureCli', scope: DEFAULT_AZURE_SCOPE } });
    else if (c === 'none') patch({ auth: { type: 'none' } });
    else patch({ auth: { type: 'apiKey' } });
  };

  const pickCa = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: 'Certificado (PEM)', extensions: ['pem', 'crt', 'cer'] }],
    });
    if (typeof picked === 'string') patch({ caCertPath: picked });
  };

  return (
    <div data-testid="step-credentials" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>{preset?.name ?? draft.name}</h2>
      {preset && <p style={muted}>{preset.help}</p>}

      {isCli ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p data-testid="cli-status" style={{ ...muted, color: cli?.installed ? 'var(--daun)' : 'var(--ink-muted)' }}>
            {cli === null ? 'Comprobando…' : cli.installed ? `Instalado (${cli.path})` : 'No encontrado'}
          </p>
          <p data-testid="cli-instructions" style={muted}>
            Si aún no has iniciado sesión, ejecuta{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>{preset?.cliLogin ?? draft.engine}</code> en una terminal
            y completa el acceso. La sesión se comprueba en el siguiente paso.
          </p>
          <button data-testid="cli-check-again" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={check}>
            Comprobar de nuevo
          </button>
        </div>
      ) : (
        <>
          <div style={field}>
            <label style={label} htmlFor="base-url">URL del endpoint</label>
            <input
              id="base-url"
              data-testid="base-url-input"
              style={input}
              value={draft.baseUrl ?? ''}
              placeholder="https://…"
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </div>

          {preset?.route === 'company' && (
            <div style={field}>
              <label style={label} htmlFor="auth">Autenticación</label>
              <select
                id="auth"
                data-testid="auth-select"
                style={input}
                value={choice}
                onChange={(e) => setAuth(e.target.value as AuthChoice)}
              >
                <option value="token">Token o clave</option>
                <option value="az">Azure CLI (az login)</option>
                <option value="none">Sin autenticación</option>
              </select>
            </div>
          )}

          {showSecret && (
            <div style={field}>
              <label style={label} htmlFor="secret">API key o token</label>
              <input
                id="secret"
                data-testid="secret-input"
                type="password"
                autoComplete="off"
                style={input}
                value={secret}
                placeholder={isEditing ? 'Dejar en blanco para mantener la actual' : 'Pega aquí tu clave'}
                onChange={(e) => onSecret(e.target.value)}
              />
              {preset?.keyUrl && (
                <button
                  data-testid="open-key-page"
                  style={{ ...secondaryButton, alignSelf: 'flex-start' }}
                  onClick={() => void openExternal(preset.keyUrl as string)}
                >
                  Abrir página para crear la clave
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div style={field}>
        <label style={label} htmlFor="test-model">
          {isCli ? 'Modelo' : 'Modelo (o despliegue) con el que probar'}
        </label>
        <input
          id="test-model"
          data-testid="test-model-input"
          list="suggested-models"
          style={input}
          value={model}
          onChange={(e) => patch({ models: [e.target.value] })}
        />
        <datalist id="suggested-models">
          {(preset?.suggestedModels ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {!isCli && (
        <details data-testid="advanced">
          <summary style={{ ...label, cursor: 'pointer' }}>Avanzado</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <div style={field}>
              <label style={label} htmlFor="auth-header">Cabecera de autenticación</label>
              <select
                id="auth-header"
                data-testid="auth-header-select"
                style={input}
                value={draft.authHeader}
                onChange={(e) => patch({ authHeader: e.target.value as AuthHeader })}
              >
                <option value="bearer">Authorization: Bearer</option>
                <option value="apiKey">api-key</option>
                <option value="xApiKey">x-api-key</option>
              </select>
            </div>
            <div style={field}>
              <label style={label} htmlFor="extra-headers">Cabeceras extra (una por línea, «Nombre: valor»)</label>
              <textarea
                id="extra-headers"
                data-testid="extra-headers-input"
                style={{ ...input, minHeight: 64, fontFamily: 'var(--font-mono)' }}
                value={headersText}
                onChange={(e) => {
                  setHeadersText(e.target.value);
                  patch({ extraHeaders: parseHeaders(e.target.value) });
                }}
              />
            </div>
            {draft.azureApiVersion !== null && (
              <div style={field}>
                <label style={label} htmlFor="azure-version">Versión de API de Azure</label>
                <input
                  id="azure-version"
                  data-testid="azure-api-version-input"
                  style={input}
                  value={draft.azureApiVersion}
                  onChange={(e) => patch({ azureApiVersion: e.target.value })}
                />
              </div>
            )}
            <div style={field}>
              <label style={label} htmlFor="ca-path">Certificado raíz propio (PEM)</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input id="ca-path" data-testid="ca-path" readOnly style={input} value={draft.caCertPath ?? ''} />
                <button data-testid="pick-ca" style={secondaryButton} onClick={() => void pickCa()}>
                  Elegir archivo…
                </button>
                <button data-testid="clear-ca" style={ghostButton} onClick={() => patch({ caCertPath: null })}>
                  Quitar
                </button>
              </div>
            </div>
          </div>
        </details>
      )}

      {!canContinue && !isCli && draft.baseUrl && !urlOk && (
        <p style={errorText}>La URL debe empezar por http:// o https:// y no contener marcadores como &lt;resource&gt;.</p>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <button
          data-testid="credentials-next"
          style={disabled(primaryButton, !canContinue)}
          disabled={!canContinue}
          onClick={onNext}
        >
          Validar conexión
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/Credentials.test.tsx && npx tsc --noEmit`
Expected: PASS (9 tests); tsc clean. (`@tauri-apps/plugin-dialog` is globally mocked in `src/test/setup.ts` with an `open` mock.)

- [ ] **Step 5: Commit**

```bash
git add src/components/LlmWizard
git commit -m "feat(ui): add wizard credentials step with CLI detection and advanced options"
```

### Task 26: `Validation` step

**Files:**
- Create: `src/components/LlmWizard/Validation.tsx`, `src/components/LlmWizard/Validation.test.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/LlmWizard/Validation.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import React from 'react';
import { Validation } from './Validation';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';
import type { ProgressEvent } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const draft = draftFromPreset(PRESETS.find((p) => p.id === 'anthropic-api')!);
const RESULT = { token: 'tok', available: ['a'], verified: ['a'] };

let emit: (e: ProgressEvent) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  mockListen.mockImplementation((async (_name: string, cb: (e: { payload: ProgressEvent }) => void) => {
    emit = async (payload) => {
      await act(async () => cb({ payload }));
    };
    return () => {};
  }) as never);
});

function renderValidation(props: Partial<React.ComponentProps<typeof Validation>> = {}) {
  const onSuccess = vi.fn();
  const onContinue = vi.fn();
  const onBack = vi.fn();
  render(
    <Validation
      draft={draft}
      secret="sk"
      onSuccess={onSuccess}
      onContinue={onContinue}
      onBack={onBack}
      {...props}
    />,
  );
  return { onSuccess, onContinue, onBack };
}

const status = (step: string) => screen.getByTestId(`step-${step}`).getAttribute('data-status');

describe('Validation', () => {
  it('runs llm_validate with the draft and secret and shows live step status', async () => {
    let resolve!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const { onSuccess } = renderValidation();

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: 'sk' }));
    expect(status('reach')).toBe('pending');

    await emit({ step: 'reach', status: 'running' });
    expect(status('reach')).toBe('running');
    await emit({ step: 'reach', status: 'ok' });
    await emit({ step: 'credential', status: 'ok' });
    await emit({ step: 'models', status: 'ok', detail: '3 models' });
    await emit({ step: 'completion', status: 'ok' });
    expect(status('reach')).toBe('ok');
    expect(screen.getByTestId('step-models')).toHaveTextContent('3 models');

    await act(async () => resolve(RESULT));
    expect(onSuccess).toHaveBeenCalledWith(RESULT);
    expect(screen.getByTestId('validation-continue')).toBeEnabled();
  });

  it('continue goes to the next step', async () => {
    mockInvoke.mockResolvedValueOnce(RESULT as never);
    const { onContinue } = renderValidation();
    const btn = await screen.findByTestId('validation-continue');
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalled();
  });

  it('stops at the first failure with a human message and action, and offers retry', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'TlsUntrusted' });
    renderValidation();
    await emit({ step: 'reach', status: 'failed', error: { kind: 'TlsUntrusted' } });
    expect(status('reach')).toBe('failed');
    expect(status('credential')).toBe('pending');
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/certificado TLS/i);
    expect(screen.getByTestId('validation-error')).toHaveTextContent(/Avanzado/);
    expect(screen.queryByTestId('validation-continue')).not.toBeInTheDocument();

    mockInvoke.mockResolvedValueOnce(RESULT as never);
    fireEvent.click(screen.getByTestId('validation-retry'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('validation-continue')).toBeInTheDocument());
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  it('uses CLI wording for CLI engines and a back button', async () => {
    const cliDraft = draftFromPreset(PRESETS.find((p) => p.id === 'claude-code')!);
    mockInvoke.mockRejectedValueOnce({ kind: 'CliNotLoggedIn' });
    const { onBack } = renderValidation({ draft: cliDraft });
    expect(screen.getByTestId('step-reach')).toHaveTextContent(/CLI instalado/i);
    expect(screen.getByTestId('step-credential')).toHaveTextContent(/sesión/i);
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/ejecuta `claude`/i);
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('sends a null secret when none was typed', async () => {
    mockInvoke.mockResolvedValueOnce(RESULT as never);
    renderValidation({ secret: '  ' });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: null }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/Validation.test.tsx`
Expected: FAIL (`./Validation` not found).

- [ ] **Step 3: Implement** - `src/components/LlmWizard/Validation.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Check, Circle, Loader2, X } from 'lucide-react';
import { llmValidate, onLlmValidateProgress } from '../../lib/tauri';
import { asLlmError, describeLlmError } from '../../lib/llm/errors';
import {
  isCliEngine,
  type Connection,
  type LlmError,
  type StepId,
  type ValidateResult,
} from '../../lib/llm/types';
import {
  disabled,
  errorText,
  footer,
  ghostButton,
  muted,
  primaryButton,
  secondaryButton,
  title,
} from './styles';

interface Props {
  draft: Connection;
  secret: string;
  onSuccess: (result: ValidateResult) => void;
  onContinue: () => void;
  onBack: () => void;
}

type Status = 'pending' | 'running' | 'ok' | 'failed';

const ORDER: StepId[] = ['reach', 'credential', 'models', 'completion'];

function labels(cli: boolean): Record<StepId, string> {
  return cli
    ? {
        reach: 'CLI instalado',
        credential: 'Sesión iniciada',
        models: 'Modelos disponibles',
        completion: 'Respuesta de prueba',
      }
    : {
        reach: 'Endpoint accesible',
        credential: 'Credencial válida',
        models: 'Modelos listados',
        completion: 'Respuesta de prueba',
      };
}

const INITIAL: Record<StepId, Status> = {
  reach: 'pending',
  credential: 'pending',
  models: 'pending',
  completion: 'pending',
};

export function Validation({ draft, secret, onSuccess, onContinue, onBack }: Props): JSX.Element {
  const [statuses, setStatuses] = useState<Record<StepId, Status>>(INITIAL);
  const [details, setDetails] = useState<Partial<Record<StepId, string>>>({});
  const [error, setError] = useState<LlmError | null>(null);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cli = isCliEngine(draft.engine);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setStatuses(INITIAL);
    setDetails({});
    setError(null);
    setDone(false);

    (async () => {
      unlisten = await onLlmValidateProgress((e) => {
        if (cancelled) return;
        setStatuses((s) => ({ ...s, [e.step]: e.status }));
        if (e.detail) setDetails((d) => ({ ...d, [e.step]: e.detail as string }));
        if (e.error) setError(e.error);
      });
      try {
        const result = await llmValidate(draft, secret.trim() === '' ? null : secret);
        if (cancelled) return;
        setDone(true);
        onSuccess(result);
      } catch (e) {
        if (!cancelled) setError(asLlmError(e));
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // `draft`/`secret` are frozen for the lifetime of this step; only retry re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const text = labels(cli);
  const view = error ? describeLlmError(error, draft.engine) : null;

  return (
    <div data-testid="step-validation" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Validando la conexión</h2>
      <p style={muted}>No se guarda nada hasta que todo pase.</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {ORDER.map((id) => {
          const st = statuses[id];
          return (
            <li
              key={id}
              data-testid={`step-${id}`}
              data-status={st}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}
            >
              {st === 'ok' && <Check size={16} strokeWidth={1.5} color="var(--daun)" />}
              {st === 'failed' && <X size={16} strokeWidth={1.5} color="var(--danger)" />}
              {st === 'running' && <Loader2 size={16} strokeWidth={1.5} color="var(--ink-muted)" />}
              {st === 'pending' && <Circle size={16} strokeWidth={1.5} color="var(--ink-muted)" />}
              <span style={{ color: st === 'pending' ? 'var(--ink-muted)' : 'var(--ink)' }}>{text[id]}</span>
              {details[id] && <span style={muted}>· {details[id]}</span>}
            </li>
          );
        })}
      </ol>

      {view && (
        <div data-testid="validation-error" role="alert">
          <p style={{ ...errorText, fontWeight: 500 }}>{view.message}</p>
          <p style={muted}>{view.action}</p>
        </div>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {error && (
            <button data-testid="validation-retry" style={secondaryButton} onClick={() => setAttempt((a) => a + 1)}>
              Reintentar
            </button>
          )}
          {done && !error && (
            <button
              data-testid="validation-continue"
              style={disabled(primaryButton, false)}
              onClick={onContinue}
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/Validation.test.tsx && npx tsc --noEmit`
Expected: PASS (5 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/LlmWizard
git commit -m "feat(ui): add wizard validation step with live checklist and typed errors"
```

### Task 27: `ModelsAndName` step

**Files:**
- Create: `src/components/LlmWizard/ModelsAndName.tsx`, `src/components/LlmWizard/ModelsAndName.test.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/LlmWizard/ModelsAndName.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { ModelsAndName } from './ModelsAndName';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';

const mockInvoke = vi.mocked(invoke);

const draft = { ...draftFromPreset(PRESETS.find((p) => p.id === 'anthropic-api')!), models: ['claude-sonnet-4-5'] };
const RESULT = {
  token: 'tok',
  available: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  verified: ['claude-sonnet-4-5', 'claude-opus-4-1'],
};

beforeEach(() => vi.clearAllMocks());

function renderStep(over: Partial<React.ComponentProps<typeof ModelsAndName>> = {}) {
  const onSaved = vi.fn();
  const onBack = vi.fn();
  render(
    <ModelsAndName
      draft={draft}
      result={RESULT}
      secret="sk"
      suggested={['claude-haiku-4-5']}
      onSaved={onSaved}
      onBack={onBack}
      {...over}
    />,
  );
  return { onSaved, onBack };
}

describe('ModelsAndName', () => {
  it('lists listed + suggested models, pre-selects the tested one and prefills the name', () => {
    renderStep();
    expect(screen.getByTestId('model-claude-sonnet-4-5')).toBeChecked();
    expect(screen.getByTestId('model-claude-opus-4-1')).not.toBeChecked();
    expect(screen.getByTestId('model-claude-haiku-4-5')).not.toBeChecked();
    expect(screen.getByTestId('connection-name')).toHaveValue('Anthropic API');
  });

  it('saves with the selected models, the secret and the validation token', async () => {
    const saved = { ...draft, id: 'new' };
    mockInvoke.mockResolvedValueOnce(saved as never);
    const { onSaved } = renderStep();

    fireEvent.click(screen.getByTestId('model-claude-opus-4-1')); // verified (listed)
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: '  Casa  ' } });
    fireEvent.click(screen.getByTestId('save-btn'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', {
      draft: { ...draft, name: 'Casa', models: ['claude-sonnet-4-5', 'claude-opus-4-1'] },
      secret: 'sk',
      validationToken: 'tok',
    });
  });

  it('save is disabled without a name or without any selected model', () => {
    renderStep();
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: ' ' } });
    expect(screen.getByTestId('save-btn')).toBeDisabled();
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: 'X' } });
    expect(screen.getByTestId('save-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('model-claude-sonnet-4-5')); // unselect the only one
    expect(screen.getByTestId('save-btn')).toBeDisabled();
  });

  it('an unverified model is test-completed before it can be selected', async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);
    renderStep();
    fireEvent.click(screen.getByTestId('model-claude-haiku-4-5'));
    await waitFor(() => expect(screen.getByTestId('model-claude-haiku-4-5')).toBeChecked());
    expect(mockInvoke).toHaveBeenCalledWith('llm_verify_model', {
      draft,
      secret: 'sk',
      token: 'tok',
      model: 'claude-haiku-4-5',
    });
  });

  it('a model that fails verification stays unselected and shows why', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'ModelNotFound' });
    renderStep();
    fireEvent.click(screen.getByTestId('model-claude-haiku-4-5'));
    expect(await screen.findByTestId('models-error')).toHaveTextContent(/modelo no existe/i);
    expect(screen.getByTestId('model-claude-haiku-4-5')).not.toBeChecked();
  });

  it('custom models (e.g. Azure deployments) can be added and are verified', async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);
    renderStep({ result: { token: 'tok', available: [], verified: ['claude-sonnet-4-5'] }, suggested: [] });
    fireEvent.change(screen.getByTestId('custom-model-input'), { target: { value: 'my-deployment' } });
    fireEvent.click(screen.getByTestId('add-model'));
    await waitFor(() => expect(screen.getByTestId('model-my-deployment')).toBeChecked());
    expect(mockInvoke).toHaveBeenCalledWith(
      'llm_verify_model',
      expect.objectContaining({ model: 'my-deployment' }),
    );
  });

  it('shows a typed save error and stays on the step', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'NotValidated' });
    const { onSaved } = renderStep();
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(await screen.findByTestId('models-error')).toHaveTextContent(/no está validada/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('sends a null secret when none was typed (editing)', async () => {
    mockInvoke.mockResolvedValueOnce({ ...draft, id: 'abc' } as never);
    renderStep({ secret: '' });
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', expect.objectContaining({ secret: null })),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/ModelsAndName.test.tsx`
Expected: FAIL (`./ModelsAndName` not found).

- [ ] **Step 3: Implement** - `src/components/LlmWizard/ModelsAndName.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { llmSaveConnection, llmVerifyModel } from '../../lib/tauri';
import { asLlmError, describeLlmError } from '../../lib/llm/errors';
import type { Connection, LlmError, ValidateResult } from '../../lib/llm/types';
import {
  disabled,
  errorText,
  field,
  footer,
  ghostButton,
  input,
  label,
  muted,
  primaryButton,
  secondaryButton,
  title,
} from './styles';

interface Props {
  draft: Connection;
  result: ValidateResult;
  secret: string;
  /** Preset suggestions shown even when the endpoint lists nothing. */
  suggested: string[];
  onSaved: (saved: Connection) => void;
  onBack: () => void;
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

export function ModelsAndName({ draft, result, secret, suggested, onSaved, onBack }: Props): JSX.Element {
  const [extra, setExtra] = useState<string[]>([]);
  const [verified, setVerified] = useState<Set<string>>(new Set(result.verified));
  const [selected, setSelected] = useState<string[]>(draft.models.slice(0, 1));
  const [name, setName] = useState(draft.name);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LlmError | null>(null);

  const candidates = useMemo(
    () => uniq([...result.available, ...suggested, ...draft.models, ...extra]),
    [result.available, suggested, draft.models, extra],
  );
  const secretOrNull = secret.trim() === '' ? null : secret;

  const select = async (model: string) => {
    setError(null);
    if (!verified.has(model)) {
      setBusy(model);
      try {
        await llmVerifyModel(draft, secretOrNull, result.token, model);
        setVerified((v) => new Set(v).add(model));
      } catch (e) {
        setError(asLlmError(e));
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    setSelected((s) => (s.includes(model) ? s : [...s, model]));
  };

  const toggle = (model: string) => {
    if (selected.includes(model)) {
      setSelected((s) => s.filter((m) => m !== model));
    } else {
      void select(model);
    }
  };

  const addCustom = () => {
    const m = custom.trim();
    if (!m) return;
    setCustom('');
    setExtra((x) => uniq([...x, m]));
    void select(m);
  };

  const canSave = name.trim() !== '' && selected.length > 0 && !saving && busy === null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Keep the candidate order so the first listed selection becomes the default.
      const models = candidates.filter((m) => selected.includes(m));
      const saved = await llmSaveConnection({ ...draft, name: name.trim(), models }, secretOrNull, result.token);
      onSaved(saved);
    } catch (e) {
      setError(asLlmError(e));
      setSaving(false);
    }
  };

  const view = error ? describeLlmError(error, draft.engine) : null;

  return (
    <div data-testid="step-models" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Modelos y nombre</h2>
      <p style={muted}>Elige los modelos que aparecerán en el selector.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {candidates.map((m) => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
            <input
              type="checkbox"
              data-testid={`model-${m}`}
              checked={selected.includes(m)}
              disabled={busy !== null}
              onChange={() => toggle(m)}
            />
            <span>{m}</span>
            {busy === m && <span style={muted}>probando…</span>}
            {busy !== m && !verified.has(m) && !selected.includes(m) && (
              <span style={muted}>(se probará al elegirlo)</span>
            )}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          data-testid="custom-model-input"
          style={input}
          value={custom}
          placeholder="Otro modelo o despliegue"
          onChange={(e) => setCustom(e.target.value)}
        />
        <button data-testid="add-model" style={secondaryButton} onClick={addCustom}>
          Añadir
        </button>
      </div>

      <div style={field}>
        <label style={label} htmlFor="connection-name">Nombre de la conexión</label>
        <input
          id="connection-name"
          data-testid="connection-name"
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {view && (
        <div data-testid="models-error" role="alert">
          <p style={{ ...errorText, fontWeight: 500 }}>{view.message}</p>
          <p style={muted}>{view.action}</p>
        </div>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <button
          data-testid="save-btn"
          style={disabled(primaryButton, !canSave)}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/ModelsAndName.test.tsx && npx tsc --noEmit`
Expected: PASS (8 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/LlmWizard
git commit -m "feat(ui): add wizard models-and-name step with per-model verification"
```

### Task 28: `LlmWizard` container and mount in `App`

**Files:**
- Create: `src/components/LlmWizard/LlmWizard.tsx`, `src/components/LlmWizard/LlmWizard.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/LlmWizard/LlmWizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { LlmWizard } from './LlmWizard';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

function backend(overrides: Record<string, (args: unknown) => unknown> = {}) {
  mockInvoke.mockImplementation((async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args);
    switch (cmd) {
      case 'llm_detect_cli':
        return { installed: true, path: '/opt/homebrew/bin/claude' };
      case 'llm_validate':
        return { token: 'tok', available: ['opus', 'sonnet'], verified: ['opus', 'sonnet'] };
      case 'llm_save_connection':
        return { ...(args as { draft: Connection }).draft, id: 'new-id' };
      case 'llm_list_connections':
        return [];
      case 'llm_get_active':
        return null;
      default:
        return undefined;
    }
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useLlmStore.setState({ connections: [], active: null, loaded: true, error: null, wizardOpen: true, editing: null });
});

describe('LlmWizard', () => {
  it('walks route -> provider -> credentials -> validation -> models -> save for a CLI', async () => {
    backend();
    render(<LlmWizard />);

    expect(screen.getByTestId('step-route')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('route-subscription'));
    fireEvent.click(await screen.findByTestId('preset-claude-code'));

    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
    fireEvent.click(screen.getByTestId('credentials-next'));

    fireEvent.click(await screen.findByTestId('validation-continue'));
    fireEvent.click(await screen.findByTestId('save-btn'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'llm_save_connection',
        expect.objectContaining({ validationToken: 'tok', secret: null }),
      ),
    );
    // closes and reloads the connections
    await waitFor(() => expect(useLlmStore.getState().wizardOpen).toBe(false));
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
  });

  it('never reaches the models/save step when validation fails', async () => {
    backend({
      llm_validate: () => {
        throw { kind: 'Unauthorized' };
      },
    });
    render(<LlmWizard />);
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(await screen.findByTestId('preset-anthropic-api'));
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByTestId('credentials-next'));

    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/rechazó/i);
    expect(screen.queryByTestId('step-models')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-btn')).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_save_connection', expect.anything());
  });

  it('back from validation returns to credentials with the entered values', async () => {
    backend({
      llm_validate: () => {
        throw { kind: 'Unreachable' };
      },
    });
    render(<LlmWizard />);
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(await screen.findByTestId('preset-kimi-api'));
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByTestId('credentials-next'));
    await screen.findByTestId('validation-error');
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(await screen.findByTestId('secret-input')).toHaveValue('k1');
  });

  it('editing a saved connection starts at credentials and re-validates before saving', async () => {
    backend();
    const saved: Connection = {
      id: 'abc',
      name: 'Casa',
      presetId: 'claude-code',
      engine: 'cliClaude',
      baseUrl: null,
      auth: { type: 'none' },
      authHeader: 'bearer',
      extraHeaders: [],
      caCertPath: null,
      azureApiVersion: null,
      models: ['opus'],
    };
    useLlmStore.setState({ editing: saved });
    render(<LlmWizard />);
    expect(screen.getByTestId('step-credentials')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
    fireEvent.click(screen.getByTestId('credentials-next'));
    await screen.findByTestId('validation-continue');
    expect(mockInvoke).toHaveBeenCalledWith('llm_validate', expect.objectContaining({ secret: null }));
  });

  it('shows a step indicator and can be closed', () => {
    backend();
    render(<LlmWizard />);
    expect(screen.getByLabelText('Pasos')).toBeInTheDocument();
    expect(screen.getByText('Ruta').closest('li')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByTestId('wizard-close'));
    expect(useLlmStore.getState().wizardOpen).toBe(false);
  });

  it('renders nothing when closed', () => {
    useLlmStore.setState({ wizardOpen: false });
    const { container } = render(<LlmWizard />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard/LlmWizard.test.tsx`
Expected: FAIL (`./LlmWizard` not found).

- [ ] **Step 3: Implement**

`src/components/LlmWizard/LlmWizard.tsx`:

```tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';
import { PRESETS, draftFromPreset, type Preset, type Route } from '../../lib/llm/presets';
import type { Connection, ValidateResult } from '../../lib/llm/types';
import { ChooseRoute } from './ChooseRoute';
import { ChooseProvider } from './ChooseProvider';
import { Credentials } from './Credentials';
import { Validation } from './Validation';
import { ModelsAndName } from './ModelsAndName';
import { ghostButton, modal, muted, overlay } from './styles';

type StepId = 'route' | 'provider' | 'credentials' | 'validation' | 'models';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'route', label: 'Ruta' },
  { id: 'provider', label: 'Proveedor' },
  { id: 'credentials', label: 'Credenciales' },
  { id: 'validation', label: 'Validación' },
  { id: 'models', label: 'Modelos' },
];

/** Full-screen setup wizard. Mounted once in App; driven by llmStore. */
export function LlmWizard(): JSX.Element | null {
  const wizardOpen = useLlmStore((s) => s.wizardOpen);
  const editing = useLlmStore((s) => s.editing);
  const closeWizard = useLlmStore((s) => s.closeWizard);
  const load = useLlmStore((s) => s.load);

  const [step, setStep] = useState<StepId>(editing ? 'credentials' : 'route');
  const [route, setRoute] = useState<Route | null>(null);
  const [preset, setPreset] = useState<Preset | null>(
    editing ? PRESETS.find((p) => p.id === editing.presetId) ?? null : null,
  );
  const [draft, setDraft] = useState<Connection | null>(editing);
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState<ValidateResult | null>(null);

  if (!wizardOpen) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const finish = async () => {
    await load();
    closeWizard();
  };

  return (
    <div data-testid="llm-wizard" style={overlay} role="dialog" aria-modal="true" aria-label="Configurar IA">
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <ol
            aria-label="Pasos"
            style={{ display: 'flex', gap: 'var(--space-3)', listStyle: 'none', margin: 0, padding: 0 }}
          >
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                aria-current={s.id === step ? 'step' : undefined}
                style={{
                  ...muted,
                  color: i === stepIndex ? 'var(--daun)' : 'var(--ink-muted)',
                  fontWeight: i === stepIndex ? 600 : 400,
                }}
              >
                {s.label}
              </li>
            ))}
          </ol>
          <button data-testid="wizard-close" aria-label="Cerrar" style={ghostButton} onClick={closeWizard}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {step === 'route' && (
          <ChooseRoute
            onSelect={(r) => {
              setRoute(r);
              setStep('provider');
            }}
          />
        )}

        {step === 'provider' && route && (
          <ChooseProvider
            route={route}
            onBack={() => setStep('route')}
            onSelect={(p) => {
              setPreset(p);
              setDraft(draftFromPreset(p));
              setSecret('');
              setStep('credentials');
            }}
          />
        )}

        {step === 'credentials' && draft && (
          <Credentials
            preset={preset}
            draft={draft}
            secret={secret}
            onChange={setDraft}
            onSecret={setSecret}
            onBack={() => (editing ? closeWizard() : setStep('provider'))}
            onNext={() => {
              setResult(null);
              setStep('validation');
            }}
          />
        )}

        {step === 'validation' && draft && (
          <Validation
            draft={draft}
            secret={secret}
            onSuccess={setResult}
            onContinue={() => setStep('models')}
            onBack={() => setStep('credentials')}
          />
        )}

        {step === 'models' && draft && result && (
          <ModelsAndName
            draft={draft}
            result={result}
            secret={secret}
            suggested={preset?.suggestedModels ?? []}
            onBack={() => setStep('credentials')}
            onSaved={() => void finish()}
          />
        )}
      </div>
    </div>
  );
}
```

Note: the wizard must be **mounted fresh each time it opens** so its `useState` initializers pick up `editing`; `App` handles that by rendering it conditionally (below).

`src/App.tsx`: add the import and mount. After `import { SecondBrainView } from './views/SecondBrainView';` add:

```tsx
import { LlmWizard } from './components/LlmWizard/LlmWizard';
import { useLlmStore } from './store/llmStore';
```

Inside `AppLayout`, after the `useState` lines add `const wizardOpen = useLlmStore((s) => s.wizardOpen);` and just before the closing `</div>` of the layout (after `<ExitDialog ... />`) add:

```tsx
      {wizardOpen && <LlmWizard />}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/LlmWizard src/App.test.tsx && npx tsc --noEmit`
Expected: PASS (all wizard suites, App tests unchanged); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/LlmWizard src/App.tsx
git commit -m "feat(ui): add LlmWizard container and mount it in App"
```

---

# PHASE 7 - Model switcher and Settings

### Task 29: `ModelSwitcher` (bottom-right pill + popover), mounted in `App`

**Files:**
- Create: `src/components/ModelSwitcher/ModelSwitcher.tsx`, `src/components/ModelSwitcher/ModelSwitcher.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/ModelSwitcher/ModelSwitcher.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { ModelSwitcher } from './ModelSwitcher';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string, name: string, models: string[]): Connection => ({
  id,
  name,
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'none' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models,
});

const HOME = conn('h', 'Casa', ['opus', 'sonnet']);
const OFFICE = conn('o', 'Oficina', ['gpt-4.1']);

function seed(over: Partial<ReturnType<typeof useLlmStore.getState>> = {}) {
  useLlmStore.setState({
    connections: [HOME, OFFICE],
    active: { connectionId: 'h', model: 'opus' },
    loaded: true,
    error: null,
    wizardOpen: false,
    editing: null,
    ...over,
  });
}

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ModelSwitcher />
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/settings" element={<div data-testid="settings-page">settings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'llm_list_connections') return [HOME, OFFICE];
    if (cmd === 'llm_get_active') return { connectionId: 'h', model: 'opus' };
    return undefined;
  }) as never);
});

describe('ModelSwitcher', () => {
  it('shows the active selection as "<connection> · <model>", fixed bottom-right', () => {
    seed();
    renderSwitcher();
    const pill = screen.getByTestId('model-pill');
    expect(pill).toHaveTextContent('Casa · opus');
    const wrapper = screen.getByTestId('model-switcher');
    expect(wrapper.style.position).toBe('fixed');
    expect(wrapper.style.right).not.toBe('');
    expect(wrapper.style.bottom).not.toBe('');
  });

  it('opens a popover with connections grouped and their models', () => {
    seed();
    renderSwitcher();
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('model-pill'));
    expect(screen.getByTestId('model-popover')).toBeInTheDocument();
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Oficina')).toBeInTheDocument();
    expect(screen.getByTestId('model-option-h-opus')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('model-option-h-sonnet')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('model-option-o-gpt-4.1')).toBeInTheDocument();
  });

  it('selecting a model persists via llm_set_active and closes the popover', async () => {
    seed();
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'llm_set_active') return { connectionId: 'o', model: 'gpt-4.1' };
      return undefined;
    }) as never);
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-option-o-gpt-4.1'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'o', model: 'gpt-4.1' }),
    );
    await waitFor(() => expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument());
    expect(screen.getByTestId('model-pill')).toHaveTextContent('Oficina · gpt-4.1');
  });

  it('empty state reads "Configurar IA" and opens the wizard', () => {
    seed({ connections: [], active: null });
    mockInvoke.mockImplementation((async () => (undefined)) as never);
    renderSwitcher();
    const pill = screen.getByTestId('model-pill');
    expect(pill).toHaveTextContent('Configurar IA');
    fireEvent.click(pill);
    expect(useLlmStore.getState().wizardOpen).toBe(true);
  });

  it('"+ Añadir conexión" opens the wizard and "Gestionar" goes to settings', () => {
    seed();
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-add'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);

    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-manage'));
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('closes on Escape and on outside click', () => {
    seed();
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();
  });

  it('loads connections on mount and renders nothing until loaded', async () => {
    seed({ loaded: false, connections: [], active: null });
    renderSwitcher();
    expect(screen.queryByTestId('model-switcher')).not.toBeInTheDocument();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections'));
    expect(await screen.findByTestId('model-pill')).toHaveTextContent('Casa · opus');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/ModelSwitcher`
Expected: FAIL (`./ModelSwitcher` not found).

- [ ] **Step 3: Implement**

`src/components/ModelSwitcher/ModelSwitcher.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronUp, Sparkles } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-pill)',
  boxShadow: 'var(--shadow-pop)',
  padding: 'var(--space-1) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-2)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--ink)',
  cursor: 'pointer',
  textAlign: 'left',
};

/** Fixed bottom-right pill: "<connection> · <model>" + popover to switch. */
export function ModelSwitcher(): JSX.Element | null {
  const connections = useLlmStore((s) => s.connections);
  const active = useLlmStore((s) => s.active);
  const loaded = useLlmStore((s) => s.loaded);
  const load = useLlmStore((s) => s.load);
  const setActive = useLlmStore((s) => s.setActive);
  const openWizard = useLlmStore((s) => s.openWizard);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!loaded) return null;

  const activeConn = connections.find((c) => c.id === active?.connectionId);
  const label = activeConn && active ? `${activeConn.name} · ${active.model}` : 'Elegir modelo';

  return (
    <div
      ref={ref}
      data-testid="model-switcher"
      style={{ position: 'fixed', right: 'var(--space-4)', bottom: 'var(--space-4)', zIndex: 40 }}
    >
      {connections.length === 0 ? (
        <button data-testid="model-pill" style={pillStyle} onClick={() => openWizard()}>
          <Sparkles size={14} strokeWidth={1.5} color="var(--daun)" />
          Configurar IA
        </button>
      ) : (
        <>
          {open && (
            <div
              data-testid="model-popover"
              role="listbox"
              style={{
                position: 'absolute',
                right: 0,
                bottom: 'calc(100% + var(--space-2))',
                minWidth: 240,
                maxHeight: '60vh',
                overflow: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-pop)',
                padding: 'var(--space-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              {connections.map((c) => (
                <div key={c.id} role="group" aria-label={c.name}>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 12,
                      color: 'var(--ink-muted)',
                      padding: 'var(--space-1) var(--space-2)',
                    }}
                  >
                    {c.name}
                  </div>
                  {c.models.map((m) => {
                    const selected = active?.connectionId === c.id && active.model === m;
                    return (
                      <button
                        key={m}
                        role="option"
                        aria-selected={selected}
                        data-testid={`model-option-${c.id}-${m}`}
                        style={rowStyle}
                        onClick={async () => {
                          await setActive(c.id, m);
                          setOpen(false);
                        }}
                      >
                        <span>{m}</span>
                        {selected && <Check size={14} strokeWidth={1.5} color="var(--daun)" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div
                style={{
                  borderTop: '1px solid var(--line)',
                  paddingTop: 'var(--space-2)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <button
                  data-testid="model-add"
                  style={rowStyle}
                  onClick={() => {
                    setOpen(false);
                    openWizard();
                  }}
                >
                  + Añadir conexión
                </button>
                <button
                  data-testid="model-manage"
                  style={rowStyle}
                  onClick={() => {
                    setOpen(false);
                    navigate('/settings');
                  }}
                >
                  Gestionar
                </button>
              </div>
            </div>
          )}
          <button
            data-testid="model-pill"
            style={pillStyle}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span>{label}</span>
            <ChevronUp size={14} strokeWidth={1.5} color="var(--ink-muted)" />
          </button>
        </>
      )}
    </div>
  );
}
```

`src/App.tsx`: add `import { ModelSwitcher } from './components/ModelSwitcher/ModelSwitcher';` and, directly above `{wizardOpen && <LlmWizard />}`, add `<ModelSwitcher />`. (`AppLayout` is rendered inside `BrowserRouter`, so `useNavigate` works.)

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/ModelSwitcher src/App.test.tsx && npx tsc --noEmit`
Expected: PASS (7 switcher tests, App tests unchanged); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelSwitcher src/App.tsx
git commit -m "feat(ui): add bottom-right model switcher"
```

### Task 30: Settings "Conexiones de IA"

**Files:**
- Create: `src/components/Settings/AiConnections.tsx`, `src/components/Settings/AiConnections.test.tsx`
- Modify: `src/views/SettingsView.tsx`

- [ ] **Step 1: Write the failing test** - `src/components/Settings/AiConnections.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { AiConnections } from './AiConnections';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string, name: string, models: string[]): Connection => ({
  id,
  name,
  presetId: 'proxy',
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'apiKey' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'llm_list_connections') return [conn('a', 'Casa', ['m1'])];
    return undefined;
  }) as never);
  useLlmStore.setState({
    connections: [conn('a', 'Casa', ['m1', 'm2']), conn('b', 'Oficina', ['gpt-4.1'])],
    active: { connectionId: 'a', model: 'm1' },
    loaded: true,
    error: null,
    wizardOpen: false,
    editing: null,
  });
});

describe('AiConnections', () => {
  it('lists connections with their models and marks the active one', () => {
    render(<AiConnections />);
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent('Casa');
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent('m1, m2');
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent(/activa/i);
    expect(screen.getByTestId('ai-connection-b')).not.toHaveTextContent(/activa/i);
  });

  it('shows an empty state', () => {
    useLlmStore.setState({ connections: [], active: null });
    render(<AiConnections />);
    expect(screen.getByTestId('ai-connections-empty')).toBeInTheDocument();
  });

  it('add opens the wizard for a new connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-add'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();
  });

  it('edit opens the wizard with the connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-edit-b'));
    expect(useLlmStore.getState().editing?.id).toBe('b');
  });

  it('duplicate opens the wizard with an unsaved copy', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-duplicate-a'));
    const ed = useLlmStore.getState().editing!;
    expect(ed.id).toBe('');
    expect(ed.name).toBe('Casa (copia)');
    expect(ed.models).toEqual(['m1', 'm2']);
  });

  it('delete asks for confirmation, then calls llm_delete_connection', async () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-delete-b'));
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_delete_connection', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'b' }));
  });

  it('cancelling the confirmation keeps the connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-delete-b'));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_delete_connection', expect.anything());
  });
});
```

Before relying on button names in the last two tests, confirm `ConfirmDialog`'s cancel label: `grep -n "Cancelar" src/components/ConfirmDialog/ConfirmDialog.tsx`; if it differs, adapt the `name` matcher.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/Settings`
Expected: FAIL (`./AiConnections` not found).

- [ ] **Step 3: Implement**

`src/components/Settings/AiConnections.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useLlmStore } from '../../store/llmStore';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import type { Connection } from '../../lib/llm/types';

const button: React.CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

/** Settings section: list, edit, duplicate and delete AI connections. */
export function AiConnections(): JSX.Element {
  const connections = useLlmStore((s) => s.connections);
  const active = useLlmStore((s) => s.active);
  const load = useLlmStore((s) => s.load);
  const openWizard = useLlmStore((s) => s.openWizard);
  const deleteConnection = useLlmStore((s) => s.deleteConnection);
  const error = useLlmStore((s) => s.error);
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section data-testid="ai-connections" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-4)' }}>Conexiones de IA</h2>

      {connections.length === 0 ? (
        <p data-testid="ai-connections-empty" style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0 }}>
          Aún no hay ninguna conexión.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {connections.map((c) => (
            <li
              key={c.id}
              data-testid={`ai-connection-${c.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {c.name}
                  {active?.connectionId === c.id && (
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 12, color: 'var(--daun)' }}>activa</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{c.models.join(', ')}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button data-testid={`ai-edit-${c.id}`} style={button} onClick={() => openWizard(c)}>
                  Editar
                </button>
                <button
                  data-testid={`ai-duplicate-${c.id}`}
                  style={button}
                  onClick={() => openWizard({ ...c, id: '', name: `${c.name} (copia)` })}
                >
                  Duplicar
                </button>
                <button
                  data-testid={`ai-delete-${c.id}`}
                  style={{ ...button, color: 'var(--danger)' }}
                  onClick={() => setPendingDelete(c)}
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>}

      <button
        data-testid="ai-add"
        onClick={() => openWizard()}
        style={{
          marginTop: 'var(--space-3)',
          background: 'var(--daun)',
          color: 'var(--on-daun)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Añadir conexión
      </button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar conexión"
        description={`Se borrará «${pendingDelete?.name ?? ''}» y su clave del llavero.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          const id = pendingDelete?.id;
          setPendingDelete(null);
          if (id) await deleteConnection(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
```

`src/views/SettingsView.tsx`: add `import { AiConnections } from '../components/Settings/AiConnections';` and render `<AiConnections />` directly after the closing `</section>` of the GitHub Sync section (before the `{/* Overwrite confirm dialog */}` comment).

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/components/Settings src/views/SettingsView.test.tsx && npx tsc --noEmit`
Expected: PASS (7 new tests + existing SettingsView tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings src/views/SettingsView.tsx
git commit -m "feat(ui): add AI connections section to Settings"
```

---

# PHASE 8 - Framework docs and full verification

### Task 31: Update `AGENTS.md` §2.6

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the check (docs "test")** - confirm the old text is present and the new keywords are absent:

Run: `cd /Users/carlosdiez/Projects/markdaun && grep -c "Endpoint configurable" AGENTS.md; grep -c "AnthropicMessages" AGENTS.md`
Expected: `1` then `0`.

- [ ] **Step 2: Implement** - replace section 2.6 (from the `### 2.6 LLM — Second Brain` heading through the line `- La API key del LLM se guarda en el llavero del SO, igual que el PAT de GitHub.`) with:

```bash
python3 -I - <<'EOF'
p = 'AGENTS.md'
s = open(p).read()
start = s.index('### 2.6 LLM — Second Brain')
end_marker = '- La API key del LLM se guarda en el llavero del SO, igual que el PAT de GitHub.\n'
end = s.index(end_marker) + len(end_marker)
new = """### 2.6 LLM — Second Brain

- **Conexiones múltiples:** el usuario guarda varias conexiones LLM (`config.db`, tabla `llm_connections`) mediante un asistente que valida de extremo a extremo (alcanzabilidad, credencial, modelos, completion de prueba) y **no persiste nada hasta que todo pasa** (token de validación de un solo uso). Un selector fijo abajo a la derecha elige conexión + modelo activos (`llm_set_active`). Ajustes → *Conexiones de IA* las gestiona.
- **Motores** (`src-tauri/src/llm/engines/`): `OpenAiCompat` (OpenAI, Gemini API, Kimi, z.ai, Azure OpenAI con `api-version`, LiteLLM y proxies corporativos), `AnthropicMessages` (Anthropic API, Anthropic en Azure Foundry) y puentes CLI `claude -p` / `gemini -p` para usar la suscripción del usuario con las CLI oficiales. **No hay OAuth directo con ningún proveedor** (Anthropic lo prohíbe a terceros).
- **Autenticación:** API key en el llavero del SO (servicio `markdaun`, cuenta `llm-connection:<id>`), token Entra ID vía `az account get-access-token` (caché en memoria, refresco con < 5 min de vida) o ninguna. Cabecera de auth configurable (`Authorization: Bearer`, `api-key`, `x-api-key`), cabeceras extra y CA raíz propia para proxies que interceptan TLS.
- **Puente CLI:** binarios resueltos con el shell de login (`zsh -lc 'command -v'` / `where`) porque las apps lanzadas desde el Dock no heredan `PATH`; ejecución en un directorio temporal vacío, un solo turno, sin herramientas, con `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` eliminadas del entorno del hijo y timeout de 120 s.
- **Errores tipados** (`LlmError`: `Unreachable`, `Unauthorized`, `TlsUntrusted`, `ModelNotFound`, `CliMissing`, `CliNotLoggedIn`, `Timeout`, `BadResponse`…) serializados como `{kind, detail}`; el frontend los traduce a mensaje + acción.
- **Retrieval:** al preguntar, se generan embeddings de la query con `fastembed` y se recuperan los fragmentos más relevantes del vault vía `sqlite-vec`. El contexto se inyecta en el prompt (RAG) y `brain_query` lo envía a la conexión activa.
- **Embeddings del vault:** locales (`fastembed`), regenerados de forma incremental al guardar un fichero (background task Rust). Este diseño solo cubre el chat.
- Todos los secretos viven solo en el llavero del SO; el webview ve un secreto una única vez, al pegarlo en el asistente. Sin streaming por ahora.
"""
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
EOF
```

- [ ] **Step 3: Verify**

Run: `cd /Users/carlosdiez/Projects/markdaun && grep -c "Endpoint configurable" AGENTS.md; grep -c "AnthropicMessages" AGENTS.md; sed -n '/### 2.6/,/^---/p' AGENTS.md | head -20`
Expected: `0`, then `1`, then the new section followed by `---`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: describe LLM connections, engines and CLI/Azure auth in AGENTS.md"
```

### Task 32: Full verification

**Files:** none (verification only; fix forward in the task that owns any regression).

- [ ] **Step 1: Rust suite**

Run: `cd /Users/carlosdiez/Projects/markdaun/src-tauri && ORT_STRATEGY=download cargo test`
Expected: all tests pass, zero warnings. The only acceptable failures are the pre-existing flaky `git::tests::pull_fast_forward` and `git::tests::pull_reset_hard_on_divergence` (re-run once to confirm they are flaky; do not fix them here).

- [ ] **Step 2: Type-check and frontend suite with coverage**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx tsc --noEmit && npx vitest run --coverage`
Expected: tsc clean; all tests pass; line coverage >= 80% (project threshold, enforced by `vite.config.ts`). If a new file is under-covered, add the missing tests in the owning task's test file.

- [ ] **Step 3: Guard checks**

Run: `cd /Users/carlosdiez/Projects/markdaun && npx vitest run src/lib/invokeArgs.test.ts && grep -rn "brain_configure\|brain_get_config\|LlmConfigPanel\|brainConfigure\|brainGetConfig" src src-tauri/src; echo "exit=$?"`
Expected: invokeArgs PASS; the grep prints nothing and `exit=1` (no leftovers).

- [ ] **Step 4: Release bundle builds**

Run: `cd /Users/carlosdiez/Projects/markdaun && ORT_STRATEGY=download npx tauri build --bundles app`
Expected: build finishes and prints the path to `MarkDaun.app` under `src-tauri/target/release/bundle/macos/`.

- [ ] **Step 5: Manual smoke test (cannot be automated; report results to the user)**

Launch the built app and check, noting any deviation:
1. Fresh state: bottom-right pill reads "Configurar IA"; Brain view shows the setup prompt.
2. Wizard -> Usar mi suscripción -> Claude Code: CLI detected; validation runs the 4 steps against the user's real login; save; pill reads "Claude Code · <model>".
3. Wizard -> API key -> any provider with an invalid key: validation stops at "Credencial válida" with the human message; nothing appears in Settings -> Conexiones de IA.
4. Add a second connection; switch via the pill; ask a question in Brain and confirm the answer comes from the selected connection.
5. Settings: edit (re-validates), duplicate, delete (confirmation; key removed).
6. (If available) Azure Foundry with `az login`, and a proxy with a corporate root CA under Avanzado.

- [ ] **Step 6: Commit (only if verification required fixes)**

```bash
git add -A
git commit -m "fix(llm): address verification findings"
```

---

## Self-review

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| 2 decisions: no OAuth, CLIs, API keys, several connections, Azure CLI, proxy first class, nothing persisted before validation, secrets only in keyring, embeddings local | 12, 11, 20, 4, 14-15 (token-gated save), 3, 31 |
| 3.1 data model, storage, active selection, migration | 2, 3, 4 |
| 3.2 presets (+ doc verification) | 20 |
| 4 wizard steps and rules (Save only after validation, keyring write only on save, edit re-validates, Settings list) | 24-28, 30 |
| 5 switcher (pill, popover, empty state, persistence) | 29 |
| 6 architecture/commands (`llm_validate`, `llm_save_connection` + token, list, delete, set/get active, `brain_query`, removal of legacy commands) | 14-17 |
| 6.2 CLI bridge (login-shell resolve, empty temp dir, no tools, scrubbed env, timeout, tolerant JSON, typed errors, fixed model list) | 10, 12 |
| 6.3 Azure CLI auth (cache, 5 min refresh, scope, not-logged-in mapping) | 11 |
| 6.4 errors + frontend mapping | 1, 19 |
| 7 frontend files | 18-30 |
| 8 testing (engines vs fake server, TLS, CLI fake scripts + env assert, az cache with fake clock, store, pipeline order/stop/no-persist; frontend steps, save gating, error mapping, switcher, presets) | 5-14 (Rust), 19-30 (TS) |
| 10 AGENTS.md follow-up | 31 |

**Placeholder scan:** no TBD/TODO; every code step has full code. The only deliberately open items are the research checks in Task 20 Step 5 (the values are provided; the step verifies them against docs).

**Type/name consistency:** `LlmError` variants, `Connection` fields (camelCase on the wire), `ValidateResult {token, available, verified}`, `ActiveSelection {connectionId, model}`, `CliDetection {installed, path}`, `ProgressEvent {step, status, detail, error}`, command names (`llm_validate`, `llm_verify_model`, `llm_save_connection`, `llm_list_connections`, `llm_delete_connection`, `llm_set_active`, `llm_get_active`, `llm_detect_cli`) and `engines::{list_models, chat}` signatures are used identically in Rust, wrappers, store and components.

**Deliberate deviations from the spec (flagged for the reviewer):**
1. Enum dispatch instead of `trait ChatEngine`.
2. Extra command `llm_verify_model` and `llm_detect_cli`: the spec's validation (step 4) precedes model selection (step 5) yet requires every picked model to be listed or test-completed; the token therefore carries a verified-model set that `llm_verify_model` can extend. `llm_detect_cli` backs the "installed / Check again" panel (login state is established by validation).
3. `LlmError` gained `NotValidated` and `Storage`.
4. reqwest moved to rustls (deterministic custom-CA behaviour and a testable self-signed TLS server); OS-installed corporate CAs still work via `native-roots`.
5. `tauri-plugin-opener` added for the "Open page to create the key" button.
6. Duplicating a connection does not copy its keyring secret (user re-enters it).
7. UI copy is Spanish to match the existing app; code/comments English.
