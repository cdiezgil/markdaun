//! File names derived from note titles: sanitising and collision handling.

use std::path::{Path, PathBuf};

/// Longest file stem (in chars) produced from a title.
const MAX_STEM_CHARS: usize = 120;

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Turns free text (a note's H1) into a safe file stem.
///
/// Invalid filename characters (`/ \ : * ? " < > |`) and control characters
/// become `-`; leading/trailing whitespace and dots are trimmed. Returns
/// `None` when nothing usable is left (callers keep the current name).
pub fn sanitize_file_stem(title: &str) -> Option<String> {
    let replaced: String = title
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let trimmed = replaced.trim_matches(|c: char| c.is_whitespace() || c == '.');
    if trimmed.is_empty() {
        return None;
    }
    let mut out: String = trimmed.chars().take(MAX_STEM_CHARS).collect();
    // Truncation may expose trailing spaces/dots again.
    out = out.trim_end_matches(|c: char| c.is_whitespace() || c == '.').to_string();
    if out.is_empty() {
        return None;
    }
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&out)) {
        out.push('-');
    }
    Some(out)
}

/// `base.ext`, or `base 2.ext`, `base 3.ext`… the first that does not exist
/// in `dir`. `ext` is given without the dot.
pub fn unique_name(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let file = |n: u32| {
        let stem = if n == 1 { base.to_string() } else { format!("{base} {n}") };
        if ext.is_empty() { stem } else { format!("{stem}.{ext}") }
    };
    let mut n = 1;
    loop {
        let candidate = dir.join(file(n));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}
