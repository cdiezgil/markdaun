use super::attachment::*;
use base64::Engine as _;
use std::io::Cursor;

fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(w, h, image::Rgba([200, 30, 30, 255]));
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn dims(b64: &str) -> (u32, u32) {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
    image::load_from_memory(&bytes).map(|i| (i.width(), i.height())).unwrap()
}

fn vault() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn input(path: &str) -> AttachmentInput {
    AttachmentInput { vault_path: path.into(), derived: None }
}

#[test]
fn small_png_is_sent_as_is() {
    let v = vault();
    let bytes = png(40, 20);
    std::fs::write(v.path().join("a.png"), &bytes).unwrap();
    let out = build_attachments(v.path(), &[input("a.png")]).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].kind, AttachmentKind::Image);
    assert_eq!(out[0].name, "a.png");
    match &out[0].parts[0] {
        Part::Image { media_type, data_b64 } => {
            assert_eq!(media_type, "image/png");
            assert_eq!(base64::engine::general_purpose::STANDARD.decode(data_b64).unwrap(), bytes);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn large_raster_is_downscaled_keeping_aspect() {
    let v = vault();
    std::fs::create_dir(v.path().join("sub")).unwrap();
    std::fs::write(v.path().join("sub/big.png"), png(3136, 1568)).unwrap();
    let out = build_attachments(v.path(), &[input("sub/big.png")]).unwrap();
    let Part::Image { media_type, data_b64 } = &out[0].parts[0] else { panic!() };
    assert_eq!(media_type, "image/png");
    assert_eq!(dims(data_b64), (1568, 784));
}

#[test]
fn media_type_comes_from_content_not_extension() {
    let v = vault();
    std::fs::write(v.path().join("liar.jpg"), png(10, 10)).unwrap();
    let out = build_attachments(v.path(), &[input("liar.jpg")]).unwrap();
    let Part::Image { media_type, .. } = &out[0].parts[0] else { panic!() };
    assert_eq!(media_type, "image/png");
}

#[test]
fn svg_requires_a_rasterized_derivative_and_is_downscaled() {
    let v = vault();
    std::fs::write(v.path().join("d.svg"), "<svg/>").unwrap();
    let err = build_attachments(v.path(), &[input("d.svg")]).unwrap_err();
    assert!(err.0.contains("d.svg"), "{}", err.0);

    let b64 = base64::engine::general_purpose::STANDARD.encode(png(2000, 1000));
    let inp = AttachmentInput {
        vault_path: "d.svg".into(),
        derived: Some(Derived {
            images: vec![DerivedImage { media_type: "image/png".into(), data_b64: b64 }],
            text: None,
            page_count: None,
        }),
    };
    let out = build_attachments(v.path(), &[inp]).unwrap();
    assert_eq!(out[0].kind, AttachmentKind::Image);
    let Part::Image { data_b64, .. } = &out[0].parts[0] else { panic!() };
    assert_eq!(dims(data_b64), (1568, 784));
}

#[test]
fn rejects_paths_outside_the_vault() {
    let v = vault();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("x.png"), png(5, 5)).unwrap();
    let abs = outside.path().join("x.png").to_string_lossy().to_string();
    assert!(build_attachments(v.path(), &[input("../x.png")]).is_err());
    assert!(build_attachments(v.path(), &[input(&abs)]).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(outside.path().join("x.png"), v.path().join("link.png")).unwrap();
        assert!(build_attachments(v.path(), &[input("link.png")]).is_err());
    }
}

#[test]
fn rejects_more_than_five_and_unknown_types_and_missing_files() {
    let v = vault();
    std::fs::write(v.path().join("a.png"), png(5, 5)).unwrap();
    let six: Vec<_> = (0..6).map(|_| input("a.png")).collect();
    let err = build_attachments(v.path(), &six).unwrap_err();
    assert!(err.0.contains("5"), "{}", err.0);
    std::fs::write(v.path().join("a.txt"), "x").unwrap();
    assert!(build_attachments(v.path(), &[input("a.txt")]).is_err());
    assert!(build_attachments(v.path(), &[input("nope.png")]).is_err());
}

#[test]
fn pdf_native_only_without_derivatives() {
    let v = vault();
    std::fs::write(v.path().join("f.pdf"), b"%PDF-1.4 fake").unwrap();
    let out = build_attachments(v.path(), &[input("f.pdf")]).unwrap();
    assert_eq!(out[0].kind, AttachmentKind::Pdf);
    assert!(matches!(&out[0].parts[0], Part::Document { media_type, .. } if media_type == "application/pdf"));
    assert!(out[0].fallback.is_empty());
}

#[test]
fn pdf_with_derivatives_keeps_native_and_builds_fallback() {
    let v = vault();
    std::fs::write(v.path().join("f.pdf"), b"%PDF-1.4 fake").unwrap();
    let b64 = base64::engine::general_purpose::STANDARD.encode(png(10, 10));
    let inp = AttachmentInput {
        vault_path: "f.pdf".into(),
        derived: Some(Derived {
            images: vec![DerivedImage { media_type: "image/png".into(), data_b64: b64 }],
            text: Some("hola pdf".into()),
            page_count: Some(1),
        }),
    };
    let out = build_attachments(v.path(), &[inp]).unwrap();
    assert!(matches!(out[0].parts[0], Part::Document { .. }));
    assert!(matches!(&out[0].fallback[0], Part::Text(t) if t.contains("hola pdf")));
    assert!(matches!(out[0].fallback[1], Part::Image { .. }));
    assert!(matches!(out[0].parts_for(true)[0], Part::Document { .. }));
    assert!(matches!(out[0].parts_for(false)[0], Part::Text(_)));
}

#[test]
fn pdf_over_twenty_pages_uses_first_twenty_as_fallback_even_for_native() {
    let v = vault();
    std::fs::write(v.path().join("f.pdf"), b"%PDF-1.4 fake").unwrap();
    let b64 = base64::engine::general_purpose::STANDARD.encode(png(10, 10));
    let imgs: Vec<_> = (0..25).map(|_| DerivedImage { media_type: "image/png".into(), data_b64: b64.clone() }).collect();
    let inp = AttachmentInput {
        vault_path: "f.pdf".into(),
        derived: Some(Derived { images: imgs, text: None, page_count: Some(25) }),
    };
    let out = build_attachments(v.path(), &[inp]).unwrap();
    assert!(!out[0].parts.iter().any(|p| matches!(p, Part::Document { .. })));
    assert_eq!(out[0].parts.iter().filter(|p| matches!(p, Part::Image { .. })).count(), 20);
}

#[test]
fn pdf_over_size_limit_is_rejected() {
    let v = vault();
    let f = std::fs::File::create(v.path().join("big.pdf")).unwrap();
    f.set_len(MAX_PDF_BYTES as u64 + 1).unwrap();
    let err = build_attachments(v.path(), &[input("big.pdf")]).unwrap_err();
    assert!(err.0.contains("20 MB"), "{}", err.0);
}

#[test]
fn expand_prefixes_each_attachment_with_its_name_and_ends_with_the_text() {
    let a = Attachment {
        name: "a.png".into(),
        vault_path: "a.png".into(),
        kind: AttachmentKind::Image,
        parts: vec![Part::Image { media_type: "image/png".into(), data_b64: "AA".into() }],
        fallback: vec![],
    };
    let m = super::ChatMessage { attachments: vec![a], ..super::ChatMessage::text("user", "¿qué ves?") };
    let parts = m.expand(true);
    assert!(matches!(&parts[0], Part::Text(t) if t.contains("a.png")));
    assert!(matches!(parts[1], Part::Image { .. }));
    assert!(matches!(&parts[2], Part::Text(t) if t == "¿qué ves?"));
}

#[test]
fn stored_reference_lists_names() {
    let r = stored_references(&["a.png".to_string(), "b.pdf".to_string()]);
    assert_eq!(r, "📎 a.png\n📎 b.pdf");
    assert_eq!(stored_references(&[]), "");
}
