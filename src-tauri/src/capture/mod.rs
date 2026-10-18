//! Capture channels: Word/PowerPoint extraction, URL clipping and quick capture.
pub mod clip;
pub mod office;

#[cfg(test)]
pub mod testutil;

#[cfg(test)]
mod office_tests;

#[cfg(test)]
mod clip_tests;
