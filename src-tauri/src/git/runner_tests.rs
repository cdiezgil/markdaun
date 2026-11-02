//! Tests for the runner's pure engine: scheduler + watcher bookkeeping.

use super::runner::{CycleMode, Engine, SyncLocks, SyncRunner};
use super::scheduler::{Action, Outcome, Trigger};
use std::time::{Duration, Instant, SystemTime};

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn started(now: Instant, wall: SystemTime) -> Engine {
    let mut e = Engine::new(now, wall);
    assert_eq!(e.trigger(Trigger::Startup, now), Action::StartCycle);
    e
}

#[test]
fn change_outside_a_cycle_schedules_the_debounce() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = Engine::new(now, wall);
    e.watch(&s(&["a.md"]), now);
    assert!(e.view().pending_debounce);
    assert_eq!(e.tick(now + Duration::from_secs(29), wall), Action::None);
    assert_eq!(e.tick(now + Duration::from_secs(31), wall), Action::StartCycle);
}

#[test]
fn foreign_write_during_cycle_runs_again() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["merged.md", "agent.md"]), now);
    assert!(!e.view().pending_debounce, "no debounce while a cycle runs");
    e.end(Outcome::Ok, &s(&["merged.md"]), false, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::StartCycle);
}

#[test]
fn cycle_own_writes_do_not_run_again() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["merged.md"]), now);
    e.end(Outcome::Ok, &s(&["merged.md"]), false, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::None);
    assert!(!e.view().pending_debounce);
}

#[test]
fn late_events_for_cycle_paths_are_ignored_briefly() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.end(Outcome::Ok, &s(&["merged.md"]), false, now);
    // The watcher's own debounce delivers the merge writes after the cycle.
    e.watch(&s(&["merged.md"]), now + Duration::from_secs(1));
    assert!(!e.view().pending_debounce);
    // Past the grace window the same path is a real edit again.
    e.watch(&s(&["merged.md"]), now + Duration::from_secs(10));
    assert!(e.view().pending_debounce);
}

#[test]
fn foreign_path_in_grace_window_still_schedules() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.end(Outcome::Ok, &s(&["merged.md"]), false, now);
    e.watch(&s(&["merged.md", "other.md"]), now + Duration::from_secs(1));
    assert!(e.view().pending_debounce);
}

#[test]
fn buffered_paths_reset_between_cycles() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["agent.md"]), now);
    e.end(Outcome::Ok, &s(&[]), false, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::StartCycle);
    e.end(Outcome::Ok, &s(&[]), false, now + Duration::from_secs(2));
    assert_eq!(e.tick(now + Duration::from_secs(3), wall), Action::None);
}

#[test]
fn foreign_rerun_dropped_when_vault_is_clean() {
    // The handshake flush writes the open note; the cycle commits and pushes
    // it, so the watcher's late report must not cost a second cycle.
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["open.md"]), now);
    e.end(Outcome::Ok, &s(&[]), true, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::None);
}

#[test]
fn rerun_from_a_trigger_survives_a_clean_vault() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["open.md"]), now);
    assert_eq!(e.trigger(Trigger::Manual, now), Action::None, "coalesced");
    e.end(Outcome::Ok, &s(&[]), true, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::StartCycle);
}

#[test]
fn quitting_engine_never_starts_a_cycle() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["agent.md"]), now);
    e.quit();
    e.end(Outcome::Ok, &s(&[]), false, now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::None);
    assert_eq!(e.trigger(Trigger::Manual, now), Action::None);
    assert_eq!(e.trigger(Trigger::Startup, now), Action::None);
    // Even a wake (wall-clock jump) stays silent.
    let later = wall + Duration::from_secs(3600);
    assert_eq!(e.tick(now + Duration::from_secs(2), later), Action::None);
}

