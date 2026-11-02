# Automatic GitHub Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual ↑/↓ sync with an automatic commit → fetch → merge → push cycle driven by vault changes, focus, wake, a periodic tick and quit, safe offline and never losing data.

**Architecture:** A pure Rust scheduler state machine (`git/scheduler.rs`) decides *when* to sync. A thin tokio runner feeds it time, vault-watcher events and frontend commands, and executes cycles under a per-vault lock. The cycle itself (`git_sync_inner`) reuses the existing safe merge and push code and reports changed paths. The frontend only flushes and holds editor saves around a cycle (handshake events), reloads the open note, and renders one status-bar item.

**Tech Stack:** Rust (git2, notify + notify-debouncer-full, tokio, rusqlite, thiserror), Tauri 2 events and commands, React 18 + Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-automatic-sync-design.md`. Read it first. Its "Settled after the builder review" section overrides the earlier sections.

## Global Constraints

- **Safety:** never force push, never `reset --hard`, never overwrite either side. The existing conflict-copy rule (`<stem> (conflicto YYYY-MM-DD HH-mm).<ext>`, local keeps the path) and the deletion guard (more than 50 % and at least 10 files) stay unchanged.
- **Rust:** `#![deny(warnings)]`, so `cargo clippy --all-targets -- -D warnings` must be clean. Tests live in `src-tauri/src/<module>/tests.rs` and use bare `file://` repos, never the network.
- **TypeScript:** strict mode, and no `any` without a justifying comment. Tests sit next to the code as `X.test.ts(x)`.
- **Commits:** tests and code go in the same commit. Messages are English imperative conventional commits with no AI attribution, on branch `agents/75-automatic-sync`.
- **Local builds:** export `ORT_LIB_LOCATION=$(ls -d ~/Library/Caches/ort.pyke.io/dfbin/aarch64-apple-darwin/*/onnxruntime | head -1)` and run only one cargo build at a time.

