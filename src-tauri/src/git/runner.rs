//! Automatic sync runner.
//!
//! The testable core is plain code: `run_cycle_inner` runs one cycle against
//! a config DB and persists its effects, and `Engine` pairs the scheduler with
//! the watcher bookkeeping. The Tauri glue (`SyncRunner`, `restart`,
//! `trigger`, the cycle procedure and the handshake) stays thin around them.

use super::error::SyncError;
use super::scheduler::{Action, Outcome, Scheduler, SchedulerView, Trigger};
use super::state;
use super::sync::{
    commit_local_inner, git_sync_inner, sync_status_inner, CycleOptions, CycleReport, SyncStatus,
};
use super::watcher::VaultWatcher;
use crate::db::ConfigDb;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, OwnedMutexGuard};

pub const WILL_START_EVENT: &str = "sync-will-start";
pub const FINISHED_EVENT: &str = "sync-finished";
pub const VAULT_CHANGED_EVENT: &str = "vault-changed";
/// How long a cycle waits for the frontend to flush and hold its saves.
const ACK_WAIT: Duration = Duration::from_secs(2);
/// The watcher delivers the cycle's own writes up to ~1 s after it ends.
const LATE_EVENT_GRACE: Duration = Duration::from_secs(3);
const PAUSE_DELETION: &str = "deletion";

// ─── Pure core ────────────────────────────────────────────────────────────────

/// Why a cycle runs; a stronger request wins when several are pending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum CycleMode {
    /// Scheduled: while a pause is persisted the push stays blocked.
    #[default]
    Auto,
    /// "Sincronizar ahora": re-checks the deletion guard even when paused.
    Manual,
    /// "Continuar" in the deletion dialog.
    ConfirmDeletions,
}

#[derive(Debug)]
pub struct CycleRun {
    pub report: Option<CycleReport>,
    pub error: Option<SyncError>,
    pub outcome: Outcome,
}

fn log_write(what: &str, result: rusqlite::Result<()>) {
    if let Err(e) = result {
        eprintln!("[sync] cannot persist {what}: {e}");
    }
}

fn outcome_for_error(e: &SyncError) -> Outcome {
    match e {
        SyncError::Offline(_) => Outcome::Offline,
        // Both stop automatic retries until the config changes.
        SyncError::Unauthorized(_) | SyncError::NotConfigured => Outcome::Unauthorized,
        SyncError::NeedsDeletionConfirmation { .. } => Outcome::Paused,
        SyncError::PushRejected(_) | SyncError::Git(_) => Outcome::Failed,
    }
}

/// One full cycle, persisting conflicts, the pause reason and the last
/// success in `db`. Never panics on a failing write: it is logged.
pub fn run_cycle_inner(
    db: &Connection,
    vault: &Path,
    url: &str,
    pat: &str,
    mode: CycleMode,
) -> CycleRun {
    let reason = state::paused_reason(db);
    let paused = reason.is_some();
    let push_paused = paused && mode == CycleMode::Auto;
    // A stale "Continuar" must never skip the guard: confirming needs the
    // deletion pause that asked for it to still be on record.
    let opts = CycleOptions {
        confirm_deletions: mode == CycleMode::ConfirmDeletions
            && reason.as_deref() == Some(PAUSE_DELETION),
        push_paused,
    };
    match git_sync_inner(vault, url, pat, opts) {
        Ok(report) => {
            log_write("conflicts", state::add_conflicts(db, &report.conflicts));
            let outcome = if report.needs_confirmation.is_some() {
                log_write("pause", state::set_paused_reason(db, Some(PAUSE_DELETION)));
                Outcome::Paused
            } else if push_paused {
                Outcome::Paused
            } else {
                if paused {
                    log_write("pause", state::set_paused_reason(db, None));
                }
                let now = chrono::Utc::now().to_rfc3339();
                log_write("last success", state::set_last_success(db, &now));
                Outcome::Ok
            };
            CycleRun {
                report: Some(report),
                error: None,
                outcome,
            }
        }
        Err(e) => CycleRun {
            outcome: outcome_for_error(&e),
            report: None,
            error: Some(e),
        },
    }
}

