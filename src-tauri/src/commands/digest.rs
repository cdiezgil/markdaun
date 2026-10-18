//! Assisted digestion: turns one inbox source into proposed notes. The model
//! answers with the usual `markdaun-note` proposal blocks (nothing is written
//! until the user accepts a card). Sources too large for one turn are digested
//! in parts and consolidated afterwards.

use super::brain_cmd::{app_db_path, resolve_active, NOTE_BLOCK_INSTRUCTION};
use super::inbox::folder_tree;
use super::vault_index::{list_vault_notes, relative_note_path, vault_note_listing};
use crate::db::{ConversationsDb, QueryScope};
use crate::capture::office::{extract_office, is_office_name, ExtractedImage};
use crate::llm::attachment::{
    build_attachments, image_attachment, stored_references, Attachment, AttachmentInput, MAX_ATTACHMENTS,
};
use crate::llm::connection::Connection;
use crate::llm::engines;
use crate::llm::env::LlmEnv;
use crate::llm::error::LlmError;
use crate::llm::ChatMessage;
use std::path::Path;
use tauri::Emitter;

/// Largest text (in characters) digested in a single turn.
pub const DIGEST_CHUNK_CHARS: usize = 100_000;
/// Deepest folder level offered to the model as a destination.
const FOLDER_DEPTH: usize = 4;
/// Characters of each candidate shown to the consolidation turn.
const SUMMARY_CHARS: usize = 240;

pub const DIGEST_EVENT: &str = "digest-progress";

/// The digestion rules added to the system prompt (§4.1 of the design).
pub const DIGEST_INSTRUCTION: &str = "Tu tarea ahora es DIGERIR una fuente: convertirla en notas Markdown enlazadas, colocadas en la estructura de carpetas del usuario. Reglas:\n1. Decide la forma: una sola nota para fuentes cortas o de un único tema (actas, artículos breves); varias notas atómicas (una idea o concepto cada una) más una nota índice que las enlace para fuentes largas o multitema.\n2. Coloca cada nota en una carpeta existente del árbol proporcionado cuando alguna encaje. Propón una carpeta nueva solo si ninguna encaja, preferiblemente una carpeta de proyecto nueva bajo el área correspondiente.\n3. Enlaza notas existentes con [[wikilinks]] usando los nombres exactos del índice de notas. Nunca inventes enlaces a notas que no existan (salvo entre las notas que propones).\n4. Prefiere mode=\"append\" sobre una nota existente cuando el contenido la amplíe claramente.\n5. Termina cada nota propuesta con una línea `Fuente: [[<carpeta de destino de la nota principal>/Fuentes/<archivo fuente>]]` que enlace la fuente en su ubicación final (si la nota principal está en la raíz de la bóveda: `[[Fuentes/<archivo fuente>]]`).\n6. Escribe en el idioma de la fuente.\nResponde con los bloques markdaun-note y, como mucho, una breve frase introductoria.";

// ─── Splitting ────────────────────────────────────────────────────────────────