**Timing values** (the spec's calls):

| Setting | Value |
|---|---|
| Push debounce after the last change | 30 s |
| Focus throttle | 60 s |
| Periodic tick | 300 s |
| Wake detection | elapsed > 2 × tick interval |
| Offline/error backoff | 30 s → 60 s → 120 s → 300 s (cap) |
| Errors before "Requiere revisión" | 3 consecutive |
| Handshake ack wait | 2 s |
| libgit2 connect timeout | 10 s |
| libgit2 read timeout | 20 s |

**User-visible copy** (Spanish):
- Status states: "Al día", "Sincronizando", "Pendiente", "Sin conexión", "Requiere revisión".
- Toasts: "Nota actualizada desde GitHub", "La nota se borró en GitHub".
- Quit notice: "Sincronizando antes de salir…".

## Review Focus

1. **Typing while a cycle runs on the same note.** No keystroke is lost. The remote version ends up in a `(conflicto …)` copy and the buffer is saved to the path. Owned by Task 8, test `keeps typed buffer and writes remote as conflict copy`.
2. **Laptop wakes after days with local unpushed commits and a remote far ahead.** The first action is a full cycle that merges, and nothing is clobbered. Owned by Task 2, test `wake_after_days_merges_both_sides`, and Task 4, test `clock_jump_triggers_wake_cycle`.
3. **Network drops mid-push or the server hangs.** The cycle ends as `Offline` within the timeouts, commits stay local, and the next success pushes them. Owned by Task 1, test `unreachable_remote_is_offline`, and Task 4, test `offline_backoff_then_recovers`.
4. **Agent writes a file while a cycle is running.** It is synced right after. Owned by Task 4, test `change_during_cycle_sets_run_again`.
5. **Deletion guard fires unattended.** The push stays blocked across restarts, while commit, fetch and merge continue. Owned by Task 3, test `paused_reason_survives_reopen`, and Task 2, test `push_blocked_when_paused_but_merge_runs`.

---

### Task 1: Typed sync errors and network timeouts

**Files:**
- Create: `src-tauri/src/git/error.rs`
- Modify: `src-tauri/src/git/mod.rs`, `src-tauri/src/git/sync.rs` (the function that builds `RemoteCallbacks`/`FetchOptions`)
- Test: `src-tauri/src/git/tests.rs`

**Interfaces:**
- Produces: `#[derive(Debug, Serialize, Clone, PartialEq)] #[serde(tag = "kind", content = "detail", rename_all = "camelCase")] pub enum SyncError { Offline(String), Unauthorized(String), NotConfigured, PushRejected(String), NeedsDeletionConfirmation { deleted: usize, total: usize }, Git(String) }`. It serializes as `{kind, detail}` like `LlmError`.
- Produces: `pub fn classify(err: &GitError) -> SyncError`.
- Produces: `pub fn apply_network_timeouts()`. It calls `git2::opts::set_server_connect_timeout_in_milliseconds(10_000)` and `set_server_timeout_in_milliseconds(20_000)` once, using `std::sync::Once`.

- [ ] **Step 1:** Write tests.
  - `unreachable_remote_is_offline`: run a fetch against `https://127.0.0.1:9/x.git`; `classify` must return `SyncError::Offline(_)`.
  - `auth_failure_is_unauthorized`: a `git2::Error` with `ErrorClass::Http` and code `Auth` maps to `Unauthorized`.
  - `push_rejected_maps`: `GitError::PushRejected("x")` maps to `SyncError::PushRejected("x")`.
  - `serializes_as_kind_detail`: `serde_json::to_value(SyncError::Offline("d".into()))` equals `{"kind":"offline","detail":"d"}`.
- [ ] **Step 2:** Run `cargo test git::tests::unreachable_remote_is_offline` (with `ORT_LIB_LOCATION` exported). Expected: it fails to compile because `SyncError` is undefined.
- [ ] **Step 3:** Implement `classify`.
  - Map `ErrorClass::Net`/`Os`/`Ssl` and the codes for resolve, connect and timeout to `Offline`.
  - Map `ErrorCode::Auth` and HTTP 401/403 to `Unauthorized`.
  - Map everything else to `Git(err.to_string())`.
  - Call `apply_network_timeouts()` from every place that builds `FetchOptions` or `PushOptions`.
- [ ] **Step 4:** Run `cargo test git::` until every test, old and new, passes.
- [ ] **Step 5:** Commit: `feat(sync): add typed SyncError and libgit2 network timeouts`.

### Task 2: The sync cycle core

**Files:**
- Modify: `src-tauri/src/git/sync.rs`. Add `git_sync_inner`, `changed_paths`, `sync_status_inner` and `device_name`. Change the commit message in `commit_local_changes` (line 279).
- Test: `src-tauri/src/git/tests.rs`

**Interfaces:**
- Consumes: `SyncError`, `classify` (Task 1). Existing: `commit_local_changes`, `fetch_main`, `merge_remote`, `push_with_retry`, `deletion_warning`.
- Produces: `pub struct CycleOptions { pub confirm_deletions: bool, pub push_paused: bool }`.
- Produces: `#[derive(Serialize, Clone, Debug, Default)] #[serde(rename_all = "camelCase")] pub struct CycleReport { pub changed_paths: Vec<String>, pub conflicts: Vec<String>, pub needs_confirmation: Option<DeletionWarning>, pub pushed: bool }`.
- Produces: `pub fn git_sync_inner(vault: &Path, url: &str, pat: &str, opts: CycleOptions) -> Result<CycleReport, SyncError>`. The order is commit → fetch → merge → guard → push (skipped if `push_paused` or the guard fires without confirmation). `changed_paths` is the diff of the HEAD tree before and after (adds, modifications, deletions, and renames as delete + add).
- Produces: `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct SyncStatus { pub uncommitted: bool, pub ahead: usize }` and `pub fn sync_status_inner(vault: &Path) -> Result<SyncStatus, SyncError>`. `ahead` comes from `graph_ahead_behind(HEAD, origin/main)`, and is 0 when there is no `origin/main`.
- Produces: `pub fn device_name() -> String`. It takes the hostname, sanitises it to `[A-Za-z0-9-]`, and falls back to `"Mac"`. The commit message becomes `MarkDaun sync (<device>) — <rfc3339>`.

- [ ] **Step 1:** Write tests using the existing helpers (`bare_repo`, `clone_device`, `peer_commit_and_push`, `conflict_copies`):
  - `cycle_pushes_local_edit`: `report.pushed`, and the remote tip contains the file.
  - `cycle_reports_changed_paths_from_remote`: a peer adds `a.md` and deletes `b.md`; `changed_paths` contains both.
  - `cycle_conflict_keeps_both`: the same file is edited on both sides; one conflict copy exists and its path is in `conflicts` and `changed_paths`.
  - `wake_after_days_merges_both_sides`: 20 peer commits plus 2 unpushed local commits and one uncommitted edit; after one cycle all of it is on the remote and local equals remote.
  - `push_blocked_when_paused_but_merge_runs`: `push_paused: true`; the remote is unchanged and the local tree contains the peer's file.
  - `guard_stops_push_without_confirmation`: delete 11 of 12 files; `needs_confirmation` is `Some` and `pushed` is false.
  - `status_counts_ahead`: `ahead == 1` after one local commit.
  - `commit_message_has_device`: the message starts with `MarkDaun sync (`.
- [ ] **Step 2:** Run `cargo test git::tests::cycle_` and confirm the tests fail to compile.
- [ ] **Step 3:** Implement the functions above. Refactor `git_push_inner` and `git_pull_inner` into `git_sync_inner`; Task 6 removes the old commands.
- [ ] **Step 4:** Run `cargo test git::` until it passes.
- [ ] **Step 5:** Commit: `feat(sync): single sync cycle with changed paths and ahead status`.

### Task 3: Persisted sync state

**Files:**
- Create: `src-tauri/src/git/state.rs`
- Test: `src-tauri/src/git/tests.rs`

**Interfaces:**
- Produces, on `&rusqlite::Connection` (config.db, key/value `config` table):
  - `pub fn paused_reason(db) -> Option<String>`, `pub fn set_paused_reason(db, Option<&str>)` (key `sync_paused_reason`, value `"deletion"`)
  - `pub fn pending_conflicts(db) -> Vec<String>`, `pub fn add_conflicts(db, &[String])` (deduplicated, order kept), `pub fn clear_conflicts(db)` (key `sync_conflicts`, JSON array)
  - `pub fn last_success(db) -> Option<String>`, `pub fn set_last_success(db, &str)` (key `sync_last_success`, RFC 3339)

- [ ] **Step 1:** Write tests with an in-memory db (the `mem_db` pattern from `commands/sync_tests.rs`):
  - `paused_reason_survives_reopen`: use a file-backed temp db, set the reason, reopen, and read `"deletion"`.
  - `conflicts_accumulate_and_dedupe`: add `["a"]`, then add `["a","b"]`; the result is `["a","b"]`. After `clear_conflicts` it is empty.
- [ ] **Step 2:** Run `cargo test git::tests::paused_reason_survives_reopen` and confirm it fails.
- [ ] **Step 3:** Implement on top of the existing config helpers.
- [ ] **Step 4:** Run the tests until they pass.
- [ ] **Step 5:** Commit: `feat(sync): persist pause reason, pending conflicts and last success`.

### Task 4: Pure scheduler state machine

**Files:**
- Create: `src-tauri/src/git/scheduler.rs`
- Test: `src-tauri/src/git/scheduler_tests.rs`

**Interfaces:**
- Produces: `pub enum Trigger { Startup, Focus, Changed, Tick, Manual, Quit }`.
- Produces: `pub enum Outcome { Ok, Offline, Unauthorized, Failed, Paused }`.
- Produces: `pub enum Action { StartCycle, None }`.
- Produces: `pub struct Scheduler`, with times as `Instant` passed in so tests need no real clock:
  - `fn new(now: Instant) -> Self`
  - `fn on_trigger(&mut self, t: Trigger, now: Instant) -> Action`
  - `fn on_tick(&mut self, now: Instant) -> Action`, called every second by the runner; it fires debounces, the periodic tick, backoff and wake detection
  - `fn on_cycle_end(&mut self, o: Outcome, now: Instant)`
  - `fn on_external_change_during_cycle(&mut self)`
  - `fn view(&self) -> SchedulerView`
- Produces: `#[derive(Serialize)] pub struct SchedulerView { pub running: bool, pub pending_debounce: bool, pub consecutive_failures: u32, pub offline: bool, pub halted: bool }`. `halted` is true after `Unauthorized`, or after 3 consecutive `Failed` outcomes.
- Rules, in this order:
  - while a cycle runs, any `StartCycle` decision sets `run_again` instead;
  - `on_cycle_end` starts one more cycle if `run_again` is set;
  - `Changed` (re)arms the 30 s debounce;
  - `Focus` is throttled to 60 s;
  - while `offline` or failing, the backoff (30/60/120/300 s) replaces the 300 s tick;
  - `Unauthorized` halts until a `Manual` trigger.

- [ ] **Step 1:** Write tests.
  - `startup_starts_cycle`
  - `changed_debounces_30s` (no action at 29 s; `StartCycle` at 30 s; a new `Changed` at 20 s restarts the window)
  - `focus_throttled_60s`
  - `periodic_tick_every_300s`
  - `clock_jump_triggers_wake_cycle` (`on_tick` called with `now = last + 700 s` returns `StartCycle`)
  - `change_during_cycle_sets_run_again`
  - `offline_backoff_then_recovers` (intervals 30, 60, 120, 300, 300; after `Ok` back to the 300 s tick)
  - `three_failures_halt`
  - `unauthorized_halts_until_manual`
- [ ] **Step 2:** Run `cargo test git::scheduler_tests` and confirm it fails.
- [ ] **Step 3:** Implement the scheduler without I/O.
- [ ] **Step 4:** Run the tests until they pass.
- [ ] **Step 5:** Commit: `feat(sync): pure scheduler for automatic sync triggers`.

### Task 5: Vault watcher

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `notify` and `notify-debouncer-full`)
- Create: `src-tauri/src/git/watcher.rs`
- Test: `src-tauri/src/git/tests.rs`