/// `sync_confirm_deletions` is only accepted while a deletion pause is persisted.
pub fn confirm_allowed(db: &Connection) -> Result<(), SyncError> {
    match state::paused_reason(db).as_deref() {
        Some(PAUSE_DELETION) => Ok(()),
        _ => Err(SyncError::Git("no_deletion_pause".to_string())),
    }
}

/// Persisted and on-disk state shown next to every cycle result.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: SyncStatus,
    pub paused_reason: Option<String>,
    pub pending_conflicts: Vec<String>,
    pub last_success: Option<String>,
}

pub fn snapshot(db: Option<&Connection>, vault: Option<&Path>) -> Snapshot {
    Snapshot {
        status: vault
            .and_then(|v| sync_status_inner(v).ok())
            .unwrap_or_default(),
        paused_reason: db.and_then(state::paused_reason),
        pending_conflicts: db.map(state::pending_conflicts).unwrap_or_default(),
        last_success: db.and_then(state::last_success),
    }
}

/// Payload of `sync-finished` and the result of `sync_get_state`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFinishedPayload {
    pub report: Option<CycleReport>,
    pub error: Option<SyncError>,
    pub view: SchedulerView,
    #[serde(flatten)]
    pub snapshot: Snapshot,
}

/// Scheduler plus the watcher bookkeeping around a running cycle.
#[derive(Debug)]
pub struct Engine {
    scheduler: Scheduler,
    /// Paths reported by the watcher while a cycle runs.
    in_cycle: Option<HashSet<String>>,
    /// The last cycle's own paths, ignored until the deadline.
    recent: Option<(Instant, HashSet<String>)>,
    /// Set by the quit path: no cycle may start any more.
    quitting: bool,
}

impl Engine {
    pub fn new(now: Instant, wall: SystemTime) -> Self {
        Engine {
            scheduler: Scheduler::new_at(now, wall),
            in_cycle: None,
            recent: None,
            quitting: false,
        }
    }

    pub fn quit(&mut self) {
        self.quitting = true;
    }

    fn started(&mut self, action: Action) -> Action {
        if self.quitting {
            // The scheduler may think a cycle runs; nothing will end it now.
            return Action::None;
        }
        if action == Action::StartCycle {
            self.in_cycle = Some(HashSet::new());
        }
        action
    }

    pub fn trigger(&mut self, t: Trigger, now: Instant) -> Action {
        let action = self.scheduler.on_trigger(t, now);
        self.started(action)
    }

    pub fn tick(&mut self, now: Instant, wall: SystemTime) -> Action {
        let action = self.scheduler.on_tick(now, wall);
        self.started(action)
    }

    /// A watcher batch (vault-relative, `/`-separated paths).
    pub fn watch(&mut self, paths: &[String], now: Instant) {
        if let Some(buffer) = &mut self.in_cycle {
            buffer.extend(paths.iter().cloned());
            return;
        }
        let foreign = match &self.recent {
            Some((until, own)) if now < *until => paths.iter().any(|p| !own.contains(p)),
            _ => !paths.is_empty(),
        };
        if foreign {
            self.scheduler.on_trigger(Trigger::Changed, now);
        }
    }

    /// End of the running cycle; `changed` is its `changed_paths`. `clean`
    /// means the vault had nothing uncommitted and nothing unpushed right
    /// after the cycle: foreign writes seen during it were already synced
    /// (typically the handshake flush), so they do not cost a rerun.
    pub fn end(&mut self, outcome: Outcome, changed: &[String], clean: bool, now: Instant) {
        let own: HashSet<String> = changed.iter().cloned().collect();
        if let Some(buffer) = self.in_cycle.take() {
            if !clean && buffer.iter().any(|p| !own.contains(p)) {
                self.scheduler.on_external_change_during_cycle();
            }
        }
        self.recent = Some((now + LATE_EVENT_GRACE, own));
        self.scheduler.on_cycle_end(outcome, now);
    }

    pub fn view(&self) -> SchedulerView {
        self.scheduler.view()
    }
}

/// One async lock per vault, shared by cycles and `github_connect_apply`.
#[derive(Default)]
pub struct SyncLocks(Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>);

