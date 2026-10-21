use super::embeddings::{download_model_files, HF_MODEL_FILE, MODEL_DIR, MODEL_FILES};
use crate::models_mirror::Mirror;
use sha2::{Digest, Sha256};
use super::testutil::{spawn, MockResponse};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Path prefix for all files in the Xenova HF repo.
const REPO_PREFIX: &str = "/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/";

/// Translate an HF request path to the **local** model file name.
/// `onnx/model.onnx` (remote path) → `model.onnx` (local name).
fn local_name(hf_path: &str) -> &str {
    if hf_path == HF_MODEL_FILE { "model.onnx" } else { hf_path }
}

#[test]
fn download_follows_relative_redirects() {
    // The mock server redirects `/blob/<hf_path>` → serves content keyed by local name.
    let server = spawn(|req| {
        if let Some(hf_path) = req.path.strip_prefix(REPO_PREFIX) {
            MockResponse::redirect(302, &format!("/blob/{hf_path}"))
        } else if let Some(hf_path) = req.path.strip_prefix("/blob/") {
            MockResponse::json(200, &format!("content-of-{}", local_name(hf_path)))
        } else {
            MockResponse::json(404, "")
        }
    });
    let tmp = tempfile::tempdir().unwrap();

    let dir = download_model_files(&server.url, &Mirror::none(), tmp.path()).unwrap();

    assert_eq!(dir, tmp.path().join(MODEL_DIR));
    for file in MODEL_FILES {
        let got = std::fs::read_to_string(dir.join(file)).unwrap();
        assert_eq!(got, format!("content-of-{file}"));
    }
}

#[test]
fn download_skips_files_already_present() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let server = spawn(move |_| {
        h.fetch_add(1, Ordering::SeqCst);
        MockResponse::json(200, "fresh")
    });
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(MODEL_DIR);
    std::fs::create_dir_all(&dir).unwrap();
    for file in MODEL_FILES {
        std::fs::write(dir.join(file), "cached").unwrap();
    }

    download_model_files(&server.url, &Mirror::none(), tmp.path()).unwrap();

    assert_eq!(hits.load(Ordering::SeqCst), 0, "nothing should be requested");
    assert_eq!(std::fs::read_to_string(dir.join("model.onnx")).unwrap(), "cached");
}

#[test]
fn download_refetches_only_missing_or_empty_files() {
    let server = spawn(|_| MockResponse::json(200, "fresh"));
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(MODEL_DIR);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("model.onnx"), "cached").unwrap();
    std::fs::write(dir.join("tokenizer.json"), "").unwrap();

    download_model_files(&server.url, &Mirror::none(), tmp.path()).unwrap();

    let paths: Vec<String> = server.requests().into_iter().map(|r| r.path).collect();
    // model.onnx is cached → neither "model.onnx" nor "onnx/model.onnx" should appear.
    assert_eq!(paths.len(), MODEL_FILES.len() - 1, "model.onnx is skipped: {paths:?}");
    assert!(!paths.iter().any(|p| p.contains("model.onnx")));
    assert_eq!(std::fs::read_to_string(dir.join("tokenizer.json")).unwrap(), "fresh");
    assert_eq!(std::fs::read_to_string(dir.join("model.onnx")).unwrap(), "cached");
}

#[test]
fn download_failure_leaves_no_partial_file() {
    let server = spawn(|req| {
        if req.path.ends_with("tokenizer.json") {
            MockResponse::json(404, "nope")
        } else {
            MockResponse::json(200, "ok")
        }
    });
    let tmp = tempfile::tempdir().unwrap();

    let err = download_model_files(&server.url, &Mirror::none(), tmp.path()).unwrap_err();

    assert!(err.to_string().contains("tokenizer.json"), "got {err}");
    let dir = tmp.path().join(MODEL_DIR);
    assert!(!dir.join("tokenizer.json").exists());
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty(), "tmp files left: {leftovers:?}");
}

#[test]
fn lazy_initialises_once_and_shares_the_value() {
    let lazy: super::embeddings::Lazy<u32> = Default::default();
    let mut calls = 0;
    let a = lazy.get_or_try_init(|| { calls += 1; Ok::<_, ()>(7) }).unwrap();
    let b = lazy.get_or_try_init(|| { calls += 1; Ok::<_, ()>(8) }).unwrap();
    assert_eq!((*a, *b, calls), (7, 7, 1));
}

#[test]
fn lazy_does_not_cache_failures() {
    let lazy: super::embeddings::Lazy<u32> = Default::default();
    assert!(lazy.get_or_try_init(|| Err::<u32, _>("boom")).is_err());
    assert_eq!(*lazy.get_or_try_init(|| Ok::<_, &str>(5)).unwrap(), 5);
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn content(file: &str) -> String {
    format!("content-of-{file}")
}

fn asset(file: &str) -> String {
    format!("{MODEL_DIR}.{file}")
}

/// Mirror pointing at `url` that knows the hash of `content(file)` for every model file.
fn mirror_for(url: &str) -> Mirror {
    Mirror::new(url, MODEL_FILES.iter().map(|f| (asset(f), sha(content(f).as_bytes()))).collect())
}

/// Returns the **local** file name for an HF request path, or None if unrecognised.
fn hf_file(path: &str) -> Option<&str> {
    path.strip_prefix(REPO_PREFIX).map(local_name)
}

fn no_part_files(dir: &std::path::Path) {
    let leftovers: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty(), "tmp files left: {leftovers:?}");
}

