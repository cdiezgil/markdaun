pub mod sync;
pub use sync::{ConnectAction, git_connect_inner, git_pull_inner, git_push_inner, git_status_inner};

#[cfg(test)]
mod tests;
