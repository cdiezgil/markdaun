//! Multimodal attachments: validation, normalisation and the engine-neutral
//! content parts every engine translates into its own wire format.
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Component, Path};

pub const MAX_ATTACHMENTS: usize = 5;
pub const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_PDF_PAGES: usize = 20;
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_IMAGE_SIDE: u32 = 1568;

/// A user-facing (Spanish) validation message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentError(pub String);

impl std::fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn err<T>(msg: impl Into<String>) -> Result<T, AttachmentError> {
    Err(AttachmentError(msg.into()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Part {
    Text(String),
    Image { media_type: String, data_b64: String },
    Document { media_type: String, data_b64: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Image,
    Pdf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub name: String,
    pub vault_path: String,
    pub kind: AttachmentKind,
    /// Native representation (image block / PDF document block).
    pub parts: Vec<Part>,
    /// For PDFs: extracted text + page images, for engines without native PDF.
    pub fallback: Vec<Part>,
}

impl Attachment {
    pub fn parts_for(&self, native_pdf: bool) -> &[Part] {
        if self.kind == AttachmentKind::Pdf && !native_pdf {
            &self.fallback
        } else {
            &self.parts
        }
    }
}

/// Frontend-prepared derivatives (rasterized SVG, PDF page images, PDF text).
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Derived {
    #[serde(default)]
    pub images: Vec<DerivedImage>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub page_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedImage {
    pub media_type: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub vault_path: String,
    #[serde(default)]
    pub derived: Option<Derived>,
}

/// Expand a message into its ordered parts: per attachment a name marker plus
/// its parts, then the message text.
pub fn expand_parts(attachments: &[Attachment], text: &str, native_pdf: bool) -> Vec<Part> {
    let mut out = Vec::new();
    for a in attachments {
        out.push(Part::Text(format!("[Archivo adjunto: {}]", a.name)));
        out.extend(a.parts_for(native_pdf).iter().cloned());
    }
    out.push(Part::Text(text.to_string()));
    out
}

/// The reference list persisted instead of the bytes.
pub fn stored_references(names: &[String]) -> String {
    names.iter().map(|n| format!("📎 {n}")).collect::<Vec<_>>().join("\n")
}

fn resolve_in_vault(vault: &Path, rel: &str) -> Result<std::path::PathBuf, AttachmentError> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir)) {
        return err(format!("«{rel}» está fuera de la bóveda."));
    }
    let root = vault.canonicalize().map_err(|e| AttachmentError(format!("Bóveda no accesible: {e}")))?;
    let full = root.join(p);
    let canon = full.canonicalize().map_err(|_| AttachmentError(format!("No se encuentra «{rel}» en la bóveda.")))?;
    if !canon.starts_with(&root) {
        return err(format!("«{rel}» está fuera de la bóveda."));
    }
    Ok(canon)
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn media_type(fmt: image::ImageFormat) -> Option<&'static str> {
    match fmt {
        image::ImageFormat::Png => Some("image/png"),
        image::ImageFormat::Jpeg => Some("image/jpeg"),
        image::ImageFormat::Gif => Some("image/gif"),
        image::ImageFormat::WebP => Some("image/webp"),
        _ => None,
    }
}

/// Validates the bytes are a supported image and downscales when the longest
/// side exceeds `MAX_IMAGE_SIDE`. Unchanged bytes are kept as they are.
fn normalise_image(name: &str, bytes: &[u8]) -> Result<Part, AttachmentError> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AttachmentError(format!("«{name}» no es una imagen válida.")))?;
    let fmt = reader.format().ok_or_else(|| AttachmentError(format!("«{name}» no es una imagen válida.")))?;
    let mt = media_type(fmt).ok_or_else(|| AttachmentError(format!("El formato de «{name}» no está soportado.")))?;
    let (w, h) = reader
        .into_dimensions()
        .map_err(|_| AttachmentError(format!("«{name}» no es una imagen válida.")))?;
    if w.max(h) <= MAX_IMAGE_SIDE {
        return Ok(Part::Image { media_type: mt.into(), data_b64: b64(bytes) });
    }
    let img = image::load_from_memory(bytes).map_err(|_| AttachmentError(format!("«{name}» no es una imagen válida.")))?;
    let small = img.resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, image::imageops::FilterType::Triangle);
    let mut out = Cursor::new(Vec::new());
    let (fmt_out, mt_out) = if fmt == image::ImageFormat::Jpeg {
        (image::ImageFormat::Jpeg, "image/jpeg")
    } else {
        (image::ImageFormat::Png, "image/png")
    };
    let small = if fmt_out == image::ImageFormat::Jpeg { image::DynamicImage::ImageRgb8(small.to_rgb8()) } else { small };
    small
        .write_to(&mut out, fmt_out)
        .map_err(|e| AttachmentError(format!("No se pudo reducir «{name}»: {e}")))?;
    Ok(Part::Image { media_type: mt_out.into(), data_b64: b64(&out.into_inner()) })
}

