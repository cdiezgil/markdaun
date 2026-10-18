use super::model::{
    download_model, is_downloaded, model_path, spec_for, ModelSpec, DEFAULT_MODEL, MODELS,
};
use super::VoiceError;
use crate::llm::testutil::{spawn, MockResponse};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

const TINY: ModelSpec = ModelSpec { id: "tiny", file: "ggml-tiny.bin", label: "Tiny", approx_mb: 1 };

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn body() -> Vec<u8> {
    (0..200_000u32).map(|i| (i % 251) as u8).collect()
}

#[test]
fn the_catalogue_has_the_default_and_the_light_model() {
    assert_eq!(DEFAULT_MODEL, "large-v3-turbo");
    let large = spec_for("large-v3-turbo").unwrap();
    assert_eq!(large.file, "ggml-large-v3-turbo-q5_0.bin");
    let small = spec_for("small").unwrap();
    assert!(small.file.starts_with("ggml-small") && small.file.ends_with(".bin"));
    assert!(spec_for("nope").is_none());
    assert_eq!(MODELS.len(), 2);
}

#[test]
fn downloads_atomically_reports_progress_and_verifies_the_published_checksum() {
    let data = body();
    let served = data.clone();
    let digest = sha(&data);
    let server = spawn(move |_| {
        MockResponse::bytes(200, "application/octet-stream", served.clone()).with_header("X-Linked-Etag", &format!("\"{digest}\""))
    });
    let dir = tempdir().unwrap();
    let mut seen: Vec<(u64, Option<u64>)> = Vec::new();
    let path = download_model(&server.url, dir.path(), &TINY, &mut |done, total| seen.push((done, total))).unwrap();

    assert_eq!(path, model_path(dir.path(), &TINY));
    assert_eq!(std::fs::read(&path).unwrap(), data);
    assert!(!dir.path().join("ggml-tiny.bin.part").exists());
    assert_eq!(server.requests()[0].path, "/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin");
    assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0), "progress never goes back");
    assert_eq!(seen.last().unwrap().0, data.len() as u64);
    assert_eq!(seen.last().unwrap().1, Some(data.len() as u64));
    assert!(is_downloaded(dir.path(), &TINY));
}

#[test]
fn a_checksum_mismatch_leaves_nothing_behind() {
    let server = spawn(|_| {
        MockResponse::bytes(200, "application/octet-stream", body()).with_header("X-Linked-Etag", &format!("\"{}\"", "0".repeat(64)))
    });
    let dir = tempdir().unwrap();
    let err = download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap_err();
    assert!(matches!(err, VoiceError::Checksum), "{err}");
    assert!(!model_path(dir.path(), &TINY).exists());
    assert!(!dir.path().join("ggml-tiny.bin.part").exists());
}

#[test]
fn a_missing_or_non_sha256_etag_is_not_verified() {
    let server = spawn(|_| MockResponse::bytes(200, "application/octet-stream", body()).with_header("X-Linked-Etag", "\"abc123\""));
    let dir = tempdir().unwrap();
    download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap();
    assert!(is_downloaded(dir.path(), &TINY));
}

#[test]
fn follows_relative_redirects() {
    let data = body();
    let served = data.clone();
    let server = spawn(move |req| {
        if req.path.starts_with("/ggerganov") {
            MockResponse::redirect(302, "/cdn/blob/abc")
        } else {
            MockResponse::bytes(200, "application/octet-stream", served.clone())
        }
    });
    let dir = tempdir().unwrap();
    let path = download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap();
    assert_eq!(std::fs::read(path).unwrap(), data);
}

#[test]
fn http_errors_and_empty_bodies_fail_cleanly() {
    for (status, body) in [(404, Vec::new()), (200, Vec::new())] {
        let server = spawn(move |_| MockResponse::bytes(status, "application/octet-stream", body.clone()));
        let dir = tempdir().unwrap();
        let err = download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap_err();
        assert!(matches!(err, VoiceError::Download(_)), "{status}: {err}");
        assert!(!model_path(dir.path(), &TINY).exists());
        assert!(!dir.path().join("ggml-tiny.bin.part").exists());
    }
}

#[test]
fn an_existing_model_is_not_downloaded_again() {
    let server = spawn(|_| MockResponse::bytes(500, "text/plain", Vec::new()));
    let dir = tempdir().unwrap();
    std::fs::write(model_path(dir.path(), &TINY), b"already here").unwrap();
    download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap();
    assert!(server.requests().is_empty());
}

#[test]
fn the_checksum_published_on_the_redirect_hop_is_the_one_verified() {
    // Hugging Face: `X-Linked-Etag` (the file's sha256) comes on the 302; the
    // CDN's own `ETag` is an unrelated storage hash and must be ignored.
    let data = body();
    let served = data.clone();
    let digest = sha(&data);
    let server = spawn(move |req| {
        if req.path.starts_with("/ggerganov") {
            MockResponse::redirect(302, "/cdn/blob/abc").with_header("X-Linked-Etag", &format!("\"{digest}\""))
        } else {
            MockResponse::bytes(200, "application/octet-stream", served.clone()).with_header("ETag", &format!("\"{}\"", "a".repeat(64)))
        }
    });
    let dir = tempdir().unwrap();
    download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}).unwrap();
    assert!(is_downloaded(dir.path(), &TINY));

    let wrong = spawn(move |req| {
        if req.path.starts_with("/ggerganov") {
            MockResponse::redirect(302, "/cdn/blob/abc").with_header("X-Linked-Etag", &format!("\"{}\"", "0".repeat(64)))
        } else {
            MockResponse::bytes(200, "application/octet-stream", body())
        }
    });
    let dir2 = tempdir().unwrap();
    assert!(matches!(download_model(&wrong.url, dir2.path(), &TINY, &mut |_, _| {}), Err(VoiceError::Checksum)));
    assert!(!model_path(dir2.path(), &TINY).exists());
}

#[test]
fn a_redirect_loop_gives_up() {
    let server = spawn(|_| MockResponse::redirect(302, "/again"));
    let dir = tempdir().unwrap();
    assert!(matches!(download_model(&server.url, dir.path(), &TINY, &mut |_, _| {}), Err(VoiceError::Download(_))));
}