impl SyncLocks {
    /// The key is the canonical path, so `/var/x` and `/private/var/x/.`
    /// share one lock; a path that cannot be resolved is used as given.
    pub fn for_vault(&self, vault: &str) -> Arc<tokio::sync::Mutex<()>> {
        let key = std::fs::canonicalize(vault)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| vault.to_string());
        lock(&self.0).entry(key).or_default().clone()
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

// ─── Tauri glue ───────────────────────────────────────────────────────────────

/// The running session for the configured vault. Dropping it stops the
/// watcher and the tick loop; a cycle already running finishes on its own.
struct Session {
    ctx: Ctx,
    _watcher: Option<VaultWatcher>,
    tick: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.tick.abort();
    }
}

#[derive(Clone)]
struct Ctx {
    id: u64,
    engine: Arc<Mutex<Engine>>,
    vault: String,
    url: String,
}

#[derive(Default)]
pub struct SyncRunner {
    pub locks: SyncLocks,
    session: Mutex<Option<Session>>,
    /// Bumped by every restart; cycles of older sessions report nothing.
    session_id: AtomicU64,
    /// Only the handshake in progress may be acknowledged.
    ack_slot: Mutex<Option<oneshot::Sender<()>>>,
    mode: Mutex<CycleMode>,
    last_error: Mutex<Option<SyncError>>,
    quitting: AtomicBool,
    /// Held from the quit cycle until the process exits.
    quit_guard: Mutex<Option<OwnedMutexGuard<()>>>,
}

impl SyncRunner {
    fn ctx(&self) -> Option<Ctx> {
        lock(&self.session).as_ref().map(|s| s.ctx.clone())
    }

    pub fn is_active(&self) -> bool {
        lock(&self.session).is_some()
    }

    pub fn request_mode(&self, mode: CycleMode) {
        let mut m = lock(&self.mode);
        *m = (*m).max(mode);
    }

    pub(crate) fn take_mode(&self) -> CycleMode {
        std::mem::take(&mut *lock(&self.mode))
    }

    /// The frontend flushed and holds its saves.
    pub fn ack(&self) {
        if let Some(tx) = lock(&self.ack_slot).take() {
            let _ = tx.send(());
        }
    }

    /// Open the ack slot for a new handshake, replacing any stale sender.
    pub(crate) fn register_ack(&self) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        *lock(&self.ack_slot) = Some(tx);
        rx
    }

    fn clear_ack(&self) {
        lock(&self.ack_slot).take();
    }

    /// Forget everything tied to the previous session and return the new
    /// session id.
    pub(crate) fn reset_for_restart(&self) -> u64 {
        *lock(&self.mode) = CycleMode::Auto;
        *lock(&self.last_error) = None;
        self.clear_ack();
        self.session_id.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn is_current(&self, id: u64) -> bool {
        self.session_id.load(Ordering::SeqCst) == id
    }

    pub(crate) fn begin_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    /// False once the app is quitting: no new git work may start.
    pub(crate) fn may_run(&self) -> bool {
        !self.quitting.load(Ordering::SeqCst)
    }
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::commands::brain_cmd::app_db_path(app)
}

fn open_db(app: &AppHandle) -> Option<ConfigDb> {
    match db_path(app).and_then(|p| ConfigDb::open(&p).map_err(|e| e.to_string())) {
        Ok(db) => Some(db),
        Err(e) => {
            eprintln!("[sync] cannot open config.db: {e}");
            None
        }
    }
}

/// `(vault, url)` when GitHub sync is configured for the active vault.
fn configured(app: &AppHandle) -> Option<(String, String)> {
    let db = open_db(app)?;
    let read = |key: &str| db.get(key).ok().flatten().filter(|s| !s.is_empty());
    Some((read("active_vault")?, read("github_repo_url")?))
}

fn read_pat() -> Result<String, SyncError> {
    use crate::commands::sync_cmd::{KEYRING_SERVICE, KEYRING_USER};
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| SyncError::Git(format!("keyring: {e}")))?;
    match entry.get_password() {
        Ok(pat) => Ok(pat),
        Err(keyring::Error::NoEntry) => Err(SyncError::NotConfigured),
        Err(e) => Err(SyncError::Git(format!("keyring: {e}"))),
    }
}

