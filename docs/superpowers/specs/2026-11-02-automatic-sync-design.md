# Automatic GitHub sync — design

Date: 2026-11-02 · Status: proposed · Project 1 of 3 (automatic sync → vector index publication → Android app)

## Intent

The user works on two Macs (home and office), never at the same time, and keeps the office laptop asleep instead of shutting it down. Sync is manual today (↑/↓ in the Notas sidebar). The user forgets to sync, both sides accumulate changes, and the user ends up running git by hand inside the vault. The goal is to **remove every manual sync step**: whatever changes in the vault is committed and pushed by itself; whatever changed on GitHub arrives by itself.

This sync is also the foundation for the planned Android app, which will read notes from the same GitHub repo.

## Goals

- Every change in the vault, whether an editor autosave or a file written by an agent or another tool, is committed and pushed without user action.
- Remote changes are pulled at startup, when the window regains focus, after waking from sleep, and periodically while the app runs, including when it is hidden in the menu bar.
- Offline: commits stay local and are pushed automatically when the network returns. No error dialogs for being offline.
- The note open in the editor is **reloaded silently** when it changed remotely and has no local unsaved edits, with a discreet notice ("Nota actualizada desde GitHub").
- One status indicator in the status bar replaces the manual buttons.

## Non-goals

- Syncing while MarkDaun is closed. No background daemon: changes made with the app closed (e.g. by an agent) are picked up on the next launch.
- Publishing `vectors.db` (project 2) and the mobile app (project 3).
- Changing the merge/conflict semantics of the safe sync (`docs/superpowers/specs/2026-10-18-safe-git-sync-design.md`, AGENTS.md §2.5).
- iOS, other Git hosts, multiple branches.

## Anti-goals: a failure even if it "works"

- Any data loss: force push, `reset --hard`, overwriting either side, or silently dropping a local edit.
- Bypassing the deletion guard (>50% and ≥10 files removed from `origin/main` → stop and ask).
- Noise: a commit per keystroke, a dialog every time the network drops, or the editor jumping while the user types.

## Constraints

- Builds on `src-tauri/src/git/sync.rs` as is: commit local changes, then fetch, then fast-forward or a real merge with conflict copies `<name> (conflicto YYYY-MM-DD HH-mm).<ext>`; push without `+` and retry once after merging. Its tests (bare `file://` repos, `src-tauri/src/git/tests.rs`) stay green.
- PAT stays in the OS keychain; nothing secret on disk.
- TDD; Rust `#![deny(warnings)]`; TypeScript strict; tests in the same commit as the code (AGENTS.md §3, §7).

## Decisions taken with the user

- Option B of the discussion: git stays the transport, made automatic. Rejected: zipping the whole vault each round (heavy, last-writer-wins, no history), and replacing git with a file-sync service.
- Push automatically after saving; offline commits wait locally.
- Watch the vault folder so changes that bypass the editor are synced too. These are occasional.
- Nothing runs while the app is closed.
- The open note updates silently.
- Waking the laptop after days is the key scenario: pull before the user edits.

## How it works (builder's calls marked *[call]*)

### Triggers

| Trigger | Action |
|---|---|
| App start (after config load) | full sync cycle |
| Window focus / app shown from tray | full sync cycle (throttled: not more than once per 60 s *[call]*) |
| Wake from sleep | full sync cycle. Detected as a wall-clock jump: the periodic tick sees more than 2× its interval elapsed *[call]*, so no native API is needed |
| Vault change (autosave or watcher event) | schedule a cycle **30 s after the last change** *[call]* (debounce; restarted by each new change) |
| Periodic tick | full sync cycle every 5 min while running, visible or hidden *[call]* |
| Status bar click | full sync cycle now ("Sincronizar ahora") |
| Quit (Cmd+Q / tray Salir) | flush pending save, one final cycle with a short timeout (~10 s *[call]*). If it fails or the device is offline, quit anyway: commits stay local and are pushed next launch. The "Cambios sin sincronizar" dialog is removed *[call]* |

A **full sync cycle** = flush any pending editor save → commit local changes → fetch → merge → push (with the existing retry and deletion guard) → re-index changed notes → reload the open note if needed. It is the existing push path (`git_push_inner`), which already commits, fetches and merges before pushing, so pull and push become one operation.

