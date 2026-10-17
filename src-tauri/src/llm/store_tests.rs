use super::connection::*;
use super::error::LlmError;
use super::secrets::{connection_account, MemorySecretStore, SecretStore, LEGACY_ACCOUNT};
use super::store::*;
use crate::db::ConfigDb;
use tempfile::NamedTempFile;

fn conn(name: &str, models: &[&str]) -> Connection {
    Connection {
        id: String::new(),
        name: name.into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some("https://api.example.com/v1".into()),
        auth: AuthSource::ApiKey,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: models.iter().map(|m| m.to_string()).collect(),
    }
}

fn open() -> (LlmStore, NamedTempFile) {
    let f = NamedTempFile::new().unwrap();
    (LlmStore::open(f.path()).unwrap(), f)
}

#[test]
fn upsert_assigns_uuid_and_lists_in_insertion_order() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1"])).unwrap();
    let b = s.upsert(conn("B", &["m2"])).unwrap();
    assert_eq!(a.id.len(), 36);
    let names: Vec<_> = s.list().unwrap().into_iter().map(|c| c.name).collect();
    assert_eq!(names, vec!["A", "B"]);
    assert_eq!(s.get(&b.id).unwrap().unwrap().name, "B");
    assert_eq!(s.get("missing").unwrap(), None);
}

#[test]
fn upsert_existing_id_updates_in_place() {
    let (s, _f) = open();
    let mut a = s.upsert(conn("A", &["m1"])).unwrap();
    a.name = "A2".into();
    s.upsert(a.clone()).unwrap();
    let all = s.list().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "A2");
}

#[test]
fn set_active_requires_known_connection_and_model() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1", "m2"])).unwrap();
    assert!(matches!(s.set_active("nope", "m1"), Err(LlmError::BadResponse(_))));
    assert_eq!(s.set_active(&a.id, "zzz"), Err(LlmError::ModelNotFound));
    let sel = s.set_active(&a.id, "m2").unwrap();
    assert_eq!(sel.connection_id, a.id);
    assert_eq!(s.get_active().unwrap(), Some(sel));
}

#[test]
fn delete_clears_active_when_it_pointed_there() {
    let (s, _f) = open();
    let a = s.upsert(conn("A", &["m1"])).unwrap();
    let b = s.upsert(conn("B", &["m1"])).unwrap();
    s.set_active(&a.id, "m1").unwrap();
    s.delete(&b.id).unwrap();
    assert!(s.get_active().unwrap().is_some());
    s.delete(&a.id).unwrap();
    assert_eq!(s.get_active().unwrap(), None);
    assert_eq!(s.list().unwrap().len(), 0);
}

#[test]
fn upsert_repairs_active_model_removed_from_connection() {
    let (s, _f) = open();
    let mut a = s.upsert(conn("A", &["m1", "m2"])).unwrap();
    s.set_active(&a.id, "m2").unwrap();
    a.models = vec!["m1".into()];
    s.upsert(a.clone()).unwrap();
    assert_eq!(s.get_active().unwrap().unwrap().model, "m1");
}

#[test]
fn migration_converts_legacy_config_and_cleans_up() {
    let f = NamedTempFile::new().unwrap();
    {
        let db = ConfigDb::open(f.path()).unwrap();
        db.set("llm_endpoint_url", "https://api.openai.com/v1/chat/completions").unwrap();
        db.set("llm_model", "gpt-4o-mini").unwrap();
    }
    let secrets = MemorySecretStore::default();
    secrets.set(LEGACY_ACCOUNT, "sk-legacy").unwrap();

    let s = LlmStore::open(f.path()).unwrap();
    assert!(s.migrate_legacy(&secrets).unwrap());

    let all = s.list().unwrap();
    assert_eq!(all.len(), 1);
    let c = &all[0];
    assert_eq!(c.name, "Migrated");
    assert_eq!(c.engine, Engine::OpenAiCompat);
    assert_eq!(c.base_url.as_deref(), Some("https://api.openai.com/v1"));
    assert_eq!(c.auth, AuthSource::ApiKey);
    assert_eq!(c.models, vec!["gpt-4o-mini"]);
    assert_eq!(s.get_active().unwrap().unwrap().connection_id, c.id);
    assert_eq!(secrets.get(&connection_account(&c.id)).unwrap().as_deref(), Some("sk-legacy"));
    assert_eq!(secrets.get(LEGACY_ACCOUNT).unwrap(), None);

    // idempotent
    assert!(!s.migrate_legacy(&secrets).unwrap());
    assert_eq!(s.list().unwrap().len(), 1);
}

#[test]
fn migration_without_legacy_config_is_a_noop() {
    let (s, _f) = open();
    assert!(!s.migrate_legacy(&MemorySecretStore::default()).unwrap());
    assert!(s.list().unwrap().is_empty());
}

#[test]
fn migration_without_key_uses_auth_none() {
    let f = NamedTempFile::new().unwrap();
    {
        let db = ConfigDb::open(f.path()).unwrap();
        db.set("llm_endpoint_url", "http://localhost:11434/v1/chat/completions/").unwrap();
        db.set("llm_model", "llama3").unwrap();
    }
    let s = LlmStore::open(f.path()).unwrap();
    assert!(s.migrate_legacy(&MemorySecretStore::default()).unwrap());
    let c = &s.list().unwrap()[0];
    assert_eq!(c.auth, AuthSource::None);
    assert_eq!(c.base_url.as_deref(), Some("http://localhost:11434/v1"));
}
