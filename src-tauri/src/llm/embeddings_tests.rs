use super::embeddings::{download_model_files, MODEL_DIR, MODEL_FILES};
use super::testutil::{spawn, MockResponse};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const REPO_PREFIX: &str = "/Qdrant/all-MiniLM-L6-v2-onnx/resolve/main/";

#[test]
fn download_follows_relative_redirects() {
    let server = spawn(|req| {
        if let Some(file) = req.path.strip_prefix(REPO_PREFIX) {
            MockResponse::redirect(302, &format!("/blob/{file}"))
        } else if let Some(file) = req.path.strip_prefix("/blob/") {
            MockResponse::json(200, &format!("content-of-{file}"))
        } else {
            MockResponse::json(404, "")
        }
    });
    let tmp = tempfile::tempdir().unwrap();

    let dir = download_model_files(&server.url, tmp.path()).unwrap();

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

    download_model_files(&server.url, tmp.path()).unwrap();

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

    download_model_files(&server.url, tmp.path()).unwrap();

    let paths: Vec<String> = server.requests().into_iter().map(|r| r.path).collect();
    assert_eq!(paths.len(), MODEL_FILES.len() - 1, "model.onnx is skipped: {paths:?}");
    assert!(!paths.iter().any(|p| p.ends_with("model.onnx")));
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

    let err = download_model_files(&server.url, tmp.path()).unwrap_err();

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