/// Splits `text` into chunks of at most `max` characters, preferring heading
/// and paragraph boundaries. Concatenating the chunks gives back the text.
pub fn split_source(text: &str, max: usize) -> Vec<String> {
    let max = max.max(1);
    if text.chars().count() <= max {
        return vec![text.to_string()];
    }
    // Blocks start at a heading or after a blank line.
    let mut blocks: Vec<String> = Vec::new();
    let mut prev_blank = true;
    for line in text.split_inclusive('\n') {
        let blank = line.trim().is_empty();
        let heading = line.starts_with('#');
        if blocks.is_empty() || heading || (prev_blank && !blank) {
            blocks.push(String::new());
        }
        blocks.last_mut().expect("just pushed").push_str(line);
        prev_blank = blank;
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0;
    let flush = |cur: &mut String, cur_len: &mut usize, chunks: &mut Vec<String>| {
        if !cur.is_empty() {
            chunks.push(std::mem::take(cur));
            *cur_len = 0;
        }
    };
    for block in blocks {
        let len = block.chars().count();
        if len > max {
            flush(&mut cur, &mut cur_len, &mut chunks);
            chunks.extend(hard_split(&block, max));
            continue;
        }
        let starts_section = block.starts_with('#');
        if cur_len + len > max || (starts_section && cur_len * 2 >= max) {
            flush(&mut cur, &mut cur_len, &mut chunks);
        }
        cur.push_str(&block);
        cur_len += len;
    }
    flush(&mut cur, &mut cur_len, &mut chunks);
    chunks
}

/// Splits an oversized block on line boundaries, then on characters.
fn hard_split(block: &str, max: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0;
    for line in block.split_inclusive('\n') {
        let len = line.chars().count();
        if len > max {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
                cur_len = 0;
            }
            let chars: Vec<char> = line.chars().collect();
            out.extend(chars.chunks(max).map(|c| c.iter().collect::<String>()));
            continue;
        }
        if cur_len + len > max {
            out.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
        cur.push_str(line);
        cur_len += len;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

// ─── Note blocks ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteBlock {
    pub path: String,
    pub mode: String,
    pub content: String,
}

fn attr(attrs: &str, name: &str) -> Option<String> {
    let key = format!("{name}=\"");
    let start = attrs.find(&key)? + key.len();
    let end = attrs[start..].find('"')?;
    Some(attrs[start..start + end].to_string())
}

/// The valid `markdaun-note` blocks of a model answer (same rules as the
/// frontend parser: `.md` path, mode create|append, default create).
pub fn parse_note_blocks(text: &str) -> Vec<NoteBlock> {
    const OPEN: &str = "```markdaun-note";
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find(OPEN) {
        let after = &rest[i + OPEN.len()..];
        let Some(nl) = after.find('\n') else { break };
        let attrs = &after[..nl];
        let body = &after[nl + 1..];
        let Some(end) = body.find("\n```") else { break };
        let content = &body[..end];
        rest = &body[end + 4..];
        let path = attr(attrs, "path");
        let mode = attr(attrs, "mode").unwrap_or_else(|| "create".to_string());
        if let Some(path) = path {
            if path.to_lowercase().ends_with(".md") && (mode == "create" || mode == "append") {
                out.push(NoteBlock { path, mode, content: content.to_string() });
            }
        }
    }
    out
}

pub fn render_note_block(b: &NoteBlock) -> String {
    format!("```markdaun-note path=\"{}\" mode=\"{}\"\n{}\n```", b.path, b.mode, b.content)
}

fn title_of(b: &NoteBlock) -> String {
    b.content
        .lines()
        .find_map(|l| l.strip_prefix("# "))
        .map(|t| t.trim().to_string())
        .unwrap_or_else(|| {
            Path::new(&b.path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        })
}

fn summary_of(b: &NoteBlock) -> String {
    let body: String = b
        .content
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#') && !l.starts_with("Fuente:"))
        .collect::<Vec<_>>()
        .join(" ");
    body.chars().take(SUMMARY_CHARS).collect()
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

fn folder_listing(folders: &[String]) -> String {
    if folders.is_empty() {
        return "Carpetas de la bóveda: ninguna todavía (la raíz es el único destino existente).".to_string();
    }
    let mut out = String::from("Carpetas de la bóveda (puedes proponer una carpeta nueva solo si ninguna encaja):");
    for f in folders {
        out.push_str("\n- ");
        out.push_str(f);
    }
    out
}

fn system_prompt(source_name: &str, extra: &str, folders: &[String], vault_notes: &[String]) -> String {
    format!(
        "Eres un asistente de conocimiento personal que organiza el material entrante del usuario.\n\n{NOTE_BLOCK_INSTRUCTION}\n\n{DIGEST_INSTRUCTION}{extra}\n\nArchivo fuente: «{source_name}».\n\n{}\n\n{}",
        folder_listing(folders),
        vault_note_listing(vault_notes),
    )
}

/// Digestion turn. `text` is the source content (None when it travels as an
/// attachment); `part` is `(n, total)` for one chunk of a large source.
pub fn build_digest_messages(
    source_name: &str,
    text: Option<&str>,
    part: Option<(usize, usize)>,
    folders: &[String],
    vault_notes: &[String],
) -> Vec<ChatMessage> {
    let extra = if part.is_some() {
        "\n\nLa fuente es muy larga y se digiere por partes: en este turno solo recibes una parte. Propón las notas CANDIDATAS que salgan de esta parte (un turno posterior las consolidará); no repitas contenido de otras partes."
    } else {
        ""
    };
    let user = match (text, part) {
        (Some(t), Some((n, total))) => {
            format!("PARTE {n} DE {total} de la fuente «{source_name}»:\n\n{t}")
        }
        (Some(t), None) => format!("Digiere esta fuente («{source_name}»):\n\n{t}"),
        (None, _) => format!("Digiere el archivo adjunto «{source_name}»."),
    };
    vec![
        ChatMessage::text("system", system_prompt(source_name, extra, folders, vault_notes)),
        ChatMessage::text("user", user),
    ]
}

/// Consolidation turn: candidate titles and summaries in, merge/discard plan
/// (and optionally an index note) out.
pub fn build_consolidation_messages(
    source_name: &str,
    candidates: &[NoteBlock],
    folders: &[String],
    vault_notes: &[String],
) -> Vec<ChatMessage> {
    let extra = "\n\nEstás en el turno de CONSOLIDACION de una fuente digerida por partes.";
    let mut user = format!(
        "CONSOLIDACION de «{source_name}». Estas son las {} notas candidatas generadas parte a parte:\n",
        candidates.len()
    );
    for (i, c) in candidates.iter().enumerate() {
        user.push_str(&format!(
            "\n[{}] ruta: {} · modo: {} · título: {} · resumen: {}",
            i + 1,
            c.path,
            c.mode,
            title_of(c),
            summary_of(c)
        ));
    }
    user.push_str(
        "\n\nResponde SOLO con líneas de estas formas (una por línea):\nFUSIONAR: 2, 5 => Carpeta/nueva.md   (une candidatas duplicadas o solapadas en una sola nota)\nDESCARTAR: 3   (candidata redundante)\nLas candidatas que no menciones se conservan tal cual. Si la fuente es larga o multitema, añade además UNA nota índice que enlace las demás con [[wikilinks]] a sus rutas finales, como bloque markdaun-note con mode=\"create\", terminada con la línea Fuente:.",
    );
    vec![
        ChatMessage::text("system", system_prompt(source_name, extra, folders, vault_notes)),
        ChatMessage::text("user", user),
    ]
}

// ─── Consolidation plan ───────────────────────────────────────────────────────

fn parse_ids(list: &str, max: usize) -> Vec<usize> {
    list.split(',')
        .filter_map(|t| t.trim().trim_start_matches('[').trim_end_matches(']').parse::<usize>().ok())
        .filter(|n| (1..=max).contains(n))
        .collect()
}

/// Splits a trailing `Fuente:` line off a note body.
fn split_fuente(content: &str) -> (String, Option<String>) {
    let trimmed = content.trim_end();
    match trimmed.rsplit_once('\n') {
        Some((body, last)) if last.trim_start().starts_with("Fuente:") => {
            (body.trim_end().to_string(), Some(last.trim().to_string()))
        }
        None if trimmed.trim_start().starts_with("Fuente:") => (String::new(), Some(trimmed.trim().to_string())),
        _ => (trimmed.to_string(), None),
    }
}

fn demote_h1(body: &str) -> String {
    body.lines()
        .map(|l| if l.starts_with("# ") { format!("#{l}") } else { l.to_string() })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Applies the model's merge/discard plan to the candidates. Candidates it
/// does not mention are kept; blocks it writes itself (an index note) are
/// appended. Unusable plans therefore degrade to "keep everything".
pub fn apply_consolidation_plan(candidates: &[NoteBlock], response: &str) -> Vec<NoteBlock> {
    let n = candidates.len();
    // Candidates already merged or discarded (the rest are kept).
    let mut taken = vec![false; n];
    let mut merges: Vec<(Vec<usize>, String)> = Vec::new();

    for line in response.lines() {
        let l = line.trim();
        let upper = l.to_uppercase();
        if upper.starts_with("FUSIONAR:") {
            let rest = &l["FUSIONAR:".len()..];
            let Some((ids, path)) = rest.split_once("=>") else { continue };
            let ids: Vec<usize> = parse_ids(ids, n).into_iter().filter(|i| !taken[i - 1]).collect();
            if ids.len() < 2 {
                continue;
            }
            for i in &ids {
                taken[i - 1] = true;
            }
            merges.push((ids, path.trim().trim_matches('`').to_string()));
        } else if upper.starts_with("DESCARTAR:") {
            for i in parse_ids(&l["DESCARTAR:".len()..], n) {
                if !taken[i - 1] {
                    taken[i - 1] = true;
                }
            }
        }
    }

    let mut out: Vec<NoteBlock> = Vec::new();
    for (idx, cand) in candidates.iter().enumerate() {
        let id = idx + 1;
        if let Some((ids, path)) = merges.iter().find(|(ids, _)| ids[0] == id) {
            out.push(merge(candidates, ids, path));
        } else if !taken[idx] {
            out.push(cand.clone());
        }
    }
    out.extend(parse_note_blocks(response));
    out
}

fn merge(candidates: &[NoteBlock], ids: &[usize], path: &str) -> NoteBlock {
    let first = &candidates[ids[0] - 1];
    let (mut body, mut fuente) = split_fuente(&first.content);
    for i in &ids[1..] {
        let (b, f) = split_fuente(&candidates[i - 1].content);
        if !b.is_empty() {
            body.push_str("\n\n");
            body.push_str(&demote_h1(&b));
        }
        fuente = fuente.or(f);
    }
    if let Some(f) = fuente {
        body.push_str("\n\n");
        body.push_str(&f);
    }
    let path = if path.to_lowercase().ends_with(".md") { path.to_string() } else { first.path.clone() };
    NoteBlock { path, mode: first.mode.clone(), content: body }
}

// ─── Driver ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DigestProgress {
    /// Vault-relative source, so the UI can tell which digestion this is.
    pub source: String,
    pub part: usize,
    pub total: usize,
    /// The final consolidation turn is running (after the last part).
    pub consolidating: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct DigestResult {
    pub answer: String,
    pub conversation_id: String,
    pub message_id: String,
    pub parts: usize,
}

pub struct DigestRequest<'a> {
    pub vault_path: &'a str,
    /// Vault-relative path of the source.
    pub source_rel: &'a str,
    /// Extracted text; `None` when the source travels as attachments.
    pub text: Option<&'a str>,
    pub attachments: &'a [AttachmentInput],
    /// Images extracted from a Word/PowerPoint source. Attached to the first
    /// turn when the model sees images (largest first, within the attachment
    /// limit); otherwise the prompt only mentions them.
    pub images: &'a [ExtractedImage],
    pub chunk_chars: usize,
}

/// Picks the extracted images to attach and the note for the prompt about the
/// ones left out. Selected images keep their document order.
fn office_images(images: &[ExtractedImage], slots: usize, vision: bool, source_rel: &str) -> (Vec<Attachment>, Option<String>) {
    if images.is_empty() {
        return (Vec::new(), None);
    }
    let n = images.len();
    if !vision {
        return (
            Vec::new(),
            Some(format!("(El documento contiene {n} imágenes que no se enviaron porque el modelo activo no admite imágenes.)")),
        );
    }
    let mut by_size: Vec<usize> = (0..n).collect();
    by_size.sort_by(|a, b| images[*b].bytes.len().cmp(&images[*a].bytes.len()).then(a.cmp(b)));
    let mut chosen: Vec<usize> = by_size.into_iter().take(slots).collect();
    chosen.sort_unstable();
    let atts: Vec<Attachment> = chosen
        .iter()
        .filter_map(|i| image_attachment(&images[*i].name, source_rel, &images[*i].bytes).ok())
        .collect();
    let left_out = n - atts.len();
    let note = (left_out > 0).then(|| {
        format!("(El documento contiene {left_out} imágenes más que no se adjuntaron por el límite de {MAX_ATTACHMENTS} adjuntos.)")
    });
    (atts, note)
}

/// Text and images of a Word/PowerPoint source in the vault.
pub fn office_source(vault: &Path, rel: &str) -> Result<(String, Vec<ExtractedImage>), String> {
    let name = Path::new(rel).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let bytes = std::fs::read(vault.join(rel)).map_err(|e| format!("io_error: {e}"))?;
    let out = extract_office(&name, &bytes).map_err(|e| format!("office_error: {e}"))?;
    if out.markdown.trim().is_empty() && out.images.is_empty() {
        return Err("office_error: empty_document".to_string());
    }
    Ok((out.markdown, out.images))
}

fn llm_err(e: LlmError) -> String {
    match e {
        LlmError::VisionUnsupported => "vision_unsupported".to_string(),
        other => format!("llm_error: {other}"),
    }
}

/// Runs one digestion and stores it as a dedicated conversation. Nothing is
/// persisted when a turn fails.
pub async fn digest_core(
    db_path: &Path,
    req: &DigestRequest<'_>,
    conn: &Connection,
    model: &str,
    secret: Option<&str>,
    env: &LlmEnv,
    progress: &(dyn Fn(DigestProgress) + Sync),
) -> Result<DigestResult, String> {
    let vault = Path::new(req.vault_path);
    let attachments = build_attachments(vault, req.attachments).map_err(|e| format!("attachment_error: {e}"))?;
    if !attachments.is_empty() && !conn.supports_vision(model) {
        return Err("vision_unsupported".to_string());
    }
    let name = Path::new(req.source_rel)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| req.source_rel.to_string());
    let folders = folder_tree(vault, FOLDER_DEPTH);
    let vault_notes: Vec<String> = list_vault_notes(vault)
        .iter()
        .map(|f| relative_note_path(vault, f))
        .filter(|p| !p.starts_with("Entrada/"))
        .collect();

    let (image_atts, image_note) = office_images(
        req.images,
        MAX_ATTACHMENTS.saturating_sub(attachments.len()),
        conn.supports_vision(model),
        req.source_rel,
    );
    let text_with_note = req.text.map(|t| match &image_note {
        Some(n) => format!("{t}\n\n{n}"),
        None => t.to_string(),
    });
    let mut attachments = attachments;
    attachments.extend(image_atts);

    let chunks = match text_with_note.as_deref() {
        Some(t) => split_source(t, req.chunk_chars),
        None => Vec::new(),
    };
    let total = chunks.len().max(1);

    let answer = if total == 1 {
        let mut messages = build_digest_messages(&name, chunks.first().map(String::as_str), None, &folders, &vault_notes);
        if let Some(last) = messages.last_mut() {
            last.attachments = attachments.clone();
        }
        engines::chat(conn, model, &messages, secret, env).await.map_err(llm_err)?
    } else {
        let mut candidates: Vec<NoteBlock> = Vec::new();
        let mut raw: Vec<String> = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            progress(DigestProgress { source: req.source_rel.to_string(), part: i + 1, total, consolidating: false });
            let mut messages = build_digest_messages(&name, Some(chunk), Some((i + 1, total)), &folders, &vault_notes);
            if i == 0 {
                if let Some(last) = messages.last_mut() {
                    last.attachments = attachments.clone();
                }
            }
            let reply = engines::chat(conn, model, &messages, secret, env).await.map_err(llm_err)?;
            candidates.extend(parse_note_blocks(&reply));
            raw.push(reply);
        }
        if candidates.is_empty() {
            raw.join("\n\n")
        } else {
            progress(DigestProgress { source: req.source_rel.to_string(), part: total, total, consolidating: true });
            let messages = build_consolidation_messages(&name, &candidates, &folders, &vault_notes);
            let finals = match engines::chat(conn, model, &messages, secret, env).await {
                Ok(plan) => apply_consolidation_plan(&candidates, &plan),
                // Consolidation is an optimisation: keep every candidate.
                Err(_) => candidates,
            };
            let body = finals.iter().map(render_note_block).collect::<Vec<_>>().join("\n\n");
            format!("He digerido «{name}» en {total} partes. Estas son las notas que propongo:\n\n{body}")
        }
    };

    let db = ConversationsDb::open(db_path).map_err(|e| format!("db_error: {e}"))?;
    let conv_id = db
        .create_digest_conversation(req.vault_path, &format!("Digerir: {name}"), req.source_rel)
        .map_err(|e| format!("db_error: {e}"))?;
    db.set_scope(&conv_id, &QueryScope::Vault).map_err(|e| format!("db_error: {e}"))?;
    let mut stored = format!("Digerir «{name}»");
    if total > 1 {
        stored.push_str(&format!(" ({total} partes)"));
    }
    if !attachments.is_empty() {
        let names: Vec<String> = attachments.iter().map(|a| a.name.clone()).collect();
        stored.push_str(&format!("\n\n{}", stored_references(&names)));
    }
    db.add_message(&conv_id, "user", &stored, None).map_err(|e| format!("db_error: {e}"))?;
    let message_id = db
        .add_message(&conv_id, "assistant", &answer, None)
        .map_err(|e| format!("db_error: {e}"))?;
    Ok(DigestResult { answer, conversation_id: conv_id, message_id, parts: total })
}

// ─── Tauri command ────────────────────────────────────────────────────────────

fn is_text_source(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".txt")
}

/// Digests one inbox source with the active connection. `.md`/`.txt` are read
/// here; for PDFs the frontend may pass its extracted text (`source_text`)
/// when the file exceeds the attachment limits; otherwise PDFs and images go
/// through `attachments`. Emits `digest-progress` for multi-part sources.
#[tauri::command]
pub async fn brain_digest(
    app: tauri::AppHandle,
    env: tauri::State<'_, LlmEnv>,
    source_path: String,
    vault_path: String,
    attachments: Option<Vec<AttachmentInput>>,
    source_text: Option<String>,
) -> Result<DigestResult, String> {
    let db_path = app_db_path(&app)?;
    let (conn, model, secret) = resolve_active(&db_path, &env)?;
    let vault = Path::new(&vault_path);
    let rel = Path::new(&source_path);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("invalid_path".to_string());
    }
    let mut images: Vec<ExtractedImage> = Vec::new();
    let text = match source_text {
        Some(t) => Some(t),
        None if is_text_source(&source_path) => {
            Some(std::fs::read_to_string(vault.join(rel)).map_err(|e| format!("io_error: {e}"))?)
        }
        None if is_office_name(&source_path) => {
            let (markdown, imgs) = office_source(vault, &source_path)?;
            images = imgs;
            Some(markdown)
        }
        None => None,
    };
    let inputs = if text.is_some() { Vec::new() } else { attachments.unwrap_or_else(|| {
        vec![AttachmentInput { vault_path: source_path.clone(), derived: None }]
    }) };
    let req = DigestRequest {
        vault_path: &vault_path,
        source_rel: &source_path,
        text: text.as_deref(),
        attachments: &inputs,
        images: &images,
        chunk_chars: DIGEST_CHUNK_CHARS,
    };
    let emitter = app.clone();
    digest_core(&db_path, &req, &conn, &model, secret.as_deref(), &env, &move |p| {
        let _ = emitter.emit(DIGEST_EVENT, p);
    })
    .await
}
