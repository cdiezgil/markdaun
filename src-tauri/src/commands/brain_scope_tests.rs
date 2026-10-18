use super::brain_cmd::{brain_query_core, BrainQueryResult};
use super::brain_scope::{validate_scope, NOTES_FULL_TEXT_BUDGET};
use crate::db::{ConversationsDb, QueryScope, VectorsDb};
use crate::llm::connection::*;
use crate::llm::proc::FixedResolver;
use crate::llm::testutil::{spawn, test_env, MockResponse, MockServer};
use std::path::Path;
use tempfile::{NamedTempFile, TempDir};

const OK: &str = r#"{"choices":[{"message":{"role":"assistant","content":"ok"}}]}"#;

fn server() -> MockServer {
    spawn(|_| MockResponse::json(200, OK))
}

fn conn_for(url: &str) -> Connection {
    Connection {
        id: String::new(),
        name: "Test".into(),
        preset_id: None,
        engine: Engine::OpenAiCompat,
        base_url: Some(url.into()),
        auth: AuthSource::None,
        auth_header: AuthHeader::Bearer,
        extra_headers: vec![],
        ca_cert_path: None,
        azure_api_version: None,
        models: vec!["test-model".into()],
        vision_models: vec![],
    }
}

fn emb() -> Vec<f32> {
    let v = vec![0.1_f32; 384];
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter().map(|x| x / n).collect()
}

struct Fixture {
    vault: TempDir,
    cfg: NamedTempFile,
    vec_file: NamedTempFile,
}

impl Fixture {
    fn new() -> Self {
        let vault = tempfile::tempdir().unwrap();
        let vec_file = NamedTempFile::new().unwrap();
        VectorsDb::open(vec_file.path()).unwrap();
        Fixture { vault, cfg: NamedTempFile::new().unwrap(), vec_file }
    }
    fn root(&self) -> &Path {
        self.vault.path()
    }
    fn vp(&self) -> String {
        self.root().to_str().unwrap().to_string()
    }
    /// Writes a note and indexes one chunk for it.
    fn note(&self, rel: &str, text: &str) {
        let p = self.root().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        let db = VectorsDb::open(self.vec_file.path()).unwrap();
        let e = emb();
        db.upsert_file_chunks(&self.vp(), p.to_str().unwrap(), &[(0, &format!("Nota: {rel}\n\nCHUNK-{rel}"), e.as_slice())])
            .unwrap();
    }
    async fn ask(
        &self,
        srv: &MockServer,
        conv: Option<String>,
        scope: Option<&QueryScope>,
    ) -> Result<BrainQueryResult, String> {
        let env = test_env(FixedResolver::default(), 3000);
        brain_query_core(
            self.cfg.path(),
            self.vec_file.path(),
            "pregunta",
            &self.vp(),
            conv,
            &conn_for(&srv.url),
            "test-model",
            None,
            &env,
            Ok(emb()),
            &[],
            scope,
        )
        .await
    }
}

fn notes(paths: &[&str]) -> QueryScope {
    QueryScope::Notes { paths: paths.iter().map(|s| s.to_string()).collect() }
}

fn body(srv: &MockServer) -> String {
    srv.requests().last().unwrap().body.clone()
}

#[tokio::test]
async fn vault_scope_uses_retrieval_over_the_whole_vault() {
    let f = Fixture::new();
    f.note("a.md", "alfa");
    f.note("b.md", "beta");
    let srv = server();
    let r = f.ask(&srv, None, Some(&QueryScope::Vault)).await.unwrap();
    assert_eq!(r.sources.len(), 2);
    assert!(body(&srv).contains("CHUNK-a.md"));
}

