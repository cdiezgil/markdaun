use crate::db::NodePositionsDb;
use crate::fs::walk_vault;
use crate::fs::tree::{EntryKind, FileKind};
use crate::graph::extract_links;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;
use walkdir::WalkDir;

// ── Public data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub path: String,
    pub name: String,
    /// "md" | "image" | "pdf" | "other"
    pub kind: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("config.db"))
}

/// Recursively collect all files (not directories) under `root`.
fn collect_all_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| format!("io_error: {e}"))?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

fn kind_str(kind: &FileKind) -> &'static str {
    match kind {
        FileKind::Md => "md",
        FileKind::Image => "image",
        FileKind::Pdf => "pdf",
        FileKind::Other => "other",
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// TC-07, TC-08, TC-09, TC-11, TC-12, TC-13
/// Build the full vault graph: nodes (all files) + edges (wikilinks + md links).
/// Loads persisted positions from config.db.
#[tauri::command]
pub async fn get_vault_graph(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<VaultGraph, String> {
    let vault = Path::new(&vault_path);
    if !vault.exists() || !vault.is_dir() {
        return Err("vault_not_found".to_string());
    }

    // 1. Collect all files for link resolution
    let all_files = collect_all_files(vault)?;

    // 2. Walk vault tree to get structured entries
    let tree = walk_vault(vault).map_err(|e| format!("io_error: {e}"))?;

    // 3. Build nodes (flatten tree)
    let mut nodes: Vec<GraphNode> = Vec::new();
    flatten_tree(&tree, &mut nodes);

    // 4. Extract edges
    let mut edge_set: std::collections::HashSet<GraphEdge> = std::collections::HashSet::new();
    for file in &all_files {
        let links = extract_links(file, vault, &all_files);
        for (src, tgt) in links {
            edge_set.insert(GraphEdge {
                source: src.to_string_lossy().to_string(),
                target: tgt.to_string_lossy().to_string(),
            });
        }
    }

    // 5. Load persisted positions
    let db_path = app_db_path(&app)?;
    let positions = NodePositionsDb::open(&db_path)
        .map_err(|e| format!("db_error: {e}"))?
        .get_all_positions(&vault_path)
        .map_err(|e| format!("db_error: {e}"))?;

    // 6. Attach positions to nodes
    for node in &mut nodes {
        if let Some(&(x, y)) = positions.get(&node.path) {
            node.x = Some(x);
            node.y = Some(y);
        }
    }

    let edges: Vec<GraphEdge> = edge_set.into_iter().collect();
    Ok(VaultGraph { nodes, edges })
}

/// TC-11: Persist a node position for a given vault + file.
#[tauri::command]
pub async fn save_node_position(
    app: tauri::AppHandle,
    vault_path: String,
    file_path: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let db_path = app_db_path(&app)?;
    NodePositionsDb::open(&db_path)
        .map_err(|e| format!("db_error: {e}"))?
        .set_position(&vault_path, &file_path, x, y)
        .map_err(|e| format!("db_error: {e}"))
}

// ── Tree flattening helper ────────────────────────────────────────────────────

fn flatten_tree(entries: &[crate::fs::tree::VaultEntry], out: &mut Vec<GraphNode>) {
    for entry in entries {
        match entry.kind {
            EntryKind::File => {
                let kind = entry
                    .file_type
                    .as_ref()
                    .map(kind_str)
                    .unwrap_or("other")
                    .to_string();
                out.push(GraphNode {
                    path: entry.path.clone(),
                    name: entry.name.clone(),
                    kind,
                    x: None,
                    y: None,
                });
            }
            EntryKind::Folder => {
                if let Some(children) = &entry.children {
                    flatten_tree(children, out);
                }
            }
        }
    }
}
