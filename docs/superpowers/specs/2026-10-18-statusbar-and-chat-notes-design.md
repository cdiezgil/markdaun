# Status Bar & Notes from Chat — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming), pending implementation plan
- **Depends on:** `fix/chat-embeddings` (chat answers again, `ChatPanel` shows errors/warnings). Implement on top of it.

## 1. Goals

1. Replace the floating AI selector pill with a proper **bottom status bar** that shows app state, data about the note being edited, and the AI selector.
2. Let the user **create Markdown notes from Second Brain conversations**, both manually ("Save as note") and from model proposals (create a new note or append to an existing one), never writing without an explicit click.

## 2. Status bar

### 2.1 Layout

- Fixed at the bottom of the main window, full width, height `var(--toolbar-height)`, background `var(--surface-sunken)`, top border `1px solid var(--line)`, text `var(--ink-muted)` in `sans` at the UI small size from `design/tokens`. Lucide icons, stroke 1.5.
- The floating `ModelSwitcher` pill is removed; `ModelSwitcher` renders **inside** the status bar (rightmost item) and its popover opens **upwards** (`--shadow-pop`).
- Main layout reserves the bar's height so no content is hidden behind it.

| Left | Right |
|---|---|
| GitHub sync state · save state · Second Brain indexing | note path · words · bytes · lines · reading time · AI selector |

### 2.2 Items

| Item | Source | Behaviour |
|---|---|---|
| Sync state | `syncStore` | Icon + short label: up to date / N pending changes / syncing / error (error in `var(--danger)`, tooltip with detail). Hidden when GitHub is not configured. |
| Save state | `editorStore` (dirty flag) | "Saved" / "Unsaved". |
| Indexing | new backend event `brain-index-progress { done, total }` emitted while re-embedding | "Indexing 3/12" while active; hidden when idle. |
| Note path | active note path relative to the vault | Truncated in the middle if long; click copies the relative path; tooltip shows the absolute path. |
| Words | serialized Markdown of the active note | With a non-empty selection: `selected / total`. |
| Bytes | UTF-8 byte length of the serialized Markdown | Human format (`1.2 KB`) with exact bytes in tooltip. |
| Lines | serialized Markdown | Total lines. |
| Reading time | words / 200 wpm | `~3 min`; `<1 min` below 200 words. |
| AI selector | `ModelSwitcher` | Existing behaviour (connection + model, *Set up AI* empty state). |

- With no open note, the note items are hidden; status items and AI selector remain.
- Counters are recomputed with a ~150 ms debounce on editor updates.

### 2.3 Counting rules (`src/lib/noteStats.ts`, pure functions)

- Words: split serialized Markdown on Unicode whitespace after stripping Markdown syntax tokens that are not words (heading `#`, list markers, emphasis markers, link URLs); count non-empty tokens. Accented words and CJK-free languages are the target; a word is any run of non-whitespace containing at least one letter or digit.
- Bytes: `new TextEncoder().encode(markdown).length`.
- Lines: `markdown === '' ? 0 : markdown.split('\n').length` (a trailing newline does not add a line).
- Selection words: same word rule applied to the selected plain text.

## 3. Notes from chat

### 3.1 Manual: "Save as note"

- Each assistant message gets a *Save as note* action (Lucide `FilePlus`).
- Opens a small dialog: file name (default: conversation title, slugified, `.md` appended), folder picker (vault folders, default vault root), checkbox *Include sources* (appends a `## Sources` list of `[[wikilinks]]` to the source notes).
- *Save* calls `chat_write_note` with `mode = create`. If the file exists, the dialog shows the error inline and offers *Append instead*.

### 3.2 Model proposals: `markdaun-note` blocks

- The Second Brain system prompt (built in `build_rag_messages`) gains an instruction: when the user asks to create or extend a note, answer with one or more fenced blocks:

  ````
  ```markdaun-note path="Folder/name.md" mode="create"
  # Title
  ...
  ```
  ````

  `mode` is `create` (default) or `append`; `path` is relative to the vault and must end in `.md`.
