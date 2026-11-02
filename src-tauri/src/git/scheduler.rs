//! Pure, I/O-free state machine that decides when an automatic sync cycle
//! must start. Times are `Instant`s passed in by the caller, so tests need no
//! real clock. The runner calls `on_tick` every second, `on_trigger` for
//! discrete events and `on_cycle_end` after each cycle.
//!
//! `Trigger::Quit` is handled outside the scheduler (the runner flushes a
//! final cycle itself), so here it always yields `Action::None`.

use serde::Serialize;
use std::time::{Duration, Instant, SystemTime};

const DEBOUNCE: Duration = Duration::from_secs(30);
const FOCUS_THROTTLE: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_secs(300);
/// Wall-clock gap between two ticks beyond which we assume the machine slept.
const WAKE_GAP: Duration = Duration::from_secs(2 * 300);
const BACKOFF_SECS: [u64; 4] = [30, 60, 120, 300];
const MAX_FAILURES: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Startup,
    Focus,
    Changed,
    // The runner calls `on_tick` directly (wake detection); tests use it.
    #[allow(dead_code)]
    Tick,
    Manual,
    // Quit is handled by `runner::before_quit`; kept for the tests' contract.
    #[allow(dead_code)]
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Offline,
    Unauthorized,
    Failed,
    /// Deletion guard asked for confirmation: not an error for backoff.
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    StartCycle,
    None,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerView {
    pub running: bool,
    pub pending_debounce: bool,
    pub consecutive_failures: u32,
    pub offline: bool,
    /// Automatic retries stopped (Unauthorized) until "Sincronizar ahora" or
    /// a config change.
    pub halted: bool,
    /// Three or more consecutive failures: "Requiere revisión". Retries go on
    /// at the backoff cadence.
    pub needs_review: bool,
}

#[derive(Debug)]
pub struct Scheduler {
    running: bool,
    run_again: bool,
    debounce_deadline: Option<Instant>,
    last_focus: Option<Instant>,
    /// Last wall-clock time seen; `Instant` can freeze during sleep.
    last_wall: SystemTime,
    next_due: Instant,
    consecutive_failures: u32,
    backoff_step: usize,
    offline: bool,
    halted: bool,
}

impl Scheduler {
    pub fn new(now: Instant) -> Self {
        Self::new_at(now, SystemTime::now())
    }

    pub fn new_at(now: Instant, wall: SystemTime) -> Self {
        Scheduler {
            last_wall: wall,
            running: false,
            run_again: false,
            debounce_deadline: None,
            last_focus: None,
            next_due: now + TICK,
            consecutive_failures: 0,
            backoff_step: 0,
            offline: false,
            halted: false,
        }
    }

    /// A start decision: queue it if a cycle is running, otherwise begin one.
    fn request(&mut self, now: Instant) -> Action {
        if self.running {
            self.run_again = true;
            return Action::None;
        }
        self.running = true;
        self.run_again = false;
        self.debounce_deadline = None;
        self.next_due = now + TICK;
        Action::StartCycle
    }

    pub fn on_trigger(&mut self, t: Trigger, now: Instant) -> Action {
        match t {
            Trigger::Manual => {
                self.halted = false;
                self.consecutive_failures = 0;
                self.backoff_step = 0;
                self.request(now)
            }
            _ if self.halted => Action::None,
            Trigger::Startup => self.request(now),
            Trigger::Focus => {
                if let Some(last) = self.last_focus {
                    if now.saturating_duration_since(last) < FOCUS_THROTTLE {
                        return Action::None;
                    }
                }
                self.last_focus = Some(now);
                self.request(now)
            }
            Trigger::Changed => {
                self.debounce_deadline = Some(now + DEBOUNCE);
                Action::None
            }
            Trigger::Tick => self.on_tick(now, self.last_wall),
            Trigger::Quit => Action::None,
        }
    }

    pub fn on_tick(&mut self, now: Instant, wall: SystemTime) -> Action {
        // A backwards wall jump yields Err: not a wake.
        let woke = wall
            .duration_since(self.last_wall)
            .is_ok_and(|gap| gap > WAKE_GAP);
        self.last_wall = wall;
        if self.halted {
            return Action::None;
        }
        if woke {
            // `request` re-bases `next_due` (or queues `run_again` mid-cycle).
            return self.request(now);
        }
        if self.running {
            return Action::None;
        }
        if self.run_again {
            return self.request(now);
        }
        if self.debounce_deadline.is_some_and(|d| now >= d) {
            return self.request(now);
        }
        if now >= self.next_due {
            return self.request(now);
        }
        Action::None
    }

    pub fn on_cycle_end(&mut self, o: Outcome, now: Instant) {
        self.running = false;
        let mut next = TICK;
        match o {
            Outcome::Ok | Outcome::Paused => {
                self.consecutive_failures = 0;
                self.backoff_step = 0;
                self.offline = false;
            }
            Outcome::Offline => {
                self.offline = true;
                next = self.bump_backoff();
            }
            Outcome::Failed => {
                self.offline = false;
                // Never halts: "Requiere revisión" shows from the view while
                // the backoff keeps retrying.
                self.consecutive_failures += 1;
                next = self.bump_backoff();
            }
            Outcome::Unauthorized => {
                self.offline = false;
                self.halted = true;
            }
        }
        self.next_due = now + next;
    }

    fn bump_backoff(&mut self) -> Duration {
        let secs = BACKOFF_SECS[self.backoff_step.min(BACKOFF_SECS.len() - 1)];
        self.backoff_step += 1;
        Duration::from_secs(secs)
    }

    pub fn on_external_change_during_cycle(&mut self) {
        if self.running {
            self.run_again = true;
        }
    }

    pub fn view(&self) -> SchedulerView {
        SchedulerView {
            running: self.running,
            pending_debounce: self.debounce_deadline.is_some(),
            consecutive_failures: self.consecutive_failures,
            offline: self.offline,
            halted: self.halted,
            needs_review: self.consecutive_failures >= MAX_FAILURES,
        }
    }
}