**Interfaces:**
- Produces: `pub fn is_ignored(rel: &Path) -> bool`. It is true for paths under `.git/` or `.markdaun/`, `.DS_Store`, names ending in `~`, `.swp` or `.tmp`, and names starting with `.#`.
- Produces: `pub struct VaultWatcher`, with `pub fn start(vault: PathBuf, on_change: impl Fn(Vec<PathBuf>) + Send + 'static) -> notify::Result<Self>` (1 s debouncer; `on_change` receives only non-ignored vault-relative paths) and `Drop`, which stops it.

- [ ] **Step 1:** Write tests.
  - `ignores_git_and_markdaun`: a table of paths and expected booleans.
  - `watcher_reports_note_write`: in a temp dir, write `n.md`; within 5 s the callback has received exactly `["n.md"]`, and nothing for `.git/x`. Use a channel with `recv_timeout`.
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement with `notify_debouncer_full::new_debouncer(Duration::from_secs(1), …)` in `RecursiveMode::Recursive`.
- [ ] **Step 4:** Run the tests until they pass.
- [ ] **Step 5:** Commit: `feat(sync): watch the vault for changes outside the editor`.

### Task 6: Runner, commands and events

**Files:**
- Create: `src-tauri/src/git/runner.rs`
- Modify: `src-tauri/src/commands/sync_cmd.rs` (remove `github_push` and `github_pull`; `github_connect_apply` takes the lock; add the commands below), `src-tauri/src/main.rs:87-93` (register the commands; manage `SyncRunner`; start it after config load; stop and restart it on disconnect and vault change)
- Test: `src-tauri/src/commands/sync_tests.rs`

