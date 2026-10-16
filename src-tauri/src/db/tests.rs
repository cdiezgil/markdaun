use super::ConfigDb;
use std::path::Path;

#[test]
fn config_set_and_get() {
    let db = ConfigDb::open(Path::new(":memory:")).unwrap();
    db.set("active_vault", "/tmp/notes").unwrap();
    let val = db.get("active_vault").unwrap();
    assert_eq!(val, Some("/tmp/notes".to_string()));
}

#[test]
fn config_get_missing_key_returns_none() {
    let db = ConfigDb::open(Path::new(":memory:")).unwrap();
    let val = db.get("nonexistent_key").unwrap();
    assert_eq!(val, None);
}

#[test]
fn config_set_overwrites_existing() {
    let db = ConfigDb::open(Path::new(":memory:")).unwrap();
    db.set("key", "value1").unwrap();
    db.set("key", "value2").unwrap();
    let val = db.get("key").unwrap();
    assert_eq!(val, Some("value2".to_string()));
}