#[tokio::test]
async fn single_note_within_budget_sends_its_full_text_without_retrieval() {
    let f = Fixture::new();
    f.note("a.md", "TEXTO-COMPLETO-DE-A");
    f.note("b.md", "TEXTO-DE-B");
    let srv = server();
    let r = f.ask(&srv, None, Some(&notes(&["a.md"]))).await.unwrap();
    let b = body(&srv);
    assert!(b.contains("TEXTO-COMPLETO-DE-A"));
    assert!(!b.contains("CHUNK-a.md"), "no retrieval chunks");
    assert!(!b.contains("TEXTO-DE-B"));
    assert_eq!(r.sources, vec![f.root().join("a.md").to_str().unwrap().to_string()]);
    assert!(r.warning.is_none());
}

#[tokio::test]
async fn full_text_scope_does_not_need_the_embedding() {
    let f = Fixture::new();
    f.note("a.md", "TEXTO-A");
    let srv = server();
    let env = test_env(FixedResolver::default(), 3000);
    let r = brain_query_core(
        f.cfg.path(), f.vec_file.path(), "q", &f.vp(), None, &conn_for(&srv.url), "test-model",
        None, &env, Err("embed_error: down".into()), &[], Some(&notes(&["a.md"])),
    )
    .await
    .unwrap();
    assert!(r.warning.is_none());
    assert!(body(&srv).contains("TEXTO-A"));
}

#[tokio::test]
async fn notes_over_budget_fall_back_to_retrieval_restricted_to_those_paths() {
    let f = Fixture::new();
    f.note("a.md", &"x".repeat(NOTES_FULL_TEXT_BUDGET + 1));
    f.note("b.md", "pequeña");
    f.note("c.md", "ajena");
    let srv = server();
    let r = f.ask(&srv, None, Some(&notes(&["a.md", "b.md"]))).await.unwrap();
    let b = body(&srv);
    assert!(b.contains("CHUNK-a.md") && b.contains("CHUNK-b.md"));
    assert!(!b.contains("CHUNK-c.md"));
    assert!(!b.contains(&"x".repeat(100)), "full text not sent");
    assert_eq!(r.sources.len(), 2);
}

#[tokio::test]
async fn combined_text_exactly_at_budget_is_still_full_text() {
    let f = Fixture::new();
    f.note("a.md", &"y".repeat(NOTES_FULL_TEXT_BUDGET / 2));
    f.note("b.md", &"z".repeat(NOTES_FULL_TEXT_BUDGET / 2));
    let srv = server();
    f.ask(&srv, None, Some(&notes(&["a.md", "b.md"]))).await.unwrap();
    assert!(!body(&srv).contains("CHUNK-a.md"));
}

#[tokio::test]
async fn folder_scope_restricts_retrieval_to_the_folder_prefix() {
    let f = Fixture::new();
    f.note("Mutua/x.md", "x");
    f.note("Mutua/sub/y.md", "y");
    f.note("MutuaOtra/z.md", "z");
    f.note("raiz.md", "r");
    let srv = server();
    let r = f.ask(&srv, None, Some(&QueryScope::Folder { path: "Mutua".into() })).await.unwrap();
    let b = body(&srv);
    assert!(b.contains("CHUNK-Mutua/x.md") && b.contains("CHUNK-Mutua/sub/y.md"));
    assert!(!b.contains("CHUNK-MutuaOtra/z.md") && !b.contains("CHUNK-raiz.md"));
    assert_eq!(r.sources.len(), 2);
}

#[tokio::test]
async fn vault_listing_stays_in_the_prompt_for_scoped_queries() {
    let f = Fixture::new();
    f.note("a.md", "A");
    f.note("otra.md", "B");
    let srv = server();
    f.ask(&srv, None, Some(&notes(&["a.md"]))).await.unwrap();
    assert!(body(&srv).contains("otra.md"));
}

#[tokio::test]
async fn paths_outside_the_vault_or_missing_are_rejected_before_anything_is_stored() {
    let f = Fixture::new();
    f.note("a.md", "A");
    let srv = server();
    for bad in [
        notes(&["../fuera.md"]),
        notes(&["/etc/passwd"]),
        notes(&["a/../../fuera.md"]),
        notes(&["no-existe.md"]),
        notes(&[]),
        QueryScope::Folder { path: "../x".into() },
        QueryScope::Folder { path: "no-existe".into() },
    ] {
        let err = f.ask(&srv, None, Some(&bad)).await.unwrap_err();
        assert!(err.starts_with("scope_error"), "{bad:?} -> {err}");
    }
    assert!(srv.requests().is_empty());
    let db = ConversationsDb::open(f.cfg.path()).unwrap();
    assert!(db.list_conversations(&f.vp()).unwrap().is_empty());
}

