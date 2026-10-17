# UI Redesign — Master Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Visual source of truth:** `design/` (README, tokens) — unchanged — plus the reference mockups in `design/mockups/` (`editor.html`, `brain.html`, `grafo.html`) and the designer's task list `design/mockups/INSTRUCCIONES-AGENTE.md`. This spec adopts that task list in full and adds the functional decisions below. Where they conflict, this spec wins.
- **Delivery:** 6 slices, one PR each, merged in order. Every slice must keep existing functionality working.

## 0. Cross-cutting rules (all slices)

- Everything in `INSTRUCCIONES-AGENTE.md` § "Reglas globales": `tokens.css` imported once at the root, CSS variables only, Google Fonts link from `design/README.md`, `body` in `--font-sans`, Instrument Serif only for document H1, note-card titles and logotype (weight 400), weights 400/500/600, Lucide stroke 1.5 at 16–18 px in `--ink-muted` (`--daun` only when active), green only for active/link/primary action, panels separated by `1px solid var(--line)`, `--shadow-pop` only on floating elements, no outer window frame, 8 px scrollbars, dark theme parity.
- **Guard test:** a Vitest test scans `src/**/*.{ts,tsx,css}` (excluding tests and `design/`) and fails on literal hex colours, `rgb(`/`rgba(` literals, `font-family` values other than token variables, and `border-radius` px literals. Existing violations are fixed in slice 1.
- Contrast ≥ 4.5:1 for text in both themes (checked against token pairs in a unit test using the token values).
- UI copy in Spanish; code in English.
- Kept beyond the mockups because the user asked for them: **bytes** in the editor status bar and the **📎 attachments** button in the Brain composer.

## Slice 1 — Base & shell

- Global CSS, fonts, scrollbars, full-viewport layout, removal of serif/system fonts in UI.
- **Top bar** (48 px, `--surface-sunken`, bottom `--line`): mark + logotype "Mark*Daun*" (Instrument Serif 19 px, "Daun" italic); segmented tabs *Notas / Grafo / Brain* mapped to the existing routes (active: `--bg` background, inner `--line` border, icon `--daun`); right: 280 px field "Buscar o ejecutar… ⌘K" (visual only in this slice; wired in slice 6).
- **Sidebar** (264 px, `--surface-sunken`): header "BÓVEDA" (12 px, 500, uppercase, tracking 0.04em, `--ink-muted`) + icon buttons *Nueva nota* / *Nueva carpeta*; tree in Geist 14 px, 32 px rows, `--radius-md`, `.md` extension hidden, active note `--bg` + `--daun` text/icon + 500; footer "N notas · N carpetas" + Ajustes button with top border. Existing drag & drop, rename, context actions keep working. In Brain view the sidebar content is replaced in slice 4.
- **Status bar** (30 px, `--surface-sunken`, 12 px `--ink-muted`), contextual by view:
  - Editor: 6 px green dot + "Guardado"/"Sin guardar", sync state; right: path, palabras, bytes, líneas, tiempo de lectura, AI selector.
  - Grafo: "N notas · N enlaces · N huérfanas" + AI selector.
  - Brain: sync state + AI selector.

## Slice 2 — Editor (after the Mermaid PR merges)

- As specified in `INSTRUCCIONES-AGENTE.md` § Editor: toolbar aligned to the text column (`max-width: var(--measure)`, centred), 32 px ghost buttons, 1 px separators between groups (títulos | estilo | bloques | inserción, plus the Mermaid *Diagrama* button in inserción), only the active format in green; document column centred with `padding-top: var(--space-12)`; caption above the title "Carpeta / Nota · editado hace N min"; H1 `reading-h1`, H2/H3 Geist 600; body `editor` style; code blocks, quotes, wikilinks (existing/broken), tags and highlights per the design system. Mermaid blocks keep their node view.
- **"Enlazada desde"**: at the end of the note, a section with a pill counter and backlink chips (notes linking to this one via `[[wikilink]]`; data from the existing Rust graph engine — add a `get_backlinks(path, vaultPath)` command if the graph API doesn't expose it). Clicking a chip opens that note. Hidden when there are no backlinks. (The mockup's "Conversación · …" chip is out of scope: conversations are not backlinks.)

## Slice 3 — Note names from the H1

- *Nueva nota* creates `Sin título.md` (or `Sin título 2.md`…) in the selected folder without asking, opens it with the cursor in an empty H1.
- While the note is still *following its H1*, the file is renamed to the H1 text when the H1 loses focus or after 1 s without typing in it. Invalid filename characters (`/ \ : * ? " < > |` and control chars) are replaced by `-`; leading/trailing spaces and dots trimmed; empty H1 keeps the current name. Collisions get " 2", " 3"…
- Renames rewrite `[[Old name]]` and `[[Old name|alias]]` wikilinks across the vault (shared with manual rename — manual rename gains the same rewrite) and keep the vector index in sync (existing fs_ops hooks).
- A manual rename (tree or dialog) stops the H1 following for that note (persisted per note in `config.db`).
- The mandatory-name prompt from #15 is removed for notes (folders still ask for a name).