### Concurrency

- Rust holds a sync lock per vault (like `IndexLocks`). A cycle requested while one runs is **coalesced**: it sets a "run again" flag and one more cycle runs after the current one. Requests are never queued N times.
- The editor's pending debounced save is flushed before each cycle, so the cycle commits what the user sees.

### Vault watcher

- New dependency: `notify` (with its debouncer) watching the active vault recursively.
- Ignores `.git/`, `.markdaun/`, `.DS_Store`, editor temp files, and the conflict-copy writes made by the merge itself (changes during a running cycle are ignored; the post-cycle state is the baseline) *[call]*.
- Emits a debounced `vault-changed` event to the frontend. That event schedules the 30 s push debounce and refreshes the file tree.
- The watcher restarts when the active vault changes and stops when sync is not configured.

### Open-note reload

After a cycle, Rust reports the list of paths changed by the merge or fast-forward (new field in `SyncResult`). If the open note is in the list:

- **No local edits since the last save:** reload content from disk keeping the scroll position as close as possible *[call]*, and show a toast "Nota actualizada desde GitHub" (existing `Toast`).
- **Local edits typed during the cycle:** they are not discarded. The save goes through, and the next cycle commits it as a normal change on top. If that produces a same-file divergence, the existing conflict copy keeps both versions.
- **The open note was deleted remotely:** with no local edits, close it and show a toast. With local edits, keep it (the existing "edit wins over delete" rule).

### Errors and offline

- Rust classifies failures into a typed `SyncError` serialized as `{kind, detail}`, mirroring `LlmError`. Kinds: `Offline` (DNS, connect or timeout from libgit2), `Unauthorized` (bad or expired PAT), `NotConfigured`, `PushRejected`, `NeedsDeletionConfirmation`, `Git` (anything else).
- `Offline`: state "Sin conexión". Retry on the next trigger and with a backoff timer (30 s → 1 → 2 → 5 min, capped) *[call]*. No dialog.
- `Unauthorized`: state "Error" with an action to open GitHub settings. Automatic retries stop until the config changes.
- `NeedsDeletionConfirmation`: automatic sync **pauses** and the existing deletion dialog opens once. "Continuar" pushes with `confirmDeletions`; "Cancelar" leaves sync paused with state "Requiere revisión" until the user resolves it, e.g. by "Sincronizar ahora" after restoring files.
- Conflicts: the existing "Hay N conflictos" notice with links is kept.

### UI

- Status bar `SyncItem` states: **Al día** · **Sincronizando** · **Pendiente** (local commits not pushed / debounce running) · **Sin conexión** · **Requiere revisión** (deletion guard, conflicts not dismissed, auth error). Tooltip: last successful sync time. Click: sync now.
- The ↑/↓ buttons and their badge in `SyncPanel` are removed. The panel keeps connect / disconnect.
- No user setting to disable automatic sync *[call]*. Disconnecting GitHub is the off switch.

### History

- Commit message gains the device name for readable history: `MarkDaun sync (<hostname>) — <rfc3339>` *[call]*. The merge message stays as is.
- Re-index (`spawn_vault_sync`) after any cycle that brought remote changes. Today only `github_pull` does it, not the push path.

## Testing

- Rust (bare `file://` repos, existing helpers such as `clone_device` and `peer_commit_and_push`):
  - coalescing lock;
  - changed-paths reporting after fast-forward, merge and conflict;
  - `SyncError` classification, offline simulated with an unreachable URL;
  - deletion guard still blocking the automatic path;
  - "laptop wakes days later": the remote has many commits and there are local edits.
- Frontend (Vitest):
  - trigger scheduling with fake timers (debounce restart, periodic tick, wake detection by clock jump, focus throttle);
  - state machine of the status item;
  - open-note reload with and without local edits;
  - quit path without dialog.
- Watcher: integration test that writes a file into a temp vault and expects one debounced event, and none for `.git/` writes.

## Docs to update

- AGENTS.md §2.5: sync is automatic, triggers, offline behaviour; remove "manual" wording.
- Memory note `auto-sync-parked`: superseded by this design.

## Settled after the builder review *[calls]*

