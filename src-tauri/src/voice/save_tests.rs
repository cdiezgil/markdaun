use super::save::{audio_ext, save_recording, MAX_AUDIO_BYTES};
use chrono::NaiveDate;
use tempfile::tempdir;

fn when() -> chrono::NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(14, 32, 7).unwrap()
}

#[test]
fn the_recorder_container_decides_the_extension() {
    assert_eq!(audio_ext("audio/mp4"), Some("m4a"));
    assert_eq!(audio_ext("audio/mp4;codecs=mp4a.40.2"), Some("m4a"));
    assert_eq!(audio_ext("audio/webm;codecs=opus"), Some("webm"));
    assert_eq!(audio_ext("audio/ogg; codecs=opus"), Some("ogg"));
    assert_eq!(audio_ext("audio/wav"), Some("wav"));
    assert_eq!(audio_ext("AUDIO/MPEG"), Some("mp3"));
    assert_eq!(audio_ext("video/webm"), Some("webm"));
    assert_eq!(audio_ext("application/x-evil"), None);
    assert_eq!(audio_ext(""), None);
}

#[test]
fn saves_into_entrada_with_a_dated_name() {
    let vault = tempdir().unwrap();
    let (path, rel) = save_recording(vault.path(), b"abc", "audio/mp4", when()).unwrap();
    assert_eq!(rel, "Entrada/Nota de voz 2026-10-18 14-32.m4a");
    assert_eq!(std::fs::read(&path).unwrap(), b"abc");
}

#[test]
fn a_second_recording_in_the_same_minute_gets_a_number_even_if_only_the_note_exists() {
    let vault = tempdir().unwrap();
    let (_, first) = save_recording(vault.path(), b"1", "audio/webm", when()).unwrap();
    let (_, second) = save_recording(vault.path(), b"2", "audio/webm", when()).unwrap();
    assert_eq!(first, "Entrada/Nota de voz 2026-10-18 14-32.webm");
    assert_eq!(second, "Entrada/Nota de voz 2026-10-18 14-32 2.webm");
    // A transcript of the base name blocks it too (they must pair up by stem).
    std::fs::write(vault.path().join("Entrada/Nota de voz 2026-10-18 14-32 3.md"), "x").unwrap();
    let (_, third) = save_recording(vault.path(), b"3", "audio/webm", when()).unwrap();
    assert_eq!(third, "Entrada/Nota de voz 2026-10-18 14-32 4.webm");
}

#[test]
fn rejects_empty_oversized_or_unknown_audio_without_writing() {
    let vault = tempdir().unwrap();
    assert_eq!(save_recording(vault.path(), b"", "audio/mp4", when()).unwrap_err(), "empty_audio");
    assert_eq!(save_recording(vault.path(), b"x", "text/html", when()).unwrap_err(), "unsupported_audio");
    let big = vec![0u8; MAX_AUDIO_BYTES + 1];
    assert_eq!(save_recording(vault.path(), &big, "audio/mp4", when()).unwrap_err(), "audio_too_large");
    let inbox = vault.path().join("Entrada");
    assert!(!inbox.exists() || std::fs::read_dir(inbox).unwrap().count() == 0);
}