**Interfaces:**
- Consumes: Tasks 1–5, and `spawn_vault_sync` (`vault_index.rs:294`).
- Produces the Tauri state `SyncRunner`. It holds `Arc<Mutex<Scheduler>>`, a `tokio::sync::Mutex<()>` cycle lock per vault, the watcher, and a `oneshot` for the handshake ack.
- Produces the cycle procedure:
  1. emit `sync-will-start`;
  2. wait up to 2 s for `sync_hold_ack`;
  3. run `git_sync_inner` on `spawn_blocking`, with `push_paused` read from `state::paused_reason`;
  4. persist conflicts and last success, and set the paused reason when `needs_confirmation` is `Some`;
  5. emit `sync-finished`;
  6. if `changed_paths` is non-empty, call `spawn_vault_sync`;
  7. pass the `Outcome` to the scheduler.

  Watcher paths that arrive while a cycle runs, and are not in its `changed_paths`, call `on_external_change_during_cycle`.
- Produces the events:
  - `sync-will-start` (no payload)
  - `sync-finished`, with payload `{ report: CycleReport | null, error: SyncError | null, view: SchedulerView, status: SyncStatus, pausedReason: string | null, pendingConflicts: string[], lastSuccess: string | null }`
- Produces these commands, all returning `Result<_, SyncError>`:
  - `sync_hold_ack()`
  - `sync_trigger(reason: "focus" | "changed" | "manual")`
  - `sync_confirm_deletions()`: runs a cycle with `confirm_deletions: true` and clears the pause
  - `sync_dismiss_conflicts()`
  - `sync_get_state() -> SyncFinishedPayload`: same shape as the event
  - `sync_before_quit()`: flush handshake, local commit, then one bounded cycle if none is running, else wait; never cancels a running cycle

