//! PDF text and image extraction via `lopdf`.
//! Only text-based PDFs are supported; scanned (image-only) PDFs return
//! `Err("empty_pdf")`.  Images with the `/DCTDecode` (JPEG) filter are
//! converted to stable PNG; all other image encodings are silently skipped.

use crate::capture::office::ExtractedImage;
use lopdf::Document;

/// Extract all selectable text from a PDF, concatenating pages with `"\n\n"`.
///
/// Returns `Err("empty_pdf")` when the document is valid but contains no
/// extractable text (e.g. scanned PDFs, image-only content).
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let doc = Document::load_mem(bytes).map_err(|e| e.to_string())?;
    let page_nums: Vec<u32> = doc.get_pages().keys().copied().collect(); // BTreeMap → sorted

    let mut parts: Vec<String> = Vec::new();
    for page_num in page_nums {
        if let Ok(text) = doc.extract_text(&[page_num]) {
            let trimmed = text.trim().to_string();
            if !trimmed.is_empty() {
                parts.push(trimmed);
            }
        }
    }

    if parts.is_empty() {
        Err("empty_pdf".to_string())
    } else {
        Ok(parts.join("\n\n"))
    }
}

/// Extract embedded images from a PDF, converting them to stable PNG.
///
/// Only `/DCTDecode` (JPEG) XObjects are processed; others are skipped.
/// Images smaller than 512 bytes (after re-encoding to PNG) are discarded
/// as artefacts.  Names are `img-1.png`, `img-2.png`, …
pub fn extract_pdf_images(bytes: &[u8]) -> Result<Vec<ExtractedImage>, String> {
    let doc = Document::load_mem(bytes).map_err(|e| e.to_string())?;
    let mut result: Vec<ExtractedImage> = Vec::new();
    let mut idx = 0usize;

    for (_id, obj) in &doc.objects {
        let stream = match obj.as_stream() {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Must be an Image XObject
        let is_image = stream
            .dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .map(|n| n == b"Image")
            .unwrap_or(false);

        if !is_image {
            continue;
        }

        // Only DCTDecode (JPEG) — raw `content` bytes are the JPEG payload
        let is_jpeg = stream
            .dict
            .get(b"Filter")
            .ok()
            .and_then(|o| o.as_name().ok())
            .map(|n| n == b"DCTDecode")
            .unwrap_or(false);

        if !is_jpeg {
            continue;
        }

        let raw = &stream.content;
        if raw.len() < 512 {
            continue;
        }

        // Load JPEG and re-encode as PNG for a stable, lossless format
        let img = match image::load_from_memory(raw) {
            Ok(i) => i,
            Err(_) => continue,
        };

        let mut png_bytes: Vec<u8> = Vec::new();
        if img
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .is_err()
        {
            continue;
        }

        if png_bytes.len() < 512 {
            continue;
        }

        idx += 1;
        result.push(ExtractedImage {
            name: format!("img-{idx}.png"),
            bytes: png_bytes,
            media_type: "image/png".to_string(),
        });
    }

    Ok(result)
}