#[test]
fn quitting_runner_refuses_git_work() {
    let runner = SyncRunner::default();
    assert!(runner.may_run());
    runner.begin_quit();
    assert!(!runner.may_run(), "run_cycle must be a no-op once quitting");
}

#[test]
fn cancelled_quit_releases_the_lock_and_allows_git_work() {
    let runner = SyncRunner::default();
    let lock = runner.locks.for_vault("/v");
    runner.begin_quit();
    runner.keep_quit_guard(lock.clone().try_lock_owned().unwrap());
    assert!(lock.try_lock().is_err(), "held until the process exits");

    runner.cancel_quit();
    assert!(runner.may_run());
    assert!(lock.try_lock().is_ok(), "a failed quit must not leave sync dead");
}

#[test]
fn restart_clears_pending_confirm() {
    let runner = SyncRunner::default();
    runner.request_mode(CycleMode::ConfirmDeletions { deleted: 1 });
    runner.reset_for_restart();
    assert_eq!(runner.take_mode(), CycleMode::Auto);
}

#[test]
fn restart_makes_older_sessions_stale() {
    let runner = SyncRunner::default();
    let first = runner.reset_for_restart();
    assert!(runner.is_current(first));
    let second = runner.reset_for_restart();
    assert!(!runner.is_current(first));
    assert!(runner.is_current(second));
}

#[test]
fn ack_slot_holds_only_the_latest_handshake() {
    let runner = SyncRunner::default();
    let mut stale = runner.register_ack();
    let mut fresh = runner.register_ack();
    runner.ack();
    assert!(stale.try_recv().is_err(), "a replaced sender never fires");
    assert!(fresh.try_recv().is_ok());
    // An ack with no handshake waiting is not stored for a later one.
    runner.ack();
    let mut later = runner.register_ack();
    assert!(later.try_recv().is_err());
}

#[test]
fn lock_key_is_canonical() {
    let dir = tempfile::TempDir::new().unwrap();
    let raw = dir.path().to_str().unwrap().to_string();
    let dotted = format!("{raw}/.");
    let locks = SyncLocks::default();
    assert!(std::sync::Arc::ptr_eq(&locks.for_vault(&raw), &locks.for_vault(&dotted)));
    // A missing path falls back to the raw string.
    let a = locks.for_vault("/no/such/vault");
    assert!(std::sync::Arc::ptr_eq(&a, &locks.for_vault("/no/such/vault")));
}

// ─── Hold release and cycle flow (fake host) ────────────────────────────────

