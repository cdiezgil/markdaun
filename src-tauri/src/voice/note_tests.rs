use super::note::{
    format_duration, format_timestamp, group_paragraphs, render_voice_note, title_date, Segment, VoiceMeta,
};
use chrono::NaiveDate;

fn seg(start_s: u64, end_s: u64, text: &str) -> Segment {
    Segment { start_ms: start_s * 1000, end_ms: end_s * 1000, text: text.to_string() }
}

fn when() -> chrono::NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(14, 32, 5).unwrap()
}

#[test]
fn durations_use_m_ss_and_h_mm_ss() {
    assert_eq!(format_duration(0), "0:00");
    assert_eq!(format_duration(9), "0:09");
    assert_eq!(format_duration(192), "3:12");
    assert_eq!(format_duration(3723), "1:02:03");
}

#[test]
fn timestamps_are_mm_ss_and_grow_an_hour_part_for_long_audio() {
    assert_eq!(format_timestamp(0, false), "00:00");
    assert_eq!(format_timestamp(75_400, false), "01:15");
    assert_eq!(format_timestamp(3_723_000, true), "01:02:03");
    assert_eq!(format_timestamp(75_400, true), "00:01:15");
}

#[test]
fn title_date_is_spanish_and_short() {
    assert_eq!(title_date(when()), "18 oct 2026, 14:32");
}

#[test]
fn paragraphs_break_at_segment_boundaries_about_every_thirty_seconds() {
    let segs = vec![
        seg(0, 10, " Hola. "),
        seg(10, 20, "Seguimos."),
        seg(29, 35, "Aún el mismo."),
        seg(31, 40, "Nuevo párrafo."),
        seg(50, 55, "   "),
        seg(62, 70, "Otro más."),
    ];
    let paras = group_paragraphs(&segs);
    assert_eq!(
        paras,
        vec![
            (0, "Hola. Seguimos. Aún el mismo.".to_string()),
            (31_000, "Nuevo párrafo.".to_string()),
            (62_000, "Otro más.".to_string()),
        ]
    );
}

#[test]
fn renders_the_documented_note() {
    let meta = VoiceMeta {
        recorded: when(),
        duration_secs: 192,
        language: "es",
        model: "large-v3-turbo",
        audio_name: "Nota de voz 2026-10-18 14-32.m4a",
    };
    let md = render_voice_note(&meta, &[seg(0, 5, "Primera idea."), seg(32, 40, "Segunda idea.")]);
    let expected = "# Nota de voz — 18 oct 2026, 14:32\n\n\
- Fecha: 2026-10-18 14:32\n\
- Duración: 3:12\n\
- Idioma: es\n\
- Modelo: large-v3-turbo\n\
- Audio: [Nota de voz 2026-10-18 14-32.m4a](Nota%20de%20voz%202026-10-18%2014-32.m4a)\n\n\
## Transcripción\n\n\
[00:00] Primera idea.\n\n\
[00:32] Segunda idea.\n";
    assert_eq!(md, expected);
}

#[test]
fn a_recording_without_speech_says_so() {
    let meta = VoiceMeta { recorded: when(), duration_secs: 4, language: "es", model: "small", audio_name: "a.m4a" };
    let md = render_voice_note(&meta, &[]);
    assert!(md.contains("## Transcripción\n\n_(No se detectó voz.)_\n"), "{md}");
}

#[test]
fn recordings_over_an_hour_use_hour_timestamps() {
    let meta = VoiceMeta { recorded: when(), duration_secs: 3700, language: "es", model: "small", audio_name: "a.m4a" };
    let md = render_voice_note(&meta, &[seg(0, 5, "Inicio."), seg(3650, 3660, "Final.")]);
    assert!(md.contains("[00:00:00] Inicio.") && md.contains("[01:00:50] Final."), "{md}");
}
