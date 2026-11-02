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
fn restart_clears_pending_confirm() {
    let runner = SyncRunner::default();
    runner.request_mode(CycleMode::ConfirmDeletions);
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
