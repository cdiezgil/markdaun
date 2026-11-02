pub mod error;
pub mod runner;
pub mod scheduler;
pub mod state;
pub mod sync;
pub mod watcher;
pub use sync::{
    git_connect_apply_inner, git_connect_preview_inner, git_status_inner, ConnectChoice,
    ConnectPreview, ConnectResult,
};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod scheduler_tests;
#[cfg(test)]
mod runner_tests;
