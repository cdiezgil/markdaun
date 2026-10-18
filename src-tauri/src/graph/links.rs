use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use crate::fs::relink::percent_decode;
use std::path::{Path, PathBuf};

/// Extract outgoing links from a Markdown file.
///
/// Returns a list of (source, target) absolute paths.
/// - Only processes `.md` files; returns `vec![]` for any other extension.
/// - Scans for `[[wikilink]]` patterns (case-insensitive, matched against stem).
/// - Parses Markdown links `[text](rel_path)` with `pulldown-cmark`.
/// - Absolute URLs (`http://`, `https://`) are ignored.
/// - Links that cannot be resolved in `all_files` are ignored.
pub fn extract_links(
    file_path: &Path,
    _vault_root: &Path,
    all_files: &[PathBuf],
) -> Vec<(PathBuf, PathBuf)> {
    // Only process .md files
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "md" {
        return vec![];
    }

    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let abs_source = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return vec![],
    };

    let mut results: Vec<(PathBuf, PathBuf)> = Vec::new();

    // ── 1. [[Wikilink]] extraction ────────────────────────────────────────────
    let wikilink_re = extract_wikilinks(&content);
    for label in wikilink_re {
        if let Some(target) = resolve_wikilink(&label, all_files) {
            results.push((abs_source.clone(), target));
        }
    }

    // ── 2. Markdown [text](url) extraction via pulldown-cmark ─────────────────
    let md_links = extract_md_links(&content);
    for href in md_links {
        // Skip absolute URLs
        if href.starts_with("http://") || href.starts_with("https://") {
            continue;
        }
        if let Some(parent) = file_path.parent() {
            let candidate = parent.join(percent_decode(&href));
            if let Ok(canonical) = candidate.canonicalize() {
                if all_files.iter().any(|f| {
                    f.canonicalize()
                        .map(|c| c == canonical)
                        .unwrap_or(false)
                }) {
                    results.push((abs_source.clone(), canonical));
                }
            }
        }
    }

    // Deduplicate
    results.sort();
    results.dedup();
    results
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract `[[label]]` patterns from raw text.
fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut labels = Vec::new();
    let mut chars = content.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '[' {
            if let Some(&(_, '[')) = chars.peek() {
                chars.next(); // consume second '['
                let start = i + 2;
                let mut end = start;
                let mut inner = String::new();
                let mut closed = false;
                for (j, ch) in content[start..].char_indices() {
                    if ch == ']' && content[start + j..].starts_with("]]") {
                        end = start + j;
                        closed = true;
                        break;
                    }
                    inner.push(ch);
                    let _ = end;
                }
                if closed && !inner.is_empty() {
                    labels.push(inner.trim().to_string());
                    // Advance iterator past the closing ]]
                    let skip_to = end + 2;
                    while let Some(&(k, _)) = chars.peek() {
                        if k >= skip_to {
                            break;
                        }
                        chars.next();
                    }
                }
            }
        }
    }
    labels
}

/// Resolve a `[[wikilink]]` label to an absolute path.
/// Case-insensitive match against the stem of `.md` files.
fn resolve_wikilink(label: &str, all_files: &[PathBuf]) -> Option<PathBuf> {
    let label_lower = label.to_lowercase();
    for file in all_files {
        if file
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref()
            != Some("md")
        {
            continue;
        }
        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if stem == label_lower {
            return file.canonicalize().ok();
        }
    }
    None
}

/// Extract href targets from Markdown `[text](href)` links.
fn extract_md_links(content: &str) -> Vec<String> {
    let mut hrefs = Vec::new();
    let parser = Parser::new(content);
    let mut in_link = false;

    for event in parser {
        match event {
            Event::Start(Tag::Link { dest_url, .. }) => {
                hrefs.push(dest_url.to_string());
                in_link = true;
            }
            Event::End(TagEnd::Link) => {
                in_link = false;
            }
            _ => {
                let _ = in_link;
            }
        }
    }
    hrefs
}
