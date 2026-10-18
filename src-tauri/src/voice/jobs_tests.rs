use super::jobs::{parse_recorded, run_job, transcribe_to_note, JobState, VoiceJobs};
use super::note::Segment;
use super::transcribe::{Transcriber, Transcript};
use super::VoiceError;
use chrono::NaiveDate;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

struct Fake(Result<Transcript, String>);

impl Transcriber for Fake {
    fn transcribe(&self, samples: &[f32]) -> Result<Transcript, VoiceError> {
        assert!(!samples.is_empty(), "the pipeline hands over decoded samples");
        self.0.clone().map_err(VoiceError::Transcribe)
    }
}

fn ok_transcript() -> Transcript {
    Transcript {
        language: "es".into(),
        segments: vec![Segment { start_ms: 0, end_ms: 2000, text: " Hola mundo. ".into() }],
    }
}

fn fixture_copy(dir: &Path, name: &str) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/voice/fixtures/voz-prueba.wav");
    let dst = dir.join(name);
    std::fs::copy(src, &dst).unwrap();
    dst
}

fn when() -> chrono::NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(14, 32, 0).unwrap()
}

#[test]
fn recorded_time_comes_from_the_file_name() {
    assert_eq!(parse_recorded("Nota de voz 2026-10-18 14-32"), Some(when()));
    assert_eq!(parse_recorded("Nota de voz 2026-10-18 14-32 2"), Some(when()));
    assert_eq!(parse_recorded("otra cosa"), None);
}

#[test]
fn writes_the_note_next_to_the_audio_with_metadata_and_transcript() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "Nota de voz 2026-10-18 14-32.wav");
    let md = transcribe_to_note(&audio, when(), "small", &Fake(Ok(ok_transcript()))).unwrap();
    assert_eq!(md, dir.path().join("Nota de voz 2026-10-18 14-32.md"));
    let text = std::fs::read_to_string(md).unwrap();
    assert!(text.starts_with("# Nota de voz — 18 oct 2026, 14:32\n"));
    assert!(text.contains("- Duración: 0:02\n"));
    assert!(text.contains("- Idioma: es\n") && text.contains("- Modelo: small\n"));
    assert!(text.contains("(Nota%20de%20voz%202026-10-18%2014-32.wav)"));
    assert!(text.contains("[00:00] Hola mundo."));
    assert!(!dir.path().join("Nota de voz 2026-10-18 14-32.md.part").exists());
}

#[test]
fn never_overwrites_an_existing_note() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "n.wav");
    std::fs::write(dir.path().join("n.md"), "mía").unwrap();
    assert!(transcribe_to_note(&audio, when(), "small", &Fake(Ok(ok_transcript()))).is_err());
    assert_eq!(std::fs::read_to_string(dir.path().join("n.md")).unwrap(), "mía");
}

fn prepared(t: Result<Transcript, String>) -> impl FnOnce(super::jobs::Progress<'_>) -> Result<Arc<dyn Transcriber>, VoiceError> {
    move |_| Ok(Arc::new(Fake(t)) as Arc<dyn Transcriber>)
}

#[test]
fn a_job_goes_transcribing_then_clears_and_leaves_the_note() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "a.wav");
    let jobs = VoiceJobs::default();
    let seen = Mutex::new(Vec::new());
    let on_change = || seen.lock().unwrap().push(jobs.get("Entrada/a.wav"));
    let md = run_job(&jobs, "Entrada/a.wav", &audio, when(), "small", prepared(Ok(ok_transcript())), &on_change).unwrap();
    assert!(md.exists());
    assert_eq!(jobs.get("Entrada/a.wav"), None);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.first().unwrap(), &Some(JobState::Transcribing));
    assert_eq!(seen.last().unwrap(), &None);
}

#[test]
fn download_progress_is_reflected_in_the_state() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "a.wav");
    let jobs = VoiceJobs::default();
    let seen = Mutex::new(Vec::new());
    let on_change = || seen.lock().unwrap().push(jobs.get("k"));
    run_job(
        &jobs,
        "k",
        &audio,
        when(),
        "small",
        |progress| {
            progress(10, Some(100));
            progress(100, Some(100));
            Ok(Arc::new(Fake(Ok(ok_transcript()))) as Arc<dyn Transcriber>)
        },
        &on_change,
    )
    .unwrap();
    let seen = seen.lock().unwrap().clone();
    assert!(seen.contains(&Some(JobState::Downloading { done: 10, total: Some(100) })));
    assert!(seen.contains(&Some(JobState::Downloading { done: 100, total: Some(100) })));
}

#[test]
fn a_failed_job_keeps_the_audio_flags_the_error_and_can_be_retried() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "a.wav");
    let jobs = VoiceJobs::default();
    let err = run_job(&jobs, "k", &audio, when(), "small", prepared(Err("boom".into())), &|| {}).unwrap_err();
    assert!(err.to_string().contains("boom"));
    assert!(audio.exists());
    assert!(!dir.path().join("a.md").exists());
    assert!(matches!(jobs.get("k"), Some(JobState::Error(m)) if m.contains("boom")));
    assert!(!jobs.is_active("k"));

    // Retry succeeds and clears the error.
    run_job(&jobs, "k", &audio, when(), "small", prepared(Ok(ok_transcript())), &|| {}).unwrap();
    assert_eq!(jobs.get("k"), None);
    assert!(dir.path().join("a.md").exists());
}

#[test]
fn a_model_that_cannot_be_prepared_is_a_job_error() {
    let dir = tempdir().unwrap();
    let audio = fixture_copy(dir.path(), "a.wav");
    let jobs = VoiceJobs::default();
    let res = run_job(&jobs, "k", &audio, when(), "small", |_| Err(VoiceError::Download("sin red".into())), &|| {});
    assert!(res.is_err());
    assert!(matches!(jobs.get("k"), Some(JobState::Error(m)) if m.contains("sin red")));
}

#[test]
fn an_undecodable_recording_is_a_job_error() {
    let dir = tempdir().unwrap();
    let audio = dir.path().join("rota.m4a");
    std::fs::write(&audio, b"not audio").unwrap();
    let jobs = VoiceJobs::default();
    assert!(run_job(&jobs, "k", &audio, when(), "small", prepared(Ok(ok_transcript())), &|| {}).is_err());
    assert!(matches!(jobs.get("k"), Some(JobState::Error(_))));
}
