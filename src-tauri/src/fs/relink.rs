//! Link maintenance after a note, file or folder is renamed or moved.
//!
//! Reusable by every operation that relocates vault content (rename, move and
//! the inbox's source archiving): move the entry on disk first, then call
//! [`relink_vault`] with the old and new locations.
//!
//! Rewritten forms, following how the app resolves links today:
//! - `[[Old]]` / `[[Old|alias]]`: matched by file stem, case-insensitively
//!   (skipped when another note shares the stem, as it is ambiguous).
//! - `[[folder/Old]]` / `[[folder/Old.md]]`: matched by vault-relative path.
//! - `[text](relative/Old.md)` and `![alt](relative/pic.png)`: resolved
//!   against the referencing file's folder, URL-encoded spaces included.
//!
//! Links inside code blocks and inline code are left alone, only `.md` files
//! are rewritten, and files whose content does not change are not written.
//! Relative links *inside* moved notes are re-based so they keep working.

use pulldown_cmark::{Event, Options, Parser, Tag};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// Rewrites links vault-wide after `old` was relocated to `new` (both inside
/// `vault`, `new` already on disk). Returns the `.md` files that were
/// rewritten, at their current location.
pub fn relink_vault(vault: &Path, old: &Path, new: &Path) -> Result<Vec<PathBuf>, String> {
    let moves = collect_moves(old, new);
    if moves.is_empty() {
        return Ok(vec![]);
    }
    let moved_to: HashMap<PathBuf, PathBuf> =
        moves.iter().map(|(o, n)| (normalize(o), normalize(n))).collect();
    let moved_from: HashMap<PathBuf, PathBuf> =
        moves.iter().map(|(o, n)| (normalize(n), normalize(o))).collect();

    let notes = list_notes(vault);
    let stem_counts = unmoved_stem_counts(&notes, &moved_from);

    let mut rewritten = Vec::new();
    for file in &notes {
        let new_loc = normalize(file);
        let old_loc = moved_from.get(&new_loc).cloned().unwrap_or_else(|| new_loc.clone());
        let Ok(content) = std::fs::read_to_string(file) else { continue };
        let ctx = Ctx {
            vault: &normalize(vault),
            moves: &moves,
            moved_to: &moved_to,
            stem_counts: &stem_counts,
            old_loc: &old_loc,
            new_loc: &new_loc,
        };
        let Some(updated) = rewrite_content(&content, &ctx) else { continue };
        std::fs::write(file, updated).map_err(|e| format!("io_error: {e}"))?;
        rewritten.push(file.clone());
    }
    Ok(rewritten)
}

/// Every file affected by the relocation as `(old, new)` pairs.
fn collect_moves(old: &Path, new: &Path) -> Vec<(PathBuf, PathBuf)> {
    if new.is_file() {
        return vec![(old.to_path_buf(), new.to_path_buf())];
    }
    WalkDir::new(new)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(new).ok()?;
            Some((old.join(rel), e.path().to_path_buf()))
        })
        .collect()
}

/// Absolute `.md` files of the vault, skipping hidden entries.
fn list_notes(vault: &Path) -> Vec<PathBuf> {
    WalkDir::new(vault)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_md(e.path()))
        .map(|e| e.into_path())
        .collect()
}

