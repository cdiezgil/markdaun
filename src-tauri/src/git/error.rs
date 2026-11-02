//! Typed sync errors for the UI, serialized as `{kind, detail}` like `LlmError`.

// Consumed by later automatic-sync tasks; unused in production code until then.
#![allow(dead_code)]

use super::sync::GitError;
use git2::{ErrorClass, ErrorCode};
use serde::Serialize;
use std::sync::Once;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum SyncError {
    Offline(String),
    Unauthorized(String),
    NotConfigured,
    PushRejected(String),
    NeedsDeletionConfirmation { deleted: usize, total: usize },
    Git(String),
}

/// Map a low-level `GitError` to the error kind the UI reacts to.
pub fn classify(err: &GitError) -> SyncError {
    match err {
        GitError::PushRejected(msg) => SyncError::PushRejected(msg.clone()),
        GitError::Git(e) => classify_git2(e),
        other => SyncError::Git(other.to_string()),
    }
}

fn classify_git2(e: &git2::Error) -> SyncError {
    let detail = e.message().to_string();
    if e.code() == ErrorCode::Auth
        || (e.class() == ErrorClass::Http && message_has_http_auth_status(&detail))
    {
        return SyncError::Unauthorized(detail);
    }
    let offline_class = matches!(
        e.class(),
        ErrorClass::Net | ErrorClass::Os | ErrorClass::Ssl
    );
    if offline_class {
        return SyncError::Offline(detail);
    }
    SyncError::Git(e.to_string())
}

fn message_has_http_auth_status(msg: &str) -> bool {
    msg.contains("401") || msg.contains("403")
}

static TIMEOUTS: Once = Once::new();

/// Set libgit2 connect/read timeouts (process-wide, applied once).
pub fn apply_network_timeouts() {
    TIMEOUTS.call_once(|| {
        // SAFETY: these setters only write libgit2 global option values, and the
        // `Once` guarantees no concurrent mutation from our side.
        unsafe {
            let _ = git2::opts::set_server_connect_timeout_in_milliseconds(10_000);
            let _ = git2::opts::set_server_timeout_in_milliseconds(20_000);
        }
    });
}
