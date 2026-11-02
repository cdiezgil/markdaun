use super::scheduler::*;
use std::time::{Duration, Instant, SystemTime};

fn wall(n: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000 + n)
}

/// Tick where the wall clock advances in step with the monotonic one.
fn tk(sc: &mut Scheduler, t0: Instant, now: Instant) -> Action {
    sc.on_tick(now, wall(now.duration_since(t0).as_secs()))
}

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
    assert_eq!(tk(&mut sc, t0, t0 + s(29)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(30)), Action::StartCycle);
    assert!(!sc.view().pending_debounce);
}

#[test]
fn changed_restarts_window() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Changed, t0);
    sc.on_trigger(Trigger::Changed, t0 + s(20));
    assert_eq!(tk(&mut sc, t0, t0 + s(30)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(49)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(50)), Action::StartCycle);
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
    assert_eq!(tk(&mut sc, t0, t0 + s(299)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(300)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0 + s(301));
    assert_eq!(tk(&mut sc, t0, t0 + s(600)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(601)), Action::StartCycle);
}

#[test]
fn clock_jump_triggers_wake_cycle() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new_at(t0, wall(0));
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_cycle_end(Outcome::Ok, t0 + s(1));
    // Monotonic clock barely moved (sleep froze it); wall clock jumped 700 s.
    assert_eq!(sc.on_tick(t0 + s(2), wall(701)), Action::StartCycle);
}

#[test]
fn wake_rebases_periodic_tick() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new_at(t0, wall(0));
    assert_eq!(sc.on_tick(t0 + s(1), wall(701)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0 + s(2));
    assert_eq!(sc.on_tick(t0 + s(3), wall(703)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(301), wall(1001)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(302), wall(1002)), Action::StartCycle);
}

#[test]
fn wake_while_running_sets_run_again() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new_at(t0, wall(0));
    sc.on_trigger(Trigger::Startup, t0);
    assert_eq!(sc.on_tick(t0 + s(1), wall(701)), Action::None);
    sc.on_cycle_end(Outcome::Ok, t0 + s(2));
    assert_eq!(sc.on_tick(t0 + s(3), wall(703)), Action::StartCycle);
}

#[test]
fn exactly_600s_wall_gap_is_not_a_wake() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new_at(t0, wall(0));
    assert_eq!(sc.on_tick(t0 + s(1), wall(600)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(2), wall(1201)), Action::StartCycle);
}

#[test]
fn backwards_wall_jump_is_not_a_wake() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new_at(t0, wall(5000));
    assert_eq!(sc.on_tick(t0 + s(1), wall(100)), Action::None);
    assert_eq!(sc.on_tick(t0 + s(2), wall(101)), Action::None);
}

#[test]
fn change_during_cycle_sets_run_again() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_external_change_during_cycle();
    sc.on_cycle_end(Outcome::Ok, t0 + s(2));
    assert!(!sc.view().running);
    assert_eq!(tk(&mut sc, t0, t0 + s(3)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, t0 + s(4));
    assert_eq!(tk(&mut sc, t0, t0 + s(5)), Action::None);
}

#[test]
fn failed_and_unauthorized_clear_offline() {
    let t0 = Instant::now();
    for o in [Outcome::Failed, Outcome::Unauthorized] {
        let mut sc = Scheduler::new(t0);
        sc.on_trigger(Trigger::Startup, t0);
        sc.on_cycle_end(Outcome::Offline, t0);
        assert!(sc.view().offline);
        sc.on_trigger(Trigger::Manual, t0 + s(1));
        sc.on_cycle_end(o, t0 + s(2));
        assert!(!sc.view().offline, "{o:?}");
    }
}

#[test]
fn manual_resets_backoff_to_first_interval() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_cycle_end(Outcome::Offline, t0);
    sc.on_cycle_end(Outcome::Offline, t0);
    sc.on_cycle_end(Outcome::Offline, t0);
    sc.on_trigger(Trigger::Manual, t0 + s(1));
    sc.on_cycle_end(Outcome::Offline, t0 + s(2));
    assert_eq!(tk(&mut sc, t0, t0 + s(31)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(32)), Action::StartCycle);
}

#[test]
fn external_change_without_cycle_is_ignored() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_external_change_during_cycle();
    assert_eq!(tk(&mut sc, t0, t0 + s(1)), Action::None);
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
        assert_eq!(tk(&mut sc, t0, now + s(secs - 1)), Action::None);
        now += s(secs);
        assert_eq!(tk(&mut sc, t0, now), Action::StartCycle, "after {secs}s");
    }
    sc.on_cycle_end(Outcome::Ok, now);
    assert!(!sc.view().offline);
    assert_eq!(tk(&mut sc, t0, now + s(299)), Action::None);
    assert_eq!(tk(&mut sc, t0, now + s(300)), Action::StartCycle);
}

#[test]
fn three_failures_need_review_but_keep_retrying() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    let mut now = t0;
    sc.on_trigger(Trigger::Startup, now);
    sc.on_cycle_end(Outcome::Failed, now);
    assert!(!sc.view().needs_review);
    now += s(30);
    assert_eq!(tk(&mut sc, t0, now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    now += s(60);
    assert_eq!(tk(&mut sc, t0, now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    let v = sc.view();
    assert!(v.needs_review);
    assert!(!v.halted, "only Unauthorized halts");
    assert_eq!(v.consecutive_failures, 3);
    // Retries continue on the backoff (120 s, then capped at 300 s).
    now += s(120);
    assert_eq!(tk(&mut sc, t0, now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    assert_eq!(tk(&mut sc, t0, now + s(299)), Action::None);
    now += s(300);
    assert_eq!(tk(&mut sc, t0, now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    now += s(300);
    assert_eq!(tk(&mut sc, t0, now), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now);
    // Focus, changes and manual are still honoured.
    assert_eq!(sc.on_trigger(Trigger::Focus, now + s(1)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Failed, now + s(2));
    assert_eq!(sc.on_trigger(Trigger::Changed, now + s(3)), Action::None);
    assert!(sc.view().pending_debounce);
    // A success clears the review state.
    assert_eq!(sc.on_trigger(Trigger::Manual, now + s(4)), Action::StartCycle);
    sc.on_cycle_end(Outcome::Ok, now + s(5));
    assert!(!sc.view().needs_review);
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
    assert_eq!(tk(&mut sc, t0, t0 + s(500)), Action::None);
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
    assert_eq!(tk(&mut sc, t0, t0 + s(3)), Action::StartCycle);
}

#[test]
fn paused_is_not_a_failure() {
    let t0 = Instant::now();
    let mut sc = Scheduler::new(t0);
    sc.on_trigger(Trigger::Startup, t0);
    sc.on_cycle_end(Outcome::Paused, t0);
    let v = sc.view();
    assert!(!v.offline && !v.halted && v.consecutive_failures == 0);
    assert_eq!(tk(&mut sc, t0, t0 + s(299)), Action::None);
    assert_eq!(tk(&mut sc, t0, t0 + s(300)), Action::StartCycle);
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
    assert!(j.contains("needsReview"));
}
