use super::audio::{decode_file, downmix, resample, WHISPER_RATE};
use std::path::Path;
use tempfile::tempdir;

/// RIFF/WAVE PCM16 file with `channels` interleaved copies of a sine.
fn write_sine_wav(path: &Path, rate: u32, channels: u16, secs: f32, hz: f32) {
    let frames = (rate as f32 * secs) as usize;
    let mut data: Vec<u8> = Vec::new();
    for i in 0..frames {
        let v = ((i as f32 / rate as f32 * hz * std::f32::consts::TAU).sin() * 0.5 * i16::MAX as f32) as i16;
        for _ in 0..channels {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
    out.extend_from_slice(&(channels * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    std::fs::write(path, out).unwrap();
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

/// Dominant frequency estimate by counting rising zero crossings.
fn freq(x: &[f32], rate: u32) -> f32 {
    let crossings = x.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
    crossings as f32 * rate as f32 / x.len() as f32
}

#[test]
fn downmix_averages_channels() {
    assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    assert_eq!(downmix(&[0.25, 0.5], 1), vec![0.25, 0.5]);
}

#[test]
fn resample_keeps_duration_and_frequency_when_downsampling() {
    let rate = 48_000;
    let input: Vec<f32> = (0..rate).map(|i| (i as f32 / rate as f32 * 440.0 * std::f32::consts::TAU).sin() * 0.5).collect();
    let out = resample(&input, rate, WHISPER_RATE);
    assert!((out.len() as i64 - WHISPER_RATE as i64).abs() <= 2, "len {}", out.len());
    assert!((freq(&out, WHISPER_RATE) - 440.0).abs() < 5.0);
    assert!((rms(&out[200..out.len() - 200]) - 0.3535).abs() < 0.02, "amplitude preserved");
}

#[test]
fn resample_removes_content_above_the_new_nyquist() {
    let rate = 48_000;
    let input: Vec<f32> = (0..rate).map(|i| (i as f32 / rate as f32 * 12_000.0 * std::f32::consts::TAU).sin() * 0.5).collect();
    let out = resample(&input, rate, WHISPER_RATE);
    assert!(rms(&out[200..out.len() - 200]) < 0.02, "aliasing leaked through");
}

#[test]
fn resample_same_rate_is_identity_and_upsampling_works() {
    let x = vec![0.0, 0.5, -0.5, 0.25];
    assert_eq!(resample(&x, 16_000, 16_000), x);
    let input: Vec<f32> = (0..8000).map(|i| (i as f32 / 8000.0 * 200.0 * std::f32::consts::TAU).sin() * 0.5).collect();
    let out = resample(&input, 8000, 16_000);
    assert!((out.len() as i64 - 16_000).abs() <= 2);
    assert!((freq(&out, 16_000) - 200.0).abs() < 4.0);
}

#[test]
fn decodes_stereo_wav_to_mono_16k() {
    let dir = tempdir().unwrap();
    let p = dir.path().join("t.wav");
    write_sine_wav(&p, 44_100, 2, 1.0, 300.0);
    let d = decode_file(&p).unwrap();
    assert!((d.samples.len() as i64 - 16_000).abs() <= 4, "len {}", d.samples.len());
    assert!((d.duration_secs - 1.0).abs() < 0.01);
    assert!((freq(&d.samples, WHISPER_RATE) - 300.0).abs() < 5.0);
}

#[test]
fn decodes_the_spanish_fixtures() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/voice/fixtures");
    for name in ["voz-prueba.wav", "voz-prueba.m4a"] {
        let d = decode_file(&dir.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(d.duration_secs > 1.5 && d.duration_secs < 4.0, "{name}: {}", d.duration_secs);
        assert!(rms(&d.samples) > 0.01, "{name} has speech energy");
    }
}

#[test]
fn garbage_is_a_decode_error() {
    let dir = tempdir().unwrap();
    let p = dir.path().join("x.m4a");
    std::fs::write(&p, b"definitely not audio at all, just text").unwrap();
    assert!(matches!(decode_file(&p), Err(super::VoiceError::Decode(_))));
    assert!(decode_file(&dir.path().join("missing.m4a")).is_err());
}