/// Stop the current session and start a new one if sync is configured.
/// Called at startup and whenever the GitHub config or the vault changes,
/// so a halted scheduler (e.g. after `Unauthorized`) starts fresh.
pub fn restart(app: &AppHandle) {
    let runner = app.state::<SyncRunner>();
    if !runner.may_run() {
        return;
    }
    // Drop the old session outside the lock: it stops its watcher.
    let old = lock(&runner.session).take();
    drop(old);
    let id = runner.reset_for_restart();
    let Some((vault, url)) = configured(app) else {
        return;
    };
    let ctx = Ctx {
        id,
        engine: Arc::new(Mutex::new(Engine::new(Instant::now(), SystemTime::now()))),
        vault,
        url,
    };
    let watcher = start_watcher(app, &ctx);
    let tick = spawn_tick_loop(app.clone(), ctx.clone());
    *lock(&runner.session) = Some(Session {
        ctx,
        _watcher: watcher,
        tick,
    });
    trigger(app, Trigger::Startup);
}

/// Feed a discrete trigger to the scheduler; start a cycle if it says so.
pub fn trigger(app: &AppHandle, t: Trigger) {
    let runner = app.state::<SyncRunner>();
    if !runner.may_run() {
        return;
    }
    let Some(ctx) = runner.ctx() else {
        return;
    };
    let action = lock(&ctx.engine).trigger(t, Instant::now());
    if action == Action::StartCycle {
        tauri::async_runtime::spawn(run_cycle(app.clone(), ctx));
    }
}

fn start_watcher(app: &AppHandle, ctx: &Ctx) -> Option<VaultWatcher> {
    let app = app.clone();
    let engine = ctx.engine.clone();
    let on_change = move |paths: Vec<PathBuf>| {
        let rels: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();
        let _ = app.emit(VAULT_CHANGED_EVENT, &rels);
        lock(&engine).watch(&rels, Instant::now());
    };
    match VaultWatcher::start(PathBuf::from(&ctx.vault), on_change) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("[sync] cannot watch {}: {e}", ctx.vault);
            None
        }
    }
}

fn spawn_tick_loop(app: AppHandle, ctx: Ctx) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if !app.state::<SyncRunner>().may_run() {
                break;
            }
            // Never `on_trigger(Tick)`: only `on_tick` detects a wake.
            let action = lock(&ctx.engine).tick(Instant::now(), SystemTime::now());
            if action == Action::StartCycle {
                tauri::async_runtime::spawn(run_cycle(app.clone(), ctx.clone()));
            }
        }
    })
}

/// Emit `sync-will-start` and wait up to 2 s for `sync_hold_ack`.
async fn handshake(app: &AppHandle) {
    let rx = app.state::<SyncRunner>().register_ack();
    let _ = app.emit(WILL_START_EVENT, ());
    if tokio::time::timeout(ACK_WAIT, rx).await.is_err() {
        app.state::<SyncRunner>().clear_ack();
    }
}

/// Runs on a blocking thread: one cycle plus the state to report with it.
fn cycle_blocking(
    db_path: Result<PathBuf, String>,
    vault: &str,
    url: &str,
    mode: CycleMode,
) -> (CycleRun, Snapshot) {
    let db = match db_path.and_then(|p| ConfigDb::open(&p).map_err(|e| e.to_string())) {
        Ok(db) => db,
        Err(e) => {
            let run = CycleRun {
                report: None,
                error: Some(SyncError::Git(format!("config.db: {e}"))),
                outcome: Outcome::Failed,
            };
            return (run, snapshot(None, Some(Path::new(vault))));
        }
    };
    let run = match read_pat() {
        Ok(pat) => run_cycle_inner(db.connection(), Path::new(vault), url, &pat, mode),
        Err(e) => CycleRun {
            outcome: outcome_for_error(&e),
            report: None,
            error: Some(e),
        },
    };
    (run, snapshot(Some(db.connection()), Some(Path::new(vault))))
}

