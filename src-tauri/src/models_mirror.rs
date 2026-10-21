//! Fallback mirror for the downloaded models. Hugging Face stays the primary
//! source; when it fails, the same files are fetched from a public GitHub
//! release of this repository and verified against hard-coded SHA-256 hashes
//! (HF downloads are verified against the same hashes: the files are identical).

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

/// Release that hosts the mirrored Whisper assets (unchanged since models-v1).
pub const MIRROR_BASE_URL: &str = "https://github.com/cdiezgil/markdaun/releases/download/models-v1";

/// `(asset name, sha256)` of every Whisper file in models-v1.
/// The `small` Whisper model is deliberately absent: it is Hugging Face only.
/// The old MiniLM-L6-v2 entries have been removed; they are superseded by
/// `EMBED_MIRROR_ASSETS` / `EMBED_MIRROR_BASE_URL` pointing at models-v2.
pub const MIRROR_ASSETS: [(&str, &str); 1] = [
    ("ggml-large-v3-turbo-q5_0.bin", "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"),
];

/// Release that hosts the new paraphrase-multilingual-MiniLM-L12-v2 ONNX export.
/// Publish a `models-v2` release (see AGENTS.md §2.6) and update
/// `EMBED_MIRROR_ASSETS` with the sha256 of the uploaded assets.
pub const EMBED_MIRROR_BASE_URL: &str =
    "https://github.com/cdiezgil/markdaun/releases/download/models-v2";

/// `(asset name, sha256)` for the 5 paraphrase-multilingual-MiniLM-L12-v2 files.
/// TODO: replace the placeholder hashes with real sha256 values computed from
/// the files downloaded from Qdrant/paraphrase-multilingual-MiniLM-L12-v2 on
/// Hugging Face **after** publishing the models-v2 GitHub release.
/// Command to compute: `shasum -a 256 <file>` for each of the 5 files.
pub const EMBED_MIRROR_ASSETS: [(&str, &str); 5] = [
    ("paraphrase-multilingual-MiniLM-L12-v2-onnx.model.onnx",             "185ae63f47e17a7e8d30d0e6a3cde6a6e4b79bc5b81666ecffc279a6856ca113"),
    ("paraphrase-multilingual-MiniLM-L12-v2-onnx.tokenizer.json",         "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441"),
    ("paraphrase-multilingual-MiniLM-L12-v2-onnx.config.json",            "05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7"),
    ("paraphrase-multilingual-MiniLM-L12-v2-onnx.special_tokens_map.json","06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f"),
    ("paraphrase-multilingual-MiniLM-L12-v2-onnx.tokenizer_config.json",  "3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2"),
];

/// A mirror base URL plus the known hash of each of its assets. Injectable so
/// tests can point it at a local server with their own hashes.
#[derive(Debug, Clone, Default)]
pub struct Mirror {
    base_url: String,
    assets: Vec<(String, String)>,
}

impl Mirror {
    pub fn production() -> Self {
        Self::new(MIRROR_BASE_URL, MIRROR_ASSETS.iter().map(|(a, h)| (a.to_string(), h.to_string())).collect())
    }

    /// Mirror for the paraphrase-multilingual-MiniLM-L12-v2 ONNX model assets
    /// hosted in the models-v2 GitHub release.
    pub fn embed_production() -> Self {
        Self::new(
            EMBED_MIRROR_BASE_URL,
            EMBED_MIRROR_ASSETS.iter().map(|(a, h)| (a.to_string(), h.to_string())).collect(),
        )
    }

    /// No mirror and no known hashes (downloads are unverified unless the host
    /// publishes a checksum).
    #[cfg(test)]
    pub fn none() -> Self {
        Self::default()
    }

    pub fn new(base_url: &str, assets: Vec<(String, String)>) -> Self {
        Self { base_url: base_url.trim_end_matches('/').to_string(), assets }
    }

    /// Known sha256 of `asset`, if it is mirrored.
    pub fn sha256_for(&self, asset: &str) -> Option<&str> {
        self.assets.iter().find(|(a, _)| a == asset).map(|(_, h)| h.as_str())
    }

    /// Download URL of `asset`, if it is mirrored.
    pub fn url_for(&self, asset: &str) -> Option<String> {
        self.sha256_for(asset).map(|_| format!("{}/{asset}", self.base_url))
    }
}

/// Lower-case hex SHA-256 of the file at `path`.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
