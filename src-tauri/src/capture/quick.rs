//! Quick capture save rules: what lands in `Entrada/` for text, a lone URL,
//! an image, or an image with text.

use super::clip::{clip_url, ClipOptions, ClipResult};
use crate::commands::inbox::inbox_ensure_inner;
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Largest pasted image accepted.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

#[derive(Debug, Clone)]
pub struct QuickInput {
    pub text: String,
    /// Raw bytes of the pasted image (any format the app decodes).
    pub image: Option<Vec<u8>>,
}

#[derive(Debug)]
pub enum QuickOutcome {
    Note { path: PathBuf },
    Image { image: PathBuf, note: Option<PathBuf> },
    Clip(ClipResult),
}

/// The URL when `text` is exactly one http(s) URL (surrounding whitespace aside).
pub fn parse_single_url(text: &str) -> Option<reqwest::Url> {
    let t = text.trim();
    if t.is_empty() || t.chars().any(char::is_whitespace) {
        return None;
    }
    let url = reqwest::Url::parse(t).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(url)
}

/// Decodes the pasted image and returns PNG bytes (a PNG is kept untouched).
fn to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("image_too_large".to_string());
    }
    let img = image::load_from_memory(bytes).map_err(|_| "invalid_image".to_string())?;
    if bytes.starts_with(&PNG_SIGNATURE) {
        return Ok(bytes.to_vec());
    }
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|_| "invalid_image".to_string())?;
    Ok(out.into_inner())
}

/// `Captura <date> <time>[ n]` such that every extension in `exts` is free.
fn free_stem(dir: &Path, base: &str, exts: &[&str]) -> String {
    let mut n = 1;
    loop {
        let stem = if n == 1 { base.to_string() } else { format!("{base} {n}") };
        if exts.iter().all(|e| !dir.join(format!("{stem}.{e}")).exists()) {
            return stem;
        }
        n += 1;
    }
}

fn encode_name(s: &str) -> String {
    s.replace('%', "%25").replace(' ', "%20").replace('(', "%28").replace(')', "%29")
}

pub async fn save_quick_capture(
    vault: &Path,
    input: &QuickInput,
    now: chrono::NaiveDateTime,
    opts: &ClipOptions,
) -> Result<QuickOutcome, String> {
    let text = input.text.trim();
    if text.is_empty() && input.image.is_none() {
        return Err("empty_capture".to_string());
    }
    // Validate before touching the disk so a bad image leaves nothing behind.
    let png = input.image.as_deref().map(to_png).transpose()?;

    if png.is_none() {
        if let Some(url) = parse_single_url(text) {
            return clip_url(vault, url.as_str(), now, opts).await.map(QuickOutcome::Clip);
        }
    }

    let dir = inbox_ensure_inner(vault)?;
    let base = format!("Captura {}", now.format("%Y-%m-%d %H-%M"));
    let io = |e: std::io::Error| format!("io_error: {e}");
    match png {
        None => {
            let path = dir.join(format!("{}.md", free_stem(&dir, &base, &["md"])));
            std::fs::write(&path, format!("{text}\n")).map_err(io)?;
            Ok(QuickOutcome::Note { path })
        }
        Some(bytes) => {
            let exts: &[&str] = if text.is_empty() { &["png"] } else { &["png", "md"] };
            let stem = free_stem(&dir, &base, exts);
            let image = dir.join(format!("{stem}.png"));
            std::fs::write(&image, bytes).map_err(io)?;
            let note = if text.is_empty() {
                None
            } else {
                let path = dir.join(format!("{stem}.md"));
                std::fs::write(&path, format!("![]({}.png)\n\n{text}\n", encode_name(&stem))).map_err(io)?;
                Some(path)
            };
            Ok(QuickOutcome::Image { image, note })
        }
    }
}