- [ ] **Step 1:** Write tests. They exercise the runner's cycle function directly with a `bare_remote`, through an inner fn taking `db`, vault, url and pat.
  - `deletion_guard_sets_paused_reason`
  - `confirm_clears_pause_and_pushes`
  - `conflicts_persist_across_cycles`
  - `connect_apply_and_cycle_share_lock`: hold the lock and check that `try_lock` fails in connect.
- [ ] **Step 2:** Run `cargo test commands::sync_tests` and confirm it fails.
- [ ] **Step 3:** Implement the runner loop: a `tokio::time::interval(1 s)` calls `on_tick`, and `StartCycle` spawns the cycle procedure. Wire the window focus event (`WindowEvent::Focused(true)`) to `Trigger::Focus` in `main.rs`.
- [ ] **Step 4:** Run `cargo test` (the full suite) and `cargo clippy --all-targets -- -D warnings` until both are clean.
- [ ] **Step 5:** Commit: `feat(sync): run automatic sync cycles with handshake events`.

### Task 7: Frontend API and sync store

**Files:**
- Modify: `src/lib/tauri.ts:104-150`. Remove `githubPush` and `githubPull`; add `syncHoldAck`, `syncTrigger`, `syncConfirmDeletions`, `syncDismissConflicts`, `syncGetState`, `syncBeforeQuit`, `onSyncWillStart`, `onSyncFinished`, and the types `SyncError`, `CycleReport`, `SyncStatus`, `SchedulerView`, `SyncState`, all mirroring Task 6.
- Modify: `src/store/syncStore.ts`. Replace `push`, `pull`, `checkStatus` and `isLoading` with `state: SyncState | null`, `applyFinished(payload)`, `confirmDeletion()`, `dismissConflicts()` and `syncNow()`.
- Produces: `export type SyncIndicator = 'upToDate' | 'syncing' | 'pending' | 'offline' | 'needsReview'` and `export function indicatorFor(s: SyncState, running: boolean): SyncIndicator` in `src/store/syncStore.ts`. Precedence: `needsReview` (the view is halted, `pausedReason` is set, or conflicts are pending) > `syncing` > `offline` > `pending` (uncommitted, ahead > 0, or a debounce is armed) > `upToDate`.
- Test: `src/store/syncStore.test.ts`

- [ ] **Step 1:** Write tests.
  - `indicatorFor precedence`: one case per row of the precedence order.
  - `applyFinished stores pendingConflicts and lastSuccess`.
  - `syncNow calls syncTrigger("manual")`, with the `@tauri-apps/api/core` invoke mocked as in the existing tests.
- [ ] **Step 2:** Run `npx vitest run src/store/syncStore.test.ts` and confirm it fails.
- [ ] **Step 3:** Implement the store and API changes.
- [ ] **Step 4:** Run the tests until they pass, and run `npx tsc --noEmit -p .` until it is clean.
- [ ] **Step 5:** Commit: `feat(sync): frontend sync store driven by sync events`.

### Task 8: Editor handshake and open-note reload

**Files:**
- Modify: `src/store/editorStore.ts`. Generalise the rename/move hold (`relocating`, lines 60 and 223-270) into `holdSaves(): Promise<void>` (flush the pending debounced save, then hold) and `releaseSaves(): void`. Add `applyRemoteChanges(changedPaths: string[], vaultPath: string): Promise<'none' | 'reloaded' | 'conflict' | 'deleted'>`.
- Create: `src/hooks/useAutoSync.ts`. It subscribes to `onSyncWillStart` (`await holdSaves()` then `syncHoldAck()`) and to `onSyncFinished` (`applyRemoteChanges`, `releaseSaves`, `useSyncStore.applyFinished`, `refreshTree`, toasts). It calls `syncTrigger('changed')` after each successful `saveNow`.
- Modify: `src/App.tsx` to mount `useAutoSync`.
- Test: `src/store/editorStore.autosync.test.ts`, `src/hooks/useAutoSync.test.tsx`