mod flow {
    use crate::git::error::SyncError;
    use crate::git::runner::{
        drive_cycle, is_clean, quit_should_push, snapshot, CycleHost, CycleRun, Engine, Snapshot,
        SyncFinishedPayload,
    };
    use crate::git::scheduler::{Outcome, Trigger};
    use crate::git::sync::{CycleReport, SyncStatus};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Instant, SystemTime};
    use tokio::sync::oneshot;

    struct Fake {
        current: AtomicBool,
        /// Simulates a restart while the frontend is flushing.
        stale_on_ack: bool,
        events: Mutex<Vec<String>>,
    }

    impl Fake {
        fn new(current: bool) -> Self {
            Fake {
                current: AtomicBool::new(current),
                stale_on_ack: false,
                events: Mutex::new(Vec::new()),
            }
        }
        fn push(&self, e: &str) {
            self.events.lock().unwrap().push(e.to_string());
        }
        fn events(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }
    }

    impl CycleHost for Fake {
        fn may_run(&self) -> bool {
            true
        }
        fn is_current(&self) -> bool {
            self.current.load(Ordering::SeqCst)
        }
        fn open_ack(&self) -> oneshot::Receiver<()> {
            if self.stale_on_ack {
                self.current.store(false, Ordering::SeqCst);
            }
            let (tx, rx) = oneshot::channel();
            let _ = tx.send(());
            rx
        }
        fn close_ack(&self) {}
        fn will_start(&self) {
            self.push("will-start");
        }
        fn release(&self) {
            self.push("release");
        }
        fn finished(&self, _payload: &SyncFinishedPayload) {
            self.push("finished");
        }
        fn record_error(&self, _error: Option<SyncError>) {
            self.push("record-error");
        }
        fn reindex(&self) {
            self.push("reindex");
        }
    }

    fn engine() -> Mutex<Engine> {
        let mut e = Engine::new(Instant::now(), SystemTime::now());
        e.trigger(Trigger::Startup, Instant::now());
        Mutex::new(e)
    }

    fn ok_run(changed: &[&str]) -> (CycleRun, Snapshot) {
        let report = CycleReport {
            changed_paths: changed.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        let run = CycleRun {
            report: Some(report),
            error: None,
            outcome: Outcome::Ok,
        };
        (run, Snapshot::default())
    }

    #[tokio::test]
    async fn stale_before_handshake_skips_git_and_hold() {
        let host = Fake::new(false);
        let worked = AtomicBool::new(false);
        drive_cycle(&host, &engine(), || async {
            worked.store(true, Ordering::SeqCst);
            Ok(ok_run(&[]))
        })
        .await;
        assert!(!worked.load(Ordering::SeqCst));
        assert!(host.events().is_empty(), "{:?}", host.events());
    }

    #[tokio::test]
    async fn stale_during_handshake_releases_without_git() {
        let host = Fake {
            stale_on_ack: true,
            ..Fake::new(true)
        };
        let worked = AtomicBool::new(false);
        drive_cycle(&host, &engine(), || async {
            worked.store(true, Ordering::SeqCst);
            Ok(ok_run(&[]))
        })
        .await;
        assert!(!worked.load(Ordering::SeqCst), "no git work once stale");
        assert_eq!(host.events(), vec!["will-start", "release"]);
    }

    #[tokio::test]
    async fn stale_after_git_work_releases() {
        let host = Fake::new(true);
        drive_cycle(&host, &engine(), || async {
            host.current.store(false, Ordering::SeqCst);
            Ok(ok_run(&["a.md"]))
        })
        .await;
        assert_eq!(host.events(), vec!["will-start", "release"]);
    }

    #[tokio::test]
    async fn failed_task_still_finishes() {
        let host = Fake::new(true);
        drive_cycle(&host, &engine(), || async { Err("task panicked".to_string()) }).await;
        assert_eq!(host.events(), vec!["will-start", "record-error", "finished"]);
    }

    #[tokio::test]
    async fn success_finishes_then_reindexes() {
        let host = Fake::new(true);
        drive_cycle(&host, &engine(), || async { Ok(ok_run(&["a.md"])) }).await;
        assert_eq!(
            host.events(),
            vec!["will-start", "record-error", "finished", "reindex"]
        );
    }

    #[test]
    fn clean_needs_a_successful_status_read() {
        assert!(!is_clean(&Snapshot::default()), "unread status is not clean");
        let dir = tempfile::TempDir::new().unwrap();
        // A `.git` that is not a repository makes the status read fail.
        std::fs::write(dir.path().join(".git"), "garbage").unwrap();
        let snap = snapshot(None, Some(dir.path()));
        assert!(!is_clean(&snap));
        let plain = tempfile::TempDir::new().unwrap();
        assert!(is_clean(&snapshot(None, Some(plain.path()))));
    }

    #[test]
    fn quit_pushes_new_or_unpushed_commits() {
        let clean = SyncStatus { uncommitted: false, ahead: 0 };
        let ahead = SyncStatus { uncommitted: false, ahead: 2 };
        assert!(!quit_should_push(false, Ok(clean.clone())));
        assert!(quit_should_push(true, Ok(clean)));
        assert!(quit_should_push(false, Ok(ahead)));
        assert!(quit_should_push(false, Err(SyncError::Git("x".into()))), "unknown: try");
    }
}
