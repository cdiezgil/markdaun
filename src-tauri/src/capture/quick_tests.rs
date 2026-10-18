use super::clip::ClipOptions;
use super::quick::{parse_single_url, save_quick_capture, QuickInput, QuickOutcome};
use super::testutil::PNG;
use crate::llm::testutil::{spawn, MockResponse};
use chrono::NaiveDate;
use std::fs;
use tempfile::tempdir;

fn now() -> chrono::NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(9, 5, 0).unwrap()
}

fn text(t: &str) -> QuickInput {
    QuickInput { text: t.to_string(), image: None }
}

fn entrada(vault: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(vault.join("Entrada"))
        .map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    names.sort();
    names
}

fn jpeg() -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(4, 4).write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

#[test]
fn only_a_lone_http_url_counts_as_a_link() {
    assert!(parse_single_url("https://example.com/a?b=1").is_some());
    assert!(parse_single_url("  http://example.com\n").is_some());
    assert!(parse_single_url("mira https://example.com").is_none());
    assert!(parse_single_url("https://a.com https://b.com").is_none());
    assert!(parse_single_url("ftp://example.com").is_none());
    assert!(parse_single_url("example.com").is_none());
    assert!(parse_single_url("https://a.com\nhttps://b.com").is_none());
    assert!(parse_single_url("").is_none());
}

#[tokio::test]
async fn text_becomes_a_timestamped_note() {
    let v = tempdir().unwrap();
    let out = save_quick_capture(v.path(), &text("  idea suelta\ncon dos líneas \n"), now(), &ClipOptions::default()).await.unwrap();
    let QuickOutcome::Note { path } = out else { panic!("{out:?}") };
    assert_eq!(path, v.path().join("Entrada/Captura 2026-10-18 09-05.md"));
    assert_eq!(fs::read_to_string(path).unwrap(), "idea suelta\ncon dos líneas\n");
}

#[tokio::test]
async fn same_minute_captures_get_numbered_names() {
    let v = tempdir().unwrap();
    for _ in 0..3 {
        save_quick_capture(v.path(), &text("x"), now(), &ClipOptions::default()).await.unwrap();
    }
    assert_eq!(
        entrada(v.path()),
        ["Captura 2026-10-18 09-05 2.md", "Captura 2026-10-18 09-05 3.md", "Captura 2026-10-18 09-05.md"]
    );
}

#[tokio::test]
async fn a_lone_url_is_clipped_instead() {
    let server = spawn(|_| {
        MockResponse::html(200, "<html><head><title>Hola</title></head><body><article><h1>Hola</h1><p>Un texto suficientemente largo, con comas, para ser contenido principal de la página y superar los umbrales de legibilidad del algoritmo de extracción, que necesita bastantes palabras.</p><p>Otro párrafo igualmente largo, con comas, que aporta más peso al contenido principal de la página, de modo que el artículo se detecte sin dudas por parte de la extracción.</p></article></body></html>")
    });
    let v = tempdir().unwrap();
    let url = format!(" {}/p \n", server.url);
    let out = save_quick_capture(v.path(), &text(&url), now(), &ClipOptions::default()).await.unwrap();
    let QuickOutcome::Clip(r) = out else { panic!("{out:?}") };
    assert!(r.clipped, "{:?}", r.failure);
    assert!(r.note_path.starts_with(v.path().join("Entrada")));
    assert!(!entrada(v.path()).iter().any(|n| n.starts_with("Captura")));
}

#[tokio::test]
async fn text_with_more_than_a_url_stays_a_plain_note() {
    let v = tempdir().unwrap();
    let t = "para leer: https://example.com/a";
    let out = save_quick_capture(v.path(), &text(t), now(), &ClipOptions::default()).await.unwrap();
    let QuickOutcome::Note { path } = out else { panic!("{out:?}") };
    assert_eq!(fs::read_to_string(path).unwrap(), format!("{t}\n"));
}

#[tokio::test]
async fn an_image_alone_is_saved_as_png() {
    let v = tempdir().unwrap();
    let input = QuickInput { text: "   ".into(), image: Some(PNG.to_vec()) };
    let out = save_quick_capture(v.path(), &input, now(), &ClipOptions::default()).await.unwrap();
    let QuickOutcome::Image { image, note } = out else { panic!("{out:?}") };
    assert_eq!(image, v.path().join("Entrada/Captura 2026-10-18 09-05.png"));
    assert!(note.is_none());
    assert_eq!(fs::read(image).unwrap(), PNG, "a PNG is stored as it came");
    assert_eq!(entrada(v.path()), ["Captura 2026-10-18 09-05.png"]);
}

#[tokio::test]
async fn image_plus_text_adds_a_note_embedding_the_image() {
    let v = tempdir().unwrap();
    let input = QuickInput { text: "mi comentario".into(), image: Some(jpeg()) };
    let out = save_quick_capture(v.path(), &input, now(), &ClipOptions::default()).await.unwrap();
    let QuickOutcome::Image { image, note } = out else { panic!("{out:?}") };
    let note = note.unwrap();
    assert_eq!(note, v.path().join("Entrada/Captura 2026-10-18 09-05.md"));
    assert_eq!(&fs::read(&image).unwrap()[..8], &PNG[..8], "other formats are converted to PNG");
    assert_eq!(
        fs::read_to_string(note).unwrap(),
        "![](Captura%202026-10-18%2009-05.png)\n\nmi comentario\n"
    );
}

#[tokio::test]
async fn image_and_note_share_the_numbered_name_on_collisions() {
    let v = tempdir().unwrap();
    let input = QuickInput { text: "t".into(), image: Some(PNG.to_vec()) };
    save_quick_capture(v.path(), &input, now(), &ClipOptions::default()).await.unwrap();
    // A lone note already took " 2": the pair skips to " 3" to stay matched.
    fs::write(v.path().join("Entrada/Captura 2026-10-18 09-05 2.md"), "otra").unwrap();
    save_quick_capture(v.path(), &input, now(), &ClipOptions::default()).await.unwrap();
    assert_eq!(
        entrada(v.path()),
        [
            "Captura 2026-10-18 09-05 2.md",
            "Captura 2026-10-18 09-05 3.md",
            "Captura 2026-10-18 09-05 3.png",
            "Captura 2026-10-18 09-05.md",
            "Captura 2026-10-18 09-05.png"
        ]
    );
    let md = fs::read_to_string(v.path().join("Entrada/Captura 2026-10-18 09-05 3.md")).unwrap();
    assert!(md.starts_with("![](Captura%202026-10-18%2009-05%203.png)"), "{md}");
}

#[tokio::test]
async fn empty_captures_and_broken_images_write_nothing() {
    let v = tempdir().unwrap();
    let o = ClipOptions::default();
    assert_eq!(save_quick_capture(v.path(), &text(" \n "), now(), &o).await.unwrap_err(), "empty_capture");
    let bad = QuickInput { text: "x".into(), image: Some(b"not an image".to_vec()) };
    assert_eq!(save_quick_capture(v.path(), &bad, now(), &o).await.unwrap_err(), "invalid_image");
    assert!(entrada(v.path()).is_empty());
}