fn is_md(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

fn stem_lower(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// How many notes (not part of the relocation) carry each lower-cased stem.
fn unmoved_stem_counts(
    notes: &[PathBuf],
    moved_from: &HashMap<PathBuf, PathBuf>,
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for n in notes {
        if !moved_from.contains_key(&normalize(n)) {
            *counts.entry(stem_lower(n)).or_insert(0) += 1;
        }
    }
    counts
}

struct Ctx<'a> {
    vault: &'a Path,
    moves: &'a [(PathBuf, PathBuf)],
    moved_to: &'a HashMap<PathBuf, PathBuf>,
    stem_counts: &'a HashMap<String, usize>,
    old_loc: &'a Path,
    new_loc: &'a Path,
}

struct Edit {
    start: usize,
    end: usize,
    text: String,
}

/// Returns the new content, or `None` when nothing changes.
fn rewrite_content(content: &str, ctx: &Ctx) -> Option<String> {
    let (code, links) = scan_markdown(content);
    let mut edits = Vec::new();
    wikilink_edits(content, &code, ctx, &mut edits);
    for link in links {
        if let Some(e) = link_edit(content, link, ctx) {
            edits.push(e);
        }
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|e| std::cmp::Reverse(e.start));
    let mut out = content.to_string();
    for e in edits {
        out.replace_range(e.start..e.end, &e.text);
    }
    (out != content).then_some(out)
}

/// Byte ranges of code (blocks and inline) and of links/images.
fn scan_markdown(content: &str) -> (Vec<std::ops::Range<usize>>, Vec<std::ops::Range<usize>>) {
    let mut code = Vec::new();
    let mut links = Vec::new();
    for (event, range) in Parser::new_ext(content, Options::empty()).into_offset_iter() {
        match event {
            Event::Code(_) | Event::Start(Tag::CodeBlock(_)) => code.push(range),
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => links.push(range),
            _ => {}
        }
    }
    (code, links)
}

fn in_code(code: &[std::ops::Range<usize>], pos: usize) -> bool {
    code.iter().any(|r| r.contains(&pos))
}

// ── Wikilinks ────────────────────────────────────────────────────────────────

fn wikilink_edits(content: &str, code: &[std::ops::Range<usize>], ctx: &Ctx, out: &mut Vec<Edit>) {
    let bytes = content.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] != b'[' || bytes[i + 1] != b'[' || in_code(code, i) {
            i += 1;
            continue;
        }
        let body_start = i + 2;
        let Some(rel_end) = content[body_start..].find("]]") else { break };
        let body_end = body_start + rel_end;
        let body = &content[body_start..body_end];
        if body.contains(['[', ']', '\n']) {
            i += 1;
            continue;
        }
        let label_end = body_start + body.find('|').unwrap_or(body.len());
        let label = &content[body_start..label_end];
        if let Some(text) = new_wikilink_label(label, ctx) {
            out.push(Edit { start: body_start, end: label_end, text });
        }
        i = body_end + 2;
    }
}

/// The replacement label (whitespace preserved) when `label` points at a
/// relocated note whose reference text must change.
fn new_wikilink_label(label: &str, ctx: &Ctx) -> Option<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lead = &label[..label.len() - label.trim_start().len()];
    let trail = &label[label.trim_end().len()..];
    let replacement = if trimmed.contains('/') {
        path_form_label(trimmed, ctx)?
    } else {
        stem_form_label(trimmed, ctx)?
    };
    Some(format!("{lead}{replacement}{trail}"))
}

fn stem_form_label(label: &str, ctx: &Ctx) -> Option<String> {
    let wanted = label.to_lowercase();
    if ctx.stem_counts.get(&wanted).copied().unwrap_or(0) > 0 {
        return None; // ambiguous: another note owns this stem
    }
    for (old, new) in ctx.moves {
        if !is_md(old) || stem_lower(old) != wanted {
            continue;
        }
        let new_stem = new.file_stem()?.to_string_lossy().to_string();
        return (new_stem != label).then_some(new_stem);
    }
    None
}

fn path_form_label(label: &str, ctx: &Ctx) -> Option<String> {
    let (core, with_ext) = match label.strip_suffix(".md") {
        Some(c) => (c, true),
        None => (label, false),
    };
    let wanted = core.to_lowercase();
    for (old, new) in ctx.moves {
        if !is_md(old) {
            continue;
        }
        let old_rel = vault_rel_no_ext(ctx.vault, old)?;
        if old_rel.to_lowercase() != wanted {
            continue;
        }
        let mut new_rel = vault_rel_no_ext(ctx.vault, new)?;
        if with_ext {
            new_rel.push_str(".md");
        }
        return (new_rel != label).then_some(new_rel);
    }
    None
}