- The frontend parser (`src/lib/chat/noteBlocks.ts`) splits an assistant message into text segments and note proposals. A block with a missing/invalid `path` or unknown `mode` is rendered as a normal code block (no card).
- Each proposal renders as a `NoteProposalCard`:
  - **create:** editable path field, rendered preview of the content, *Create* / *Discard*. If the path already exists (checked on render via `note_exists`), the card shows "Already exists" with *Rename* (focus path field) and *Append instead*.
  - **append:** target path, the last ~8 lines of the existing note (muted) followed by the new content highlighted (`var(--mark)` background), *Append* / *Discard*. If the target does not exist, offer *Create instead*.
  - After acceptance: card collapses to "✓ Created · Open" / "✓ Appended · Open". *Discard* collapses to "Discarded". State is per message in memory (not persisted).
- Multiple cards per message are allowed.
- Nothing is written to disk without the user's click.

### 3.3 Backend

New commands in `src-tauri/src/commands/chat_notes.rs` (tests in `chat_notes_tests.rs`):

| Command | Behaviour |
|---|---|
| `chat_write_note(path, content, mode, vaultPath)` | `path` relative to vault; rejects absolute paths, `..` escapes (canonical parent must be within vault), and non-`.md` extensions → `invalid_path`. Creates missing parent folders. `create`: fails with `already_exists` if present. `append`: fails with `not_found` if absent; otherwise appends `"\n\n" + content` (trimming trailing newlines of the existing file first, single trailing newline at the end). Returns the absolute path. After writing, triggers re-embedding of that file (existing `brain_update_embedding` path). |
| `note_exists(path, vaultPath)` | Same path validation; returns bool. |
| `read_note_tail(path, vaultPath, lines)` | Same validation; returns the last `lines` lines (for the append preview). |

The frontend refreshes the vault tree after a successful write and opens the note on *Open*.

## 4. Components and files

| File | Responsibility |
|---|---|
| `src/components/StatusBar/StatusBar.tsx` | Layout and composition |
| `src/components/StatusBar/NoteStats.tsx` | Path, words, bytes, lines, reading time |
| `src/components/StatusBar/AppStatus.tsx` | Sync, save, indexing |
| `src/lib/noteStats.ts` | Pure counting functions |
| `src/components/ModelSwitcher/ModelSwitcher.tsx` | Modified: in-bar rendering, popover upwards |
| `src/lib/chat/noteBlocks.ts` | Parse `markdaun-note` blocks |
| `src/components/SecondBrain/NoteProposalCard.tsx` | Proposal card (create/append) |
| `src/components/SecondBrain/SaveAsNoteDialog.tsx` | Manual save dialog |
| `src/components/SecondBrain/MessageBubble.tsx` | Modified: render segments + cards, *Save as note* action |
| `src/lib/tauri.ts` | Wrappers `chatWriteNote`, `noteExists`, `readNoteTail` (camelCase args) |
| `src-tauri/src/commands/chat_notes.rs` | Commands above |
| `src-tauri/src/commands/brain_cmd.rs` | System prompt instruction; emit `brain-index-progress` |
| `src/App.tsx` | Mount `StatusBar`, remove floating switcher |

## 5. Testing (strict TDD)

- `noteStats`: empty doc, Markdown syntax not counted as words, accented text, bytes with multibyte chars, trailing newline, selection count.
- `noteBlocks`: single block, multiple blocks, `append` mode, missing path → plain code block, non-`.md` path → plain, text around blocks preserved.
- `StatusBar`: hides note items with no note; shows `sel / total` with selection; sync error styling; indexing shown only while active.
- `ModelSwitcher`: renders inside bar; popover opens upwards (class/position assertion).
- `NoteProposalCard`: create happy path, exists → *Append instead*, append preview shows tail + new content, discard, accepted state.
- `SaveAsNoteDialog`: default name from title, include sources, exists error → *Append instead*.
- Rust `chat_notes`: create, create existing → `already_exists`, append, append missing → `not_found`, `..` escape and absolute path → `invalid_path`, non-`.md` → `invalid_path`, nested folders created, separator newline rules, `read_note_tail`.
- Rust `build_rag_messages`: system prompt contains the `markdaun-note` instruction.

## 6. Out of scope

- Replacing or editing arbitrary parts of existing notes (only append).
- Persisting proposal card state across app restarts.
- Cursor position (line:col) in the status bar.
