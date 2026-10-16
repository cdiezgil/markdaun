use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EmbeddingError {
    #[error("fastembed: {0}")]
    FastEmbed(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Load the `AllMiniLML6V2` embedding model, caching ONNX artifacts in `cache_dir`.
/// First call requires internet access (~22 MB download).
pub fn load_model(cache_dir: &Path) -> Result<fastembed::TextEmbedding, EmbeddingError> {
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    std::fs::create_dir_all(cache_dir)?;
    TextEmbedding::try_new(InitOptions {
        model_name: EmbeddingModel::AllMiniLML6V2,
        cache_dir: cache_dir.to_path_buf(),
        show_download_progress: false,
        ..Default::default()
    })
    .map_err(|e| EmbeddingError::FastEmbed(e.to_string()))
}

/// Embed a single text string. Returns a `Vec<f32>` of dimension 384.
pub fn embed_text(
    model: &fastembed::TextEmbedding,
    text: &str,
) -> Result<Vec<f32>, EmbeddingError> {
    let mut embeddings = model
        .embed(vec![text], None)
        .map_err(|e| EmbeddingError::FastEmbed(e.to_string()))?;
    Ok(embeddings.remove(0))
}

/// Split `content` into overlapping chunks.
///
/// Strategy:
/// 1. Split on `\n\n` (paragraph boundaries).
/// 2. If a paragraph exceeds `chunk_size` chars, subdivide it by `chunk_size` slices.
/// 3. Build consecutive chunks with `overlap` chars carried over from the previous chunk.
///
/// Default values used by callers: `chunk_size = 1500`, `overlap = 200`.
pub fn chunk_text(content: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if content.is_empty() {
        return vec![];
    }

    // Step 1: split on double newlines into paragraphs.
    let raw_paragraphs: Vec<&str> = content.split("\n\n").collect();

    // Step 2: flatten paragraphs that exceed chunk_size.
    let mut segments: Vec<String> = Vec::new();
    for para in &raw_paragraphs {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if para.len() <= chunk_size {
            segments.push(para.to_string());
        } else {
            // Subdivide by chars.
            let chars: Vec<char> = para.chars().collect();
            let mut start = 0;
            while start < chars.len() {
                let end = (start + chunk_size).min(chars.len());
                segments.push(chars[start..end].iter().collect());
                start = end;
            }
        }
    }

    if segments.is_empty() {
        return vec![];
    }

    // Step 3: combine segments into chunks with overlap.
    let mut chunks: Vec<String> = Vec::new();
    let mut current = segments[0].clone();

    for seg in segments.iter().skip(1) {
        if current.len() + 1 + seg.len() <= chunk_size {
            // Still fits — append with a newline separator.
            current.push('\n');
            current.push_str(seg);
        } else {
            // Emit current chunk, then start new chunk carrying over overlap.
            chunks.push(current.clone());
            // Take the last `overlap` chars of current as the beginning of next chunk.
            let overlap_text: String = if current.len() > overlap {
                current
                    .chars()
                    .rev()
                    .take(overlap)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect()
            } else {
                current.clone()
            };
            current = format!("{overlap_text}\n{seg}");
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn chunk_text_empty_returns_empty() {
        assert!(chunk_text("", 1500, 200).is_empty());
    }

    #[test]
    fn chunk_text_single_short_para_returns_one_chunk() {
        let text = "Hello world.";
        let chunks = chunk_text(text, 1500, 200);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("Hello world"));
    }

    #[test]
    fn chunk_text_each_chunk_within_size() {
        let para = "a".repeat(400);
        let content = format!("{para}\n\n{para}\n\n{para}\n\n{para}\n\n{para}");
        let chunks = chunk_text(&content, 1500, 200);
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= 1700,
                "chunk too long: {}",
                chunk.len()
            );
        }
    }

    #[test]
    fn chunk_text_long_paragraph_subdivided() {
        let long_para = "x".repeat(4000);
        let chunks = chunk_text(&long_para, 1500, 200);
        assert!(chunks.len() >= 2, "Should have split the long paragraph");
    }
}
