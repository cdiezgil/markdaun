//! Query scopes: which notes Second Brain answers from.

use crate::db::vectors::SearchResult;
use crate::db::QueryScope;
use std::path::{Component, Path, PathBuf};

/// Combined text of the scoped notes (in characters) up to which their full
/// text is the context instead of retrieved chunks.
pub const NOTES_FULL_TEXT_BUDGET: usize = 30_000;

/// Lexically normalises a vault-relative (or absolute-inside-the-vault) path
/// to a relative `/` path. Rejects `..`, other roots and empty paths.
fn relativize(vault: &Path, raw: &str) -> Result<String, String> {
    let p = Path::new(raw);
    let rel: PathBuf = if p.is_absolute() {
        p.strip_prefix(vault)
            .map_err(|_| format!("scope_error: path outside the vault: {raw}"))?
            .to_path_buf()
    } else {
        p.to_path_buf()
    };
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return Err(format!("scope_error: invalid path: {raw}")),
        }
    }
    if parts.is_empty() {
        return Err(format!("scope_error: empty path: {raw}"));
    }
    Ok(parts.join("/"))
}

/// Validates a scope against the vault and returns it with normalised
/// relative paths. Every note must be an existing file, a folder an existing
/// directory, all inside the vault.
pub fn validate_scope(vault: &Path, scope: &QueryScope) -> Result<QueryScope, String> {
    match scope {
        QueryScope::Vault => Ok(QueryScope::Vault),
        QueryScope::Notes { paths } => {
            if paths.is_empty() {
                return Err("scope_error: no notes selected".into());
            }
            let mut out = Vec::new();
            for raw in paths {
                let rel = relativize(vault, raw)?;
                if !vault.join(&rel).is_file() {
                    return Err(format!("scope_error: note not found: {rel}"));
                }
                if !out.contains(&rel) {
                    out.push(rel);
                }
            }
            Ok(QueryScope::Notes { paths: out })
        }
        QueryScope::Folder { path } => {
            let rel = relativize(vault, path)?;
            if !vault.join(&rel).is_dir() {
                return Err(format!("scope_error: folder not found: {rel}"));
            }
            Ok(QueryScope::Folder { path: rel })
        }
    }
}

/// How a validated scope turns into prompt context.
pub enum ScopeContext {
    /// Whole-vault retrieval.
    Retrieve,
    /// Retrieval restricted to file paths accepted by the predicate data.
    RetrieveIn(Vec<String>, Option<String>),
    /// Full text of the notes; no retrieval.
    FullText(Vec<SearchResult>),
}

/// Decides full text vs. restricted retrieval for a *validated* scope.
pub fn resolve_context(vault: &Path, scope: &QueryScope) -> Result<ScopeContext, String> {
    match scope {
        QueryScope::Vault => Ok(ScopeContext::Retrieve),
        QueryScope::Folder { path } => {
            let prefix = format!("{}/", vault.join(path).to_string_lossy());
            Ok(ScopeContext::RetrieveIn(Vec::new(), Some(prefix)))
        }
        QueryScope::Notes { paths } => {
            let mut notes = Vec::new();
            let mut total = 0usize;
            for rel in paths {
                let abs = vault.join(rel);
                let text = std::fs::read_to_string(&abs).map_err(|e| format!("scope_error: {rel}: {e}"))?;
                total += text.chars().count();
                notes.push((rel.clone(), abs, text));
            }
            if total <= NOTES_FULL_TEXT_BUDGET {
                Ok(ScopeContext::FullText(
                    notes
                        .into_iter()
                        .map(|(rel, abs, text)| SearchResult {
                            file_path: abs.to_string_lossy().to_string(),
                            content: format!("Nota: {rel}\n\n{text}"),
                            distance: 0.0,
                        })
                        .collect(),
                ))
            } else {
                let abs = notes.into_iter().map(|(_, a, _)| a.to_string_lossy().to_string()).collect();
                Ok(ScopeContext::RetrieveIn(abs, None))
            }
        }
    }
}
