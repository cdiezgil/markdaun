use super::secrets::*;

#[test]
fn account_name_uses_connection_prefix() {
    assert_eq!(connection_account("abc"), "llm-connection:abc");
}

#[test]
fn memory_store_set_get_delete() {
    let s = MemorySecretStore::default();
    assert_eq!(s.get("a").unwrap(), None);
    s.set("a", "k1").unwrap();
    assert_eq!(s.get("a").unwrap(), Some("k1".to_string()));
    s.set("a", "k2").unwrap();
    assert_eq!(s.get("a").unwrap(), Some("k2".to_string()));
    s.delete("a").unwrap();
    assert_eq!(s.get("a").unwrap(), None);
    // deleting a missing entry is not an error
    s.delete("a").unwrap();
}