These override the sections above where they are more specific.

1. **Editor saves vs a running cycle.**
   - Before a cycle, the frontend flushes the pending save and then **holds saves** (reusing the existing "saves held" mechanism used for rename/move) until the cycle ends. Typing continues in the buffer.
   - After the cycle, if the open note changed remotely **and** the buffer has unsaved edits, the remote version on disk is first written as the usual conflict copy `<name> (conflicto …)`, then the buffer is saved to the path. This is the same rule as a merge conflict: local keeps the path, remote becomes a copy.
   - If the buffer is clean, the note reloads silently.
2. **Orchestration lives in Rust.** A scheduler task owns the timers (debounce, periodic tick, wake detection, backoff), because hidden-window webview timers may be throttled.
   - **Handshake:** Rust emits `sync-will-start`. The frontend flushes, holds saves and calls `sync_hold_ack`. Rust waits at most 2 s for the ack and then proceeds.
   - When the cycle ends, Rust emits `sync-finished { changedPaths, state, conflicts }`. The frontend releases the hold, reloads the note if needed and refreshes the tree.
   - Focus, "Sincronizar ahora", and autosave-scheduling arrive as commands from the frontend.
3. **"Pendiente"** means uncommitted changes **or** commits ahead of `origin/main`. Add an ahead/behind query (`graph_ahead_behind`) to the status.
4. **Timeouts and quit.**
   - Set libgit2 server connect and read timeouts (≈10 s connect, ≈20 s read). A timeout maps to `Offline`. The same applies to a hung server.
   - A running git operation is **never** abandoned. On quit:
     1. flush;
     2. commit locally (fast, no network);
     3. if no cycle is running, attempt one push cycle bounded by those timeouts; if a cycle is running, wait for it to end.
   - Then quit. Worst case is ~30 s on a hung network. A "Sincronizando antes de salir…" notice is shown.
5. **Deletion guard pause.**
   - Persisted in `config.db` (`sync_paused_reason`), so it survives restarts and the dialog reappears on launch and on "Sincronizar ahora".
   - While paused, cycles still commit locally and fetch/merge. Only the push is blocked.
   - "Continuar" pushes with `confirmDeletions` and clears the pause.
6. **Repeated non-offline errors.**
   - `PushRejected` after its retry, and `Git`, follow the same backoff as `Offline`. After 3 consecutive failures the state becomes "Requiere revisión" with the error in the tooltip.
   - The backoff schedule replaces the periodic tick until a cycle succeeds.
   - `Unauthorized` stops retries immediately.
7. **Conflicts.**
   - Conflict copies created by unattended cycles **accumulate** in a list persisted in `config.db` and shown in the existing notice.
   - The list clears only with the explicit dismiss.
   - "Requiere revisión" holds while the list is non-empty.
8. **Watcher details.**
   - Autosave also schedules the debounce directly. Double signals are harmless because the debounce coalesces them.
   - Events during a running cycle are **not** dropped. Paths outside the cycle's own `changedPaths` set the "run again" flag, so an agent's write during a cycle is synced right after.
   - Voice, clip and quick-capture files in `Entrada/` go through the same path. Audio and its later transcription simply sync as two changes; no waiting.
9. **One command, one lock.**
   - `github_push` and `github_pull` are replaced by a single `github_sync` cycle command, and the frontend is updated.
   - `github_connect_apply` takes the same lock.
   - The scheduler is inert until sync is configured and connected.
   - Re-indexing is requested after the lock is released, via `spawn_vault_sync`, whose `IndexLocks` already skips duplicates.
10. **`changedPaths`** is the diff between the HEAD tree **after the cycle's local commit** and the post-cycle HEAD tree, so it covers remote changes and conflict copies, not the device's own edits. That includes added, modified and deleted paths and conflict copies; a rename counts as a delete plus an add.
11. **Small details.**
    - Hostname comes from the OS, sanitised to `[A-Za-z0-9-]`, with `Mac` as the fallback.
    - The "Cambios sin sincronizar" dialog and any dirty-tracking used only by it are removed.

## Left to the builder

Module layout inside Rust and the frontend, exact debounce values within the ranges above, toast wording, and watcher crate configuration.
