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
