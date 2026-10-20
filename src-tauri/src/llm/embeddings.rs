use crate::models_mirror::{sha256_file, Mirror};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EmbeddingError {
    #[error("fastembed: {0}")]
    FastEmbed(String),
    #[error("download: {0}")]
    Download(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Hugging Face host used in production; tests inject a local server instead.
pub const HF_BASE_URL: &str = "https://huggingface.co";
/// Repo path (under the base URL) holding the ONNX export of all-MiniLM-L6-v2.
const HF_REPO_PATH: &str = "Qdrant/all-MiniLM-L6-v2-onnx/resolve/main";
/// Sub-directory of the cache dir that holds the model files.
pub const MODEL_DIR: &str = "all-MiniLM-L6-v2-onnx";
/// Files fastembed needs to build the model from user-defined bytes.
pub const MODEL_FILES: [&str; 5] = [
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// Download any missing model file into `<cache_dir>/MODEL_DIR`.
///
/// Each file is tried on Hugging Face (`base_url`) first and, on any failure,
/// on the GitHub release `mirror`. Whenever the mirror knows a file's SHA-256
/// the download is verified against it, whichever source served it.
///
/// hf-hub (used by fastembed) cannot follow the relative redirects Hugging Face
/// returns, so we fetch with reqwest, which does. Each file is written to a
/// `.part` file and renamed, so a crash never leaves a truncated file behind.
/// Files that already exist and are non-empty are skipped.
pub fn download_model_files(base_url: &str, mirror: &Mirror, cache_dir: &Path) -> Result<PathBuf, EmbeddingError> {
    let dir = cache_dir.join(MODEL_DIR);
    std::fs::create_dir_all(&dir)?;
    let client = reqwest::blocking::Client::builder()
        .use_rustls_tls()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| EmbeddingError::Download(format!("cannot build HTTP client: {e}")))?;
    for file in MODEL_FILES {
        let target = dir.join(file);
        if std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
            continue;
        }
        let part = dir.join(format!("{file}.part"));
        let asset = format!("{MODEL_DIR}.{file}");
        let expected = mirror.sha256_for(&asset);
        let hf_url = format!("{}/{HF_REPO_PATH}/{file}", base_url.trim_end_matches('/'));
        let result = fetch_verified(&client, &hf_url, &part, file, expected).or_else(|hf_err| {
            let Some(mirror_url) = mirror.url_for(&asset) else { return Err(hf_err) };
            fetch_verified(&client, &mirror_url, &part, file, expected).map_err(|mirror_err| {
                EmbeddingError::Download(format!(
                    "{file}: Hugging Face failed ({hf_err}); mirror failed ({mirror_err})"
                ))
            })
        });
        if let Err(e) = result {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        std::fs::rename(&part, &target)?;
    }
    Ok(dir)
}

/// Fetch `url` into `part` and, when `expected` is known, check its SHA-256.
/// On any error the `.part` file is removed.
fn fetch_verified(
    client: &reqwest::blocking::Client,
    url: &str,
    part: &Path,
    file: &str,
    expected: Option<&str>,
) -> Result<(), EmbeddingError> {
    let result = fetch_to(client, url, part, file).and_then(|()| match expected {
        Some(want) if sha256_file(part)? != want => {
            Err(EmbeddingError::Download(format!("{file}: checksum mismatch")))
        }
        _ => Ok(()),
    });
    if result.is_err() {
        let _ = std::fs::remove_file(part);
    }
    result
}

fn fetch_to(
    client: &reqwest::blocking::Client,
    url: &str,
    part: &Path,
    file: &str,
) -> Result<(), EmbeddingError> {
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| EmbeddingError::Download(format!("{file}: {e}")))?;
    if !resp.status().is_success() {
        return Err(EmbeddingError::Download(format!("{file}: HTTP {}", resp.status())));
    }
    let mut out = std::fs::File::create(part)?;
    let written = resp
        .copy_to(&mut out)
        .map_err(|e| EmbeddingError::Download(format!("{file}: {e}")))?;
    if written == 0 {
        return Err(EmbeddingError::Download(format!("{file}: empty response")));
    }
    out.sync_all()?;
    Ok(())
}

/// Load the `AllMiniLML6V2` embedding model, caching ONNX artifacts in `cache_dir`.
/// First call requires internet access (~90 MB download).
pub fn load_model(cache_dir: &Path) -> Result<fastembed::TextEmbedding, EmbeddingError> {
    load_model_from(HF_BASE_URL, &Mirror::production(), cache_dir)
}

/// Like [`load_model`] with an injectable download host.
pub fn load_model_from(base_url: &str, mirror: &Mirror, cache_dir: &Path) -> Result<fastembed::TextEmbedding, EmbeddingError> {
    use fastembed::{InitOptionsUserDefined, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel};
    let dir = download_model_files(base_url, mirror, cache_dir)?;
    let read = |name: &str| std::fs::read(dir.join(name));
    let model = UserDefinedEmbeddingModel {
        onnx_file: read("model.onnx")?,
        tokenizer_files: TokenizerFiles {
            tokenizer_file: read("tokenizer.json")?,
            config_file: read("config.json")?,
            special_tokens_map_file: read("special_tokens_map.json")?,
            tokenizer_config_file: read("tokenizer_config.json")?,
        },
    };
    TextEmbedding::try_new_from_user_defined(model, InitOptionsUserDefined::default())
        .map_err(|e| EmbeddingError::FastEmbed(e.to_string()))
}

/// Holds a value that is expensive to build, creating it on first use and
/// sharing it afterwards. A failed initialisation is not cached, so the next
/// call retries.
pub struct Lazy<T>(Mutex<Option<Arc<T>>>);

impl<T> Default for Lazy<T> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T> Lazy<T> {
    pub fn get_or_try_init<E>(&self, init: impl FnOnce() -> Result<T, E>) -> Result<Arc<T>, E> {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(v) = guard.as_ref() {
            return Ok(v.clone());
        }
        let v = Arc::new(init()?);
        *guard = Some(v.clone());
        Ok(v)
    }
}

/// Tauri managed state: the embedding model, loaded once per process.
pub type EmbedderState = Lazy<fastembed::TextEmbedding>;

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
