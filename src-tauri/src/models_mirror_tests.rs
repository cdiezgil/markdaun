use crate::models_mirror::{sha256_file, Mirror, MIRROR_ASSETS, MIRROR_BASE_URL};

#[test]
fn production_mirror_lists_every_asset_with_a_valid_hash() {
    let m = Mirror::production();
    for (asset, hash) in MIRROR_ASSETS {
        assert_eq!(hash.len(), 64, "{asset}");
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "{asset}");
        assert_eq!(m.url_for(asset).unwrap(), format!("{MIRROR_BASE_URL}/{asset}"));
        assert_eq!(m.sha256_for(asset), Some(hash));
    }
    assert!(m.url_for("ggml-small-q5_1.bin").is_none());
}

#[test]
fn none_knows_nothing_and_new_trims_the_trailing_slash() {
    assert!(Mirror::none().url_for("a").is_none());
    let m = Mirror::new("http://h/x/", vec![("a".into(), "b".into())]);
    assert_eq!(m.url_for("a").unwrap(), "http://h/x/a");
}

#[test]
fn sha256_file_hashes_the_content() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("f");
    std::fs::write(&p, b"abc").unwrap();
    assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert!(sha256_file(&dir.path().join("missing")).is_err());
}
