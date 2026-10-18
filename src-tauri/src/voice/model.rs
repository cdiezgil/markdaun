//! Whisper model catalogue and its downloader. Models come from the official
//! whisper.cpp repository on Hugging Face; like the embedding model they are
//! fetched with our own client (atomic `.part` + rename, relative redirects
//! followed) and verified against the SHA-256 Hugging Face publishes.

use super::VoiceError;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Path (under the host) of the official whisper.cpp model repository.
const REPO_PATH: &str = "ggerganov/whisper.cpp/resolve/main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub label: &'static str,
    /// Approximate download size, for the UI.
    pub approx_mb: u32,
}

pub const DEFAULT_MODEL: &str = "large-v3-turbo";

pub const MODELS: [ModelSpec; 2] = [
    ModelSpec { id: "large-v3-turbo", file: "ggml-large-v3-turbo-q5_0.bin", label: "Calidad máxima (large-v3-turbo)", approx_mb: 550 },
    ModelSpec { id: "small", file: "ggml-small-q5_1.bin", label: "Ligero (small)", approx_mb: 190 },
];

pub fn spec_for(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn model_path(dir: &Path, spec: &ModelSpec) -> PathBuf {
    dir.join(spec.file)
}

pub fn is_downloaded(dir: &Path, spec: &ModelSpec) -> bool {
    std::fs::metadata(model_path(dir, spec)).map(|m| m.len() > 0).unwrap_or(false)
}

/// The file's sha256 as Hugging Face publishes it: `X-Linked-Etag`. The plain
/// `ETag` of the CDN response is a storage hash, not the file's sha256.
fn published_sha256(resp: &reqwest::blocking::Response) -> Option<String> {
    let v = resp.headers().get("x-linked-etag")?.to_str().ok()?;
    let v = v.trim().trim_matches('"').to_lowercase();
    (v.len() == 64 && v.chars().all(|c| c.is_ascii_hexdigit())).then_some(v)
}

const MAX_HOPS: usize = 10;

/// Downloads `spec` into `dir` unless it is already there. `progress` gets
/// `(bytes so far, total if known)`. The file only appears (renamed from
/// `.part`) once complete and, when a checksum is published, verified.
pub fn download_model(
    base_url: &str,
    dir: &Path,
    spec: &ModelSpec,
    progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<PathBuf, VoiceError> {
    let target = model_path(dir, spec);
    if is_downloaded(dir, spec) {
        return Ok(target);
    }
    std::fs::create_dir_all(dir)?;
    let part = dir.join(format!("{}.part", spec.file));
    let result = fetch(base_url, spec, &part, progress);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, &target)?;
    Ok(target)
}

fn fetch(
    base_url: &str,
    spec: &ModelSpec,
    part: &Path,
    progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<(), VoiceError> {
    let client = reqwest::blocking::Client::builder()
        .use_rustls_tls()
        .connect_timeout(Duration::from_secs(15))
        // Redirects are followed by hand: the checksum header is on the first hop.
        .redirect(reqwest::redirect::Policy::none())
        // Idle/overall guard; the large model takes minutes on slow links.
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| VoiceError::Download(format!("cannot build HTTP client: {e}")))?;
    let mut url = reqwest::Url::parse(&format!("{}/{REPO_PATH}/{}", base_url.trim_end_matches('/'), spec.file))
        .map_err(|e| VoiceError::Download(format!("{}: {e}", spec.file)))?;
    let mut expected: Option<String> = None;
    let mut hops = 0;
    let mut resp = loop {
        let resp = client.get(url.clone()).send().map_err(|e| VoiceError::Download(format!("{}: {e}", spec.file)))?;
        expected = expected.or_else(|| published_sha256(&resp));
        if !resp.status().is_redirection() {
            break resp;
        }
        hops += 1;
        let next = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|l| l.to_str().ok())
            .and_then(|l| url.join(l).ok());
        match next {
            Some(n) if hops <= MAX_HOPS => url = n,
            _ => return Err(VoiceError::Download(format!("{}: too many or invalid redirects", spec.file))),
        }
    };
    if !resp.status().is_success() {
        return Err(VoiceError::Download(format!("{}: HTTP {}", spec.file, resp.status())));
    }
    let total = resp.content_length();
    let mut out = std::fs::File::create(part)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    loop {
        let n = resp.read(&mut buf).map_err(|e| VoiceError::Download(format!("{}: {e}", spec.file)))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        done += n as u64;
        progress(done, total);
    }
    if done == 0 {
        return Err(VoiceError::Download(format!("{}: empty response", spec.file)));
    }
    out.sync_all()?;
    if let Some(expected) = expected {
        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            return Err(VoiceError::Checksum);
        }
    }
    Ok(())
}