## Slice 4 — Brain

- As specified in `INSTRUCCIONES-AGENTE.md` § Brain: the middle conversations column is removed; in Brain view the sidebar shows the primary "Nueva conversación" button, a search field and conversations grouped by day (title 14 px + time 12 px); thread centred, `max-width: 720px`, 28 px gap; user messages right-aligned `--daun`/`--on-daun` bubbles (16 px radius, bottom-right 6 px, max 70 %); assistant answers without bubble, "Brain" label with leaf icon, **Markdown rendered** with reading styles (no raw `**`, `>`, fences); quoted note content in `--surface` cards; under each answer "Fuentes" chips + ghost "Guardar como nota"; existing `markdaun-note` proposal cards, warnings, failed-message state and attachments keep working inside the new layout.
- **Markdown rendering:** render assistant Markdown with the same TipTap schema in read-only mode (reuses wikilink/tag/highlight/mermaid extensions; no new Markdown library). Wikilinks are clickable and open the note.
- **Floating composer:** `--surface`, `--line`, `--radius-lg`, `--shadow-pop`, 720 px centred, 24 px bottom margin, borderless textarea, bottom row with the context chip, 📎 button, and the 36 px circular `--daun` send button with an up arrow; caption "Brain responde a partir de tus notas y cita siempre sus fuentes."
- **Context chip "@"** opens a menu: *Toda la bóveda* (default), *Esta nota* (note open in the editor; disabled if none), *Carpeta…* (folder picker), *Notas…* (multi-select with search). The chip shows the current scope ("@ Esta nota: Primera nota"). Scope is stored per conversation and persists until changed.
  - Backend: `brain_query` gains `scope: { kind: 'vault' } | { kind: 'notes', paths } | { kind: 'folder', path }` ("Esta nota" is `notes` with one path).
  - `notes` whose combined text ≤ 30 000 characters: full text of those notes is the context (no retrieval).
  - `notes` above the budget or `folder`: vector retrieval restricted to those paths/prefix (top-k 5).
  - The vault note listing in the system prompt stays.

## Slice 5 — Graph

- As specified in `INSTRUCCIONES-AGENTE.md` § Grafo: dotted-grid background, circular `--daun` nodes sized 12–28 px by backlink count, labels below, open-note ring (5 px `--sap`, 600 13 px label), orphans hollow `--amber`, edges `--line-strong` 45 % / open-note edges `--daun` 1.5 px, subtle folder halos with uppercase labels (no grey "root" container), **d3-force** layout with collision avoidance (add `d3-force`), floating filter panel (search + chips), selected-note card (300 px: path, Instrument Serif 28 px title, mono excerpt, link/backlink counters, *Abrir nota* primary, *Preguntar* secondary), single zoom capsule (− / % / + / Ajustar) replacing React Flow controls, legend + "React Flow" attribution (12 px `--ink-muted`).
- **Filters** are visibility toggles: *Enlaces* (link edges; on by default), *Etiquetas* (adds `#tag` nodes — small `--sap` circles — connected to their notes; off by default), *Huérfanas* (show/hide orphan notes; on by default). Search highlights matches and dims the rest.
- **Preguntar** opens Brain with a new conversation scoped to "Esta nota" = the selected note, composer focused.
- Saved node positions (existing `save_node_position`) are respected when present; d3-force lays out the rest.

## Slice 6 — ⌘K note search

- ⌘K (Ctrl+K on Windows) focuses the top-bar field; typing shows a dropdown of notes matched fuzzily by name/path (no content search), max 20 results, matched characters highlighted, ↑/↓/Enter/Esc navigation, Enter opens the note in the editor view. Implemented with a small in-house fuzzy scorer (no new dependency) with tests.

## Testing (every slice, strict TDD)

- Component tests for each new/changed component (structure, states, interactions).
- Slice-specific logic tests: guard test (slice 1), backlinks (slice 2), filename sanitising/collisions/wikilink rewrite/H1-follow state (slice 3), scope resolution and budget switch in Rust + chip menu (slice 4), graph sizing/filters/data transforms (slice 5; d3 simulation mocked or run headless), fuzzy scorer (slice 6).
- Verification per slice: `cargo test`, `cargo clippy -- -D warnings`, `npx tsc --noEmit`, `npx vitest run`, `tauri build --bundles app`, and headless-Chrome screenshots of the affected view compared side by side with the mockup (attached to the PR description).

## Out of scope

- Command execution in ⌘K (only note search).
- Content/semantic search in ⌘K.
- Conversation backlinks in "Enlazada desde".
