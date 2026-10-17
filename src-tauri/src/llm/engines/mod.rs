use serde::{Deserialize, Serialize};

pub mod openai;

#[cfg(test)]
mod openai_tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}