/// Lock, handshake, run, report. Reindexing is requested after the lock is
/// released; `spawn_vault_sync` skips duplicates on its own.
async fn run_cycle(app: AppHandle, ctx: Ctx) {
    if !app.state::<SyncRunner>().may_run() {
        return;
    }
    let cycle_lock = app.state::<SyncRunner>().locks.for_vault(&ctx.vault);
    let guard = cycle_lock.lock_owned().await;
    // The quit path may have started while this cycle waited for the lock.
    if !app.state::<SyncRunner>().may_run() {
        return;
    }
    handshake(&app).await;
    let mode = app.state::<SyncRunner>().take_mode();
    let (path, vault, url) = (db_path(&app), ctx.vault.clone(), ctx.url.clone());
    let joined =
        tokio::task::spawn_blocking(move || cycle_blocking(path, &vault, &url, mode)).await;
    drop(guard);
    let (run, snap) = joined.unwrap_or_else(|e| {
        let run = CycleRun {
            report: None,
            error: Some(SyncError::Git(format!("sync task failed: {e}"))),
            outcome: Outcome::Failed,
        };
        (run, Snapshot::default())
    });

    let changed = run
        .report
        .as_ref()
        .map(|r| r.changed_paths.clone())
        .unwrap_or_default();
    let clean = !snap.status.uncommitted && snap.status.ahead == 0;
    let view = {
        let mut engine = lock(&ctx.engine);
        engine.end(run.outcome, &changed, clean, Instant::now());
        engine.view()
    };
    let runner = app.state::<SyncRunner>();
    if !runner.is_current(ctx.id) {
        // A restart (reconnect, vault change) replaced this session.
        return;
    }
    *lock(&runner.last_error) = run.error.clone();
    let payload = SyncFinishedPayload {
        report: run.report,
        error: run.error,
        view,
        snapshot: snap,
    };
    let _ = app.emit(FINISHED_EVENT, &payload);
    if !changed.is_empty() {
        crate::commands::vault_index::spawn_vault_sync(&app, ctx.vault);
    }
}

/// Current state in the `sync-finished` shape (no report).
pub fn current_state(app: &AppHandle) -> SyncFinishedPayload {
    let runner = app.state::<SyncRunner>();
    let ctx = runner.ctx();
    let db = open_db(app);
    let conn = db.as_ref().map(|d| d.connection());
    let vault = match &ctx {
        Some(c) => Some(c.vault.clone()),
        None => db
            .as_ref()
            .and_then(|d| d.get("active_vault").ok().flatten())
            .filter(|s| !s.is_empty()),
    };
    let (view, error) = match &ctx {
        Some(c) => (lock(&c.engine).view(), lock(&runner.last_error).clone()),
        None => (
            Scheduler::new(Instant::now()).view(),
            Some(SyncError::NotConfigured),
        ),
    };
    SyncFinishedPayload {
        report: None,
        error,
        view,
        snapshot: snapshot(conn, vault.as_deref().map(Path::new)),
    }
}

/// Quit path. Neutralises the session first (no tick, watcher or trigger can
/// start git work), then takes the cycle lock, waiting for a running cycle,
/// and keeps it until exit. Under the lock: flush handshake, local commit,
/// and one bounded push cycle unless a cycle just ran and nothing new was
/// committed. Never cancels a running git operation.
pub async fn before_quit(app: &AppHandle) {
    let runner = app.state::<SyncRunner>();
    runner.begin_quit();
    let Some(ctx) = runner.ctx() else {
        return;
    };
    lock(&ctx.engine).quit();
    // Stops the tick loop and the watcher; a running cycle keeps going.
    let old = lock(&runner.session).take();
    drop(old);

    let cycle_lock = runner.locks.for_vault(&ctx.vault);
    let (guard, cycle_just_ran) = match cycle_lock.clone().try_lock_owned() {
        Ok(guard) => (guard, false),
        Err(_) => (cycle_lock.lock_owned().await, true),
    };
    handshake(app).await;
    let (path, vault, url) = (db_path(app), ctx.vault.clone(), ctx.url.clone());
    let joined = tokio::task::spawn_blocking(move || {
        let committed = match commit_local_inner(Path::new(&vault)) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] local commit before quit failed: {e:?}");
                false
            }
        };
        (!cycle_just_ran || committed)
            .then(|| cycle_blocking(path, &vault, &url, CycleMode::Auto))
    })
    .await;
    // Held until the process exits: no other cycle may start.
    *lock(&runner.quit_guard) = Some(guard);
    match joined {
        Ok(Some((run, snap))) => {
            let payload = SyncFinishedPayload {
                report: run.report,
                error: run.error,
                view: lock(&ctx.engine).view(),
                snapshot: snap,
            };
            let _ = app.emit(FINISHED_EVENT, &payload);
        }
        Ok(None) => {}
        Err(e) => eprintln!("[sync] quit cycle task failed: {e}"),
    }
}
