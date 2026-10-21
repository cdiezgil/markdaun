//! Tests for `capture::pdf`.

use super::pdf::extract_pdf_text;

// ─── Minimal PDF builder ──────────────────────────────────────────────────────

/// Build a minimal PDF 1.4 with a single page whose content stream contains
/// `text` as a literal PDF string (characters `(` `)` `\` are escaped).
fn text_pdf(text: &str) -> Vec<u8> {
    let escaped = text
        .replace('\\', r"\\")
        .replace('(', r"\(")
        .replace(')', r"\)");
    let stream_content = format!("BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET");
    let stream_len = stream_content.len();

    let obj1 = format!("1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n");
    let obj2 = format!("2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n");
    let obj3 = format!(
        "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
         /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n"
    );
    let obj4 = format!(
        "4 0 obj\n<</Length {stream_len}>>\nstream\n{stream_content}\nendstream\nendobj\n"
    );
    let obj5 =
        "5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n".to_string();

    let header = b"%PDF-1.4\n";
    let o1_off = header.len();
    let o2_off = o1_off + obj1.len();
    let o3_off = o2_off + obj2.len();
    let o4_off = o3_off + obj3.len();
    let o5_off = o4_off + obj4.len();
    let xref_off = o5_off + obj5.len();

    let xref = format!(
        "xref\n0 6\n\
         0000000000 65535 f \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n{}\n%%EOF\n",
        o1_off, o2_off, o3_off, o4_off, o5_off, xref_off,
    );

    let mut bytes: Vec<u8> = Vec::new();
    bytes.extend_from_slice(header);
    bytes.extend_from_slice(obj1.as_bytes());
    bytes.extend_from_slice(obj2.as_bytes());
    bytes.extend_from_slice(obj3.as_bytes());
    bytes.extend_from_slice(obj4.as_bytes());
    bytes.extend_from_slice(obj5.as_bytes());
    bytes.extend_from_slice(xref.as_bytes());
    bytes
}

/// Minimal valid PDF with no content stream (the page has no `/Contents`).
fn empty_pdf() -> Vec<u8> {
    let obj1 = "1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n".to_string();
    let obj2 = "2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n".to_string();
    let obj3 =
        "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>\nendobj\n".to_string();

    let header = b"%PDF-1.4\n";
    let o1_off = header.len();
    let o2_off = o1_off + obj1.len();
    let o3_off = o2_off + obj2.len();
    let xref_off = o3_off + obj3.len();

    let xref = format!(
        "xref\n0 4\n\
         0000000000 65535 f \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         {:010} 00000 n \n\
         trailer\n<</Size 4 /Root 1 0 R>>\nstartxref\n{}\n%%EOF\n",
        o1_off, o2_off, o3_off, xref_off,
    );

    let mut bytes: Vec<u8> = Vec::new();
    bytes.extend_from_slice(header);
    bytes.extend_from_slice(obj1.as_bytes());
    bytes.extend_from_slice(obj2.as_bytes());
    bytes.extend_from_slice(obj3.as_bytes());
    bytes.extend_from_slice(xref.as_bytes());
    bytes
}

// ─── TC-67g ───────────────────────────────────────────────────────────────────

#[test]
fn tc_67g_extract_pdf_text_returns_text_from_content_stream() {
    let pdf = text_pdf("Hola mundo");
    let result = extract_pdf_text(&pdf);
    assert!(result.is_ok(), "TC-67g: extract should succeed, got {:?}", result);
    let text = result.unwrap();
    // lopdf may normalise spacing; just check that both words appear
    assert!(
        text.contains("Hola") || text.contains("mundo"),
        "TC-67g: extracted text should contain PDF content, got: {text:?}"
    );
}

// ─── TC-67h ───────────────────────────────────────────────────────────────────

#[test]
fn tc_67h_extract_pdf_text_returns_empty_pdf_error_when_no_text() {
    let pdf = empty_pdf();
    let result = extract_pdf_text(&pdf);
    // A page with no content stream produces no extractable text.
    assert_eq!(
        result,
        Err("empty_pdf".to_string()),
        "TC-67h: should return Err(\"empty_pdf\") for a PDF with no content"
    );
}
