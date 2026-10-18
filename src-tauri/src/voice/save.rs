//! Storing a finished recording in the inbox.

use crate::commands::inbox::{inbox_ensure_inner, INBOX_DIR};
use chrono::NaiveDateTime;
use std::path::{Path, PathBuf};

/// Largest recording accepted (30 minutes of speech is a few tens of MB).
pub const MAX_AUDIO_BYTES: usize = 200 * 1024 * 1024;

/// File extension for the container the webview recorded (from the MIME type).
pub fn audio_ext(mime: &str) -> Option<&'static str> {
    let base = mime.split(';').next().unwrap_or("").trim().to_lowercase();
    match base.as_str() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" | "video/mp4" => Some("m4a"),
        "audio/webm" | "video/webm" => Some("webm"),
        "audio/ogg" | "audio/opus" => Some("ogg"),
        "audio/wav" | "audio/x-wav" | "audio/wave" => Some("wav"),
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        _ => None,
    }
}

/// Writes the recording as `Entrada/Nota de voz <date> <time>.<ext>` and
/// returns its path and vault-relative path. The name is numbered (" 2"…)
/// until neither the audio nor a transcript note with that stem exists.
pub fn save_recording(
    vault: &Path,
    bytes: &[u8],
    mime: &str,
    now: NaiveDateTime,
) -> Result<(PathBuf, String), String> {
    if bytes.is_empty() {
        return Err("empty_audio".to_string());
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("audio_too_large".to_string());
    }
    let ext = audio_ext(mime).ok_or_else(|| "unsupported_audio".to_string())?;
    let dir = inbox_ensure_inner(vault)?;
    let base = format!("Nota de voz {}", now.format("%Y-%m-%d %H-%M"));
    let mut n = 1;
    let stem = loop {
        let stem = if n == 1 { base.clone() } else { format!("{base} {n}") };
        let taken = std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .any(|e| e.path().file_stem().is_some_and(|s| s.to_string_lossy() == stem))
            })
            .unwrap_or(false);
        if !taken {
            break stem;
        }
        n += 1;
    };
    let name = format!("{stem}.{ext}");
    let path = dir.join(&name);
    std::fs::write(&path, bytes).map_err(|e| format!("io_error: {e}"))?;
    Ok((path, format!("{INBOX_DIR}/{name}")))
}
