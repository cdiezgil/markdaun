use super::digest::{
    area_folders, enforce_area, office_source,
    apply_consolidation_plan, build_consolidation_messages, build_digest_messages, digest_core,
    parse_note_blocks, render_note_block, split_source, DigestProgress, DigestRequest, NoteBlock,
    DIGEST_INSTRUCTION,
};
use crate::db::{ConversationsDb, QueryScope};
use crate::llm::connection::*;
use crate::llm::proc::FixedResolver;
use crate::llm::testutil::{spawn, test_env, MockResponse, MockServer, Recorded};
use std::fs;
use std::sync::{Arc, Mutex};
use tempfile::{tempdir, NamedTempFile};

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
        models: vec!["m".into()],
        vision_models: vec![],
    }
}

/// OpenAI-style reply carrying `content`.
fn reply(content: &str) -> MockResponse {
    let body = serde_json::json!({"choices":[{"message":{"role":"assistant","content":content}}]});
    MockResponse::json(200, &body.to_string())
}

fn block(path: &str, mode: &str, content: &str) -> String {
    format!("```markdaun-note path=\"{path}\" mode=\"{mode}\"\n{content}\n```")
}

fn vault_with_structure() -> tempfile::TempDir {
    let v = tempdir().unwrap();
    for d in ["Personal", "Mutua/ProyectoX", "Entrada", "Mutua/ProyectoX/Fuentes"] {
        fs::create_dir_all(v.path().join(d)).unwrap();
    }
    fs::write(v.path().join("Personal/Salud.md"), "# Salud").unwrap();
    fs::write(v.path().join("Mutua/ProyectoX/Plan.md"), "# Plan").unwrap();
    fs::write(v.path().join("Entrada/pendiente.md"), "# Pendiente").unwrap();
    v
}

// ── split_source ──────────────────────────────────────────────────────────────

#[test]
fn short_text_is_one_chunk() {
    assert_eq!(split_source("hola\n\nmundo", 100), vec!["hola\n\nmundo".to_string()]);
}

#[test]
fn chunks_respect_the_limit_and_rebuild_the_original() {
    let text: String = (0..40).map(|i| format!("Párrafo número {i} con algo de texto.\n\n")).collect();
    let chunks = split_source(&text, 200);
    assert!(chunks.len() > 3);
    assert!(chunks.iter().all(|c| c.chars().count() <= 200));
    assert_eq!(chunks.concat(), text);
}

#[test]
fn chunks_prefer_heading_boundaries() {
    let a = format!("# Uno\n\n{}\n\n", "a".repeat(120));
    let b = format!("# Dos\n\n{}\n\n", "b".repeat(120));
    let text = format!("{a}{b}");
    let chunks = split_source(&text, 160);
    assert_eq!(chunks.len(), 2);
    assert!(chunks[0].starts_with("# Uno") && !chunks[0].contains("# Dos"));
    assert!(chunks[1].starts_with("# Dos"));
}

#[test]
fn oversized_paragraph_is_hard_split_without_breaking_characters() {
    let text = "ñ".repeat(450);
    let chunks = split_source(&text, 100);
    assert_eq!(chunks.len(), 5);
    assert!(chunks.iter().all(|c| c.chars().count() <= 100));
    assert_eq!(chunks.concat(), text);
}

// ── note blocks ───────────────────────────────────────────────────────────────

#[test]
fn parses_and_renders_note_blocks() {
    let text = format!(
        "Intro\n{}\n\n{}\n{}",
        block("Personal/A.md", "create", "# A\ncuerpo"),
        block("Mala.txt", "create", "no es md"),
        block("Mutua/B.md", "append", "# B"),
    );
    let blocks = parse_note_blocks(&text);
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0], NoteBlock { path: "Personal/A.md".into(), mode: "create".into(), content: "# A\ncuerpo".into() });
    assert_eq!(blocks[1].mode, "append");
    assert_eq!(render_note_block(&blocks[0]), block("Personal/A.md", "create", "# A\ncuerpo"));
}

