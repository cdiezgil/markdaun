pub mod client;
pub mod embeddings;

pub use client::{chat_completion, ChatMessage, LlmConfig};
pub use embeddings::{chunk_text, embed_text, load_model};

#[cfg(test)]
mod tests;