**Behaviour of `applyRemoteChanges`** (the open note's vault-relative path is in `changedPaths`):
- **Note deleted on disk:** if the buffer is clean, close the note and return `'deleted'`. If it is dirty, save the buffer, which recreates the file, and return `'conflict'`.
- **Note changed and the buffer is clean:** reload from disk, keep the scroll position best-effort, and return `'reloaded'`.
- **Note changed and the buffer is dirty:** write the on-disk content to a sibling `<stem> (conflicto YYYY-MM-DD HH-mm).<ext>` through a new Tauri command `write_conflict_copy(path, vaultPath) -> String`, which reuses `conflict_copy_name` from `sync.rs:287` and lives in `commands/sync_cmd.rs` with a Rust test. Then save the buffer to the path and return `'conflict'`.

- [ ] **Step 1:** Write tests.
  - `reloads clean open note`
  - `keeps typed buffer and writes remote as conflict copy`: asserts `write_conflict_copy` was invoked, then `write_note` with the buffer text
  - `closes clean note deleted remotely`
  - `holdSaves flushes pending debounce before resolving`
  - In `useAutoSync`, `acks hold after flush` and `shows "Nota actualizada desde GitHub" toast on reload`
  - In Rust, `write_conflict_copy_creates_sibling`
- [ ] **Step 2:** Run `npx vitest run src/store/editorStore.autosync.test.ts src/hooks/useAutoSync.test.tsx` and confirm it fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests until they pass; run `npx tsc --noEmit -p .` and `cargo test commands::` too.
- [ ] **Step 5:** Commit: `feat(sync): hold editor saves during cycles and reload changed notes`.

### Task 9: UI — status item, removed manual controls, quit

**Files:**
- Modify: `src/components/StatusBar/AppStatus.tsx:16-41`. `SyncItem` renders `indicatorFor` with the copy from Global Constraints. Its tooltip is the last success time, or the error detail when in `needsReview`. A click calls `syncNow()`, or opens the deletion dialog when `pausedReason === 'deletion'`.
- Modify: `src/components/Sync/SyncPanel.tsx:56-90`. Remove the ↑/↓ buttons and the badge, keeping connect and disconnect.
- Modify: `src/components/Sync/SyncDialogs.tsx`. The deletion dialog opens when `pausedReason === 'deletion'` (once per launch and on click); the conflicts notice reads `pendingConflicts`.
- Delete: `src/components/Sync/ExitDialog.tsx` and its test. In `src/App.tsx:59-74,164-185`, `request-quit` now shows "Sincronizando antes de salir…", awaits `syncBeforeQuit()`, then calls `quitApp()`.
- Test: `src/components/StatusBar/StatusBar.test.tsx`, `src/components/Sync/SyncPanel.test.tsx`, `src/components/Sync/SyncDialogs.test.tsx`, and `src/App.test.tsx` (create it if missing, only for the quit path).

- [ ] **Step 1:** Write tests.
  - `renders each indicator label`
  - `click triggers manual sync`
  - `click opens deletion dialog when paused`
  - `no push/pull buttons in SyncPanel`
  - `quit awaits syncBeforeQuit then quits`
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement. Remove the store fields and tests that only the deleted dialog and buttons used.
- [ ] **Step 4:** Run `npx vitest run` (the full suite) until it is green, and `npx tsc --noEmit -p .` until it is clean.
- [ ] **Step 5:** Commit: `feat(sync): automatic sync status item and quit flow`.

### Task 10: Docs and end-to-end check

**Files:**
- Modify: `AGENTS.md` §2.5. Sync is automatic, with its triggers, offline behaviour, pause and conflict accumulation. Replace the exposed operations list with `github_connect_preview`, `github_connect_apply`, `github_get_config`, `github_disconnect` and the `sync_*` commands. Drop the "manual" wording.
- Modify: the memory note `~/.claude/projects/-Users-carlosdiez-Projects-markdaun/memory/auto-sync-parked.md`. Mark it as superseded by this design, and update its `MEMORY.md` line.

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2:** Run the full verification: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `npx tsc --noEmit -p .` and `npx vitest run`. All must be green.
- [ ] **Step 3:** Run a manual smoke test in `npm run tauri dev`:
  1. Edit a note and check that the remote updates within ~40 s.
  2. Edit the same note in GitHub's web UI, focus the app, and check that the note reloads with the toast.
  3. Turn Wi-Fi off, edit, and check that the status reads "Sin conexión".
  4. Turn Wi-Fi on and check that it pushes by itself.
- [ ] **Step 4:** Commit: `docs(sync): describe automatic sync in AGENTS.md`.
