#![allow(dead_code)] // removed in Task 17 once everything is wired

pub mod auth;
pub mod client;
pub mod connection;
pub mod embeddings;
pub mod engines;
pub mod error;
pub mod http;
pub mod secrets;
pub mod store;

pub use client::{chat_completion, ChatMessage, LlmConfig};
pub use embeddings::{chunk_text, embed_text, load_model};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod connection_tests;
#[cfg(test)]
mod secrets_tests;
#[cfg(test)]
mod store_tests;
#[cfg(test)]
pub mod testutil;
#[cfg(test)]
mod testutil_tests;
#[cfg(test)]
mod tls_tests;
