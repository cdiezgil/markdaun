use super::office::{extract_docx, extract_pptx, split_docx, split_markdown_by_headings, split_office, split_pptx};
use super::testutil::{zip_of, PNG};

const W_NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main""#;

fn docx(body: &str, rels: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let doc = format!(r#"<?xml version="1.0"?><w:document {W_NS}><w:body>{body}</w:body></w:document>"#);
    let rels = format!(
        r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#
    );
    let styles = format!(
        r#"<?xml version="1.0"?><w:styles {W_NS}>
<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
</w:styles>"#
    );
    let numbering = format!(
        r#"<?xml version="1.0"?><w:numbering {W_NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"#
    );
    let mut files: Vec<(&str, &[u8])> = vec![
        ("word/document.xml", doc.as_bytes()),
        ("word/_rels/document.xml.rels", rels.as_bytes()),
        ("word/styles.xml", styles.as_bytes()),
        ("word/numbering.xml", numbering.as_bytes()),
    ];
    files.extend_from_slice(extra);
    zip_of(&files)
}

fn para(style: Option<&str>, runs: &str) -> String {
    let ppr = style.map(|s| format!(r#"<w:pPr><w:pStyle w:val="{s}"/></w:pPr>"#)).unwrap_or_default();
    format!("<w:p>{ppr}{runs}</w:p>")
}

fn run(text: &str) -> String {
    format!("<w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r>")
}

fn list_item(num_id: u32, lvl: u32, text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{lvl}"/><w:numId w:val="{num_id}"/></w:numPr></w:pPr>{}</w:p>"#,
        run(text)
    )
}

#[test]
fn docx_headings_and_paragraphs() {
    let body = [
        para(Some("Title"), &run("Informe")),
        para(Some("Ttulo1"), &run("Contexto")),
        para(None, &run("Primer párrafo.")),
        para(Some("Heading2"), &run("Detalle")),
        para(None, ""), // empty paragraphs vanish
        para(None, &run("Segundo párrafo.")),
    ]
    .concat();
    let out = extract_docx(&docx(&body, "", &[])).unwrap();
    assert_eq!(
        out.markdown,
        "# Informe\n\n# Contexto\n\nPrimer párrafo.\n\n## Detalle\n\nSegundo párrafo."
    );
    assert!(out.images.is_empty());
}

#[test]
fn docx_bold_italic_merge_adjacent_runs() {
    let b = |t: &str| format!("<w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{t}</w:t></w:r>");
    let i = |t: &str| format!("<w:r><w:rPr><w:i/></w:rPr><w:t xml:space=\"preserve\">{t}</w:t></w:r>");
    let off = "<w:r><w:rPr><w:b w:val=\"0\"/></w:rPr><w:t>plano</w:t></w:r>";
    let body = para(None, &format!("{}{}{}{} {}", run("Hola "), b("muy "), b("fuerte "), i("itálico "), off));
    let out = extract_docx(&docx(&body, "", &[])).unwrap();
    assert_eq!(out.markdown, "Hola **muy fuerte** *itálico* plano");
}

#[test]
fn docx_lists_bullets_numbers_and_nesting() {
    let body = [
        list_item(1, 0, "uno"),
        list_item(1, 1, "uno-a"),
        list_item(1, 0, "dos"),
        para(None, &run("Pasos:")),
        list_item(2, 0, "primero"),
        list_item(2, 0, "segundo"),
    ]
    .concat();
    let out = extract_docx(&docx(&body, "", &[])).unwrap();
    assert_eq!(out.markdown, "- uno\n  - uno-a\n- dos\n\nPasos:\n\n1. primero\n2. segundo");
}

#[test]
fn docx_table_becomes_gfm() {
    let cell = |t: &str| format!("<w:tc>{}</w:tc>", para(None, &run(t)));
    let row = |cs: &[&str]| format!("<w:tr>{}</w:tr>", cs.iter().map(|c| cell(c)).collect::<String>());
    let body = format!("<w:tbl>{}{}</w:tbl>", row(&["Nombre", "Edad"]), row(&["Ana | B", "30"]));
    let out = extract_docx(&docx(&body, "", &[])).unwrap();
    assert_eq!(out.markdown, "| Nombre | Edad |\n| --- | --- |\n| Ana \\| B | 30 |");
}

#[test]
fn docx_hyperlinks_use_relationship_targets() {
    let rels = r#"<Relationship Id="rId5" Type="http://x/hyperlink" Target="https://example.com/a" TargetMode="External"/>"#;
    let body = para(None, &format!("{}<w:hyperlink r:id=\"rId5\">{}</w:hyperlink>", run("Ver "), run("el sitio")));
    let out = extract_docx(&docx(&body, rels, &[])).unwrap();
    assert_eq!(out.markdown, "Ver [el sitio](https://example.com/a)");
}

#[test]
fn docx_images_are_extracted_and_marked() {
    let rels = r#"<Relationship Id="rId9" Type="http://x/image" Target="media/image1.png"/>"#;
    let drawing = r#"<w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rId9"/></a:graphicData></a:graphic></w:drawing></w:r>"#;
    let body = para(None, &format!("{}{drawing}", run("Figura: ")));
    let out = extract_docx(&docx(&body, rels, &[("word/media/image1.png", PNG)])).unwrap();
    assert_eq!(out.markdown, "Figura: [Imagen: image1.png]");
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].name, "image1.png");
    assert_eq!(out.images[0].media_type, "image/png");
    assert_eq!(out.images[0].bytes, PNG);
}

