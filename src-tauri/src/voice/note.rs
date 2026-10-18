//! The Markdown note a transcribed voice recording becomes.

use chrono::{Datelike, NaiveDateTime, Timelike};

/// Seconds of speech after which the transcript starts a new paragraph.
const PARAGRAPH_MS: u64 = 30_000;
const MONTHS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

pub struct VoiceMeta<'a> {
    pub recorded: NaiveDateTime,
    pub duration_secs: u64,
    pub language: &'a str,
    pub model: &'a str,
    /// File name of the audio next to the note.
    pub audio_name: &'a str,
}

/// `3:12`, or `1:02:03` from one hour.
pub fn format_duration(secs: u64) -> String {
    let (h, m, s) = (secs / 3600, secs / 60 % 60, secs % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// `mm:ss`, or `hh:mm:ss` when `long`.
pub fn format_timestamp(ms: u64, long: bool) -> String {
    let secs = ms / 1000;
    let (h, m, s) = (secs / 3600, secs / 60 % 60, secs % 60);
    if long {
        format!("{h:02}:{m:02}:{s:02}")
    } else {
        format!("{:02}:{s:02}", secs / 60)
    }
}

/// `18 oct 2026, 14:32`.
pub fn title_date(dt: NaiveDateTime) -> String {
    format!("{} {} {}, {:02}:{:02}", dt.day(), MONTHS[dt.month0() as usize], dt.year(), dt.hour(), dt.minute())
}

/// Joins consecutive segments into paragraphs that start about every thirty
/// seconds, always at a segment boundary. Returns `(start_ms, text)`.
pub fn group_paragraphs(segments: &[Segment]) -> Vec<(u64, String)> {
    let mut out: Vec<(u64, String)> = Vec::new();
    for s in segments {
        let text = s.text.trim();
        if text.is_empty() {
            continue;
        }
        match out.last_mut() {
            Some((start, body)) if s.start_ms.saturating_sub(*start) < PARAGRAPH_MS => {
                body.push(' ');
                body.push_str(text);
            }
            _ => out.push((s.start_ms, text.to_string())),
        }
    }
    out
}

fn encode_link(name: &str) -> String {
    name.replace('%', "%25").replace(' ', "%20").replace('(', "%28").replace(')', "%29")
}

pub fn render_voice_note(meta: &VoiceMeta, segments: &[Segment]) -> String {
    let long = meta.duration_secs >= 3600 || segments.iter().any(|s| s.start_ms >= 3_600_000);
    let mut out = format!(
        "# Nota de voz — {}\n\n- Fecha: {}\n- Duración: {}\n- Idioma: {}\n- Modelo: {}\n- Audio: [{}]({})\n\n## Transcripción\n\n",
        title_date(meta.recorded),
        meta.recorded.format("%Y-%m-%d %H:%M"),
        format_duration(meta.duration_secs),
        meta.language,
        meta.model,
        meta.audio_name,
        encode_link(meta.audio_name),
    );
    let paragraphs = group_paragraphs(segments);
    if paragraphs.is_empty() {
        out.push_str("_(No se detectó voz.)_\n");
        return out;
    }
    let body: Vec<String> =
        paragraphs.iter().map(|(start, text)| format!("[{}] {text}", format_timestamp(*start, long))).collect();
    out.push_str(&body.join("\n\n"));
    out.push('\n');
    out
}
