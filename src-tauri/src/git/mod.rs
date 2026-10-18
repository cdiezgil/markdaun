pub mod sync;
pub use sync::{
    git_connect_apply_inner, git_connect_preview_inner, git_pull_inner, git_push_inner,
    git_status_inner, ConnectChoice, ConnectPreview, ConnectResult, SyncResult,
};

#[cfg(test)]
mod tests;
