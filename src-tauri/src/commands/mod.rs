pub mod fs_ops;
pub mod vault;
pub mod editor;
pub mod graph_cmd;
pub mod sync_cmd;
pub use fs_ops::*;
pub use vault::*;
pub use editor::*;
pub use graph_cmd::*;
pub use sync_cmd::*;

#[cfg(test)]
mod vault_tests;

#[cfg(test)]
mod fs_ops_tests;

#[cfg(test)]
mod editor_tests;

#[cfg(test)]
mod graph_tests;

#[cfg(test)]
mod sync_tests;

pub mod brain_scope;
#[cfg(test)]
mod brain_scope_tests;
pub mod brain_cmd;
pub use brain_cmd::*;
#[cfg(test)]
mod brain_tests;

pub mod llm_cmd;
pub use llm_cmd::*;
#[cfg(test)]
mod llm_tests;

pub mod chat_notes;
pub use chat_notes::*;
#[cfg(test)]
mod chat_notes_tests;

pub mod vault_index;
#[cfg(test)]
mod vault_index_tests;

pub mod backlinks;
pub use backlinks::*;
#[cfg(test)]
mod backlinks_tests;

pub mod inbox;
pub use inbox::*;
#[cfg(test)]
mod inbox_tests;

pub mod digest;
pub use digest::*;
#[cfg(test)]
mod digest_tests;
