# Capture Channels (batch 1) — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Scope:** Sub-project B, batch 1, of feeding the Second Brain: global quick capture, URL clipping, Word/PowerPoint extraction. All channels land in `Entrada/` (inbox, shipped in #38). Voice notes are a later batch (local vs API transcription to be decided).

## 1. Quick capture (global)

- **Shortcut:** default `Alt+Cmd+N` (macOS) / `Ctrl+Alt+N` (Windows), registered with Tauri's `global-shortcut` plugin; configurable in Settings (*Captura rápida* section, key recorder); registration failure (taken by another app) is shown in Settings with the reason. Stored in `config.db`.
- **Window:** separate small Tauri window (~480×220), always on top, centred, no decorations beyond the design system frame (`--surface`, `--radius-lg`, `--shadow-pop`). Shown/focused by the shortcut even when the main window is hidden or another app is active.
  - Textarea (borderless, `--font-sans`), placeholder "Escribe, pega una URL o una imagen…".
  - Paste of an image puts a thumbnail chip in the window; one image per capture.
  - *Guardar en Entrada* button + `Cmd/Ctrl+Enter`; `Esc` closes without saving.
  - After saving: the window closes and a discreet notification/toast "Guardado en Entrada" (system notification if the main window is hidden).
- **Saving rules:**
  - Text only → `Entrada/Captura YYYY-MM-DD HH-mm.md` with the text.
  - Text that is exactly one URL (trimmed) → URL clipping (§2).
  - Image (+ optional text) → `Entrada/Captura YYYY-MM-DD HH-mm.png` and, if there is text, a `.md` of the same name embedding the image and the text.
  - Name collisions get " 2", " 3"…
- **Menu bar (tray):** leaf icon (`design/icons/mark.svg`, template image on macOS) with *Abrir MarkDaun*, *Captura rápida*, *Salir*. Closing the main window hides it instead of quitting; the app keeps running in the menu bar. *Salir* goes through the existing exit guard (unsynced changes dialog, #24). Reopening from the Dock or tray shows the main window.

## 2. URL clipping

- **Entry points:** quick capture (URL text) and an *Añadir URL* button in the inbox view (small input + *Recortar*).
- **Pipeline (Rust, `src-tauri/src/capture/clip.rs`):**
  1. Fetch with reqwest (rustls, follow redirects, 15 s timeout, desktop browser User-Agent, honour `HTTPS_PROXY`/`HTTP_PROXY` env vars).
  2. Extract the main content with a Readability-style algorithm (use a maintained Rust crate if one fits — e.g. `readability` / `dom_smoothie` — else a small in-house scorer; decide in the plan after evaluating).
  3. Convert the content HTML to Markdown (headings, paragraphs, lists, links, emphasis, code, blockquotes, tables, images).
  4. Download images (≤ 20 images, ≤ 10 MB each, http/https only) into `Entrada/<slug>_assets/`, rewrite image links to relative paths; failed images keep their remote URL.
  5. Write `Entrada/<Título>.md` with a header block: `# <Título>`, then `Fuente: <URL>` and `Capturado: YYYY-MM-DD HH:mm`, then the article.
- **Failure** (non-2xx, timeout, non-HTML, empty extraction): still write `Entrada/<host> — <fecha>.md` containing the URL, page title if known, and `No se pudo recortar: <motivo>`. The UI reports the failure but the link is never lost.
- Archiving a clipped note moves its `_assets` folder alongside it (extend `archive_source` to move a sibling `<stem>_assets/` folder and relink).

## 3. Word and PowerPoint

- **Extraction (Rust, `src-tauri/src/capture/office.rs`)** — both formats are ZIP + XML; use the `zip` crate and an XML reader (`quick-xml`); no external tools.
  - `.docx` → Markdown: headings (from paragraph styles Heading1–6 / Título), paragraphs with bold/italic, numbered and bulleted lists, tables (GFM), hyperlinks, embedded images (extracted from `word/media/`).
  - `.pptx` → Markdown: one `## Diapositiva N` (with the slide title when present) per slide in order, text frames as paragraphs/lists, speaker notes under `> Notas: …`, images extracted from `ppt/media/` and placed in their slide.
  - Output: `{ markdown, images: [{ name, bytes, media_type }] }`.
- **Inbox:** `.docx` and `.pptx` become supported items. *Digerir* sends the extracted Markdown as text plus extracted images as attachments (existing multimodal path, vision check, 5-attachment limit: the largest images first, rest noted in the prompt). Large documents use the existing chunking path.
- **Indexing:** the vault indexer (`vault_index`) also indexes `.docx`/`.pptx` text (extracted Markdown), so archived sources in `Fuentes/` are retrievable by the Brain. Fingerprinting unchanged.
- `.doc`, `.ppt`, `.xlsx` and other formats stay unsupported.

## 4. Testing (strict TDD)

- Office extractors with small fixture files committed under `src-tauri/tests/fixtures/` (generate them programmatically in a test helper or commit tiny real files): headings, lists, tables, images, slide order, notes.
- Clipper: extraction + HTML→Markdown on fixture HTML pages (article with nav/ads noise), image download and rewrite against the fake HTTP server (incl. a failing image), failure note on 404/timeout/non-HTML.
- Quick capture: save rules (text, URL, image, image+text, collisions) in Rust; window component tests (paste image, Cmd+Enter, Esc); shortcut config persistence and registration error surfacing (plugin mocked).
- Tray/close behaviour: close hides the main window; *Salir* triggers the exit guard (unit-testable parts).
- Indexer picks up `.docx`/`.pptx`; inbox lists them as supported; archive moves `_assets`.

## 5. Out of scope

- Voice notes (next batch).
- Browser extension / share-sheet integration.
- `.doc`, `.ppt`, spreadsheets.
- Login-protected or JavaScript-rendered pages (handled by the failure note).
