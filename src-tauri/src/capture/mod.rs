//! Capture channels: Word/PowerPoint extraction, URL clipping and quick capture.
pub mod clip;
pub mod lifecycle;
pub mod office;
pub mod quick;
pub mod shortcut;
pub mod tray;

#[cfg(test)]
pub mod testutil;

#[cfg(test)]
mod office_tests;

#[cfg(test)]
mod clip_tests;

#[cfg(test)]
mod quick_tests;

#[cfg(test)]
mod shortcut_tests;

#[cfg(test)]
mod lifecycle_tests;
