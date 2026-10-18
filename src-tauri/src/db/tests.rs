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

// ── Digestion conversations ───────────────────────────────────────────────────

#[test]
fn digest_conversation_remembers_its_source_and_archive_state() {
    use super::ConversationsDb;
    let f = tempfile::NamedTempFile::new().unwrap();
    let db = ConversationsDb::open(f.path()).unwrap();
    let plain = db.create_conversation("/v", "charla").unwrap();
    let id = db.create_digest_conversation("/v", "Digerir: acta.txt", "Entrada/acta.txt").unwrap();

    let list = db.list_conversations("/v").unwrap();
    let get = |i: &str| list.iter().find(|c| c.id == i).unwrap().clone();
    assert_eq!(get(&plain).digest_source, None);
    assert!(!get(&plain).digest_archived);
    assert_eq!(get(&id).digest_source.as_deref(), Some("Entrada/acta.txt"));
    assert!(!get(&id).digest_archived);

    db.mark_digest_archived(&id, "Mutua/Fuentes/acta.txt").unwrap();
    let c = db.list_conversations("/v").unwrap().into_iter().find(|c| c.id == id).unwrap();
    assert_eq!(c.digest_source.as_deref(), Some("Mutua/Fuentes/acta.txt"));
    assert!(c.digest_archived);
}