/// An image that is not a vault file (e.g. one extracted from a Word or
/// PowerPoint document): validated and downscaled like any other image.
pub fn image_attachment(name: &str, vault_path: &str, bytes: &[u8]) -> Result<Attachment, AttachmentError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return err(format!("«{name}» supera el límite de 20 MB."));
    }
    Ok(Attachment {
        name: name.to_string(),
        vault_path: vault_path.to_string(),
        kind: AttachmentKind::Image,
        parts: vec![normalise_image(name, bytes)?],
        fallback: vec![],
    })
}

fn derived_image(name: &str, d: &DerivedImage) -> Result<Part, AttachmentError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(d.data_b64.as_bytes())
        .map_err(|_| AttachmentError(format!("La vista previa de «{name}» no es válida.")))?;
    normalise_image(name, &bytes)
}

fn build_one(vault: &Path, input: &AttachmentInput) -> Result<Attachment, AttachmentError> {
    let full = resolve_in_vault(vault, &input.vault_path)?;
    let name = full.file_name().and_then(|n| n.to_str()).unwrap_or(&input.vault_path).to_string();
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let meta = std::fs::metadata(&full).map_err(|_| AttachmentError(format!("No se puede leer «{name}».")))?;
    let mk = |kind, parts, fallback| Attachment { name: name.clone(), vault_path: input.vault_path.clone(), kind, parts, fallback };

    match ext.as_str() {
        "pdf" => {
            if meta.len() as usize > MAX_PDF_BYTES {
                return err(format!("«{name}» supera el límite de 20 MB para PDF."));
            }
            let bytes = std::fs::read(&full).map_err(|_| AttachmentError(format!("No se puede leer «{name}».")))?;
            let native = Part::Document { media_type: "application/pdf".into(), data_b64: b64(&bytes) };
            let Some(d) = &input.derived else {
                return Ok(mk(AttachmentKind::Pdf, vec![native], vec![]));
            };
            let mut fallback = Vec::new();
            if let Some(t) = d.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                fallback.push(Part::Text(format!("Texto extraído del PDF «{name}»:\n{t}")));
            }
            for img in d.images.iter().take(MAX_PDF_PAGES) {
                fallback.push(derived_image(&name, img)?);
            }
            let too_long = d.page_count.unwrap_or(d.images.len()) > MAX_PDF_PAGES;
            let parts = if too_long { fallback.clone() } else { vec![native] };
            Ok(mk(AttachmentKind::Pdf, parts, fallback))
        }
        "png" | "jpg" | "jpeg" | "gif" | "webp" => {
            if meta.len() as usize > MAX_IMAGE_BYTES {
                return err(format!("«{name}» supera el límite de 20 MB."));
            }
            let bytes = std::fs::read(&full).map_err(|_| AttachmentError(format!("No se puede leer «{name}».")))?;
            Ok(mk(AttachmentKind::Image, vec![normalise_image(&name, &bytes)?], vec![]))
        }
        "svg" | "bmp" | "ico" | "avif" | "tif" | "tiff" => {
            let Some(img) = input.derived.as_ref().and_then(|d| d.images.first()) else {
                return err(format!("«{name}» necesita convertirse a PNG antes de enviarse."));
            };
            Ok(mk(AttachmentKind::Image, vec![derived_image(&name, img)?], vec![]))
        }
        _ => err(format!("«{name}» no es una imagen ni un PDF.")),
    }
}

/// Validates and normalises the attachments of one message.
pub fn build_attachments(vault: &Path, inputs: &[AttachmentInput]) -> Result<Vec<Attachment>, AttachmentError> {
    if inputs.len() > MAX_ATTACHMENTS {
        return err(format!("Máximo {MAX_ATTACHMENTS} adjuntos por mensaje."));
    }
    inputs.iter().map(|i| build_one(vault, i)).collect()
}
