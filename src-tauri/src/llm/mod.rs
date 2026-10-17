pub mod attachment;
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

pub use embeddings::{chunk_text, embed_text, load_model, EmbedderState};
pub use engines::ChatMessage;

#[cfg(test)]
mod attachment_tests;
#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod connection_tests;
#[cfg(test)]
mod embeddings_tests;
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
