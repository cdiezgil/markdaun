//! Decodes a recording (whatever container the webview produced) into the
//! 16 kHz mono `f32` samples Whisper expects.

use super::VoiceError;
use std::path::Path;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

pub const WHISPER_RATE: u32 = 16_000;
/// Half-width of the resampling kernel, in zero crossings of the low-pass.
const KERNEL_ZEROS: f64 = 16.0;

pub struct Decoded {
    /// Mono samples at [`WHISPER_RATE`].
    pub samples: Vec<f32>,
    pub duration_secs: f64,
}

fn codecs() -> CodecRegistry {
    let mut reg = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut reg);
    // WebView2 (Windows) records WebM/Opus, which Symphonia cannot decode itself.
    reg.register_audio_decoder::<symphonia_adapter_libopus::OpusDecoder>();
    reg
}

fn dec<E: std::fmt::Display>(e: E) -> VoiceError {
    VoiceError::Decode(e.to_string())
}

/// Averages interleaved channels into one.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect()
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// Windowed-sinc resampler (Blackman window) with an anti-aliasing cutoff
/// when going down. Output length is `input.len() * to / from`.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64; // input samples per output sample
    let scale = ratio.max(1.0);
    let cutoff = 0.5 / scale; // cycles per input sample
    let half = (KERNEL_ZEROS * scale).ceil() as i64;
    let out_len = (input.len() as f64 / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let center = i as f64 * ratio;
        let lo = (center.floor() as i64 - half + 1).max(0);
        let hi = (center.floor() as i64 + half).min(input.len() as i64 - 1);
        let (mut acc, mut norm) = (0.0f64, 0.0f64);
        for j in lo..=hi {
            let x = j as f64 - center;
            let w = {
                let r = (x / half as f64).clamp(-1.0, 1.0);
                0.42 + 0.5 * (std::f64::consts::PI * r).cos() + 0.08 * (2.0 * std::f64::consts::PI * r).cos()
            };
            let k = 2.0 * cutoff * sinc(2.0 * cutoff * x) * w;
            acc += input[j as usize] as f64 * k;
            norm += k;
        }
        out.push(if norm.abs() > 1e-12 { (acc / norm) as f32 } else { 0.0 });
    }
    out
}

/// Decodes `path` to mono 16 kHz. The extension is only a probing hint.
pub fn decode_file(path: &Path) -> Result<Decoded, VoiceError> {
    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(dec)?;
    let track = format.default_track(TrackType::Audio).ok_or_else(|| dec("no audio track"))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| dec("missing codec parameters"))?;
    let mut decoder = codecs().make_audio_decoder(params, &AudioDecoderOptions::default()).map_err(dec)?;

    let mut mono: Vec<f32> = Vec::new();
    let mut rate = params.sample_rate.unwrap_or(0);
    let mut scratch: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A stream that ends abruptly (a recording cut short) is still usable.
            Err(SymError::IoError(_)) => break,
            Err(e) => return Err(dec(e)),
        };
        if packet.track_id != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buf) => {
                let spec = buf.spec();
                rate = spec.rate();
                scratch.clear();
                buf.copy_to_vec_interleaved(&mut scratch);
                mono.extend(downmix(&scratch, spec.channels().count().max(1)));
            }
            // Skip a damaged packet; keep what decodes.
            Err(SymError::IoError(_)) | Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(dec(e)),
        }
    }
    if mono.is_empty() || rate == 0 {
        return Err(dec("no audio decoded"));
    }
    let duration_secs = mono.len() as f64 / rate as f64;
    Ok(Decoded { samples: resample(&mono, rate, WHISPER_RATE), duration_secs })
}
