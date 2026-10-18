use super::voice_cmd::{config_snapshot, model_get, model_set};
use crate::voice::model::{model_path, spec_for};
use tempfile::{tempdir, NamedTempFile};

#[test]
fn the_default_model_is_large_v3_turbo_and_the_choice_persists() {
    let db = NamedTempFile::new().unwrap();
    assert_eq!(model_get(db.path()), "large-v3-turbo");
    model_set(db.path(), "small").unwrap();
    assert_eq!(model_get(db.path()), "small");
}

#[test]
fn unknown_models_are_rejected_and_a_stale_choice_falls_back_to_the_default() {
    let db = NamedTempFile::new().unwrap();
    assert_eq!(model_set(db.path(), "gigante").unwrap_err(), "unknown_model");
    crate::db::ConfigDb::open(db.path()).unwrap().set("voice_model", "borrado").unwrap();
    assert_eq!(model_get(db.path()), "large-v3-turbo");
}

#[test]
fn the_snapshot_lists_both_models_with_their_download_state() {
    let db = NamedTempFile::new().unwrap();
    let models = tempdir().unwrap();
    std::fs::write(model_path(models.path(), spec_for("small").unwrap()), b"x").unwrap();
    model_set(db.path(), "small").unwrap();
    let snap = config_snapshot(db.path(), models.path());
    assert_eq!(snap.model, "small");
    let by = |id: &str| snap.models.iter().find(|m| m.id == id).unwrap();
    assert!(by("small").downloaded && !by("large-v3-turbo").downloaded);
    assert_eq!(by("large-v3-turbo").approx_mb, 550);
    assert!(by("small").label.contains("small"));
}