#[test]
fn parse_note_blocks_preserves_inner_mermaid_fence() {
    // A note that contains a ```mermaid block must not be cut off at the inner fence.
    let content = "# Arq\n\n## Diagrama\n\n```mermaid\ngraph TD\n  A --> B\n```";
    let text = block("Mutua/Arq.md", "create", content);
    let blocks = parse_note_blocks(&text);
    assert_eq!(blocks.len(), 1, "should parse exactly one note block");
    assert!(blocks[0].content.contains("```mermaid"), "mermaid fence must be inside content");
    assert!(blocks[0].content.contains("A --> B"), "diagram body must be present");
}

#[test]
fn parse_note_blocks_handles_multiple_inner_fences() {
    // Two inner code fences (mermaid + rust) followed by the actual closing fence.
    let content = "# Note\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n```rust\nlet x = 1;\n```";
    let text = block("X.md", "create", content);
    let blocks = parse_note_blocks(&text);
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0].content.contains("let x = 1;"));
}

// ── prompts ───────────────────────────────────────────────────────────────────

#[test]
fn digest_prompt_has_instruction_folders_index_and_source() {
    let msgs = build_digest_messages(
        "acta.txt",
        Some("texto de la fuente"),
        None,
        &["Mutua".to_string(), "Mutua/ProyectoX".to_string(), "Personal".to_string()],
        &["Personal/Salud.md".to_string()],
        None,
    );
    assert_eq!(msgs[0].role, "system");
    assert!(msgs[0].content.contains(DIGEST_INSTRUCTION));
    assert!(msgs[0].content.contains("markdaun-note"));
    assert!(msgs[0].content.contains("- Mutua/ProyectoX"));
    assert!(msgs[0].content.contains("Personal/Salud.md"));
    assert!(msgs[0].content.contains("acta.txt"));
    assert_eq!(msgs[1].role, "user");
    assert!(msgs[1].content.contains("texto de la fuente"));
}

#[test]
fn part_prompt_announces_the_part() {
    let msgs = build_digest_messages("grande.md", Some("trozo"), Some((2, 5)), &[], &[], None);
    assert!(msgs[1].content.contains("PARTE 2 DE 5"));
    assert!(msgs[0].content.contains("CANDIDATAS"));
}

#[test]
fn consolidation_prompt_lists_titles_and_summaries_not_full_bodies() {
    let long_body = format!("# Título largo\n{}\nFIN-DEL-CUERPO", "palabra ".repeat(200));
    let cands = vec![NoteBlock { path: "Personal/A.md".into(), mode: "create".into(), content: long_body }];
    let msgs = build_consolidation_messages("grande.md", &cands, &["Personal".to_string()], &[], None);
    let user = &msgs[1].content;
    assert!(user.contains("CONSOLIDACION"));
    assert!(user.contains("[1]") && user.contains("Personal/A.md") && user.contains("Título largo"));
    assert!(!user.contains("FIN-DEL-CUERPO"));
}

// ── consolidation plan ────────────────────────────────────────────────────────

fn cand(path: &str, body: &str) -> NoteBlock {
    NoteBlock { path: path.into(), mode: "create".into(), content: body.into() }
}

#[test]
fn plan_keeps_unmentioned_candidates_and_applies_merge_and_discard() {
    let cands = vec![
        cand("P/A.md", "# A\nuno\n\nFuente: [[P/Fuentes/s.txt]]"),
        cand("P/B.md", "# B\ndos"),
        cand("P/A2.md", "# A bis\ntres\n\nFuente: [[P/Fuentes/s.txt]]"),
        cand("P/D.md", "# D\ncuatro"),
    ];
    let plan = "FUSIONAR: 1, 3 => P/Fusion.md\nDESCARTAR: 4\nTexto suelto";
    let out = apply_consolidation_plan(&cands, plan);
    let paths: Vec<&str> = out.iter().map(|b| b.path.as_str()).collect();
    assert_eq!(paths, ["P/Fusion.md", "P/B.md"]);
    let merged = &out[0].content;
    assert!(merged.starts_with("# A\nuno"));
    assert!(merged.contains("## A bis\ntres"), "second H1 demoted: {merged}");
    assert_eq!(merged.matches("Fuente:").count(), 1);
    assert!(merged.trim_end().ends_with("Fuente: [[P/Fuentes/s.txt]]"));
}

