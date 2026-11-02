use super::{inbox_files, pending_transcriptions};
use crate::voice::jobs::{JobState, VoiceJobs};
use std::path::Path;

fn touch(vault: &Path, rel: &str) {
    let p = vault.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b"x").unwrap();
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn picks_new_audio_in_entrada() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/Nota de voz 2026-11-02 09-05.webm");
    let c = s(&["Entrada/Nota de voz 2026-11-02 09-05.webm"]);
    assert_eq!(pending_transcriptions(d.path(), &c, &VoiceJobs::default()), c);
}

#[test]
fn skips_audio_with_transcript() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/Nota de voz 2026-11-02 09-05.m4a");
    touch(d.path(), "Entrada/Nota de voz 2026-11-02 09-05.md");
    let c = s(&["Entrada/Nota de voz 2026-11-02 09-05.m4a"]);
    assert!(pending_transcriptions(d.path(), &c, &VoiceJobs::default()).is_empty());
}

#[test]
fn skips_numbered_stem_with_transcript() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/Nota de voz 2026-11-02 09-05 2.webm");
    touch(d.path(), "Entrada/Nota de voz 2026-11-02 09-05 2.md");
    let c = s(&["Entrada/Nota de voz 2026-11-02 09-05 2.webm"]);
    assert!(pending_transcriptions(d.path(), &c, &VoiceJobs::default()).is_empty());
}

#[test]
fn skips_subfolders_and_non_audio() {
    let d = tempfile::tempdir().unwrap();
    for rel in ["Entrada/sub/a.webm", "Recetas/a.webm", "Entrada/nota.md", "Entrada/foto.png", "Entrada/sin-extension"] {
        touch(d.path(), rel);
    }
    let c = s(&["Entrada/sub/a.webm", "Recetas/a.webm", "Entrada/nota.md", "Entrada/foto.png", "Entrada/sin-extension", "../x.webm"]);
    assert!(pending_transcriptions(d.path(), &c, &VoiceJobs::default()).is_empty());
}

#[test]
fn skips_active_jobs() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/a.webm");
    touch(d.path(), "Entrada/b.webm");
    let jobs = VoiceJobs::default();
    jobs.set("Entrada/a.webm", JobState::Transcribing);
    let c = s(&["Entrada/a.webm", "Entrada/b.webm"]);
    assert_eq!(pending_transcriptions(d.path(), &c, &jobs), s(&["Entrada/b.webm"]));
}

#[test]
fn retries_failed_jobs() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/a.webm");
    let jobs = VoiceJobs::default();
    jobs.set("Entrada/a.webm", JobState::Error("boom".into()));
    assert_eq!(pending_transcriptions(d.path(), &s(&["Entrada/a.webm"]), &jobs).len(), 1);
}

#[test]
fn skips_missing_files() {
    let d = tempfile::tempdir().unwrap();
    let c = s(&["Entrada/gone.webm"]);
    assert!(pending_transcriptions(d.path(), &c, &VoiceJobs::default()).is_empty());
}

#[test]
fn inbox_files_lists_only_top_level_files() {
    let d = tempfile::tempdir().unwrap();
    touch(d.path(), "Entrada/b.webm");
    touch(d.path(), "Entrada/a.md");
    touch(d.path(), "Entrada/sub/c.webm");
    assert_eq!(inbox_files(d.path()), s(&["Entrada/a.md", "Entrada/b.webm"]));
    assert!(inbox_files(&d.path().join("nope")).is_empty());
}
