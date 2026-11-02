//! Tests for the runner's pure engine: scheduler + watcher bookkeeping.

use super::runner::Engine;
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
    e.end(Outcome::Ok, &s(&["merged.md"]), now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::StartCycle);
}

#[test]
fn cycle_own_writes_do_not_run_again() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["merged.md"]), now);
    e.end(Outcome::Ok, &s(&["merged.md"]), now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::None);
    assert!(!e.view().pending_debounce);
}

#[test]
fn late_events_for_cycle_paths_are_ignored_briefly() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.end(Outcome::Ok, &s(&["merged.md"]), now);
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
    e.end(Outcome::Ok, &s(&["merged.md"]), now);
    e.watch(&s(&["merged.md", "other.md"]), now + Duration::from_secs(1));
    assert!(e.view().pending_debounce);
}

#[test]
fn buffered_paths_reset_between_cycles() {
    let (now, wall) = (Instant::now(), SystemTime::now());
    let mut e = started(now, wall);
    e.watch(&s(&["agent.md"]), now);
    e.end(Outcome::Ok, &s(&[]), now);
    assert_eq!(e.tick(now + Duration::from_secs(1), wall), Action::StartCycle);
    e.end(Outcome::Ok, &s(&[]), now + Duration::from_secs(2));
    assert_eq!(e.tick(now + Duration::from_secs(3), wall), Action::None);
}