#[test]
fn plan_appends_model_written_index_and_ignores_garbage() {
    let cands = vec![cand("P/A.md", "# A"), cand("P/B.md", "# B")];
    let plan = format!("FUSIONAR: 9, 1 => X.md\nDESCARTAR: hola\n{}", block("P/Índice.md", "create", "# Índice\n[[A]] [[B]]"));
    let out = apply_consolidation_plan(&cands, &plan);
    let paths: Vec<&str> = out.iter().map(|b| b.path.as_str()).collect();
    assert_eq!(paths, ["P/A.md", "P/B.md", "P/Índice.md"]);
}

// ── digest_core ───────────────────────────────────────────────────────────────

struct Run {
    db: NamedTempFile,
    vault: tempfile::TempDir,
    server: MockServer,
    progress: Arc<Mutex<Vec<DigestProgress>>>,
}

async fn run_digest(
    handler: impl Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
    text: &str,
    chunk: usize,
) -> (Result<super::digest::DigestResult, String>, Run) {
    run_digest_in(handler, text, chunk, None).await
}

async fn run_digest_in(
    handler: impl Fn(&Recorded) -> MockResponse + Send + Sync + 'static,
    text: &str,
    chunk: usize,
    area: Option<&str>,
) -> (Result<super::digest::DigestResult, String>, Run) {
    let db = NamedTempFile::new().unwrap();
    let vault = vault_with_structure();
    fs::write(vault.path().join("Entrada/acta.txt"), text).unwrap();
    let server = spawn(handler);
    let env = test_env(FixedResolver::default(), 5000);
    let progress = Arc::new(Mutex::new(Vec::new()));
    let sink = progress.clone();
    let vault_str = vault.path().to_string_lossy().to_string();
    let req = DigestRequest {
        vault_path: &vault_str,
        source_rel: "Entrada/acta.txt",
        text: Some(text),
        attachments: &[],
        images: &[],
        chunk_chars: chunk,
        area,
    };
    let res = digest_core(db.path(), &req, &conn_for(&server.url), "m", None, &env, &move |p| {
        sink.lock().unwrap().push(p)
    })
    .await;
    (res, Run { db, vault, server, progress })
}

#[tokio::test]
async fn small_source_is_one_turn_and_creates_a_digest_conversation() {
    let answer = block("Personal/Nota.md", "create", "# Nota\nx\n\nFuente: [[Personal/Fuentes/acta.txt]]");
    let ans = answer.clone();
    let (res, run) = run_digest(move |_| reply(&ans), "contenido corto", 1000).await;
    let res = res.unwrap();
    assert_eq!(res.answer, answer);
    assert_eq!(res.parts, 1);
    assert_eq!(run.server.requests().len(), 1);
    let body = &run.server.requests()[0].body;
    assert!(body.contains("contenido corto") && body.contains("Mutua/ProyectoX") && body.contains("Personal/Salud.md"));
    assert!(!body.contains("pendiente.md"), "Entrada notes are not part of the index");
    assert!(run.progress.lock().unwrap().is_empty());

    let vault = run.vault.path().to_string_lossy().to_string();
    let db = ConversationsDb::open(run.db.path()).unwrap();
    let convs = db.list_conversations(&vault).unwrap();
    assert_eq!(convs.len(), 1);
    assert_eq!(convs[0].id, res.conversation_id);
    assert_eq!(convs[0].title, "Digerir: acta.txt");
    assert_eq!(convs[0].digest_source.as_deref(), Some("Entrada/acta.txt"));
    assert_eq!(convs[0].scope, QueryScope::Vault);
    let msgs = db.get_messages(&res.conversation_id).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].role, "user");
    assert!(msgs[0].content.contains("acta.txt"));
    assert_eq!(msgs[1].content, answer);
}

fn large_text() -> String {
    // Three headed sections of ~60 chars each; chunk size 80 -> three parts.
    ["# Uno", "# Dos", "# Tres"].iter().map(|h| format!("{h}\n\n{}\n\n", "x".repeat(50))).collect()
}