#[test]
fn falls_back_to_the_mirror_when_hugging_face_fails() {
    let hf = spawn(|_| MockResponse::json(503, "down"));
    let mirror = spawn(|req| match req.path.strip_prefix('/') {
        Some(name) => MockResponse::json(200, &content(name.strip_prefix(&format!("{MODEL_DIR}.")).unwrap())),
        None => MockResponse::json(404, ""),
    });
    let tmp = tempfile::tempdir().unwrap();

    let dir = download_model_files(&hf.url, &mirror_for(&mirror.url), tmp.path()).unwrap();

    for file in MODEL_FILES {
        assert_eq!(std::fs::read_to_string(dir.join(file)).unwrap(), content(file));
    }
    assert_eq!(mirror.requests().len(), MODEL_FILES.len());
    no_part_files(&dir);
}

#[test]
fn falls_back_when_hugging_face_is_unreachable_or_empty() {
    let mirror = spawn(|req| {
        let file = req.path.trim_start_matches('/').strip_prefix(&format!("{MODEL_DIR}.")).unwrap().to_string();
        MockResponse::json(200, &content(&file))
    });
    for hf_url in [crate::llm::testutil::closed_port_url(), spawn(|_| MockResponse::json(200, "")).url] {
        let tmp = tempfile::tempdir().unwrap();
        download_model_files(&hf_url, &mirror_for(&mirror.url), tmp.path()).unwrap();
        assert!(tmp.path().join(MODEL_DIR).join("model.onnx").exists());
    }
}

#[test]
fn the_mirror_is_untouched_when_hugging_face_works() {
    // hf_file() already normalises onnx/model.onnx → model.onnx.
    let hf = spawn(|req| MockResponse::json(200, &content(hf_file(&req.path).unwrap())));
    let mirror = spawn(|_| MockResponse::json(200, "from-mirror"));
    let tmp = tempfile::tempdir().unwrap();

    let dir = download_model_files(&hf.url, &mirror_for(&mirror.url), tmp.path()).unwrap();

    assert!(mirror.requests().is_empty());
    assert_eq!(std::fs::read_to_string(dir.join("model.onnx")).unwrap(), content("model.onnx"));
}

#[test]
fn hugging_face_downloads_are_verified_against_the_known_hash_and_fall_back() {
    // HF serves corrupted bytes; the mirror serves the right ones.
    let hf = spawn(|_| MockResponse::json(200, "corrupted"));
    let mirror = spawn(|req| {
        let file = req.path.trim_start_matches('/').strip_prefix(&format!("{MODEL_DIR}.")).unwrap().to_string();
        MockResponse::json(200, &content(&file))
    });
    let tmp = tempfile::tempdir().unwrap();

    let dir = download_model_files(&hf.url, &mirror_for(&mirror.url), tmp.path()).unwrap();

    assert_eq!(std::fs::read_to_string(dir.join("config.json")).unwrap(), content("config.json"));
    assert_eq!(mirror.requests().len(), MODEL_FILES.len());
}

#[test]
fn a_mirror_hash_mismatch_errors_and_leaves_no_file() {
    let hf = spawn(|_| MockResponse::json(500, ""));
    let mirror = spawn(|_| MockResponse::json(200, "tampered"));
    let tmp = tempfile::tempdir().unwrap();

    let err = download_model_files(&hf.url, &mirror_for(&mirror.url), tmp.path()).unwrap_err();

    assert!(err.to_string().to_lowercase().contains("checksum"), "got {err}");
    let dir = tmp.path().join(MODEL_DIR);
    assert!(!dir.join("model.onnx").exists());
    no_part_files(&dir);
}

#[test]
fn when_both_sources_fail_the_error_names_both() {
    let hf = spawn(|_| MockResponse::json(503, "down"));
    let mirror = spawn(|_| MockResponse::json(404, ""));
    let tmp = tempfile::tempdir().unwrap();

    let err = download_model_files(&hf.url, &mirror_for(&mirror.url), tmp.path()).unwrap_err().to_string();

    assert!(err.contains("Hugging Face") && err.contains("mirror"), "got {err}");
    assert!(err.contains("model.onnx"), "got {err}");
}

#[test]
#[ignore = "downloads from the real GitHub release mirror (models-v2); requires real sha256 in EMBED_MIRROR_ASSETS"]
fn the_real_mirror_serves_the_expected_bytes() {
    use crate::models_mirror::{sha256_file, EMBED_MIRROR_ASSETS};
    let mirror = crate::models_mirror::Mirror::embed_production();
    let name = "paraphrase-multilingual-MiniLM-L12-v2-onnx.tokenizer_config.json";
    let url = mirror.url_for(name).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("tokenizer_config.json");
    let mut resp = reqwest::blocking::get(url).unwrap();
    assert!(resp.status().is_success(), "{}", resp.status());
    let mut out = std::fs::File::create(&path).unwrap();
    resp.copy_to(&mut out).unwrap();
    let expected = EMBED_MIRROR_ASSETS.iter().find(|(a, _)| *a == name).unwrap().1;
    assert_eq!(sha256_file(&path).unwrap(), expected);
}
