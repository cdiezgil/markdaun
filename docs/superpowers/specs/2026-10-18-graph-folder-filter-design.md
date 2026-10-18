# Graph Folder Filter — Design

- **Date:** 2026-10-18
- **Status:** Approved (decided with the user)

## Behaviour

- The graph floating filter panel (`GraphFilterPanel`) gains a 4th chip **"Carpetas"** next to *Enlaces*, *Etiquetas*, *Huérfanas*, same chip styling (active when a folder is selected: `--mark` background, `--daun` border).
- Clicking it opens a popover (`--surface`, `--radius-lg`, `--shadow-pop`) with a **tree**: "Bóveda" first, then the vault folders and subfolders (expand/collapse chevrons, Lucide icons stroke 1.5). `Entrada/`, `Fuentes/` folders are listed like any other folder; hidden folders (`.markdaun`, dot-folders) are not.
- **Single selection.** Default is *Bóveda* (whole graph, no restriction). Clicking a folder selects it and closes the popover; clicking *Bóveda* clears the restriction.
- Chip label: "Carpetas" when *Bóveda*; "Carpetas · Mutua/ProyectoX" when a folder is selected (middle-truncated if long).
- **Restriction:** with folder F selected, the graph shows notes inside F and its subfolders at full style. Notes **outside** F that are linked to/from a note inside F are shown **dimmed** (reduced opacity, label `--ink-muted`), with their connecting edges dimmed too. Notes outside F with no link to F are hidden. Edges between two outside notes are hidden.
- **Huérfanas** keeps its vault-wide meaning: a note is an orphan only if it has no links at all in the vault (a note linked only from outside F is not an orphan).
- **Etiquetas**: tag nodes only for tags used by notes inside F.
- Search, the selected-note card, zoom "Ajustar" and the status-bar graph counts operate on the visible (restricted) graph; counts reflect visible notes (dimmed outside notes not counted).
- **Persistence:** the selected folder is remembered per vault (localStorage key `markdaun.graph.folder:<vaultPath>`); if the folder no longer exists, fall back to *Bóveda*.
- Layout: d3-force runs on the visible set; saved node positions are respected.

## Testing (strict TDD)

- `graphModel`: restriction (inside/outside/hidden), dimmed flags on nodes and edges, orphan semantics unchanged, tags limited to inside notes, subfolders included, Bóveda = no restriction.
- Folder tree builder from the vault tree (excludes hidden folders, ordering).
- `GraphFilterPanel`: chip label states, popover tree, selection closes popover, Bóveda clears.
- Persistence per vault and fallback when the folder disappears.
- Status-bar graph stats reflect the restricted view.

## Out of scope

- Multiple folder selection.
