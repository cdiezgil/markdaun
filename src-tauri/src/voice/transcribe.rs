//! Whisper (whisper.cpp) behind a small trait, so the pipeline is testable
//! without a multi-hundred-megabyte model.

use super::note::Segment;
use super::VoiceError;
use std::path::Path;
use std::sync::{Arc, Mutex};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    /// Detected language code (`es`, `en`…).
    pub language: String,
    pub segments: Vec<Segment>,
}

pub trait Transcriber: Send + Sync {
    /// `samples`: mono 16 kHz.
    fn transcribe(&self, samples: &[f32]) -> Result<Transcript, VoiceError>;
}

pub struct WhisperEngine {
    ctx: WhisperContext,
}

fn tr<E: std::fmt::Display>(e: E) -> VoiceError {
    VoiceError::Transcribe(e.to_string())
}

impl WhisperEngine {
    /// Loads the model (Metal-accelerated on macOS builds).
    pub fn load(model: &Path) -> Result<Self, VoiceError> {
        let path = model.to_str().ok_or_else(|| tr("non-UTF-8 model path"))?;
        let ctx = WhisperContext::new_with_params(path, WhisperContextParameters::default()).map_err(tr)?;
        Ok(Self { ctx })
    }
}

impl Transcriber for WhisperEngine {
    fn transcribe(&self, samples: &[f32]) -> Result<Transcript, VoiceError> {
        let mut state = self.ctx.create_state().map_err(tr)?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("auto"));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        params.set_n_threads(threads as i32);
        state.full(params, samples).map_err(tr)?;
        let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).unwrap_or("auto").to_string();
        let segments = state
            .as_iter()
            .map(|s| Segment {
                // Whisper timestamps are in centiseconds.
                start_ms: s.start_timestamp().max(0) as u64 * 10,
                end_ms: s.end_timestamp().max(0) as u64 * 10,
                text: s.to_str_lossy().map(|t| t.to_string()).unwrap_or_default(),
            })
            .collect();
        Ok(Transcript { language, segments })
    }
}

/// Tauri managed state: the loaded engine, kept for the process lifetime and
/// replaced when another model is selected.
#[derive(Default)]
pub struct EngineState {
    slot: Mutex<Option<(String, Arc<WhisperEngine>)>>,
    queue: Mutex<()>,
}

impl EngineState {
    /// Held while a job runs so transcriptions go one after another.
    pub fn queue(&self) -> std::sync::MutexGuard<'_, ()> {
        self.queue.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn get_or_load(&self, model_id: &str, model: &Path) -> Result<Arc<WhisperEngine>, VoiceError> {
        let mut slot = self.slot.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((id, engine)) = slot.as_ref() {
            if id == model_id {
                return Ok(engine.clone());
            }
        }
        let engine = Arc::new(WhisperEngine::load(model)?);
        *slot = Some((model_id.to_string(), engine.clone()));
        Ok(engine)
    }
}
