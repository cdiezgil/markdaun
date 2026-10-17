# Mermaid Diagrams in the Editor — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Scope:** Sub-project B of the diagrams work: render Mermaid code blocks in the WYSIWYG editor. (Sub-project A — images/PDFs in Second Brain — shipped in #28.)

## 1. Goal

Fenced code blocks with language `mermaid` render as diagrams in the editor, are edited in place, and stay plain standard Markdown on disk.

## 2. Behaviour

- **Render mode (default):** a ` ```mermaid ` code block is shown as the rendered SVG diagram, centred, max width `--measure`. The Markdown on disk is unchanged (round-trip safe).
- **Edit mode:** clicking the diagram, or the ✎ button shown on hover (Lucide `Pencil`, stroke 1.5, `ink-muted`, `daun` when active), opens the source below the diagram in `mono`. The diagram re-renders live with a ~300 ms debounce. Leaving the block (cursor/selection moves outside it) or pressing `Esc` returns to render mode.
- **Errors:** invalid source keeps the last successful render and shows Mermaid's error message below it in `var(--danger)`. A block that has never rendered successfully stays in edit mode showing the source and the error.
- **Theme:** Mermaid `base` theme with `themeVariables` mapped from design tokens (background `--bg`/`--surface`, primary `--surface`, primary border/lines `--line-strong`, text `--ink`, secondary `--surface-sunken`, accent `--daun`), font `Geist`. Re-render on theme change (`data-theme` / `prefers-color-scheme`). Values are read from computed CSS variables, never hard-coded.
- **Insert:** a *Diagrama* button in the editor toolbar (Lucide `Workflow`) inserts a mermaid block with the template
  ```
  flowchart TD
    A[Inicio] --> B[Fin]
  ```
  and opens it in edit mode.
- **Security:** `securityLevel: 'strict'`, `startOnLoad: false`; render via `mermaid.render(id, source)` into the node view; no HTML labels.
- **Performance:** `mermaid` is dynamically imported the first time a mermaid block is rendered (code-split chunk), so notes without diagrams do not load it.
- **Other languages:** code blocks with any other language keep current behaviour.

## 3. AI

The Second Brain system prompt (`build_rag_messages` in `src-tauri/src/commands/brain_cmd.rs`) gains one line: when the user asks for a diagram inside a note, use a fenced ` ```mermaid ` block.

## 4. Implementation outline

| File | Responsibility |
|---|---|
| `src/components/editor/extensions/MermaidCodeBlock.ts` | Extends StarterKit's `codeBlock` with a React node view for `language === 'mermaid'`; other languages fall back to the default rendering. Keeps `tiptap-markdown` serialization unchanged. |
| `src/components/editor/MermaidView.tsx` | Node view: render/edit modes, debounce, last-good SVG, error display, ✎ button, `Esc`. |
| `src/lib/mermaid/render.ts` | Lazy loader + `renderMermaid(source, themeVars) → { svg } \| { error }`; unique ids; theme variables from CSS tokens. |
| `src/components/editor/EditorCanvas.tsx` | Register the extension (replace StarterKit's codeBlock). |
| `src/components/editor/EditorToolbar.tsx` | *Diagrama* button. |
| `src-tauri/src/commands/brain_cmd.rs` | Prompt line + test. |

## 5. Testing (strict TDD)

- Markdown round-trip: load a note with a mermaid block and other code blocks, serialize back → identical Markdown.
- Node view (with `renderMermaid` mocked): render mode shows SVG; click/✎ enters edit mode; typing triggers debounced re-render; `Esc` and blur exit; invalid source keeps last SVG and shows error; never-valid block shows source + error.
- `render.ts`: theme variables read from CSS custom properties; lazy import happens once; `securityLevel: 'strict'` passed.
- Toolbar button inserts the template and opens edit mode.
- Theme change triggers re-render.
- Rust: system prompt contains the mermaid instruction.

## 6. Out of scope

- PlantUML or other diagram languages (would need a server or extra runtimes).
- Exporting diagrams to images.
- Visual (drag-and-drop) diagram editing.