#[tokio::test]
async fn large_source_is_digested_in_parts_then_consolidated() {
    let handler = |req: &Recorded| {
        let b = &req.body;
        if b.contains("CONSOLIDACION") {
            return reply("FUSIONAR: 1, 2 => Personal/Union.md\nDESCARTAR: 3");
        }
        for n in 1..=3 {
            if b.contains(&format!("PARTE {n} DE 3")) {
                return reply(&block(&format!("Personal/P{n}.md"), "create", &format!("# Tema {n}\ncuerpo {n}\n\nFuente: [[Personal/Fuentes/acta.txt]]")));
            }
        }
        reply("sin formato")
    };
    let (res, run) = run_digest(handler, &large_text(), 80).await;
    let res = res.unwrap();
    assert_eq!(res.parts, 3);

    let reqs = run.server.requests();
    assert_eq!(reqs.len(), 4, "3 parts + 1 consolidation");
    assert!(reqs[3].body.contains("CONSOLIDACION"));
    assert!(reqs[3].body.contains("Tema 1") && reqs[3].body.contains("Tema 3"));

    let blocks = parse_note_blocks(&res.answer);
    let paths: Vec<&str> = blocks.iter().map(|b| b.path.as_str()).collect();
    assert_eq!(paths, ["Personal/Union.md"], "P1+P2 merged, P3 discarded");
    assert!(blocks[0].content.contains("cuerpo 1") && blocks[0].content.contains("cuerpo 2"));

    let p = run.progress.lock().unwrap().clone();
    assert_eq!(
        p,
        vec![
            DigestProgress { source: "Entrada/acta.txt".into(), part: 1, total: 3, consolidating: false },
            DigestProgress { source: "Entrada/acta.txt".into(), part: 2, total: 3, consolidating: false },
            DigestProgress { source: "Entrada/acta.txt".into(), part: 3, total: 3, consolidating: false },
            DigestProgress { source: "Entrada/acta.txt".into(), part: 3, total: 3, consolidating: true },
        ]
    );
    let vault = run.vault.path().to_string_lossy().to_string();
    let db = ConversationsDb::open(run.db.path()).unwrap();
    let user = &db.get_messages(&res.conversation_id).unwrap()[0];
    assert!(user.content.contains("3 partes"));
    assert_eq!(db.list_conversations(&vault).unwrap().len(), 1);
}

#[tokio::test]
async fn failed_consolidation_falls_back_to_every_candidate() {
    let handler = |req: &Recorded| {
        if req.body.contains("CONSOLIDACION") {
            return MockResponse::json(500, "{}");
        }
        let n = if req.body.contains("PARTE 1 DE 3") { 1 } else if req.body.contains("PARTE 2 DE 3") { 2 } else { 3 };
        reply(&block(&format!("Personal/P{n}.md"), "create", &format!("# T{n}")))
    };
    let (res, _run) = run_digest(handler, &large_text(), 80).await;
    let blocks = parse_note_blocks(&res.unwrap().answer);
    assert_eq!(blocks.len(), 3);
}

#[tokio::test]
async fn a_failing_part_aborts_without_leaving_a_conversation() {
    let handler = |req: &Recorded| {
        if req.body.contains("PARTE 2 DE 3") {
            MockResponse::json(500, "{}")
        } else {
            reply(&block("Personal/P.md", "create", "# T"))
        }
    };
    let (res, run) = run_digest(handler, &large_text(), 80).await;
    assert!(res.unwrap_err().starts_with("llm_error"));
    let vault = run.vault.path().to_string_lossy().to_string();
    let db = ConversationsDb::open(run.db.path()).unwrap();
    assert!(db.list_conversations(&vault).unwrap().is_empty());
}

#[tokio::test]
async fn attachments_need_a_vision_model() {
    let db = NamedTempFile::new().unwrap();
    let vault = vault_with_structure();
    fs::write(vault.path().join("Entrada/foto.png"), b"x").unwrap();
    let server = spawn(|_| reply("no"));
    let env = test_env(FixedResolver::default(), 5000);
    let vault_str = vault.path().to_string_lossy().to_string();
    let inputs = [crate::llm::attachment::AttachmentInput { vault_path: "Entrada/foto.png".into(), derived: None }];
    let req = DigestRequest {
        vault_path: &vault_str,
        source_rel: "Entrada/foto.png",
        text: None,
        attachments: &inputs,
        images: &[],
        chunk_chars: 1000,
        area: None,
    };
    let err = digest_core(db.path(), &req, &conn_for(&server.url), "m", None, &env, &|_| {}).await.unwrap_err();
    assert!(err == "vision_unsupported" || err.starts_with("attachment_error"), "{err}");
    assert!(server.requests().is_empty());
}

// ── Word / PowerPoint sources ────────────────────────────────────────────────

