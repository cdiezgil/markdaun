use super::*;

// ── TC-03b: chunk_text splits on paragraphs ───────────────────────────────────

/// TC-03b: chunk_text divides content by paragraphs and respects chunk_size.
#[test]
fn chunk_text_splits_on_paragraphs() {
    let para_a = "a".repeat(800);
    let para_b = "b".repeat(800);
    let content = format!("{para_a}\n\n{para_b}");

    let chunks = embeddings::chunk_text(&content, 1500, 200);
    assert!(!chunks.is_empty(), "Must produce at least one chunk");
    for chunk in &chunks {
        assert!(chunk.chars().count() <= 1700, "Chunk too large: {} chars", chunk.len());
    }
    let all = chunks.join(" ");
    assert!(all.contains('a'), "Should contain para_a content");
    assert!(all.contains('b'), "Should contain para_b content");
}

// ── TC-01/02: model loading (ignored in CI, require download) ────────────────

/// TC-01: embed_text returns a vector of 384 dimensions.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_returns_384_dims() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let emb = embeddings::embed_text(&model, "hello world").unwrap();
    assert_eq!(emb.len(), 384, "AllMiniLML6V2 produces 384-dim vectors");
}

/// TC-02: embed_text is deterministic for the same input.
#[test]
#[ignore = "requires fastembed model download (~22 MB)"]
fn embed_is_deterministic() {
    let tmp = tempfile::tempdir().unwrap();
    let model = embeddings::load_model(tmp.path()).unwrap();
    let a = embeddings::embed_text(&model, "mismo texto").unwrap();
    let b = embeddings::embed_text(&model, "mismo texto").unwrap();
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(b.iter()) {
        assert!((x - y).abs() < 1e-6, "Embeddings should be deterministic, got diff at some dim");
    }
}