#[test]
fn docx_rejects_non_zip_and_missing_document() {
    assert!(extract_docx(b"not a zip").is_err());
    assert!(extract_docx(&zip_of(&[("x.txt", b"x")])).is_err());
}

const P_NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;

fn rels_xml(items: &[(&str, &str, &str)]) -> String {
    let body: String = items
        .iter()
        .map(|(id, ty, target)| format!(r#"<Relationship Id="{id}" Type="http://x/{ty}" Target="{target}"/>"#))
        .collect();
    format!(r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>"#)
}

fn shape(ph: &str, paras: &[&str]) -> String {
    let ps: String = paras.iter().map(|p| format!("<a:p><a:r><a:t>{p}</a:t></a:r></a:p>")).collect();
    format!(r#"<p:sp><p:nvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:txBody>{ps}</p:txBody></p:sp>"#)
}

fn slide(shapes: &str) -> String {
    format!(r#"<?xml version="1.0"?><p:sld {P_NS}><p:cSld><p:spTree>{shapes}</p:spTree></p:cSld></p:sld>"#)
}

#[test]
fn pptx_slides_in_presentation_order_with_titles_lists_notes_and_images() {
    let pres = format!(
        r#"<?xml version="1.0"?><p:presentation {P_NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>"#
    );
    // rId2 (slide2.xml) is presented first.
    let pres_rels = rels_xml(&[("rId1", "slide", "slides/slide1.xml"), ("rId2", "slide", "slides/slide2.xml")]);
    let s2 = slide(&format!(
        "{}{}",
        shape(r#"<p:ph type="title"/>"#, &["Resumen"]),
        shape(r#"<p:ph type="body" idx="1"/>"#, &["Punto A", "Punto B"])
    ));
    let s2_rels = rels_xml(&[("rId1", "notesSlide", "../notesSlides/notesSlide2.xml")]);
    let notes = slide(&format!(
        "{}{}",
        shape(r#"<p:ph type="sldImg"/>"#, &["no"]),
        shape(r#"<p:ph type="body" idx="1"/>"#, &["Recordar la demo"])
    ));
    let pic = r#"<p:pic><p:blipFill><a:blip r:embed="rId7"/></p:blipFill></p:pic>"#;
    let s1 = slide(&format!(
        "{}{}{pic}",
        shape(r#"<p:ph type="ctrTitle"/>"#, &["Portada"]),
        shape("", &["Texto suelto"])
    ));
    let s1_rels = rels_xml(&[("rId7", "image", "../media/image3.png")]);
    let bytes = zip_of(&[
        ("ppt/presentation.xml", pres.as_bytes()),
        ("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes()),
        ("ppt/slides/slide1.xml", s1.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", s1_rels.as_bytes()),
        ("ppt/slides/slide2.xml", s2.as_bytes()),
        ("ppt/slides/_rels/slide2.xml.rels", s2_rels.as_bytes()),
        ("ppt/notesSlides/notesSlide2.xml", notes.as_bytes()),
        ("ppt/media/image3.png", PNG),
    ]);
    let out = extract_pptx(&bytes).unwrap();
    assert_eq!(
        out.markdown,
        "## Diapositiva 1 — Resumen\n\n- Punto A\n- Punto B\n\n> Notas: Recordar la demo\n\n## Diapositiva 2 — Portada\n\nTexto suelto\n\n[Imagen: image3.png]"
    );
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].name, "image3.png");
}

#[test]
fn pptx_without_presentation_order_falls_back_to_file_order_and_untitled_slides() {
    let s = |t: &str| slide(&shape("", &[t]));
    let (a, b, c) = (s("uno"), s("dos"), s("diez"));
    let bytes = zip_of(&[
        ("ppt/slides/slide10.xml", c.as_bytes()),
        ("ppt/slides/slide2.xml", b.as_bytes()),
        ("ppt/slides/slide1.xml", a.as_bytes()),
    ]);
    let out = extract_pptx(&bytes).unwrap();
    assert_eq!(
        out.markdown,
        "## Diapositiva 1\n\nuno\n\n## Diapositiva 2\n\ndos\n\n## Diapositiva 3\n\ndiez"
    );
}

#[test]
fn pptx_table_in_a_slide() {
    let tbl = r#"<p:graphicFrame><a:graphic><a:graphicData><a:tbl>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>K</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>V</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>a</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#;
    let s = slide(tbl);
    let out = extract_pptx(&zip_of(&[("ppt/slides/slide1.xml", s.as_bytes())])).unwrap();
    assert_eq!(out.markdown, "## Diapositiva 1\n\n| K | V |\n| --- | --- |\n| a | 1 |");
}

#[test]
fn pptx_rejects_non_zip_and_empty_deck() {
    assert!(extract_pptx(b"nope").is_err());
    assert!(extract_pptx(&zip_of(&[("x", b"x")])).is_err());
}

// ─── TC-01..TC-05: split_markdown_by_headings ─────────────────────────────────

#[test]
fn tc01_split_by_h1s() {
    let md = "# Intro\n\nContenido.\n\n# Capítulo 1\n\nTexto.\n\n# Conclusión\n\nFin.";
    let (sections, level) = split_markdown_by_headings(md);
    assert_eq!(level, 1);
    assert_eq!(sections.len(), 3);
    assert_eq!(sections[0].title, "Intro");
    assert_eq!(sections[1].title, "Capítulo 1");
    assert_eq!(sections[2].title, "Conclusión");
}

#[test]
fn tc02_split_by_h2_when_no_h1() {
    let md = "## A\n\nTexto A.\n\n## B\n\nTexto B.";
    let (sections, level) = split_markdown_by_headings(md);
    assert_eq!(level, 2);
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0].title, "A");
    assert_eq!(sections[1].title, "B");
}

#[test]
fn tc03_no_headings_returns_single_section() {
    let md = "Solo párrafos.\nSin títulos.";
    let (sections, _level) = split_markdown_by_headings(md);
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0].title, "Sin título");
    assert!(sections[0].markdown.contains("Solo párrafos"));
}

#[test]
fn tc04_blank_preamble_discarded_content_preamble_becomes_section() {
    // Blank preamble is discarded
    let md = "\n\n# Sec 1\n\nTexto.";
    let (sections, _) = split_markdown_by_headings(md);
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0].title, "Sec 1");

    // Non-blank preamble becomes "Sin título" section
    let md2 = "Introducción sin título.\n\n# Sec 1\n\nTexto.";
    let (sections2, _) = split_markdown_by_headings(md2);
    assert_eq!(sections2.len(), 2);
    assert_eq!(sections2[0].title, "Sin título");
    assert_eq!(sections2[1].title, "Sec 1");
}

#[test]
fn tc05_empty_h1_title_becomes_sin_titulo() {
    let md = "# \n\nContenido.";
    let (sections, _) = split_markdown_by_headings(md);
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0].title, "Sin título");
}

// ─── TC-06..TC-09: split_pptx ─────────────────────────────────────────────────

fn pptx_with_ooxml_sections() -> Vec<u8> {
    let pres = format!(
        r#"<?xml version="1.0"?><p:presentation {P_NS}>
<p:sldIdLst>
  <p:sldId id="256" r:id="rId1"/>
  <p:sldId id="257" r:id="rId2"/>
  <p:sldId id="258" r:id="rId3"/>
  <p:sldId id="259" r:id="rId4"/>
  <p:sldId id="260" r:id="rId5"/>
  <p:sldId id="261" r:id="rId6"/>
</p:sldIdLst>
<p:sectionLst>
  <p:section name="Sección A">
    <p:sldIdLst>
      <p:sldId id="256"/>
      <p:sldId id="257"/>
      <p:sldId id="258"/>
    </p:sldIdLst>
  </p:section>
  <p:section name="Sección B">
    <p:sldIdLst>
      <p:sldId id="259"/>
      <p:sldId id="260"/>
      <p:sldId id="261"/>
    </p:sldIdLst>
  </p:section>
</p:sectionLst>
</p:presentation>"#
    );
    let pres_rels = rels_xml(&[
        ("rId1", "slide", "slides/slide1.xml"),
        ("rId2", "slide", "slides/slide2.xml"),
        ("rId3", "slide", "slides/slide3.xml"),
        ("rId4", "slide", "slides/slide4.xml"),
        ("rId5", "slide", "slides/slide5.xml"),
        ("rId6", "slide", "slides/slide6.xml"),
    ]);
    let mk_slide = |t: &str| -> String {
        slide(&shape(r#"<p:ph type="title"/>"#, &[t]))
    };
    let s1 = mk_slide("Diap 1 Sec A");
    let s2 = mk_slide("Diap 2 Sec A");
    let s3 = mk_slide("Diap 3 Sec A");
    let s4 = mk_slide("Diap 1 Sec B");
    let s5 = mk_slide("Diap 2 Sec B");
    let s6 = mk_slide("Diap 3 Sec B");
    zip_of(&[
        ("ppt/presentation.xml", pres.as_bytes()),
        ("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes()),
        ("ppt/slides/slide1.xml", s1.as_bytes()),
        ("ppt/slides/slide2.xml", s2.as_bytes()),
        ("ppt/slides/slide3.xml", s3.as_bytes()),
        ("ppt/slides/slide4.xml", s4.as_bytes()),
        ("ppt/slides/slide5.xml", s5.as_bytes()),
        ("ppt/slides/slide6.xml", s6.as_bytes()),
    ])
}

#[test]
fn tc06_pptx_with_section_lst_produces_one_section_per_ooxml_section() {
    let bytes = pptx_with_ooxml_sections();
    let result = split_pptx(&bytes).unwrap();
    assert_eq!(result.sections.len(), 2);
    assert_eq!(result.sections[0].title, "Sección A");
    assert_eq!(result.sections[1].title, "Sección B");
}

#[test]
fn tc07_pptx_without_sections_produces_one_section_per_slide() {
    use super::testutil::simple_pptx;
    let bytes = simple_pptx(&["Intro", "Desarrollo", "Conclusión"]);
    let result = split_pptx(&bytes).unwrap();
    assert_eq!(result.sections.len(), 3);
    assert_eq!(result.sections[0].title, "Intro");
    assert_eq!(result.sections[1].title, "Desarrollo");
    assert_eq!(result.sections[2].title, "Conclusión");
}

#[test]
fn tc08_pptx_slide_without_title_gets_sin_titulo() {
    let s = slide(&shape("", &["Contenido sin título"]));
    let bytes = zip_of(&[("ppt/slides/slide1.xml", s.as_bytes())]);
    let result = split_pptx(&bytes).unwrap();
    assert_eq!(result.sections.len(), 1);
    assert_eq!(result.sections[0].title, "Sin título");
}

#[test]
fn tc09_pptx_empty_section_does_not_crash() {
    let s1 = slide(&shape(r#"<p:ph type="title"/>"#, &["Slide 1"]));
    let pres = format!(
        r#"<?xml version="1.0"?><p:presentation {P_NS}>
<p:sldIdLst>
  <p:sldId id="256" r:id="rId1"/>
</p:sldIdLst>
<p:sectionLst>
  <p:section name="Vacía">
    <p:sldIdLst/>
  </p:section>
  <p:section name="Con contenido">
    <p:sldIdLst>
      <p:sldId id="256"/>
    </p:sldIdLst>
  </p:section>
</p:sectionLst>
</p:presentation>"#
    );
    let pres_rels = rels_xml(&[("rId1", "slide", "slides/slide1.xml")]);
    let bytes = zip_of(&[
        ("ppt/presentation.xml", pres.as_bytes()),
        ("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes()),
        ("ppt/slides/slide1.xml", s1.as_bytes()),
    ]);
    // Should not crash; empty section is skipped
    let result = split_pptx(&bytes).unwrap();
    assert!(!result.sections.is_empty());
    assert!(result.sections.iter().all(|s| !s.title.is_empty()));
}

// ─── TC-10..TC-12: split_office ───────────────────────────────────────────────

#[test]
fn tc10_split_office_docx_delegates_to_split_docx() {
    let body = [para(Some("Ttulo1"), &run("Sec A")), para(None, &run("Texto."))].concat();
    let bytes = docx(&body, "", &[]);
    let by_name = split_office("documento.docx", &bytes).unwrap();
    let direct = split_docx(&bytes).unwrap();
    assert_eq!(by_name.sections.len(), direct.sections.len());
    assert_eq!(by_name.sections[0].title, direct.sections[0].title);
}

#[test]
fn tc11_split_office_pptx_delegates_to_split_pptx() {
    use super::testutil::simple_pptx;
    let bytes = simple_pptx(&["Slide 1"]);
    let by_name = split_office("deck.pptx", &bytes).unwrap();
    let direct = split_pptx(&bytes).unwrap();
    assert_eq!(by_name.sections.len(), direct.sections.len());
    assert_eq!(by_name.sections[0].title, direct.sections[0].title);
}

#[test]
fn tc12_split_office_invalid_extension_returns_error() {
    let result = split_office("hoja.xls", b"not-a-zip");
    assert_eq!(result, Err("unsupported_office_format".to_string()));
}