fn vault_rel_no_ext(vault: &Path, file: &Path) -> Option<String> {
    let rel = normalize(file).strip_prefix(vault).ok()?.with_extension("");
    Some(slash_join(&rel))
}

fn slash_join(p: &Path) -> String {
    p.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

// ── Markdown links and images ────────────────────────────────────────────────

/// Locates the destination of `[text](dest ...)` inside `range` and returns
/// its byte range plus whether it was written between angle brackets.
fn dest_span(content: &str, range: &std::ops::Range<usize>) -> Option<(usize, usize, bool)> {
    let bytes = content.as_bytes();
    let mut i = range.start;
    if bytes.get(i) == Some(&b'!') {
        i += 1;
    }
    if bytes.get(i) != Some(&b'[') {
        return None;
    }
    // Skip the (possibly nested) link text.
    let mut depth = 0usize;
    while i < range.end {
        match bytes[i] {
            b'\\' => i += 1,
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        i += 1;
    }
    if bytes.get(i + 1) != Some(&b'(') {
        return None; // reference-style or autolink
    }
    let mut j = i + 2;
    while j < range.end && bytes[j].is_ascii_whitespace() {
        j += 1;
    }
    if bytes.get(j) == Some(&b'<') {
        let end = content[j + 1..range.end].find('>')? + j + 1;
        return Some((j + 1, end, true));
    }
    let start = j;
    let mut parens = 0usize;
    while j < range.end {
        match bytes[j] {
            b'\\' => j += 1,
            b'(' => parens += 1,
            b')' if parens == 0 => break,
            b')' => parens -= 1,
            b if b.is_ascii_whitespace() => break,
            _ => {}
        }
        j += 1;
    }
    Some((start, j, false))
}

fn is_external(href: &str) -> bool {
    if href.is_empty() || href.starts_with('#') || href.starts_with('/') {
        return true;
    }
    let scheme_len = href
        .find(|c: char| !(c.is_ascii_alphanumeric() || "+.-".contains(c)))
        .unwrap_or(href.len());
    href[scheme_len..].starts_with(':') && scheme_len > 1
}

fn link_edit(content: &str, range: std::ops::Range<usize>, ctx: &Ctx) -> Option<Edit> {
    let (start, end, angled) = dest_span(content, &range)?;
    let raw = &content[start..end];
    if is_external(raw) {
        return None;
    }
    let split = raw.find(['#', '?']).unwrap_or(raw.len());
    let (path_part, suffix) = raw.split_at(split);
    let decoded = percent_decode(path_part);

    let old_dir = ctx.old_loc.parent()?;
    let new_dir = ctx.new_loc.parent()?;
    let target_old = normalize(&old_dir.join(&decoded));
    let target_new = ctx.moved_to.get(&target_old).cloned().unwrap_or_else(|| target_old.clone());

    let target_moved = target_new != target_old;
    let source_moved = ctx.old_loc != ctx.new_loc;
    if !target_moved && !(source_moved && target_new.exists()) {
        return None;
    }
    let rel_old = relative_path(old_dir, &target_old);
    let rel_new = relative_path(new_dir, &target_new);
    if rel_old == rel_new {
        return None;
    }
    let text = if angled { format!("{rel_new}{suffix}") } else { format!("{}{suffix}", percent_encode(&rel_new)) };
    Some(Edit { start, end, text })
}

/// `/`-separated path of `target` relative to the directory `from`.
fn relative_path(from: &Path, target: &Path) -> String {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = target.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(to[common..].iter().map(|c| c.as_os_str().to_string_lossy().to_string()));
    parts.join("/")
}

/// Lexical normalisation: drops `.` and resolves `..` without touching disk.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Decodes `%XX` escapes (e.g. `%20`) in a link destination.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if " %()<>#?\"\\[]".contains(c) {
            out.push_str(&format!("%{:02X}", c as u32));
        } else {
            out.push(c);
        }
    }
    out
}
