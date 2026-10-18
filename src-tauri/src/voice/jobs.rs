//! Background transcription: in-memory job states (what the inbox shows next
//! to an audio file) and the job pipeline itself, kept free of Tauri so it
//! can be tested with a fake transcriber.

use super::audio::decode_file;
use super::note::{render_voice_note, VoiceMeta};
use super::transcribe::Transcriber;
use super::VoiceError;
use chrono::NaiveDateTime;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq)]
pub enum JobState {
    /// The model is being fetched; `total` when the server announced it.
    Downloading { done: u64, total: Option<u64> },
    Transcribing,
    Error(String),
}

/// Job states by vault-relative audio path. Managed by Tauri.
#[derive(Default)]
pub struct VoiceJobs {
    inner: Mutex<HashMap<String, JobState>>,
}

impl VoiceJobs {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, JobState>> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }
    pub fn set(&self, key: &str, state: JobState) {
        self.lock().insert(key.to_string(), state);
    }
    pub fn get(&self, key: &str) -> Option<JobState> {
        self.lock().get(key).cloned()
    }
    pub fn clear(&self, key: &str) {
        self.lock().remove(key);
    }
    /// A job for `key` is running (not failed).
    pub fn is_active(&self, key: &str) -> bool {
        matches!(self.get(key), Some(JobState::Downloading { .. } | JobState::Transcribing))
    }
}

/// `Nota de voz 2026-10-18 14-32` -> that moment.
pub fn parse_recorded(stem: &str) -> Option<NaiveDateTime> {
    let rest = stem.strip_prefix("Nota de voz ")?;
    let stamp = rest.get(..16)?;
    NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H-%M").ok()
}

/// Decodes `audio`, transcribes it and writes `<stem>.md` next to it (never
/// over an existing file). Returns the note path.
pub fn transcribe_to_note(
    audio: &Path,
    recorded: NaiveDateTime,
    model_id: &str,
    transcriber: &dyn Transcriber,
) -> Result<PathBuf, VoiceError> {
    let decoded = decode_file(audio)?;
    let transcript = transcriber.transcribe(&decoded.samples)?;
    let audio_name = audio.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let meta = VoiceMeta {
        recorded,
        duration_secs: decoded.duration_secs.round() as u64,
        language: &transcript.language,
        model: model_id,
        audio_name: &audio_name,
    };
    let md = render_voice_note(&meta, &transcript.segments);
    let target = audio.with_extension("md");
    let tmp = audio.with_extension("md.part");
    std::fs::write(&tmp, md)?;
    if target.exists() {
        let _ = std::fs::remove_file(&tmp);
        return Err(VoiceError::Io(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "note already exists")));
    }
    std::fs::rename(&tmp, &target)?;
    Ok(target)
}

pub type Progress<'a> = &'a mut dyn FnMut(u64, Option<u64>);

/// One transcription job. `prepare` makes the transcriber ready (downloading
/// the model, loading it) and reports download progress. Job state changes
/// are mirrored in `jobs` and announced through `on_change`; failures leave
/// the audio untouched with an `Error` state so it can be retried.
pub fn run_job(
    jobs: &VoiceJobs,
    key: &str,
    audio: &Path,
    recorded: NaiveDateTime,
    model_id: &str,
    prepare: impl FnOnce(Progress<'_>) -> Result<Arc<dyn Transcriber>, VoiceError>,
    on_change: &dyn Fn(),
) -> Result<PathBuf, VoiceError> {
    jobs.set(key, JobState::Transcribing);
    on_change();
    let outcome = (|| {
        let transcriber = prepare(&mut |done, total| {
            jobs.set(key, JobState::Downloading { done, total });
            on_change();
        })?;
        jobs.set(key, JobState::Transcribing);
        on_change();
        transcribe_to_note(audio, recorded, model_id, transcriber.as_ref())
    })();
    match &outcome {
        Ok(_) => jobs.clear(key),
        Err(e) => jobs.set(key, JobState::Error(e.to_string())),
    }
    on_change();
    outcome
}
