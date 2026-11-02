use super::scheduler::*;
use std::time::{Duration, Instant};

fn s(n: u64) -> Duration {
    Duration::from_secs(n)
}

#[test]
fn startup_starts_cycle() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    assert_eq!(sc.on_trigger(Trigger::Startup, t0), Action::StartCycle);
    assert!(sc.view().running);
}

#[test]
fn changed_debounces_30s() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Changed, t0);
    assert!(sc.view().pending_debounce);
    assert_eq!(sc.on_tick(t0 + s(29)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(30)), Action::StartCycle);
    assert!(!sc.view().pending_debounce);
}

#[test]
fn changed_restarts_window() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Changed, t0);
    sc.on_trigger(Trigger::Changed, t0 + s(20));
    assert_eq!(sc.on_tick(t0 + s(30)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(49)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(50)), Action::StartCycle);
}

#[test]
fn focus_throttled_60s() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0 + s(30)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0 + s(59)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0 + s(60)), Action::StartCycle);
}

#[test]
fn periodic_tick_every_300s() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    assert_eq!(sc.on_tick(t0 + s(299)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(300)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0 + s(301));
    assert_eq!(sc.on_tick(t0 + s(600)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(601)), Action::StartCycle);
}

#[test]
fn clock_jump_triggers_wake_cycle() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_tick(t0 + s(1));
    assert_eq!(sc.on_tick(t0 + s(1) + s(700)), Action::StartCycle);
}

#[test]
fn change_during_cycle_sets_run_again() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0 + s(1)), Action::None);
    sc.on_external_change_during_cycle();
    sc.on_cycle_end(Outcome::Ok, t0 + s(2));
    assert!(!sc.view().running);
    assert_eq!(sc.on_tick(t0 + s(3)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0 + s(4));
    assert_eq!(sc.on_tick(t0 + s(5)), Action::None);
}

#[test]
fn external_change_without_cycle_is_ignored() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_external_change_during_cycle();
    assert_eq!(sc.on_tick(t0 + s(1)), Action::None);
}

#[test]
fn offline_backoff_then_recovers() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    let mut now = t0;
    sc.on_trigger(Trigger::Startup, now);
    for secs in [30, 60, 120, 300, 300] {
        sc.on_cycle_end(Outcome::Offline, now);
        assert!(sc.view().offline);
        assert!(!sc.view().halted);
        assert_eq!(sc.on_tick(now + s(secs - 1)), Action::None);
        now += s(secs);
        assert_eq!(sc.on_tick(now), Action::StartCycle, "after {secs}s");
    }
    sc.on_cycle_end(Outcome::Ok, now);
    assert!(!sc.view().offline);
    assert_eq!(sc.on_tick(now + s(299)), Action::None);
    assert_eq!(sc.on_tick(now + s(300)), Action::StartCycle);
}

#[test]
fn three_failures_halt() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    let mut now = t0;
    sc.on_trigger(Trigger::Startup, now);
    sc.on_cycle_end(Outcome::Failed, now);
    assert!(!sc.view().halted);
    now += s(30);
    assert_eq!(sc.on_tick(now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    now += s(60);
    assert_eq!(sc.on_tick(now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    let v = sc.view();
    assert!(v.halted);
    assert_eq!(v.consecutive_failures, 3);
    assert_eq!(sc.on_tick(now + s(1000)), Action::None);
}

#[test]
fn unauthorized_halts_until_manual() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_cycle_end(Outcome::Unauthorized, t0);
    assert!(sc.view().halted);
    assert_eq!(sc.on_trigger(Trigger::Focus, t0 + s(100)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Changed, t0 + s(100)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(500)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Manual, t0 + s(501)), Action::StartCycle);
    assert!(!sc.view().halted);
}

#[test]
fn manual_while_running_queues_and_quit_is_noop() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    assert_eq!(sc.on_trigger(Trigger::Manual, t0 + s(1)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Quit, t0 + s(1)), Action::None);
    sc.on_cycle_end(Outcome::Ok, t0 + s(2));
    assert_eq!(sc.on_tick(t0 + s(3)), Action::StartCycle);
}

#[test]
fn paused_is_not_a_failure() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_cycle_end(Outcome::Paused, t0);
    let v = sc.view();
    assert!(!v.offline && !v.halted && v.consecutive_failures == 0);
    assert_eq!(sc.on_tick(t0 + s(299)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(300)), Action::StartCycle);
}

#[test]
fn tick_trigger_acts_like_on_tick() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    assert_eq!(sc.on_trigger(Trigger::Tick, t0 + s(299)), Action::None);
    assert_eq!(sc.on_trigger(Trigger::Tick, t0 + s(300)), Action::StartCycle);
}

#[test]
fn view_serializes_camel_case() {
    let sc = Scheduler::new(Instant::now());
    let j = serde_json::to_string(&sc.view()).unwrap();
    assert!(j.contains("pendingDebounce") && j.contains("consecutiveFailures"));
}
