//! Fallback mirror for the downloaded models. Hugging Face stays the primary
//! source; when it fails, the same files are fetched from a public GitHub
//! release of this repository and verified against hard-coded SHA-256 hashes
//! (HF downloads are verified against the same hashes: the files are identical).

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

/// Release that hosts the mirrored assets. Publish a new `models-vN` release
/// (see AGENTS.md) and bump this URL when the files change.
pub const MIRROR_BASE_URL: &str = "https://github.com/cdiezgil/markdaun/releases/download/models-v1";

/// `(asset name, sha256)` of every mirrored file. The `small` Whisper model is
/// deliberately absent: it is Hugging Face only.
pub const MIRROR_ASSETS: [(&str, &str); 6] = [
    ("ggml-large-v3-turbo-q5_0.bin", "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"),
    ("all-MiniLM-L6-v2-onnx.model.onnx", "bbd7b466f6d58e646fdc2bd5fd67b2f5e93c0b687011bd4548c420f7bd46f0c5"),
    ("all-MiniLM-L6-v2-onnx.tokenizer.json", "851ca67100d372ca3ae031a6abd168f53489eebfd7d89523f35c5c9b4d372c3c"),
    ("all-MiniLM-L6-v2-onnx.config.json", "1b4d8e2a3988377ed8b519a31d8d31025a25f1c5f8606998e8014111438efcd7"),
    ("all-MiniLM-L6-v2-onnx.special_tokens_map.json", "5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a"),
    ("all-MiniLM-L6-v2-onnx.tokenizer_config.json", "abda01c8c14c5151ae498aceb30db406d6b91242c394fd88d3b6fd5a63a101e6"),
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