#[test]
fn validate_accepts_absolute_paths_inside_the_vault_and_normalizes_to_relative() {
    let f = Fixture::new();
    f.note("Mutua/x.md", "x");
    let abs = f.root().join("Mutua/x.md").to_str().unwrap().to_string();
    let v = validate_scope(f.root(), &QueryScope::Notes { paths: vec![abs] }).unwrap();
    assert_eq!(v, notes(&["Mutua/x.md"]));
    let v = validate_scope(f.root(), &QueryScope::Folder { path: "Mutua/".into() }).unwrap();
    assert_eq!(v, QueryScope::Folder { path: "Mutua".into() });
}

#[tokio::test]
async fn scope_is_persisted_with_the_conversation_and_reloaded() {
    let f = Fixture::new();
    f.note("a.md", "A");
    let srv = server();
    let r = f.ask(&srv, None, Some(&notes(&["a.md"]))).await.unwrap();
    let db = ConversationsDb::open(f.cfg.path()).unwrap();
    assert_eq!(db.get_scope(&r.conversation_id).unwrap(), notes(&["a.md"]));
    let listed = db.list_conversations(&f.vp()).unwrap();
    assert_eq!(listed[0].scope, notes(&["a.md"]));

    // No scope on the next turn: the stored one applies.
    f.ask(&srv, Some(r.conversation_id.clone()), None).await.unwrap();
    assert!(body(&srv).contains("A") && !body(&srv).contains("CHUNK-a.md"));

    // Changing it persists the new one.
    f.ask(&srv, Some(r.conversation_id.clone()), Some(&QueryScope::Vault)).await.unwrap();
    assert_eq!(db.get_scope(&r.conversation_id).unwrap(), QueryScope::Vault);
}

#[test]
fn set_scope_updates_an_existing_conversation_and_defaults_to_vault() {
    let f = Fixture::new();
    let db = ConversationsDb::open(f.cfg.path()).unwrap();
    let id = db.create_conversation(&f.vp(), "t").unwrap();
    assert_eq!(db.get_scope(&id).unwrap(), QueryScope::Vault);
    db.set_scope(&id, &QueryScope::Folder { path: "Mutua".into() }).unwrap();
    assert_eq!(db.get_scope(&id).unwrap(), QueryScope::Folder { path: "Mutua".into() });
}

#[test]
fn old_databases_without_the_scope_column_are_migrated() {
    let f = NamedTempFile::new().unwrap();
    {
        let c = rusqlite::Connection::open(f.path()).unwrap();
        c.execute_batch(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, vault_path TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL);
             INSERT INTO conversations VALUES ('old','/v','viejo','2024-01-01');",
        )
        .unwrap();
    }
    let db = ConversationsDb::open(f.path()).unwrap();
    assert_eq!(db.get_scope("old").unwrap(), QueryScope::Vault);
    db.set_scope("old", &notes(&["a.md"])).unwrap();
    assert_eq!(db.get_scope("old").unwrap(), notes(&["a.md"]));
}

#[test]
fn query_scope_json_shape_matches_the_frontend() {
    let s: QueryScope = serde_json::from_str(r#"{"kind":"notes","paths":["a.md"]}"#).unwrap();
    assert_eq!(s, notes(&["a.md"]));
    let s: QueryScope = serde_json::from_str(r#"{"kind":"folder","path":"M"}"#).unwrap();
    assert_eq!(s, QueryScope::Folder { path: "M".into() });
    assert_eq!(serde_json::to_string(&QueryScope::Vault).unwrap(), r#"{"kind":"vault"}"#);
}
