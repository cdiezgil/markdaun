use super::jobs::transcribe_to_note;
use super::model::{download_model, spec_for};
use super::transcribe::WhisperEngine;
use chrono::NaiveDate;
use std::path::Path;

/// Real end-to-end check: downloads the `small` model (~190 MB) into a temp
/// dir and transcribes the committed Spanish clip. Run on demand:
/// `cargo test real_spanish_clip -- --ignored --nocapture`.
#[test]
#[ignore = "downloads the small Whisper model (~190 MB)"]
fn real_spanish_clip_is_transcribed_with_the_small_model() {
    let models = tempfile::tempdir().unwrap();
    let spec = spec_for("small").unwrap();
    let path = download_model(crate::llm::embeddings::HF_BASE_URL, &crate::models_mirror::Mirror::production(), models.path(), spec, &mut |_, _| {}).unwrap();
    let engine = WhisperEngine::load(&path).unwrap();

    let work = tempfile::tempdir().unwrap();
    let audio = work.path().join("Nota de voz 2026-10-18 14-32.m4a");
    std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/voice/fixtures/voz-prueba.m4a"), &audio).unwrap();
    let recorded = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(14, 32, 0).unwrap();
    let md = transcribe_to_note(&audio, recorded, "small", &engine).unwrap();
    let text = std::fs::read_to_string(md).unwrap();
    println!("---- transcript note ----\n{text}\n-------------------------");

    let lower = text.to_lowercase();
    assert!(lower.contains("- idioma: es"), "language auto-detected as Spanish: {text}");
    assert!(lower.contains("nota de voz") && lower.contains("prueba"), "expected the spoken sentence: {text}");
}
