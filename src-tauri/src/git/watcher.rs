//! Watches the vault for file changes made outside the editor.
#![allow(dead_code)] // consumed by the sync wiring (task 6)

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// True for paths the sync must never react to.
pub fn is_ignored(rel: &Path) -> bool {
    if let Some(first) = rel.components().next() {
        let first = first.as_os_str();
        if first == ".git" || first == ".markdaun" {
            return true;
        }
    }
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    name == ".DS_Store"
        || name.ends_with('~')
        || name.ends_with(".swp")
        || name.ends_with(".tmp")
        || name.starts_with(".#")
}

/// Debounced recursive watcher; dropping it stops watching.
pub struct VaultWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl VaultWatcher {
    pub fn start(
        vault: PathBuf,
        on_change: impl Fn(Vec<PathBuf>) + Send + 'static,
    ) -> notify::Result<Self> {
        let canonical = vault.canonicalize().unwrap_or_else(|_| vault.clone());
        let watch_root = canonical.clone();
        let mut debouncer = new_debouncer(
            Duration::from_secs(1),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                let mut out: Vec<PathBuf> = Vec::new();
                let mut seen: HashSet<PathBuf> = HashSet::new();
                for event in events {
                    for path in &event.event.paths {
                        let rel = path
                            .strip_prefix(&canonical)
                            .or_else(|_| path.strip_prefix(&vault))
                            .ok()
                            .map(Path::to_path_buf);
                        let Some(rel) = rel else { continue };
                        if rel.as_os_str().is_empty() || is_ignored(&rel) || !seen.insert(rel.clone()) {
                            continue;
                        }
                        out.push(rel);
                    }
                }
                if !out.is_empty() {
                    on_change(out);
                }
            },
        )?;
        debouncer.watch(&watch_root, RecursiveMode::Recursive)?;
        Ok(Self { _debouncer: debouncer })
    }
}
