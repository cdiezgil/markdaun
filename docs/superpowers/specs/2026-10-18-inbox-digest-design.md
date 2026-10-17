# Inbox & Assisted Digestion — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Scope:** Sub-project A of "feeding the Second Brain". Sub-project B (capture channels: URL clipper, Word/PowerPoint extraction, quick capture, voice notes) is a later spec and plugs into the same inbox.
- **Depends on:** redesign slice 4 (Brain layout) and slice 3 (rename + wikilink rewrite), which this feature reuses. Implement after both are merged.

## 1. Goal

Give every piece of incoming information one landing place (`Entrada/`) and a manual, reviewable way to turn it into linked Markdown notes placed in the user's own structure, keeping the original as a cited source.

## 2. Decisions

| Decision | Choice |
|---|---|
| When to digest | **Manual** — *Digerir* per item or for a selection. |
| Output shape | **The model decides** per source: one note, or several atomic notes plus an index note. |
| Placement | **The model proposes a folder within the user's structure** (`Personal/`, `Mutua/<Proyecto>/…`); editable per card; may propose a new folder, clearly flagged *carpeta nueva*. |
| Work vs personal AI | **No enforcement.** The user controls which AI connection is active. |
| Writes | Nothing is written without a click (existing proposal cards). |

## 3. Inbox

- `Entrada/` at the vault root, created automatically when missing. Shown as the first sidebar entry with a counter ("Entrada · 4"), above the tree.
- Imports/drops without an explicit destination folder land in `Entrada/` (vault-root drops and the import action default to it; drops onto a specific folder keep current behaviour).
- **Inbox view** (opening `Entrada/`): list of items — name, type icon, size, date added — with per-item *Digerir* and *Descartar*, multi-select with *Digerir seleccionados*.
- *Descartar* moves the item to `.markdaun/papelera/` inside the vault (not indexed, not shown in the tree, not deleted). A *Papelera* entry in Settings lists and restores/permanently deletes items.
- Supported item types in A: `.md`, `.txt`, PDF, images (PNG/JPEG/GIF/WebP/SVG). Other types are listed with a "formato no soportado todavía" badge and only *Descartar*.

## 4. Digestion

- *Digerir* opens a **dedicated Brain conversation** titled "Digerir: <file name>" and sends one turn containing:
  - the source content: text for `.md`/`.txt`; PDF and images through the existing multimodal attachment path (vision required; otherwise the existing non-vision message);
  - the vault folder tree (folders only, depth-limited to 4, `Entrada/`, `Fuentes/` folders and `.markdaun/` excluded);
  - the vault note index (existing listing, cap 300);
  - the digestion instruction (§4.1).
- *Digerir seleccionados* runs the items sequentially, one conversation each.
- The answer is rendered with the existing `markdaun-note` proposal cards (create / append), with the folder part of the path editable and a *carpeta nueva* badge when the folder does not exist.

### 4.1 Digestion instruction (system prompt addition, Spanish)

The model must:
1. Decide the shape: one note for short/single-topic sources (minutes, short articles); several atomic notes (one idea/concept each) plus one index note that links them for long or multi-topic sources.
2. Place every note in an existing folder of the provided tree when one fits; propose a new folder only when none fits, preferring a new project folder under the matching area.
3. Link related existing notes with `[[wikilinks]]` using exact names from the index; never invent links to notes that do not exist (except between the notes it is proposing).
4. Prefer `mode="append"` to an existing note when the content clearly extends it.
5. End every proposed note with a `Fuente:` line linking the source at its **final** location (§5): `Fuente: [[<carpeta destino de la nota principal>/Fuentes/<archivo>]]`.
6. Write in the language of the source.

### 4.2 Large sources

- Text over ~100 000 characters (after extraction) is digested in parts: split on headings/paragraph boundaries into chunks ≤ 100 000 characters; each part produces candidate notes; a final consolidation turn receives the candidate titles + summaries and returns the final proposals (merging duplicates). PDFs over the attachment limits use their extracted text for this path.
- The UI shows progress "Parte 2/5" in the conversation.

## 5. Archiving the source

- *Archivar fuente* button in the digestion conversation, enabled once at least one card from that conversation was accepted.
- Moves the original from `Entrada/` to `<folder of the first accepted note>/Fuentes/<file>` (creating `Fuentes/`; collisions get " 2"). If the user edited folders so notes ended up in different places, the first accepted note's folder wins.
- Rewrites links pointing to the old location (reuses the slice 3 rename/rewrite service) and keeps the vector index in sync (existing fs hooks).
- Sources stay indexed and citable by the Brain.

## 6. Components and backend

| Piece | Responsibility |
|---|---|
| `src-tauri/src/commands/inbox.rs` (+ tests) | `inbox_ensure(vaultPath)`, `inbox_list(vaultPath)` (items with type/size/date/supported), `inbox_discard(path, vaultPath)`, `trash_list/restore/delete`, `archive_source(path, targetFolder, vaultPath)` (move + link rewrite). |
| `src-tauri/src/commands/brain_cmd.rs` | Digestion prompt builder (folder tree, index, instruction) and large-source chunking/consolidation driver. |
| `src/components/Inbox/InboxView.tsx` (+ tests) | Inbox list, selection, actions. |
| Sidebar | `Entrada · N` entry. |
| Brain | "Digerir" conversation kind, *Archivar fuente* button, part progress, *carpeta nueva* badge on cards. |
| Settings | *Papelera* section. |

## 7. Testing (strict TDD)

- Rust: `Entrada/` creation; listing (types, supported flag, sorting by date); discard → trash and restore; archive moves to `<folder>/Fuentes/`, handles collisions, rewrites links; folder tree for the prompt excludes `Entrada/`, `Fuentes/`, `.markdaun/` and respects depth; chunking boundaries and consolidation input.
- Frontend: inbox list and actions; sidebar counter; digest opens a dedicated conversation with the right attachments; *carpeta nueva* badge; *Archivar fuente* enabled only after an accepted card; part progress display.
- One manual smoke with the real Claude CLI engine on a short `.txt` source (proposals + archive), reported in the PR.

## 8. Out of scope (sub-project B or later)

- URL clipping, Word/PowerPoint/other document extraction, quick-capture shortcut, voice notes.
- Automatic digestion and review queues.
- Per-area AI connection rules.
