//! Test-only builders for small real Office files.
use std::io::Write;

/// 1x1 transparent PNG.
pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

pub fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default();
    for (name, data) in files {
        w.start_file(*name, opts).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

/// A `.docx` with a heading, the given paragraphs and one embedded PNG per
/// entry of `images` (names `imageN.png`).
pub fn simple_docx(paragraphs: &[&str], images: &[&[u8]]) -> Vec<u8> {
    let ns = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main""#;
    let mut body = String::from(r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Documento</w:t></w:r></w:p>"#);
    for p in paragraphs {
        body.push_str(&format!("<w:p><w:r><w:t>{p}</w:t></w:r></w:p>"));
    }
    let mut rels = String::new();
    for i in 0..images.len() {
        let n = i + 1;
        body.push_str(&format!(
            r#"<w:p><w:r><w:drawing><a:blip r:embed="rId{n}"/></w:drawing></w:r></w:p>"#
        ));
        rels.push_str(&format!(r#"<Relationship Id="rId{n}" Type="http://x/image" Target="media/image{n}.png"/>"#));
    }
    let doc = format!(r#"<?xml version="1.0"?><w:document {ns}><w:body>{body}</w:body></w:document>"#);
    let rels = format!(r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#);
    let names: Vec<String> = (1..=images.len()).map(|n| format!("word/media/image{n}.png")).collect();
    let mut files: Vec<(&str, &[u8])> =
        vec![("word/document.xml", doc.as_bytes()), ("word/_rels/document.xml.rels", rels.as_bytes())];
    for (n, img) in names.iter().zip(images) {
        files.push((n.as_str(), img));
    }
    zip_of(&files)
}

/// A `.pptx` with one titled slide per entry.
pub fn simple_pptx(titles: &[&str]) -> Vec<u8> {
    let ns = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
    let slides: Vec<String> = titles
        .iter()
        .map(|t| {
            format!(
                r#"<?xml version="1.0"?><p:sld {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
            )
        })
        .collect();
    let names: Vec<String> = (1..=titles.len()).map(|n| format!("ppt/slides/slide{n}.xml")).collect();
    let files: Vec<(&str, &[u8])> = names.iter().zip(&slides).map(|(n, s)| (n.as_str(), s.as_bytes())).collect();
    zip_of(&files)
}
