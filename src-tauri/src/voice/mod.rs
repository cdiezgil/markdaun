//! Voice notes: audio decoding, local Whisper transcription, model download
//! and the Markdown note a recording becomes.

pub mod audio;
pub mod jobs;
pub mod model;
pub mod note;
pub mod save;
pub mod transcribe;

#[cfg(test)]
mod audio_tests;
#[cfg(test)]
mod jobs_tests;
#[cfg(test)]
mod model_tests;
#[cfg(test)]
mod note_tests;
#[cfg(test)]
mod save_tests;
#[cfg(test)]
mod transcribe_tests;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("decode: {0}")]
    Decode(String),
    #[error("download: {0}")]
    Download(String),
    #[error("checksum mismatch")]
    Checksum,
    #[error("transcribe: {0}")]
    Transcribe(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