fn png_of(side: u32) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(side, side).write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn extracted(name: &str, bytes: Vec<u8>) -> crate::capture::office::ExtractedImage {
    crate::capture::office::ExtractedImage { name: name.into(), bytes, media_type: "image/png".into() }
}

async fn run_with_images(vision: bool, images: Vec<crate::capture::office::ExtractedImage>) -> (Result<super::digest::DigestResult, String>, MockServer) {
    let db = NamedTempFile::new().unwrap();
    let vault = vault_with_structure();
    let server = spawn(|_| reply(&block("Personal/N.md", "create", "# N")));
    let env = test_env(FixedResolver::default(), 5000);
    let vault_str = vault.path().to_string_lossy().to_string();
    let mut conn = conn_for(&server.url);
    if vision {
        conn.vision_models = vec!["m".into()];
    }
    let req = DigestRequest {
        vault_path: &vault_str,
        source_rel: "Entrada/informe.docx",
        text: Some("# Informe\n\ncuerpo del informe"),
        attachments: &[],
        images: &images,
        chunk_chars: 1000,
        area: None,
    };
    let res = digest_core(db.path(), &req, &conn, "m", None, &env, &|_| {}).await;
    (res, server)
}

#[tokio::test]
async fn office_images_are_attached_largest_first_up_to_the_limit_and_the_rest_is_noted() {
    // Seven images; sizes grow with the index so 3..=7 are the five largest.
    let images: Vec<_> = (1..=7u32).map(|n| extracted(&format!("image{n}.png"), png_of(10 * n))).collect();
    let (res, server) = run_with_images(true, images).await;
    res.unwrap();
    let body = &server.requests()[0].body;
    assert_eq!(body.matches("\"type\":\"image_url\"").count(), 5, "{body}");
    assert!(body.contains("cuerpo del informe"));
    assert!(body.contains("[Archivo adjunto: image7.png]") && body.contains("[Archivo adjunto: image3.png]"));
    assert!(!body.contains("[Archivo adjunto: image1.png]") && !body.contains("[Archivo adjunto: image2.png]"));
    assert!(body.contains("2 imágenes más que no se adjuntaron"), "{body}");
}

#[tokio::test]
async fn office_images_are_only_mentioned_when_the_model_has_no_vision() {
    let images = vec![extracted("image1.png", png_of(10))];
    let (res, server) = run_with_images(false, images).await;
    res.unwrap();
    let body = &server.requests()[0].body;
    assert_eq!(body.matches("\"type\":\"image_url\"").count(), 0);
    assert!(body.contains("no admite imágenes"), "{body}");
}

#[test]
fn office_source_extracts_text_and_images_and_reports_bad_files() {
    use crate::capture::testutil::{simple_docx, PNG};
    let v = tempdir().unwrap();
    fs::create_dir_all(v.path().join("Entrada")).unwrap();
    fs::write(v.path().join("Entrada/a.docx"), simple_docx(&["Hola mundo"], &[PNG])).unwrap();
    let (text, images) = office_source(v.path(), "Entrada/a.docx").unwrap();
    assert!(text.starts_with("# Documento\n\nHola mundo"));
    assert_eq!(images.len(), 1);

    fs::write(v.path().join("Entrada/roto.docx"), b"zip? no").unwrap();
    assert!(office_source(v.path(), "Entrada/roto.docx").unwrap_err().starts_with("office_error"));
    assert!(office_source(v.path(), "Entrada/falta.docx").unwrap_err().starts_with("io_error"));
}

// ── area-first digestion ──────────────────────────────────────────────────────

fn tree() -> Vec<String> {
    ["Mutua", "Mutua/ProyectoX", "Personal", "Personal/Salud"].iter().map(|s| s.to_string()).collect()
}

#[test]
fn area_folders_keeps_only_the_area_subtree() {
    assert_eq!(area_folders(&tree(), "Mutua"), ["Mutua", "Mutua/ProyectoX"]);
    assert_eq!(area_folders(&tree(), "Per"), Vec::<String>::new(), "prefix of a name is not the area");
    assert!(area_folders(&tree(), "").is_empty(), "the vault root has no folders");
}

