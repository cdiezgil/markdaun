use super::quick_cmd::{decode_image, summarize_quick, written_paths};
use crate::capture::clip::ClipResult;
use crate::capture::quick::QuickOutcome;
use std::path::{Path, PathBuf};

fn vault() -> &'static Path {
    Path::new("/v")
}

#[test]
fn note_summary() {
    let out = QuickOutcome::Note { path: PathBuf::from("/v/Entrada/Captura 1.md") };
    let s = summarize_quick(vault(), &out);
    assert_eq!((s.kind, s.rel_path.as_str()), ("note", "Entrada/Captura 1.md"));
    assert_eq!(written_paths(&out), [PathBuf::from("/v/Entrada/Captura 1.md")]);
}

#[test]
fn image_summary_points_at_the_note_when_there_is_one() {
    let with_note = QuickOutcome::Image {
        image: PathBuf::from("/v/Entrada/C.png"),
        note: Some(PathBuf::from("/v/Entrada/C.md")),
    };
    let s = summarize_quick(vault(), &with_note);
    assert_eq!((s.kind, s.rel_path.as_str()), ("image", "Entrada/C.md"));
    assert_eq!(written_paths(&with_note).len(), 2);

    let alone = QuickOutcome::Image { image: PathBuf::from("/v/Entrada/C.png"), note: None };
    assert_eq!(summarize_quick(vault(), &alone).rel_path, "Entrada/C.png");
}

#[test]
fn clip_summary_reports_failures() {
    let out = QuickOutcome::Clip(ClipResult {
        note_path: PathBuf::from("/v/Entrada/host — 2026-10-18.md"),
        title: "t".into(),
        clipped: false,
        failure: Some("HTTP 404".into()),
        words: 0,
        images_downloaded: 0,
        images_failed: 0,
    });
    let s = summarize_quick(vault(), &out);
    assert_eq!(s.kind, "clip");
    assert_eq!(s.clipped, Some(false));
    assert_eq!(s.failure.as_deref(), Some("HTTP 404"));
}

#[test]
fn decodes_plain_base64_and_data_urls() {
    assert_eq!(decode_image("aGk=").unwrap(), b"hi");
    assert_eq!(decode_image("data:image/png;base64,aGk=").unwrap(), b"hi");
    assert_eq!(decode_image("%%%").unwrap_err(), "invalid_image");
}
