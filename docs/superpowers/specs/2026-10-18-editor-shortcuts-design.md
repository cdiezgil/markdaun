# Editor Shortcuts & Markdown Typing — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)

## 1. Shortcut map

`Mod` = ⌘ on macOS, Ctrl on Windows/Linux. Replaces TipTap defaults where they differ.

| Action | Shortcut | Note |
|---|---|---|
| Bold / Italic / Strike | Mod-B / Mod-I / Mod-Shift-X | Strike moves from Mod-Shift-S |
| Highlight `==` | Mod-Shift-H | new |
| Inline code / Code block | Mod-E / Mod-Shift-E | code block moves from Mod-Alt-C |
| H1 / H2 / H3 / Paragraph | Mod-Alt-1 / 2 / 3 / Mod-Alt-0 | kept |
| Bullet list / Ordered list / Quote | Mod-Shift-8 / Mod-Shift-7 / Mod-Shift-9 | quote moves from Mod-Shift-B |
| Link | Mod-Shift-K | new; Mod-K stays the global note search |
| Wikilink `[[ ]]` | Mod-Shift-L | new: inserts `[[]]` with the caret between the brackets (if text is selected, wraps it: `[[selection]]`) |
| Table / Image / Diagram / Horizontal rule | Mod-Shift-T / Mod-Shift-I / Mod-Shift-M / Mod-Shift-Minus | new; table opens the existing size picker; image opens the existing image picker; diagram inserts the Mermaid template in edit mode |
| Shortcut cheat sheet | Mod-/ | new |

- Old default bindings that were moved are removed (no duplicates).
- Shortcuts only act when the editor has focus (except Mod-/ which also works from the editor view when the toolbar has focus).
- A single source of truth `src/lib/editor/shortcuts.ts` exports the map (action id → key combo, label) used by the TipTap extension(s), the toolbar tooltips and the cheat sheet.

## 2. Visibility

- Every toolbar button's tooltip/`title` and `aria-keyshortcuts` show "Label · ⌘B" on macOS and "Label · Ctrl+B" elsewhere (platform from `navigator.platform`/userAgentData, injectable for tests).
- **Cheat sheet** (Mod-/): floating panel (`--surface`, `--radius-lg`, `--shadow-pop`, 240 ms motion), grouped (Formato, Títulos, Bloques, Insertar, Escritura Markdown), listing all shortcuts plus the Markdown typing rules; closes with Esc, Mod-/ or click outside.

## 3. Markdown typing (input rules)

- Verify with tests (already provided by StarterKit/extensions): `# ` `## ` `### `, `- ` / `* `, `1. `, `> `, ```` ``` ````, `---`, `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `code` ``, `==highlight==`, `[[wikilink]]`, `#tag` + space.
- New:
  - `[text](url)` → link mark on "text".
  - `![alt](path)` → image node (relative paths resolved like existing images).
  - ```` ```mermaid ```` + Enter → Mermaid block opened in edit mode.
- No rule fires inside inline code or code blocks.

## 4. Testing (strict TDD)

- Each shortcut applies its action in a real TipTap editor (keyboard events), moved defaults no longer act.
- Wikilink shortcut with and without selection.
- Each input rule (existing and new) converts correctly and not inside code; Markdown round-trip unchanged.
- Tooltips per platform; cheat sheet open/close and content generated from the map.
