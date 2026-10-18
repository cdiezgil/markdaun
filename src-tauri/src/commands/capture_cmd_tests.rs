use super::capture_cmd::summarize;
use crate::capture::clip::ClipResult;
use std::path::Path;

#[test]
fn summary_carries_a_vault_relative_slash_path() {
    let vault = Path::new("/v");
    let r = ClipResult {
        note_path: vault.join("Entrada").join("Artículo.md"),
        title: "Artículo".into(),
        clipped: true,
        failure: None,
        words: 120,
        images_downloaded: 2,
        images_failed: 1,
    };
    let s = summarize(vault, &r);
    assert_eq!(s.rel_path, "Entrada/Artículo.md");
    assert_eq!(s.path, "/v/Entrada/Artículo.md");
    assert_eq!((s.words, s.images_downloaded, s.images_failed), (120, 2, 1));
    assert!(s.clipped && s.failure.is_none());
}