#[test]
fn prompt_with_area_lists_only_its_folders_and_requires_notes_inside() {
    let msgs = build_digest_messages(
        "acta.txt",
        Some("t"),
        None,
        &["Mutua".to_string(), "Mutua/ProyectoX".to_string()],
        &["Personal/Salud.md".to_string()],
        Some("Mutua"),
    );
    let sys = &msgs[0].content;
    assert!(sys.contains("- Mutua/ProyectoX"));
    assert!(!sys.contains("- Personal\n"));
    assert!(sys.contains("«Mutua»") && sys.contains("dentro"), "area instruction: {sys}");
    assert!(sys.contains("Personal/Salud.md"), "the note index stays complete");
}

#[test]
fn prompt_for_the_vault_root_area_asks_for_root_notes() {
    let msgs = build_digest_messages("a.txt", Some("t"), None, &[], &[], Some(""));
    assert!(msgs[0].content.contains("raíz de la bóveda"));
}

#[test]
fn consolidation_prompt_also_carries_the_area() {
    let msgs = build_consolidation_messages("g.md", &[cand("Mutua/A.md", "x")], &["Mutua".to_string()], &[], Some("Mutua"));
    assert!(msgs[0].content.contains("«Mutua»"));
}

fn areas() -> Vec<String> {
    vec!["Mutua".to_string(), "Personal".to_string()]
}

#[test]
fn paths_outside_the_area_are_rewritten_into_it_and_flagged() {
    let answer = format!(
        "{}\n\n{}\n\n{}\n\n{}",
        block("Mutua/ProyectoX/Plan.md", "create", "# Plan"),
        block("Personal/Salud/Dieta.md", "create", "# Dieta"),
        block("Suelta.md", "append", "# Suelta"),
        block("Mutua/Otra.md", "create", "# Otra"),
    );
    let out = enforce_area(&answer, Some("Mutua"), &areas());
    let blocks = parse_note_blocks(&out);
    let paths: Vec<&str> = blocks.iter().map(|b| b.path.as_str()).collect();
    assert_eq!(paths, ["Mutua/ProyectoX/Plan.md", "Mutua/Salud/Dieta.md", "Mutua/Suelta.md", "Mutua/Otra.md"]);
    assert_eq!(out.matches("adjusted=\"true\"").count(), 2, "only rewritten blocks are flagged: {out}");
    assert!(blocks[2].mode == "append", "mode is preserved");
}

#[test]
fn enforce_area_is_a_noop_without_area_or_for_the_root() {
    let answer = block("Personal/A.md", "create", "# A");
    assert_eq!(enforce_area(&answer, None, &areas()), answer);
    assert_eq!(enforce_area(&answer, Some(""), &areas()), answer);
}

#[tokio::test]
async fn digesting_in_an_area_scopes_prompt_title_and_proposals() {
    let outside = block("Personal/Salud.md", "create", "# Salud\nx");
    let ans = outside.clone();
    let (res, run) = run_digest_in(move |_| reply(&ans), "contenido corto", 1000, Some("Mutua")).await;
    let res = res.unwrap();
    let body = &run.server.requests()[0].body;
    assert!(body.contains("Mutua/ProyectoX"));
    assert!(!body.contains("- Personal\\n"), "other areas' folders are not offered");
    let blocks = parse_note_blocks(&res.answer);
    assert_eq!(blocks[0].path, "Mutua/Salud.md");
    assert!(res.answer.contains("adjusted=\"true\""));

    let vault = run.vault.path().to_string_lossy().to_string();
    let db = ConversationsDb::open(run.db.path()).unwrap();
    assert_eq!(db.list_conversations(&vault).unwrap()[0].title, "Digerir: acta.txt · Mutua");
    let stored = db.get_messages(&res.conversation_id).unwrap();
    assert!(stored[1].content.contains("Mutua/Salud.md"), "the rewritten answer is what is stored");
}

#[tokio::test]
async fn large_sources_keep_the_area_restriction_in_every_turn() {
    let (res, run) = run_digest_in(
        |_| reply(&block("Personal/N.md", "create", "# N\ncuerpo")),
        &large_text(),
        80,
        Some("Mutua"),
    )
    .await;
    let res = res.unwrap();
    assert!(res.parts > 1);
    let reqs = run.server.requests();
    assert!(reqs.iter().all(|r| r.body.contains("«Mutua»")), "every part and the consolidation carry the area");
    assert!(parse_note_blocks(&res.answer).iter().all(|b| b.path.starts_with("Mutua/")));
}
